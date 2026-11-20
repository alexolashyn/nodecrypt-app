import { ApiError, apiClient } from '@/shared/api/client';
import { AppError } from '@/shared/errors';

export interface FileStatus {
  fileId: string;
  cid: string;
  pinned: boolean;
  providers: Record<string, { status: string; error?: string; updatedAt: string }>;
}

export type UploadFailureKind = 'retry' | 'quorum' | 'final';

const FINAL_KEYS: Record<number, string> = {
  400: 'errors:upload.rejected',
  404: 'errors:upload.notRegistered',
  410: 'errors:upload.removed',
  413: 'errors:upload.tooLarge',
};

export const classifyUploadStatus = (status: number): UploadFailureKind => {
  if (status === 408 || status === 409 || status === 429) return 'retry';
  if (status === 502) return 'quorum';
  return 'final';
};

export class UploadError extends AppError {
  readonly retryable: boolean;

  constructor(key: string, retryable: boolean, detail?: string) {
    super(key, detail);
    this.name = 'UploadError';
    this.retryable = retryable;
  }
}

const toUploadError = (error: unknown): UploadError => {
  if (error instanceof ApiError) {
    const kind = classifyUploadStatus(error.status);
    if (kind === 'quorum') {
      return new UploadError('errors:upload.quorum', true, error.message);
    }
    if (kind === 'retry') {
      return new UploadError('errors:upload.busy', true, error.message);
    }
    return new UploadError(
      FINAL_KEYS[error.status] ?? 'errors:upload.unknown',
      !(error.status in FINAL_KEYS),
      error.message,
    );
  }
  return new UploadError(
    'errors:upload.network',
    true,
    error instanceof Error ? error.message : undefined,
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRY_DELAYS_MS = [
  2_000, 5_000, 10_000, 15_000, 30_000, 30_000,
  60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000,
];

const RELEASE_DELAYS_MS = [1_000, 2_000, 4_000];

const pinnedStatus = async (fileId: string): Promise<FileStatus | null> => {
  try {
    const status = await getFileStatus(fileId);
    return status.pinned ? status : null;
  } catch {
    return null;
  }
};

export const uploadContainer = async (
  fileId: string,
  container: Blob,
  onRetry?: (attempt: number) => void,
): Promise<FileStatus> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await apiClient.postBinary<FileStatus>(`/files/${fileId}`, container);
    } catch (error) {
      const isNetwork = !(error instanceof ApiError);
      const retryable =
        isNetwork || classifyUploadStatus(error.status) === 'retry';
      if (!retryable) throw toUploadError(error);
      if (attempt >= RETRY_DELAYS_MS.length) {
        const status = await pinnedStatus(fileId);
        if (status) return status;
        throw toUploadError(error);
      }
      onRetry?.(attempt + 1);
      await sleep(RETRY_DELAYS_MS[attempt]);

      const status = await pinnedStatus(fileId);
      if (status) return status;
    }
  }
};

export const releaseRemote = async (fileId: string): Promise<void> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await apiClient.delete(`/files/${fileId}`);
      return;
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 404) return;
      if (status !== 409 || attempt >= RELEASE_DELAYS_MS.length) throw error;
      await sleep(RELEASE_DELAYS_MS[attempt]);
    }
  }
};

export const getFileStatus = (fileId: string): Promise<FileStatus> =>
  apiClient.get<FileStatus>(`/files/${fileId}`);
