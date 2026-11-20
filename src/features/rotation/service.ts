import { type Bytes, bytesEqual, bytesToHex, hexToBytes, wipe } from '@/crypto/bytes';
import { seal, unseal } from '@/crypto/ecies';
import { unwrapFileKey, wrapFileKey } from '@/crypto/fileCrypto';
import { deriveIdentityKey, signDerivationMessage } from '@/crypto/identity';
import {
  generateMasterKeyBytes,
  importMasterKey,
  masterKeyAad,
} from '@/crypto/masterKey';
import { type Keyring, masterKeyFor } from '@/context/keyring';
import { AppError } from '@/shared/errors';
import {
  MAX_REWRAP_BATCH,
  clearPendingMasterKey,
  decodeFileRegistryError,
  getAllFiles,
  getPendingMasterKey,
  rewrapFileKeys,
  setPendingMasterKey,
} from '@/web3/fileRegistry';
import {
  decodeContractError,
  getProfile,
  rotateIdentity,
  rotateMasterKey,
} from '@/web3/profileRegistry';
import type { Profile } from '@/web3/types';
import { connectAs } from '@/web3/wallet';
import {
  deleteFile,
  openFile,
  pushUpload,
  registerUpload,
  type UploadProgress,
} from '@/features/files/service';

export type RotationStage =
  | 'signing'
  | 'sealing'
  | 'parking'
  | 'rewrapping'
  | 'committing'
  | 'verifying'
  | 'cleanup'
  | 'downloading'
  | 'reuploading'
  | 'removing';

export interface RotationProgress {
  stage: RotationStage;
  done?: number;
  total?: number;
  upload?: UploadProgress;
}

type OnProgress = (progress: RotationProgress) => void;
type OnKeyring = (keyring: Keyring) => void;

const requireInSync = (profile: Profile, keyring: Keyring): void => {
  if (
    profile.keyVersion !== keyring.keyVersion ||
    profile.mkVersion !== keyring.mkVersion
  ) {
    throw new AppError(
      'errors:files.keyringStale',
      `profile kv=${profile.keyVersion}/mk=${profile.mkVersion}, keyring kv=${keyring.keyVersion}/mk=${keyring.mkVersion}`,
    );
  }
};

const sealChecked = async (
  privateKey: CryptoKey,
  x: Bytes,
  yOdd: boolean,
  secret: Bytes,
  aad: Bytes,
): Promise<Bytes> => {
  const sealed = await seal(x, yOdd, secret, aad);
  const roundTrip = await unseal(privateKey, sealed, aad);
  const ok = bytesEqual(roundTrip, secret);
  wipe(roundTrip);
  if (!ok) throw new AppError('errors:crypto.selfCheckFailed');
  return sealed;
};

export const rotateIdentityKey = async (
  keyring: Keyring,
  address: string,
  onProgress: OnProgress,
): Promise<Keyring> => {
  const wallet = await connectAs(address);
  const profile = await getProfile(wallet.provider, address);
  requireInSync(profile, keyring);

  if ((await getPendingMasterKey(wallet.provider, address)).length > 0) {
    throw new AppError('errors:rotation.migrationPending');
  }

  const nextKv = profile.keyVersion + 1;

  onProgress({ stage: 'signing' });
  const signature = await signDerivationMessage(wallet.signer, address, nextKv, {
    checkDeterminism: true,
  });
  const identity = await deriveIdentityKey(signature, address, nextKv);
  wipe(signature);

  onProgress({ stage: 'sealing' });
  const masterKeyBytes = await unseal(
    keyring.identityPrivateKey,
    hexToBytes(profile.wrappedMasterKey),
    masterKeyAad(address, profile.keyVersion, profile.mkVersion),
  );
  let sealed: Bytes;
  try {
    sealed = await sealChecked(
      identity.privateKey,
      identity.x,
      identity.yOdd,
      masterKeyBytes,
      masterKeyAad(address, nextKv, profile.mkVersion),
    );
  } finally {
    wipe(masterKeyBytes);
  }

  onProgress({ stage: 'committing' });
  try {
    await rotateIdentity(wallet.signer, bytesToHex(identity.x), identity.yOdd, bytesToHex(sealed));
  } catch (error) {
    throw decodeContractError(error);
  }

  onProgress({ stage: 'verifying' });
  const stored = await getProfile(wallet.provider, address);
  if (
    stored.keyVersion !== nextKv ||
    stored.pubKeyYOdd !== identity.yOdd ||
    !bytesEqual(hexToBytes(stored.pubKeyX), identity.x)
  ) {
    throw new AppError('errors:crypto.selfCheckFailed');
  }

  wipe(keyring.x);
  return {
    ...keyring,
    identityPrivateKey: identity.privateKey,
    x: identity.x,
    yOdd: identity.yOdd,
    keyVersion: nextKv,
  };
};

export const startMasterKeyRotation = async (
  keyring: Keyring,
  address: string,
  onProgress: OnProgress,
  onKeyring: OnKeyring,
): Promise<Keyring> => {
  const wallet = await connectAs(address);
  const profile = await getProfile(wallet.provider, address);
  requireInSync(profile, keyring);

  if ((await getPendingMasterKey(wallet.provider, address)).length > 0) {
    throw new AppError('errors:rotation.migrationPending');
  }

  onProgress({ stage: 'sealing' });
  const nextMk = profile.mkVersion + 1;
  const bytes = generateMasterKeyBytes();
  let sealed: Bytes;
  try {
    sealed = await sealChecked(
      keyring.identityPrivateKey,
      keyring.x,
      keyring.yOdd,
      bytes,
      masterKeyAad(address, profile.keyVersion, nextMk),
    );
  } catch (error) {
    wipe(bytes);
    throw error;
  }

  onProgress({ stage: 'parking' });
  try {
    await setPendingMasterKey(wallet.signer, sealed);
  } catch (error) {
    wipe(bytes);
    throw decodeFileRegistryError(error);
  }

  const parked: Keyring = {
    ...keyring,
    pendingMasterKey: await importMasterKey(bytes),
    migration: 'inProgress',
  };
  onKeyring(parked);

  return resumeMasterKeyRotation(parked, address, onProgress, onKeyring);
};

const rewrapAll = async (
  keyring: Keyring,
  address: string,
  toKey: CryptoKey,
  toMk: number,
  onProgress: OnProgress,
): Promise<void> => {
  const wallet = await connectAs(address);

  for (let pass = 0; pass < 3; pass += 1) {
    const records = await getAllFiles(wallet.provider, address);
    const todo = records.filter((record) => record.mkVersion !== toMk);
    if (todo.length === 0) return;

    let done = records.length - todo.length;
    onProgress({ stage: 'rewrapping', done, total: records.length });

    for (let i = 0; i < todo.length; i += MAX_REWRAP_BATCH) {
      const batch = todo.slice(i, i + MAX_REWRAP_BATCH);
      const wrapped: Uint8Array[] = [];

      for (const record of batch) {
        const fileKey = await unwrapFileKey(
          masterKeyFor(keyring, record.mkVersion),
          record.wrappedFileKey,
          address,
          record.fileId,
          record.mkVersion,
        );
        try {
          wrapped.push(await wrapFileKey(toKey, fileKey, address, record.fileId, toMk));
        } finally {
          wipe(fileKey);
        }
      }

      try {
        await rewrapFileKeys(
          wallet.signer,
          batch.map((record) => record.fileId),
          wrapped,
          toMk,
        );
      } catch (error) {
        throw decodeFileRegistryError(error);
      }
      done += batch.length;
      onProgress({ stage: 'rewrapping', done, total: records.length });
    }
  }

  throw new AppError('errors:rotation.filesKeepChanging');
};

export const resumeMasterKeyRotation = async (
  keyring: Keyring,
  address: string,
  onProgress: OnProgress,
  onKeyring: OnKeyring,
): Promise<Keyring> => {
  const wallet = await connectAs(address);

  if (keyring.migration === 'needsCleanup') {
    onProgress({ stage: 'cleanup' });
    await clearPendingMasterKey(wallet.signer).catch((error: unknown) => {
      throw decodeFileRegistryError(error);
    });
    const done: Keyring = { ...keyring, migration: 'none' };
    onKeyring(done);
    return done;
  }

  const nextKey = keyring.pendingMasterKey;
  if (keyring.migration !== 'inProgress' || !nextKey) {
    throw new AppError('errors:rotation.nothingToResume');
  }

  const profile = await getProfile(wallet.provider, address);
  requireInSync(profile, keyring);
  const sealed = await getPendingMasterKey(wallet.provider, address);
  if (sealed.length === 0) throw new AppError('errors:rotation.nothingToResume');

  const nextMk = keyring.mkVersion + 1;
  await rewrapAll(keyring, address, nextKey, nextMk, onProgress);

  onProgress({ stage: 'committing' });
  try {
    await rotateMasterKey(wallet.signer, bytesToHex(sealed));
  } catch (error) {
    throw decodeContractError(error);
  }

  const committed: Keyring = {
    ...keyring,
    masterKey: nextKey,
    mkVersion: nextMk,
    pendingMasterKey: null,
    migration: 'needsCleanup',
  };
  onKeyring(committed);

  await rewrapAll(keyring, address, nextKey, nextMk, onProgress);

  onProgress({ stage: 'cleanup' });
  try {
    await clearPendingMasterKey(wallet.signer);
  } catch (error) {
    throw decodeFileRegistryError(error);
  }

  const finished: Keyring = { ...committed, migration: 'none' };
  onKeyring(finished);
  return finished;
};

export const fullRotation = async (
  keyring: Keyring,
  address: string,
  onProgress: OnProgress,
): Promise<void> => {
  if (keyring.migration !== 'none') {
    throw new AppError('errors:rotation.migrationPending');
  }

  const wallet = await connectAs(address);
  const records = await getAllFiles(wallet.provider, address);
  const total = records.length;

  for (let i = 0; i < total; i += 1) {
    const { fileId } = records[i];

    onProgress({ stage: 'downloading', done: i, total });
    const { blob, meta } = await openFile(wallet.provider, keyring, address, fileId);

    const copy = new File([blob], meta.name, { type: meta.type });
    const report = (upload: UploadProgress) =>
      onProgress({ stage: 'reuploading', done: i, total, upload });

    const registered = await registerUpload(copy, keyring, address, report);
    try {
      await pushUpload(registered, report);
    } catch (error) {
      await deleteFile(address, registered.fileId).catch(() => undefined);
      throw error;
    }

    onProgress({ stage: 'removing', done: i, total });
    await deleteFile(address, fileId);
  }

  onProgress({ stage: 'removing', done: total, total });
};
