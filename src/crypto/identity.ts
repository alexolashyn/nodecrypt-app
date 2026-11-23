import { Signature, type Signer } from 'ethers';
import { CHAIN_ID, PROFILE_REGISTRY_ADDRESS } from '@/config';
import { AppError } from '@/shared/errors';
import {
  type Bytes,
  base64UrlToBytes,
  bytesEqual,
  bytesToBigInt,
  concatBytes,
  hexToBytes,
  utf8,
  wipe,
} from './bytes';
import { CURVE_N, scalarToPkcs8 } from './p256';

const PURPOSE =
  'Derive nodecrypt encryption key. Sign ONLY on the nodecrypt app.';

const DOMAIN = {
  name: 'nodecrypt',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: PROFILE_REGISTRY_ADDRESS,
};

const TYPES = {
  KeyDerivation: [
    { name: 'purpose', type: 'string' },
    { name: 'account', type: 'address' },
    { name: 'keyVersion', type: 'uint32' },
  ],
};

const HKDF_SALT = utf8('nodecrypt/identity/v1');
const MAX_DERIVATION_ATTEMPTS = 16;

export interface IdentityKey {
  privateKey: CryptoKey;
  x: Bytes;
  yOdd: boolean;
}

export class UnsupportedWalletError extends AppError {
  constructor() {
    super(
      'errors:crypto.unsupportedWallet',
      'wallet returned two different signatures for the same message',
    );
    this.name = 'UnsupportedWalletError';
  }
}

export const signDerivationMessage = async (
  signer: Signer,
  address: string,
  keyVersion: number,
  options: { checkDeterminism?: boolean } = {},
): Promise<Bytes> => {
  const signOnce = async (): Promise<Bytes> => {
    const raw = await signer.signTypedData(DOMAIN, TYPES, {
      purpose: PURPOSE,
      account: address,
      keyVersion,
    });

    const signature = Signature.from(raw);
    return concatBytes(hexToBytes(signature.r), hexToBytes(signature.s));
  };

  const first = await signOnce();

  if (options.checkDeterminism) {
    const second = await signOnce();
    const identical = bytesEqual(first, second);
    wipe(second);

    if (!identical) {
      wipe(first);
      throw new UnsupportedWalletError();
    }
  }

  return first;
};

export const matchesPublicKey = (
  identity: Pick<IdentityKey, 'x' | 'yOdd'>,
  pubKeyX: string,
  pubKeyYOdd: boolean,
): boolean => pubKeyYOdd === identity.yOdd && bytesEqual(hexToBytes(pubKeyX), identity.x);

export const deriveIdentityKey = async (
  signatureBytes: Bytes,
  address: string,
  keyVersion: number,
): Promise<IdentityKey> => {
  const ikm = await crypto.subtle.importKey(
    'raw',
    signatureBytes,
    'HKDF',
    false,
    ['deriveBits'],
  );

  let scalar: Bytes | undefined;

  for (let counter = 0; counter < MAX_DERIVATION_ATTEMPTS; counter += 1) {
    const info = utf8(
      `p256|${address.toLowerCase()}|${CHAIN_ID}|${keyVersion}|${counter}`,
    );

    const candidate = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info },
        ikm,
        256,
      ),
    );

    const value = bytesToBigInt(candidate);
    if (value >= 1n && value < CURVE_N) {
      scalar = candidate;
      break;
    }

    wipe(candidate);
  }

  if (!scalar) {
    throw new AppError(
      'errors:crypto.derivationFailed',
      `no valid scalar after ${MAX_DERIVATION_ATTEMPTS} attempts`,
    );
  }

  const pkcs8 = scalarToPkcs8(scalar);

  const extractableKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  const jwk = await crypto.subtle.exportKey('jwk', extractableKey);
  const x = base64UrlToBytes(jwk.x!);
  const y = base64UrlToBytes(jwk.y!);

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: jwk.d,
      x: jwk.x,
      y: jwk.y,
      ext: false,
      key_ops: ['deriveBits'],
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );

  const yOdd = (y[31] & 1) === 1;

  wipe(scalar);
  wipe(pkcs8);
  jwk.d = undefined;

  return { privateKey, x, yOdd };
};
