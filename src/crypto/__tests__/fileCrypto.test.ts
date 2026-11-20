import { beforeAll, describe, expect, it } from 'vitest';
import { type Bytes, bytesEqual, randomBytes } from '../bytes';
import {
  FileDecryptError,
  MAX_META_BYTES,
  WRAPPED_FILE_KEY_BYTES,
  containerSize,
  decryptContainer,
  decryptMeta,
  encodeMeta,
  encryptContainer,
  encryptMeta,
  generateFileId,
  generateFileKey,
  unwrapFileKey,
  wrapFileKey,
} from '../fileCrypto';

const OWNER = '0x1234567890abcdef1234567890abcdef12345678';
const SMALL_CHUNK = 1024;

let masterKey: CryptoKey;

beforeAll(async () => {
  masterKey = await crypto.subtle.importKey('raw', randomBytes(32), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
});

const streamOf = (blob: Blob, piece = 333): ReadableStream<Uint8Array> => {
  let offset = 0;
  return new ReadableStream({
    async pull(controller) {
      if (offset >= blob.size) return controller.close();
      const part = new Uint8Array(await blob.slice(offset, offset + piece).arrayBuffer());
      offset += piece;
      controller.enqueue(part);
    },
  });
};

const bytesOf = async (blob: Blob): Promise<Bytes> =>
  new Uint8Array(await blob.arrayBuffer());

describe('file key wrapping', () => {
  it('wraps to exactly 60 bytes and unwraps back', async () => {
    const fileId = generateFileId();
    const fileKey = generateFileKey();
    const wrapped = await wrapFileKey(masterKey, fileKey, OWNER, fileId, 1);

    expect(wrapped.length).toBe(WRAPPED_FILE_KEY_BYTES);
    const unwrapped = await unwrapFileKey(masterKey, wrapped, OWNER, fileId, 1);
    expect(bytesEqual(unwrapped, fileKey)).toBe(true);
  });

  it('is bound to fileId and mkVersion', async () => {
    const fileId = generateFileId();
    const wrapped = await wrapFileKey(masterKey, generateFileKey(), OWNER, fileId, 1);

    await expect(unwrapFileKey(masterKey, wrapped, OWNER, generateFileId(), 1)).rejects.toThrow(
      FileDecryptError,
    );
    await expect(unwrapFileKey(masterKey, wrapped, OWNER, fileId, 2)).rejects.toThrow(
      FileDecryptError,
    );
  });
});

describe('metadata', () => {
  it('round-trips name and type', async () => {
    const fileId = generateFileId();
    const fileKey = generateFileKey();
    const encrypted = await encryptMeta(fileKey, fileId, { name: 'звіт.pdf', type: 'application/pdf' });

    expect(encrypted.length).toBeLessThanOrEqual(MAX_META_BYTES);
    expect(await decryptMeta(fileKey, fileId, encrypted)).toEqual({
      name: 'звіт.pdf',
      type: 'application/pdf',
    });
  });

  it('shortens long names to fit 256 bytes, keeping the extension', async () => {
    const name = `${'дуже-довга-назва-'.repeat(30)}.tar.gz`;
    const fileKey = generateFileKey();
    const fileId = generateFileId();
    const encrypted = await encryptMeta(fileKey, fileId, { name, type: 'application/gzip' });

    expect(encrypted.length).toBeLessThanOrEqual(MAX_META_BYTES);
    const meta = await decryptMeta(fileKey, fileId, encrypted);
    expect(meta.name.endsWith('….gz')).toBe(true);
    expect(meta.type).toBe('application/gzip');
  });

  it('never exceeds the limit, whatever the input', () => {
    for (const name of ['😀'.repeat(500), 'a'.repeat(1000), '', '.'.repeat(300)]) {
      expect(encodeMeta({ name, type: 'x'.repeat(500) }).length).toBeLessThanOrEqual(227);
    }
  });
});

describe('container', () => {
  const roundTrip = async (size: number) => {
    const fileId = generateFileId();
    const fileKey = generateFileKey();
    const plain = randomBytes(size);
    const container = await encryptContainer(new Blob([plain]), fileKey, fileId, undefined, SMALL_CHUNK);

    expect(container.size).toBe(containerSize(size, SMALL_CHUNK));
    const out = await decryptContainer(streamOf(container), fileKey, fileId, container.size, 'text/plain');
    expect(bytesEqual(await bytesOf(out), plain)).toBe(true);
    expect(out.type).toBe('text/plain');
  };

  it.each([0, 1, SMALL_CHUNK - 1, SMALL_CHUNK, SMALL_CHUNK + 1, 3 * SMALL_CHUNK, 5000])(
    'round-trips %i bytes',
    roundTrip,
  );

  it('rejects a container truncated at a chunk boundary', async () => {
    const fileId = generateFileId();
    const fileKey = generateFileKey();
    const container = await encryptContainer(
      new Blob([randomBytes(3 * SMALL_CHUNK)]),
      fileKey,
      fileId,
      undefined,
      SMALL_CHUNK,
    );
    const cut = container.slice(0, 8 + 2 * (SMALL_CHUNK + 16));

    await expect(
      decryptContainer(streamOf(cut), fileKey, fileId, cut.size, ''),
    ).rejects.toThrow(FileDecryptError);
  });

  it('rejects a flipped byte and a foreign fileId', async () => {
    const fileId = generateFileId();
    const fileKey = generateFileKey();
    const container = await encryptContainer(new Blob([randomBytes(2000)]), fileKey, fileId, undefined, SMALL_CHUNK);

    const tampered = await bytesOf(container);
    tampered[100] ^= 1;
    await expect(
      decryptContainer(streamOf(new Blob([tampered])), fileKey, fileId, tampered.length, ''),
    ).rejects.toThrow(FileDecryptError);

    await expect(
      decryptContainer(streamOf(container), fileKey, generateFileId(), container.size, ''),
    ).rejects.toThrow(FileDecryptError);
  });
});
