import type { Bytes } from '@/crypto/bytes';

export interface Profile {
  pubKeyX: string;
  pubKeyYOdd: boolean;
  wrappedMasterKey: string;
  createdAt: number;
  updatedAt: number;
  keyVersion: number;
  mkVersion: number;
  exists: boolean;
}

export interface TierInfo {
  isPremium: boolean;
  premiumUntil: number;
  maxFileBytes: bigint;
  freeMaxFileBytes: bigint;
  premiumMaxFileBytes: bigint;
  pricePerPeriod: bigint;
  periodSeconds: number;
  maxPeriods: number;
  paused: boolean;
}

export interface FileRecord {
  fileId: string;
  cid: Bytes;
  wrappedFileKey: Bytes;
  encryptedMeta: Bytes;
  sizeBytes: bigint;
  uploadedAt: number;
  mkVersion: number;
  removed: boolean;
  exists: boolean;
}

export interface FilesPage {
  records: FileRecord[];
  nextOffset: number;
}
