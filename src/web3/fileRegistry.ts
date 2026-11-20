import {
  Contract,
  type ContractTransactionReceipt,
  type InterfaceAbi,
  type Provider,
  type Signer,
} from 'ethers';
import { FILE_REGISTRY_ADDRESS } from '@/config';
import { type Bytes, bytesToHex, hexToBytes } from '@/crypto/bytes';
import { formatBytes } from '@/shared/format';
import artifact from './abi/FileRegistry.json';
import { createErrorDecoder, waitForReceipt } from './contractErrors';
import type { FileRecord, FilesPage } from './types';

const ABI = artifact.abi as InterfaceAbi;

export const WRAPPED_KEY_LENGTH = 60;
export const MAX_CID_LENGTH = 64;
export const MAX_META_LENGTH = 256;
export const MAX_PAGE_LIMIT = 100;
export const MAX_REWRAP_BATCH = 50;

const CONTRACT_ERROR_KEYS = {
  ProfileNotFound: 'errors:contract.profileNotFound',
  StaleMasterKeyVersion: 'errors:files.staleMasterKey',
  InvalidTargetVersion: 'errors:files.staleMasterKey',
  InvalidFileId: 'errors:files.invalidFileId',
  FileAlreadyExists: 'errors:files.alreadyExists',
  InvalidCid: 'errors:files.invalidCid',
  InvalidWrappedKey: 'errors:contract.invalidWrappedKey',
  InvalidMeta: 'errors:files.invalidMeta',
  InvalidFileSize: 'errors:files.invalidSize',
  FileTooLarge: {
    key: 'errors:files.tooLarge',
    params: (args: Record<string, unknown>) => ({
      size: formatBytes(args.size as bigint),
      max: formatBytes(args.max as bigint),
    }),
  },
  FileNotFound: 'errors:files.notFound',
  FileAlreadyRemoved: 'errors:files.alreadyRemoved',
  BatchLengthMismatch: 'errors:contract.unknown',
  InvalidBatchSize: 'errors:contract.unknown',
};

const getContract = (runner: Provider | Signer): Contract => {
  return new Contract(FILE_REGISTRY_ADDRESS, ABI, runner);
};

type RawRecord = {
  cid: string;
  wrappedFileKey: string;
  encryptedMeta: string;
  sizeBytes: bigint;
  uploadedAt: bigint;
  mkVersion: bigint;
  removed: boolean;
  exists: boolean;
};

const toRecord = (fileId: string, raw: RawRecord): FileRecord => ({
  fileId: fileId.toLowerCase(),
  cid: hexToBytes(raw.cid),
  wrappedFileKey: hexToBytes(raw.wrappedFileKey),
  encryptedMeta: hexToBytes(raw.encryptedMeta),
  sizeBytes: raw.sizeBytes,
  uploadedAt: Number(raw.uploadedAt),
  mkVersion: Number(raw.mkVersion),
  removed: raw.removed,
  exists: raw.exists,
});

export const getFile = async (
  provider: Provider,
  owner: string,
  fileId: string,
): Promise<FileRecord> => {
  const raw = (await getContract(provider).getFile(owner, fileId)) as RawRecord;
  return toRecord(fileId, raw);
};

export const getFileCount = async (
  provider: Provider,
  owner: string,
): Promise<number> => {
  return Number(await getContract(provider).getFileCount(owner));
};

export const getActiveFileCount = async (
  provider: Provider,
  owner: string,
): Promise<number> => {
  return Number(await getContract(provider).getActiveFileCount(owner));
};

export const getFiles = async (
  provider: Provider,
  owner: string,
  offset: number,
  limit: number,
): Promise<FilesPage> => {
  const pageLimit = Math.min(limit, MAX_PAGE_LIMIT);
  const [ids, raws] = (await getContract(provider).getFiles(
    owner,
    offset,
    pageLimit,
  )) as [string[], RawRecord[]];

  return {
    records: ids.map((id, i) => toRecord(id, raws[i])),
    nextOffset: offset + pageLimit,
  };
};

export const getAllFiles = async (
  provider: Provider,
  owner: string,
): Promise<FileRecord[]> => {
  const total = await getFileCount(provider, owner);
  const records: FileRecord[] = [];
  for (let offset = 0; offset < total; offset += MAX_PAGE_LIMIT) {
    const page = await getFiles(provider, owner, offset, MAX_PAGE_LIMIT);
    records.push(...page.records);
  }
  return records;
};

export interface NewFile {
  fileId: string;
  cid: Uint8Array;
  wrappedFileKey: Uint8Array;
  encryptedMeta: Uint8Array;
  sizeBytes: number;
  mkVersion: number;
}

export const addFile = async (
  signer: Signer,
  file: NewFile,
): Promise<ContractTransactionReceipt> => {
  const tx = await getContract(signer).addFile(
    file.fileId,
    bytesToHex(file.cid),
    bytesToHex(file.wrappedFileKey),
    bytesToHex(file.encryptedMeta),
    file.sizeBytes,
    file.mkVersion,
  );
  return waitForReceipt(tx);
};

export const removeFile = async (
  signer: Signer,
  fileId: string,
): Promise<ContractTransactionReceipt> => {
  const tx = await getContract(signer).removeFile(fileId);
  return waitForReceipt(tx);
};

export const replaceFile = async (
  signer: Signer,
  fileId: string,
  newCid: Uint8Array,
  newWrappedFileKey: Uint8Array,
  newSizeBytes: number,
  newMkVersion: number,
): Promise<ContractTransactionReceipt> => {
  const tx = await getContract(signer).replaceFile(
    fileId,
    bytesToHex(newCid),
    bytesToHex(newWrappedFileKey),
    newSizeBytes,
    newMkVersion,
  );
  return waitForReceipt(tx);
};

export const rewrapFileKeys = async (
  signer: Signer,
  fileIds: string[],
  newWrappedFileKeys: Uint8Array[],
  newMkVersion: number,
): Promise<ContractTransactionReceipt> => {
  const tx = await getContract(signer).rewrapFileKeys(
    fileIds,
    newWrappedFileKeys.map(bytesToHex),
    newMkVersion,
  );
  return waitForReceipt(tx);
};

export const getPendingMasterKey = async (
  provider: Provider,
  owner: string,
): Promise<Bytes> => {
  return hexToBytes((await getContract(provider).getPendingMasterKey(owner)) as string);
};

export const setPendingMasterKey = async (
  signer: Signer,
  sealedMasterKey: Uint8Array,
): Promise<ContractTransactionReceipt> => {
  const tx = await getContract(signer).setPendingMasterKey(bytesToHex(sealedMasterKey));
  return waitForReceipt(tx);
};

export const clearPendingMasterKey = async (
  signer: Signer,
): Promise<ContractTransactionReceipt> => {
  const tx = await getContract(signer).clearPendingMasterKey();
  return waitForReceipt(tx);
};

export const decodeFileRegistryError = createErrorDecoder(ABI, CONTRACT_ERROR_KEYS);
