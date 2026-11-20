import { AppError } from '@/shared/errors';
import { type Bytes, concatBytes, randomBytes, utf8 } from './bytes';
import { compressPoint, importPublicKey } from './p256';

const EPHEMERAL_KEY_BYTES = 33;
const IV_BYTES = 12;
const SEALED_BYTES = 93;

const HKDF_INFO = utf8('nodecrypt/ecies/v1');

export class UnsealError extends AppError {
  constructor(detail?: string) {
    super('errors:crypto.unsealFailed', detail);
    this.name = 'UnsealError';
  }
}

const deriveSharedKey = async (
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Bytes,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> => {
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );

  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
};

export const seal = async (
  recipientX: Bytes,
  recipientYOdd: boolean,
  plaintext: Bytes,
  aad: Bytes,
): Promise<Bytes> => {
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  const ephemeralRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeral.publicKey),
  );
  const ephemeralCompressed = compressPoint(
    ephemeralRaw.slice(1, 33),
    ephemeralRaw.slice(33, 65),
  );

  const recipientKey = await importPublicKey(recipientX, recipientYOdd);
  const kek = await deriveSharedKey(
    ephemeral.privateKey,
    recipientKey,
    ephemeralCompressed,
    'encrypt',
  );

  const iv = randomBytes(IV_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      kek,
      plaintext,
    ),
  );

  return concatBytes(ephemeralCompressed, iv, ciphertext);
};

export const unseal = async (
  identityPrivateKey: CryptoKey,
  sealed: Bytes,
  aad: Bytes,
): Promise<Bytes> => {
  if (sealed.length !== SEALED_BYTES) {
    throw new UnsealError(
      `expected ${SEALED_BYTES} bytes, got ${sealed.length}`,
    );
  }

  try {
    const ephemeralCompressed = sealed.slice(0, EPHEMERAL_KEY_BYTES);
    const iv = sealed.slice(EPHEMERAL_KEY_BYTES, EPHEMERAL_KEY_BYTES + IV_BYTES);
    const ciphertext = sealed.slice(EPHEMERAL_KEY_BYTES + IV_BYTES);

    const ephemeralKey = await importPublicKey(
      ephemeralCompressed.slice(1),
      ephemeralCompressed[0] === 0x03,
    );

    const kek = await deriveSharedKey(
      identityPrivateKey,
      ephemeralKey,
      ephemeralCompressed,
      'decrypt',
    );

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      kek,
      ciphertext,
    );

    return new Uint8Array(plaintext);
  } catch (error) {
    if (error instanceof UnsealError) throw error;
    throw new UnsealError();
  }
};
