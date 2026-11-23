import type { Provider, Signer } from 'ethers';
import { SiweMessage } from 'siwe';
import { bytesEqual, bytesToHex, hexToBytes, wipe } from '@/crypto/bytes';
import { seal, unseal } from '@/crypto/ecies';
import { deriveIdentityKey, matchesPublicKey, signDerivationMessage } from '@/crypto/identity';
import { generateMasterKeyBytes, importMasterKey, masterKeyAad } from '@/crypto/masterKey';
import type { Keyring } from '@/context/keyring';
import { fetchNonce, verifySignIn } from '@/features/auth/api';
import {
  type UploadProgress,
  type UploadStage,
  deleteFile,
  loadFilesPage,
  openFile,
  pushUpload,
  registerUpload,
} from '@/features/files/service';
import { loadPendingState } from '@/features/rotation/pending';
import { rotateIdentityKey, startMasterKeyRotation } from '@/features/rotation/service';
import { AppError } from '@/shared/errors';
import { getProfile, registerProfile } from '@/web3/profileRegistry';

export interface SimWallet {
  provider: Provider;
  signer: Signer;
  address: string;
  chainId: number;
}

export interface SimUser {
  index: number;
  wallet: SimWallet;
  accessToken: string | null;
}

export interface SimOptions {
  files: number;
  sizeBytes: number;
  rotate: boolean;
  cleanup: boolean;
  siweDomain: string;
  siweUri: string;
  onUploaded: (cid: string, container: Blob) => Promise<void>;
}

export interface StepRecord {
  user: number;
  step: string;
  file: number | null;
  ms: number;
  ok: boolean;
  error?: string;
}

type Recorder = (record: StepRecord) => void;

const describeError = (error: unknown) =>
  error instanceof AppError
    ? `${error.key}${error.detail ? ` (${error.detail})` : ''}`
    : error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);

const sha256 = async (data: Blob) =>
  bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', await data.arrayBuffer())));

const randomFile = (index: number, size: number): File => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 65_536) crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65_536, size)));
  return new File([bytes], `sim-${index}.bin`, { type: 'application/octet-stream' });
};

async function register(wallet: SimWallet): Promise<Keyring> {
  const { signer, address } = wallet;
  const signature = await signDerivationMessage(signer, address, 1, { checkDeterminism: true });
  const identity = await deriveIdentityKey(signature, address, 1);
  wipe(signature);

  const masterKeyBytes = generateMasterKeyBytes();
  const aad = masterKeyAad(address, 1, 1);
  const sealed = await seal(identity.x, identity.yOdd, masterKeyBytes, aad);
  const roundTrip = await unseal(identity.privateKey, sealed, aad);
  const sealIsValid = bytesEqual(roundTrip, masterKeyBytes);
  wipe(roundTrip);
  if (!sealIsValid) throw new AppError('errors:crypto.selfCheckFailed');

  await registerProfile(signer, bytesToHex(identity.x), identity.yOdd, bytesToHex(sealed));
  const stored = await getProfile(wallet.provider, address);
  if (!stored.exists || !matchesPublicKey(identity, stored.pubKeyX, stored.pubKeyYOdd))
    throw new AppError('errors:crypto.selfCheckFailed');

  return {
    identityPrivateKey: identity.privateKey,
    x: identity.x,
    yOdd: identity.yOdd,
    masterKey: await importMasterKey(masterKeyBytes),
    keyVersion: 1,
    mkVersion: 1,
    pendingMasterKey: null,
    migration: 'none',
  };
}

async function signIn(user: SimUser, options: SimOptions): Promise<void> {
  const { signer, address, chainId } = user.wallet;
  const { nonce } = await fetchNonce();
  const message = new SiweMessage({
    domain: options.siweDomain,
    address,
    statement: 'Sign in to nodecrypt.',
    uri: options.siweUri,
    version: '1',
    chainId,
    nonce,
  }).prepareMessage();
  const tokens = await verifySignIn(message, await signer.signMessage(message));
  user.accessToken = tokens.accessToken;
}

async function unlock(wallet: SimWallet): Promise<Keyring> {
  const { provider, signer, address } = wallet;
  const profile = await getProfile(provider, address);
  if (!profile.exists) throw new AppError('errors:contract.profileNotFound');
  const signature = await signDerivationMessage(signer, address, profile.keyVersion);
  const identity = await deriveIdentityKey(signature, address, profile.keyVersion);
  wipe(signature);
  if (!matchesPublicKey(identity, profile.pubKeyX, profile.pubKeyYOdd)) throw new AppError('errors:crypto.keyMismatch');

  const masterKeyBytes = await unseal(
    identity.privateKey,
    hexToBytes(profile.wrappedMasterKey),
    masterKeyAad(address, profile.keyVersion, profile.mkVersion),
  );
  const masterKey = await importMasterKey(masterKeyBytes);
  const pending = await loadPendingState(provider, address, identity.privateKey, profile.keyVersion, profile.mkVersion);
  return {
    identityPrivateKey: identity.privateKey,
    x: identity.x,
    yOdd: identity.yOdd,
    masterKey,
    keyVersion: profile.keyVersion,
    mkVersion: profile.mkVersion,
    ...pending,
  };
}

export async function runUser(user: SimUser, options: SimOptions, record: Recorder): Promise<boolean> {
  const { address, provider } = user.wallet;

  const step = async <T>(name: string, file: number | null, run: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      const value = await run();
      record({ user: user.index, step: name, file, ms: performance.now() - start, ok: true });
      return value;
    } catch (error) {
      record({ user: user.index, step: name, file, ms: performance.now() - start, ok: false, error: describeError(error) });
      throw error;
    }
  };

  try {
    let keyring = await step('register', null, () => register(user.wallet));
    await step('login', null, () => signIn(user, options));
    keyring = await step('unlock', null, () => unlock(user.wallet));

    const uploaded: { fileId: string; digest: string; name: string }[] = [];
    for (let f = 0; f < options.files; f += 1) {
      const file = randomFile(f, options.sizeBytes);
      const digest = await sha256(file);

      let stage: UploadStage | null = null;
      let stageStart = 0;
      const onProgress = (p: UploadProgress) => {
        if (p.stage === stage) return;
        const now = performance.now();
        if (stage) record({ user: user.index, step: `upload.${stage}`, file: f, ms: now - stageStart, ok: true });
        stage = p.stage;
        stageStart = now;
      };

      const registered = await step('upload', f, async () => {
        const result = await registerUpload(file, keyring, address, onProgress);
        await pushUpload(result, onProgress);
        if (stage) record({ user: user.index, step: `upload.${stage}`, file: f, ms: performance.now() - stageStart, ok: true });
        return result;
      });
      await options.onUploaded(registered.cid, registered.container);
      uploaded.push({ fileId: registered.fileId, digest, name: file.name });
    }

    await step('list', null, async () => {
      const page = await loadFilesPage(provider, keyring, address, 0, Math.max(options.files, 1));
      const readable = page.entries.filter((e) => e.meta !== null).length;
      if (page.total !== options.files || readable !== options.files)
        throw new Error(`listed ${page.total} files, ${readable} readable, expected ${options.files}`);
    });

    const download = async (prefix: string) => {
      for (const [f, item] of uploaded.entries()) {
        await step(prefix, f, async () => {
          const { blob, meta } = await openFile(provider, keyring, address, item.fileId);
          if (meta.name !== item.name) throw new Error(`name "${meta.name}" instead of "${item.name}"`);
          if ((await sha256(blob)) !== item.digest) throw new Error('downloaded content differs from the original');
        });
      }
    };
    await download('download');

    if (options.rotate) {
      keyring = await step('rotateIdentity', null, () => rotateIdentityKey(keyring, address, () => {}));
      keyring = await step('rotateMasterKey', null, () =>
        startMasterKeyRotation(keyring, address, () => {}, (next) => (keyring = next)),
      );
      keyring = await step('unlockAfterRotation', null, () => unlock(user.wallet));
      await download('downloadAfterRotation');
    }

    if (options.cleanup) {
      for (const [f, item] of uploaded.entries()) await step('delete', f, () => deleteFile(address, item.fileId));
    }
    return true;
  } catch {
    return false;
  }
}
