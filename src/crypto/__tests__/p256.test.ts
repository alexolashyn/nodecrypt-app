import { describe, expect, it } from 'vitest';
import { bytesToBigInt, bytesEqual } from '../bytes';
import {
  CURVE_P,
  compressPoint,
  decompressPoint,
  scalarToPkcs8,
} from '../p256';

const generateRawPublicKey = async (): Promise<Uint8Array> => {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  return new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
};

describe('compressPoint / decompressPoint', () => {
  it('round-trips 20 real Web Crypto keys', async () => {
    for (let i = 0; i < 20; i += 1) {
      const raw = await generateRawPublicKey();
      const x = raw.slice(1, 33);
      const y = raw.slice(33, 65);

      const compressed = compressPoint(x, y);
      expect(compressed.length).toBe(33);
      expect(compressed[0] === 0x02 || compressed[0] === 0x03).toBe(true);

      const decompressed = decompressPoint(x, compressed[0] === 0x03);
      expect(bytesEqual(decompressed, raw)).toBe(true);
    }
  });

  it('encodes parity in the prefix byte', async () => {
    const raw = await generateRawPublicKey();
    const x = raw.slice(1, 33);
    const y = raw.slice(33, 65);

    const yIsOdd = (y[31] & 1) === 1;
    expect(compressPoint(x, y)[0]).toBe(yIsOdd ? 0x03 : 0x02);
  });

  it('returns the other root when the requested parity flips', async () => {
    const raw = await generateRawPublicKey();
    const x = raw.slice(1, 33);
    const y = raw.slice(33, 65);
    const yIsOdd = (y[31] & 1) === 1;

    const flipped = decompressPoint(x, !yIsOdd);
    const flippedY = bytesToBigInt(flipped.slice(33, 65));

    expect(flippedY).toBe(CURVE_P - bytesToBigInt(y));
  });

  it('rejects an x that is not on the curve', () => {
    const x = new Uint8Array(32);
    x[31] = 1;

    expect(() => decompressPoint(x, false)).toThrow(/not on the P-256 curve/);
  });

  it('rejects an x outside the field', () => {
    const x = new Uint8Array(32).fill(0xff);

    expect(() => decompressPoint(x, false)).toThrow(/outside the field/);
  });

  it('rejects wrong input sizes', () => {
    expect(() => decompressPoint(new Uint8Array(31), false)).toThrow(
      /must be 32 bytes/,
    );
    expect(() => compressPoint(new Uint8Array(31), new Uint8Array(32))).toThrow(
      /must be 32 bytes/,
    );
  });
});

describe('scalarToPkcs8', () => {
  it('produces a 67-byte blob that Web Crypto accepts as a P-256 key', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );

    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const d = Uint8Array.from(
      atob(jwk.d!.replace(/-/g, '+').replace(/_/g, '/')),
      (char) => char.charCodeAt(0),
    );

    const pkcs8 = scalarToPkcs8(d);
    expect(pkcs8.length).toBe(67);

    const imported = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );

    const reexported = await crypto.subtle.exportKey('jwk', imported);
    const original = await crypto.subtle.exportKey('jwk', pair.privateKey);
    expect(reexported.x).toBe(original.x);
    expect(reexported.y).toBe(original.y);
  });

  it('rejects a scalar that is not 32 bytes', () => {
    expect(() => scalarToPkcs8(new Uint8Array(31))).toThrow(/must be 32 bytes/);
  });
});
