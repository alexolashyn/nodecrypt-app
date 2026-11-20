export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

export const utf8 = (str: string): Bytes => {
  return encoder.encode(str);
};

export const bytesToHex = (bytes: Uint8Array): string => {
  const hexString = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return '0x' + hexString;
};

export const hexToBytes = (hex: string): Bytes => {
  const payload = hex.startsWith('0x') ? hex.slice(2) : hex;

  if (payload.length % 2 !== 0) {
    throw new Error(
      `hexToBytes: odd-length hex string (${payload.length} chars)`,
    );
  }

  if (payload.length > 0 && !/^[0-9a-fA-F]+$/.test(payload)) {
    throw new Error('hexToBytes: string contains non-hex characters');
  }

  const bytes = new Uint8Array(payload.length / 2);

  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(payload.substring(i * 2, i * 2 + 2), 16);
  }

  return bytes;
};

export const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

export const base64UrlToBytes = (value: string): Bytes => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
};

export const concatBytes = (...arrays: Uint8Array[]): Bytes => {
  const total = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(total);

  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
};

export const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
};

export const bigIntToBytes = (value: bigint, length: number): Bytes => {
  if (value < 0n) {
    throw new Error('bigIntToBytes: negative values are not supported');
  }

  const bytes = new Uint8Array(length);
  let remaining = value;

  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  if (remaining !== 0n) {
    throw new Error(`bigIntToBytes: value does not fit into ${length} bytes`);
  }

  return bytes;
};

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
};

export const wipe = (bytes: Uint8Array): void => {
  bytes.fill(0);
};

export const randomBytes = (length: number): Bytes => {
  return crypto.getRandomValues(new Uint8Array(length));
};
