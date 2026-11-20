import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/shared/api/client';
import { UploadError, classifyUploadStatus, uploadContainer } from '../api';

describe('classifyUploadStatus', () => {
  it.each([408, 409, 429])('%i is retried automatically', (status) => {
    expect(classifyUploadStatus(status)).toBe('retry');
  });

  it('502 is a pin-quorum failure offered for manual retry', () => {
    expect(classifyUploadStatus(502)).toBe('quorum');
  });

  it.each([400, 404, 410, 413])('%i is shown to the user', (status) => {
    expect(classifyUploadStatus(status)).toBe('final');
  });
});

describe('uploadContainer', () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])]);
  const status = { fileId: '0x01', cid: 'bafy', pinned: true, providers: {} };

  let getStatus: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    getStatus = vi
      .spyOn(apiClient, 'get')
      .mockRejectedValue(new ApiError(404, 'Nothing is pinned for this file'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries 409 and 408, then succeeds', async () => {
    const post = vi
      .spyOn(apiClient, 'postBinary')
      .mockRejectedValueOnce(new ApiError(409, 'locked'))
      .mockRejectedValueOnce(new ApiError(408, 'stalled'))
      .mockResolvedValueOnce(status);
    const onRetry = vi.fn();

    const result = uploadContainer('0x01', blob, onRetry);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual(status);
    expect(post).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('does not retry 413 and marks it final', async () => {
    const post = vi
      .spyOn(apiClient, 'postBinary')
      .mockRejectedValue(new ApiError(413, 'too large'));

    const error = await uploadContainer('0x01', blob).catch((e: unknown) => e);
    expect(post).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).key).toBe('errors:upload.tooLarge');
    expect((error as UploadError).retryable).toBe(false);
  });

  it('does not auto-retry 502 but offers a manual retry', async () => {
    const post = vi
      .spyOn(apiClient, 'postBinary')
      .mockRejectedValue(new ApiError(502, 'quorum'));

    const error = await uploadContainer('0x01', blob).catch((e: unknown) => e);
    expect(post).toHaveBeenCalledTimes(1);
    expect((error as UploadError).key).toBe('errors:upload.quorum');
    expect((error as UploadError).retryable).toBe(true);
  });

  it('gives up after the retry budget', async () => {
    vi.spyOn(apiClient, 'postBinary').mockRejectedValue(new ApiError(409, 'locked'));

    const result = uploadContainer('0x01', blob).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const error = await result;

    expect((error as UploadError).key).toBe('errors:upload.busy');
    expect((error as UploadError).retryable).toBe(true);
  });

  it('treats a dropped connection as success once the pin shows up', async () => {
    const post = vi
      .spyOn(apiClient, 'postBinary')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    getStatus.mockResolvedValueOnce(status);

    const result = uploadContainer('0x01', blob);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual(status);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('waits out a 409 from a request still pinning until the pin shows up', async () => {
    const post = vi
      .spyOn(apiClient, 'postBinary')
      .mockRejectedValueOnce(new ApiError(409, 'Another request for this file is in progress'));
    getStatus
      .mockRejectedValueOnce(new ApiError(404, 'not yet'))
      .mockResolvedValueOnce(status);
    vi.mocked(post).mockRejectedValueOnce(new ApiError(409, 'still locked'));

    const result = uploadContainer('0x01', blob);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual(status);
    expect(post).toHaveBeenCalledTimes(2);
  });
});
