import type { Provider } from 'ethers';
import type { CID } from 'multiformats/cid';
import { IPFS_GATEWAY_URLS } from '@/config';
import { wipe } from '@/crypto/bytes';
import { cidFromBytes, computeCid } from '@/crypto/cid';
import {
  type FileMeta,
  type ProgressFn,
  containerSize,
  decryptContainer,
  decryptMeta,
  encryptContainer,
  encryptMeta,
  generateFileId,
  generateFileKey,
  unwrapFileKey,
  wrapFileKey,
} from '@/crypto/fileCrypto';
import { type Keyring, masterKeyFor } from '@/context/keyring';
import { AppError } from '@/shared/errors';
import { formatBytes } from '@/shared/format';
import {
  addFile,
  decodeFileRegistryError,
  getFile,
  getFileCount,
  getFiles,
  removeFile,
} from '@/web3/fileRegistry';
import { getProfile } from '@/web3/profileRegistry';
import { getMaxFileBytes } from '@/web3/storageTier';
import type { FileRecord } from '@/web3/types';
import { connectAs } from '@/web3/wallet';
import { type FileStatus, UploadError, releaseRemote, uploadContainer } from './api';

export type UploadStage =
  | 'checking'
  | 'encrypting'
  | 'hashing'
  | 'registering'
  | 'uploading'
  | 'retrying';

export interface UploadProgress {
  stage: UploadStage;
  fraction?: number;
  attempt?: number;
}

export interface RegisteredUpload {
  fileId: string;
  name: string;
  container: Blob;
  cid: string;
}

const toFraction =
  (stage: UploadStage, onProgress: (p: UploadProgress) => void): ProgressFn =>
  (done, total) =>
    onProgress({ stage, fraction: total ? done / total : 1 });

const currentMkVersion = async (
  provider: Provider,
  address: string,
  keyring: Keyring,
): Promise<number> => {
  const { mkVersion } = await getProfile(provider, address);
  if (mkVersion !== keyring.mkVersion) {
    throw new AppError(
      'errors:files.keyringStale',
      `profile mk=${mkVersion}, keyring mk=${keyring.mkVersion}`,
    );
  }
  return mkVersion;
};

export const registerUpload = async (
  file: File,
  keyring: Keyring,
  address: string,
  onProgress: (p: UploadProgress) => void,
): Promise<RegisteredUpload> => {
  onProgress({ stage: 'checking' });
  const wallet = await connectAs(address);
  const mkVersion = await currentMkVersion(wallet.provider, address, keyring);

  const sizeBytes = containerSize(file.size);
  const maxBytes = await getMaxFileBytes(wallet.provider, address);
  if (BigInt(sizeBytes) > maxBytes) {
    throw new AppError('errors:files.tooLarge', undefined, {
      size: formatBytes(sizeBytes),
      max: formatBytes(maxBytes),
    });
  }

  const fileId = generateFileId();
  const fileKey = generateFileKey();
  let container: Blob;
  let wrappedFileKey: Uint8Array;
  let encryptedMeta: Uint8Array;
  try {
    onProgress({ stage: 'encrypting', fraction: 0 });
    container = await encryptContainer(
      file,
      fileKey,
      fileId,
      toFraction('encrypting', onProgress),
    );
    wrappedFileKey = await wrapFileKey(
      keyring.masterKey,
      fileKey,
      address,
      fileId,
      mkVersion,
    );
    encryptedMeta = await encryptMeta(fileKey, fileId, {
      name: file.name,
      type: file.type,
    });
  } finally {
    wipe(fileKey);
  }

  onProgress({ stage: 'hashing' });
  const cid = await computeCid(container);

  onProgress({ stage: 'registering' });
  try {
    await addFile(wallet.signer, {
      fileId,
      cid: cid.bytes,
      wrappedFileKey,
      encryptedMeta,
      sizeBytes: container.size,
      mkVersion,
    });
  } catch (error) {
    throw decodeFileRegistryError(error);
  }

  return { fileId, name: file.name, container, cid: cid.toString() };
};

export const pushUpload = async (
  upload: RegisteredUpload,
  onProgress: (p: UploadProgress) => void,
): Promise<FileStatus> => {
  onProgress({ stage: 'uploading' });
  const status = await uploadContainer(upload.fileId, upload.container, (attempt) =>
    onProgress({ stage: 'retrying', attempt }),
  );
  if (status.cid !== upload.cid) {
    throw new UploadError(
      'errors:upload.cidMismatch',
      false,
      `server cid=${status.cid}, on-chain cid=${upload.cid}`,
    );
  }
  return status;
};

export interface FileEntry {
  fileId: string;
  meta: FileMeta | null;
  sizeBytes: bigint;
  uploadedAt: number;
  mkVersion: number;
  cid: string;
}

const describe = async (
  record: FileRecord,
  keyring: Keyring,
  address: string,
): Promise<FileEntry> => {
  let meta: FileMeta | null = null;
  try {
    const fileKey = await unwrapFileKey(
      masterKeyFor(keyring, record.mkVersion),
      record.wrappedFileKey,
      address,
      record.fileId,
      record.mkVersion,
    );
    try {
      meta = await decryptMeta(fileKey, record.fileId, record.encryptedMeta);
    } finally {
      wipe(fileKey);
    }
  } catch (error) {
    console.warn(`metadata of ${record.fileId} is unreadable`, error);
  }

  let cid = '';
  try {
    cid = cidFromBytes(record.cid).toString();
  } catch {}

  return {
    fileId: record.fileId,
    meta,
    sizeBytes: record.sizeBytes,
    uploadedAt: record.uploadedAt,
    mkVersion: record.mkVersion,
    cid,
  };
};

export interface FileListPage {
  entries: FileEntry[];
  nextOffset: number;
  total: number;
}

export const loadFilesPage = async (
  provider: Provider,
  keyring: Keyring,
  address: string,
  offset: number,
  wanted: number,
): Promise<FileListPage> => {
  const total = await getFileCount(provider, address);
  const records: FileRecord[] = [];
  let next = offset;

  while (records.length < wanted && next < total) {
    const page = await getFiles(provider, address, next, wanted);
    records.push(...page.records);
    next = page.nextOffset;
  }

  const entries = await Promise.all(
    records.map((record) => describe(record, keyring, address)),
  );
  return { entries, nextOffset: next, total };
};

export class ContentMismatchError extends AppError {
  constructor(detail?: string) {
    super('errors:files.cidMismatch', detail);
    this.name = 'ContentMismatchError';
  }
}

const readBody = async (
  body: ReadableStream<Uint8Array>,
  total: number,
  onProgress?: ProgressFn,
): Promise<Blob> => {
  const reader = body.getReader();
  const parts: BlobPart[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value as Uint8Array<ArrayBuffer>);
      received += value.length;
      onProgress?.(Math.min(received, total), total);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(parts, { type: 'application/octet-stream' });
};

const fetchVerified = async (
  expected: CID,
  total: number,
  onProgress?: ProgressFn,
): Promise<Blob> => {
  const failures: string[] = [];
  let mismatch = false;

  for (const base of IPFS_GATEWAY_URLS) {
    let container: Blob;
    try {
      const response = await fetch(`${base}/ipfs/${expected.toString()}`);
      if (!response.ok || !response.body) {
        failures.push(`${base}: HTTP ${response.status}`);
        void response.body?.cancel();
        continue;
      }
      container = await readBody(response.body, total, onProgress);
    } catch (error) {
      failures.push(`${base}: ${error instanceof Error ? error.message : 'network error'}`);
      continue;
    }

    const actual = await computeCid(container);
    if (actual.equals(expected)) return container;
    mismatch = true;
    failures.push(`${base}: content hashes to ${actual.toString()}`);
  }

  if (mismatch) throw new ContentMismatchError(failures.join('; '));
  throw new AppError('errors:files.gatewayUnavailable', failures.join('; '));
};

export const openFile = async (
  provider: Provider,
  keyring: Keyring,
  address: string,
  fileId: string,
  onProgress?: ProgressFn,
): Promise<{ blob: Blob; meta: FileMeta }> => {
  const record = await getFile(provider, address, fileId);
  if (!record.exists || record.removed) {
    throw new AppError('errors:files.notFound');
  }

  const fileKey = await unwrapFileKey(
    masterKeyFor(keyring, record.mkVersion),
    record.wrappedFileKey,
    address,
    record.fileId,
    record.mkVersion,
  );

  try {
    const meta = await decryptMeta(fileKey, record.fileId, record.encryptedMeta).catch(
      (): FileMeta => ({ name: 'file', type: '' }),
    );
    const container = await fetchVerified(
      cidFromBytes(record.cid),
      Number(record.sizeBytes),
      onProgress,
    );

    const blob = await decryptContainer(
      container.stream(),
      fileKey,
      record.fileId,
      container.size,
      meta.type,
    );
    return { blob, meta };
  } finally {
    wipe(fileKey);
  }
};

export const saveBlob = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

export const deleteFile = async (
  address: string,
  fileId: string,
): Promise<{ released: boolean }> => {
  const wallet = await connectAs(address);
  try {
    await removeFile(wallet.signer, fileId);
  } catch (error) {
    throw decodeFileRegistryError(error);
  }

  try {
    await releaseRemote(fileId);
    return { released: true };
  } catch (error) {
    console.warn(`backend did not release ${fileId}`, error);
    return { released: false };
  }
};
