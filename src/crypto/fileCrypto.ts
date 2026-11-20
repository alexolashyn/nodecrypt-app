import { CHAIN_ID } from '@/config';
import { AppError } from '@/shared/errors';
import {
  type Bytes,
  concatBytes,
  hexToBytes,
  bytesToHex,
  randomBytes,
  utf8,
  wipe,
} from './bytes';

export const FILE_KEY_BYTES = 32;
export const WRAPPED_FILE_KEY_BYTES = 60;
export const MAX_META_BYTES = 256;
export const CHUNK_SIZE = 1024 * 1024;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const META_VERSION = 0x01;
const MAGIC = utf8('NCF1');
const HEADER_BYTES = MAGIC.length + 4;
const HKDF_SALT = utf8('nodecrypt/file/v1');

export interface FileMeta {
  name: string;
  type: string;
}

export class FileDecryptError extends AppError {
  constructor(detail?: string) {
    super('errors:files.decryptFailed', detail);
    this.name = 'FileDecryptError';
  }
}

export const generateFileId = (): string => {
  for (;;) {
    const bytes = randomBytes(32);
    if (bytes.some((b) => b !== 0)) return bytesToHex(bytes);
  }
};

export const generateFileKey = (): Bytes => randomBytes(FILE_KEY_BYTES);

const fileKeyAad = (owner: string, fileId: string, mkVersion: number): Bytes =>
  utf8(
    `nodecrypt|fk|${owner.toLowerCase()}|${CHAIN_ID}|${fileId.toLowerCase()}|mk=${mkVersion}`,
  );

export const wrapFileKey = async (
  masterKey: CryptoKey,
  fileKey: Bytes,
  owner: string,
  fileId: string,
  mkVersion: number,
): Promise<Bytes> => {
  const iv = randomBytes(IV_BYTES);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: fileKeyAad(owner, fileId, mkVersion) },
      masterKey,
      fileKey,
    ),
  );
  const wrapped = concatBytes(iv, sealed);

  if (wrapped.length !== WRAPPED_FILE_KEY_BYTES) {
    throw new AppError('errors:crypto.selfCheckFailed', `wrapped key is ${wrapped.length} bytes`);
  }
  return wrapped;
};

export const unwrapFileKey = async (
  masterKey: CryptoKey,
  wrapped: Uint8Array,
  owner: string,
  fileId: string,
  mkVersion: number,
): Promise<Bytes> => {
  if (wrapped.length !== WRAPPED_FILE_KEY_BYTES) {
    throw new FileDecryptError(`wrapped key is ${wrapped.length} bytes`);
  }
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: wrapped.slice(0, IV_BYTES),
        additionalData: fileKeyAad(owner, fileId, mkVersion),
      },
      masterKey,
      wrapped.slice(IV_BYTES),
    );
    return new Uint8Array(plain);
  } catch {
    throw new FileDecryptError('file key unwrap failed');
  }
};

const deriveSubkey = async (
  fileKey: Bytes,
  purpose: 'content' | 'meta',
): Promise<CryptoKey> => {
  const ikm = await crypto.subtle.importKey('raw', fileKey, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_SALT,
      info: utf8(`nodecrypt/file/v1/${purpose}`),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const MAX_META_PLAINTEXT = MAX_META_BYTES - 1 - IV_BYTES - TAG_BYTES;
const MAX_TYPE_LENGTH = 100;
const encoder = new TextEncoder();

const metaAad = (fileId: string): Bytes =>
  utf8(`nodecrypt|meta|${fileId.toLowerCase()}`);

export const encodeMeta = (meta: FileMeta): Bytes => {
  const type = meta.type.length <= MAX_TYPE_LENGTH ? meta.type : '';
  const chars = Array.from(meta.name || 'file');
  const dot = meta.name.lastIndexOf('.');
  const ext =
    dot > 0 && meta.name.length - dot <= 16 ? Array.from(meta.name.slice(dot)) : [];
  let base = ext.length ? chars.slice(0, chars.length - ext.length) : chars;

  for (;;) {
    const name = base.length < chars.length - ext.length
      ? `${base.join('')}…${ext.join('')}`
      : chars.join('');
    const bytes = encoder.encode(JSON.stringify({ n: name, t: type }));
    if (bytes.length <= MAX_META_PLAINTEXT) return bytes;
    if (base.length === 0) {
      return encoder.encode(JSON.stringify({ n: 'file', t: '' }));
    }
    base = base.slice(0, base.length - 1);
  }
};

export const encryptMeta = async (
  fileKey: Bytes,
  fileId: string,
  meta: FileMeta,
): Promise<Bytes> => {
  const key = await deriveSubkey(fileKey, 'meta');
  const iv = randomBytes(IV_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: metaAad(fileId) },
      key,
      encodeMeta(meta),
    ),
  );
  return concatBytes(new Uint8Array([META_VERSION]), iv, ciphertext);
};

export const decryptMeta = async (
  fileKey: Bytes,
  fileId: string,
  encrypted: Uint8Array,
): Promise<FileMeta> => {
  if (encrypted[0] !== META_VERSION || encrypted.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new FileDecryptError('unknown metadata format');
  }
  try {
    const key = await deriveSubkey(fileKey, 'meta');
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: encrypted.slice(1, 1 + IV_BYTES),
        additionalData: metaAad(fileId),
      },
      key,
      encrypted.slice(1 + IV_BYTES),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as {
      n?: unknown;
      t?: unknown;
    };
    return {
      name: typeof parsed.n === 'string' ? parsed.n : 'file',
      type: typeof parsed.t === 'string' ? parsed.t : '',
    };
  } catch {
    throw new FileDecryptError('metadata decrypt failed');
  }
};

const makeHeader = (chunkSize: number): Bytes => {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC, 0);
  new DataView(header.buffer).setUint32(MAGIC.length, chunkSize);
  return header;
};

const chunkIv = (index: number): Bytes => {
  const iv = new Uint8Array(IV_BYTES);
  new DataView(iv.buffer).setBigUint64(4, BigInt(index));
  return iv;
};

const chunkAad = (header: Bytes, fileId: Bytes, index: number, final: boolean): Bytes => {
  const tail = new Uint8Array(9);
  const view = new DataView(tail.buffer);
  view.setBigUint64(0, BigInt(index));
  view.setUint8(8, final ? 1 : 0);
  return concatBytes(header, fileId, tail);
};

const chunkCount = (plainSize: number, chunkSize: number): number =>
  Math.max(1, Math.ceil(plainSize / chunkSize));

export const containerSize = (plainSize: number, chunkSize = CHUNK_SIZE): number =>
  HEADER_BYTES + plainSize + TAG_BYTES * chunkCount(plainSize, chunkSize);

export type ProgressFn = (done: number, total: number) => void;

export const encryptContainer = async (
  file: Blob,
  fileKey: Bytes,
  fileId: string,
  onProgress?: ProgressFn,
  chunkSize = CHUNK_SIZE,
): Promise<Blob> => {
  const key = await deriveSubkey(fileKey, 'content');
  const header = makeHeader(chunkSize);
  const idBytes = hexToBytes(fileId);
  const count = chunkCount(file.size, chunkSize);
  const parts: BlobPart[] = [header];

  for (let i = 0; i < count; i += 1) {
    const plain = new Uint8Array(
      await file.slice(i * chunkSize, (i + 1) * chunkSize).arrayBuffer(),
    );
    const sealed = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: chunkIv(i),
        additionalData: chunkAad(header, idBytes, i, i === count - 1),
      },
      key,
      plain,
    );
    wipe(plain);
    parts.push(sealed);
    onProgress?.(Math.min((i + 1) * chunkSize, file.size), file.size);
  }

  return new Blob(parts, { type: 'application/octet-stream' });
};

export const decryptContainer = async (
  stream: ReadableStream<Uint8Array>,
  fileKey: Bytes,
  fileId: string,
  totalSize: number,
  mimeType: string,
  onProgress?: ProgressFn,
): Promise<Blob> => {
  const key = await deriveSubkey(fileKey, 'content');
  const idBytes = hexToBytes(fileId);
  const reader = stream.getReader();

  let buffer: Bytes = new Uint8Array(0);
  let received = 0;
  let ended = false;

  const fill = async (): Promise<void> => {
    const { done, value } = await reader.read();
    if (done) {
      ended = true;
      return;
    }
    received += value.length;
    onProgress?.(Math.min(received, totalSize), totalSize);
    buffer = buffer.length ? concatBytes(buffer, value) : new Uint8Array(value);
  };

  try {
    while (buffer.length < HEADER_BYTES && !ended) await fill();
    if (buffer.length < HEADER_BYTES) throw new FileDecryptError('truncated header');

    const header = buffer.slice(0, HEADER_BYTES);
    const magicOk = MAGIC.every((b, i) => header[i] === b);
    const chunkSize = new DataView(header.buffer).getUint32(MAGIC.length);
    if (!magicOk || chunkSize === 0 || chunkSize > 64 * 1024 * 1024) {
      throw new FileDecryptError('not a nodecrypt container');
    }
    buffer = buffer.slice(HEADER_BYTES);

    const recordSize = chunkSize + TAG_BYTES;
    const parts: BlobPart[] = [];

    for (let index = 0; ; index += 1) {
      while (buffer.length <= recordSize && !ended) await fill();

      const final = buffer.length <= recordSize;
      const record = final ? buffer : buffer.slice(0, recordSize);
      if (record.length < TAG_BYTES) throw new FileDecryptError('truncated chunk');

      let plain: ArrayBuffer;
      try {
        plain = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: chunkIv(index),
            additionalData: chunkAad(header, idBytes, index, final),
          },
          key,
          record,
        );
      } catch {
        throw new FileDecryptError(`chunk ${index} failed authentication`);
      }
      parts.push(plain);

      if (final) break;
      buffer = buffer.slice(recordSize);
    }

    return new Blob(parts, { type: mimeType || 'application/octet-stream' });
  } finally {
    reader.releaseLock();
  }
};
