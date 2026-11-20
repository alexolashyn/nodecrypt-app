import { describe, expect, it } from 'vitest';
import { type Bytes, bytesEqual, bytesToBigInt } from '../bytes';
import { deriveIdentityKey } from '../identity';
import { CURVE_N, decompressPoint } from '../p256';
import { seal, unseal } from '../ecies';
import { utf8 } from '../bytes';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const fixedSignature = (fill: number): Bytes => new Uint8Array(64).fill(fill);

describe('deriveIdentityKey', () => {
  it('is deterministic: same signature gives the same public key', async () => {
    const a = await deriveIdentityKey(fixedSignature(0x11), ADDRESS, 1);
    const b = await deriveIdentityKey(fixedSignature(0x11), ADDRESS, 1);

    expect(bytesEqual(a.x, b.x)).toBe(true);
    expect(a.yOdd).toBe(b.yOdd);
  });

  it('a different signature gives a different key', async () => {
    const a = await deriveIdentityKey(fixedSignature(0x11), ADDRESS, 1);
    const b = await deriveIdentityKey(fixedSignature(0x22), ADDRESS, 1);

    expect(bytesEqual(a.x, b.x)).toBe(false);
  });

  it('a different keyVersion gives a different key', async () => {
    const a = await deriveIdentityKey(fixedSignature(0x11), ADDRESS, 1);
    const b = await deriveIdentityKey(fixedSignature(0x11), ADDRESS, 2);

    expect(bytesEqual(a.x, b.x)).toBe(false);
  });

  it('a different address gives a different key', async () => {
    const other = '0xfedcba0987654321fedcba0987654321fedcba09';
    const a = await deriveIdentityKey(fixedSignature(0x11), ADDRESS, 1);
    const b = await deriveIdentityKey(fixedSignature(0x11), other, 1);

    expect(bytesEqual(a.x, b.x)).toBe(false);
  });

  it('address casing does not affect the result', async () => {
    const a = await deriveIdentityKey(fixedSignature(0x11), ADDRESS, 1);
    const b = await deriveIdentityKey(
      fixedSignature(0x11),
      ADDRESS.toUpperCase().replace('0X', '0x'),
      1,
    );

    expect(bytesEqual(a.x, b.x)).toBe(true);
  });

  it('produces a public key that is a real point on the curve', async () => {
    for (let i = 0; i < 10; i += 1) {
      const identity = await deriveIdentityKey(fixedSignature(i), ADDRESS, 1);

      const point = decompressPoint(identity.x, identity.yOdd);
      expect(point.length).toBe(65);
      expect(point[0]).toBe(0x04);

      const xValue = bytesToBigInt(identity.x);
      expect(xValue).toBeGreaterThan(0n);
      expect(xValue).toBeLessThan(CURVE_N * 2n);
    }
  });

  it('returns a non-extractable private key', async () => {
    const identity = await deriveIdentityKey(fixedSignature(0x11), ADDRESS, 1);

    expect(identity.privateKey.extractable).toBe(false);
    await expect(
      crypto.subtle.exportKey('jwk', identity.privateKey),
    ).rejects.toThrow();
  });

  it('the derived key can unseal what was sealed to its public key', async () => {
    const identity = await deriveIdentityKey(fixedSignature(0x11), ADDRESS, 1);
    const aad = utf8('nodecrypt|mk|test|84532|kv=1|mk=1');
    const secret = new Uint8Array(32).fill(0x7f);

    const sealed = await seal(identity.x, identity.yOdd, secret, aad);
    const opened = await unseal(identity.privateKey, sealed, aad);

    expect(bytesEqual(opened, secret)).toBe(true);
  });
});
