import type { Provider } from 'ethers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Bytes, randomBytes, utf8 } from '@/crypto/bytes';
import { computeCid } from '@/crypto/cid';
import { FileDecryptError, containerSize, unwrapFileKey } from '@/crypto/fileCrypto';
import type { Keyring } from '@/context/keyring';
import { ApiError, apiClient } from '@/shared/api/client';
import { addFile, getFile, type NewFile } from '@/web3/fileRegistry';
import type { FileRecord } from '@/web3/types';
import { UploadError } from '../api';
import { ContentMismatchError, openFile, pushUpload, registerUpload } from '../service';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const generatedKeys = vi.hoisted(() => [] as { live: Uint8Array; copy: Uint8Array }[]);

const GATEWAYS = vi.hoisted(() => ['https://gw-a.test', 'https://gw-b.test']);

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  IPFS_GATEWAY_URLS: GATEWAYS,
}));
vi.mock('@/web3/wallet', () => ({
  connectAs: vi.fn(async () => ({ provider: {}, signer: {}, address: ADDRESS })),
}));
vi.mock('@/web3/profileRegistry', () => ({
  getProfile: vi.fn(async () => ({ mkVersion: 1 })),
}));
vi.mock('@/web3/storageTier', () => ({
  getMaxFileBytes: vi.fn(async () => 50n * 1024n * 1024n),
}));
vi.mock('@/web3/fileRegistry', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  addFile: vi.fn(async () => ({})),
  getFile: vi.fn(),
}));
vi.mock('@/crypto/fileCrypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/crypto/fileCrypto')>();
  return {
    ...actual,
    generateFileKey: () => {
      const live = actual.generateFileKey();
      generatedKeys.push({ live, copy: live.slice() });
      return live;
    },
  };
});

const MARKER = 'NODECRYPT-PLAINTEXT-MARKER;';
const NAME = 'salary-report-2026.pdf';
const TYPE = 'application/pdf';

const plaintext = (bytes: number): Bytes => {
  const text = MARKER.repeat(Math.ceil(bytes / MARKER.length)).slice(0, bytes);
  return utf8(text);
};

const contains = (haystack: Uint8Array, needle: Uint8Array): boolean =>
  Buffer.from(haystack).includes(Buffer.from(needle));

const bytesOf = async (blob: Blob): Promise<Bytes> => new Uint8Array(await blob.arrayBuffer());

let keyring: Keyring;
let masterKey: CryptoKey;

beforeEach(async () => {
  generatedKeys.length = 0;
  masterKey = await crypto.subtle.importKey('raw', randomBytes(32), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  keyring = { masterKey, mkVersion: 1, pendingMasterKey: null } as unknown as Keyring;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(addFile).mockClear();
});

const uploadThroughClient = async (plain: Bytes) => {
  const file = new File([plain], NAME, { type: TYPE });
  const registered = await registerUpload(file, keyring, ADDRESS, () => undefined);
  const onChain = vi.mocked(addFile).mock.calls.at(-1)![1] as NewFile;

  let body: Blob | undefined;
  vi.spyOn(apiClient, 'postBinary').mockImplementation(async (_path, data) => {
    body = data;
    return { fileId: registered.fileId, cid: (await computeCid(data)).toString(), pinned: true, providers: {} };
  });
  await pushUpload(registered, () => undefined);

  return { registered, onChain, body: await bytesOf(body!), fileKey: generatedKeys.at(-1)! };
};

describe('scenario 1: a changed container byte is detected', () => {
  const recordOf = (onChain: NewFile): FileRecord => ({
    fileId: onChain.fileId,
    cid: new Uint8Array(onChain.cid),
    wrappedFileKey: new Uint8Array(onChain.wrappedFileKey),
    encryptedMeta: new Uint8Array(onChain.encryptedMeta),
    sizeBytes: BigInt(onChain.sizeBytes),
    mkVersion: onChain.mkVersion,
    uploadedAt: 0,
    exists: true,
    removed: false,
  });

  const serveFromGateway = (bytes: Bytes) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Blob([bytes])));

  const openUploaded = async (onChain: NewFile) => {
    vi.mocked(getFile).mockResolvedValue(recordOf(onChain));
    return openFile({} as Provider, keyring, ADDRESS, onChain.fileId);
  };

  it('the untouched container downloads and decrypts to the original file', async () => {
    const plain = plaintext(20 * 1024);
    const { onChain, body } = await uploadThroughClient(plain);
    serveFromGateway(body);

    const { blob, meta } = await openUploaded(onChain);

    expect(await bytesOf(blob)).toEqual(plain);
    expect(meta).toEqual({ name: NAME, type: TYPE });
  });

  it.each([0, 8, 100, -1])('flipping byte %i changes the CID and the download is rejected', async (at) => {
    const { onChain, body } = await uploadThroughClient(plaintext(20 * 1024));
    const tampered = body.slice();
    tampered[at < 0 ? tampered.length + at : at] ^= 0x01;

    expect((await computeCid(new Blob([tampered]))).bytes).not.toEqual(onChain.cid);

    const fetchSpy = serveFromGateway(tampered);
    await expect(openUploaded(onChain)).rejects.toBeInstanceOf(ContentMismatchError);
    expect(fetchSpy).toHaveBeenCalledTimes(GATEWAYS.length);
  });

  it('a container swapped for another file of the same owner is rejected', async () => {
    const first = await uploadThroughClient(plaintext(4 * 1024));
    const second = await uploadThroughClient(plaintext(4 * 1024));
    serveFromGateway(second.body);

    await expect(openUploaded(first.onChain)).rejects.toBeInstanceOf(ContentMismatchError);
  });

  it('skips a gateway that serves foreign content and uses the next one', async () => {
    const plain = plaintext(8 * 1024);
    const { onChain, body } = await uploadThroughClient(plain);
    const tampered = body.slice();
    tampered[50] ^= 0x01;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      new Response(new Blob([String(input).startsWith(GATEWAYS[0]) ? tampered : body])),
    );

    const { blob } = await openUploaded(onChain);

    expect(await bytesOf(blob)).toEqual(plain);
  });

  it('reports an unavailable gateway separately from a content mismatch', async () => {
    const { onChain } = await uploadThroughClient(plaintext(1024));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 504 }));

    await expect(openUploaded(onChain)).rejects.toMatchObject({ key: 'errors:files.gatewayUnavailable' });
  });

  it('a CID-valid container under a wrong file key still fails GCM authentication', async () => {
    const { onChain, body } = await uploadThroughClient(plaintext(4 * 1024));
    const other = await uploadThroughClient(plaintext(4 * 1024));
    serveFromGateway(body);
    vi.mocked(getFile).mockResolvedValue({
      ...recordOf(onChain),
      wrappedFileKey: new Uint8Array(other.onChain.wrappedFileKey),
    });

    await expect(openFile({} as Provider, keyring, ADDRESS, onChain.fileId)).rejects.toBeInstanceOf(
      FileDecryptError,
    );
  });
});

describe('confidentiality: only ciphertext leaves the client', () => {
  it('the upload body contains neither the plaintext, the file name nor the file key', async () => {
    const plain = plaintext(300 * 1024);
    const { body, fileKey } = await uploadThroughClient(plain);

    expect(body.length).toBe(containerSize(plain.length));
    expect(contains(body, utf8(MARKER))).toBe(false);
    expect(contains(body, plain.subarray(0, 64))).toBe(false);
    expect(contains(body, utf8(NAME))).toBe(false);
    expect(contains(body, fileKey.copy)).toBe(false);
  });

  it('the on-chain record holds the file key and metadata only in encrypted form', async () => {
    const { onChain, fileKey } = await uploadThroughClient(plaintext(10 * 1024));

    expect(contains(onChain.encryptedMeta, utf8(NAME))).toBe(false);
    expect(contains(onChain.encryptedMeta, utf8(TYPE))).toBe(false);
    expect(contains(onChain.wrappedFileKey, fileKey.copy)).toBe(false);

    const unwrapped = await unwrapFileKey(masterKey, onChain.wrappedFileKey, ADDRESS, onChain.fileId, 1);
    expect(unwrapped).toEqual(fileKey.copy);
  });

  it('the registered CID addresses the ciphertext, not the plaintext', async () => {
    const plain = plaintext(10 * 1024);
    const { onChain, body } = await uploadThroughClient(plain);

    expect(onChain.cid).toEqual((await computeCid(new Blob([body]))).bytes);
    expect(onChain.cid).not.toEqual((await computeCid(new Blob([plain]))).bytes);
    expect(onChain.sizeBytes).toBe(body.length);
  });

  it('the same file uploaded twice gives unrelated containers and CIDs', async () => {
    const plain = plaintext(10 * 1024);
    const first = await uploadThroughClient(plain);
    const second = await uploadThroughClient(plain);

    expect(second.registered.cid).not.toBe(first.registered.cid);
    expect(second.body).not.toEqual(first.body);
    expect(second.onChain.fileId).not.toBe(first.onChain.fileId);
  });

  it('wipes the file key once the file is registered', async () => {
    const { fileKey } = await uploadThroughClient(plaintext(1024));

    expect(fileKey.copy.some((b) => b !== 0)).toBe(true);
    expect(fileKey.live.every((b) => b === 0)).toBe(true);
  });
});

describe('scenario 2: the server returns a CID that differs from the on-chain one', () => {
  const registerSmallFile = () =>
    registerUpload(new File([plaintext(2048)], NAME, { type: TYPE }), keyring, ADDRESS, () => undefined);

  const otherCid = async () => (await computeCid(new Blob([randomBytes(2048)]))).toString();

  it('accepts a status whose CID matches the registered one', async () => {
    const registered = await registerSmallFile();
    vi.spyOn(apiClient, 'postBinary').mockResolvedValue({
      fileId: registered.fileId,
      cid: registered.cid,
      pinned: true,
      providers: {},
    });

    await expect(pushUpload(registered, () => undefined)).resolves.toMatchObject({ cid: registered.cid });
  });

  it('rejects a different CID with a final error', async () => {
    const registered = await registerSmallFile();
    const wrong = await otherCid();
    vi.spyOn(apiClient, 'postBinary').mockResolvedValue({
      fileId: registered.fileId,
      cid: wrong,
      pinned: true,
      providers: {},
    });

    const error = await pushUpload(registered, () => undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).key).toBe('errors:upload.cidMismatch');
    expect((error as UploadError).retryable).toBe(false);
    expect((error as UploadError).detail).toContain(wrong);
  });

  it('also checks a status recovered after a dropped connection', async () => {
    const registered = await registerSmallFile();
    vi.useFakeTimers();
    vi.spyOn(apiClient, 'postBinary').mockRejectedValue(new TypeError('Failed to fetch'));
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      fileId: registered.fileId,
      cid: await otherCid(),
      pinned: true,
      providers: {},
    });

    const result = pushUpload(registered, () => undefined).catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    expect(((await result) as UploadError).key).toBe('errors:upload.cidMismatch');
  });

  it('does not accept a 404 as a reason to skip the check', async () => {
    const registered = await registerSmallFile();
    vi.spyOn(apiClient, 'postBinary').mockRejectedValue(new ApiError(404, 'not registered'));

    const error = await pushUpload(registered, () => undefined).catch((e: unknown) => e);
    expect((error as UploadError).key).toBe('errors:upload.notRegistered');
  });
});
