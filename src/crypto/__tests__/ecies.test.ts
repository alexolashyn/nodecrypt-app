import { beforeAll, describe, expect, it } from 'vitest';
import { type Bytes, bytesEqual, randomBytes, utf8 } from '../bytes';
import { UnsealError, seal, unseal } from '../ecies';
import { scalarToPkcs8 } from '../p256';

interface Identity {
  privateKey: CryptoKey;
  x: Bytes;
  yOdd: boolean;
}

const base64UrlDecode = (value: string): Bytes =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
    char.charCodeAt(0),
  );

const createIdentity = async (): Promise<Identity> => {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const x = base64UrlDecode(jwk.x!);
  const y = base64UrlDecode(jwk.y!);

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    scalarToPkcs8(base64UrlDecode(jwk.d!)),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );

  return { privateKey, x, yOdd: (y[31] & 1) === 1 };
};

const AAD = utf8('nodecrypt|mk|0xabc|84532|kv=1|mk=1');

describe('seal / unseal', () => {
  let identity: Identity;
  let plaintext: Bytes;

  beforeAll(async () => {
    identity = await createIdentity();
    plaintext = randomBytes(32);
  });

  it('produces exactly 93 bytes for a 32-byte plaintext', async () => {
    const sealed = await seal(identity.x, identity.yOdd, plaintext, AAD);
    expect(sealed.length).toBe(93);
  });

  it('is randomised: sealing the same plaintext twice differs', async () => {
    const first = await seal(identity.x, identity.yOdd, plaintext, AAD);
    const second = await seal(identity.x, identity.yOdd, plaintext, AAD);

    expect(bytesEqual(first, second)).toBe(false);
  });

  it('round-trips back to the original bytes', async () => {
    const sealed = await seal(identity.x, identity.yOdd, plaintext, AAD);
    const opened = await unseal(identity.privateKey, sealed, AAD);

    expect(bytesEqual(opened, plaintext)).toBe(true);
  });

  it('fails with a different AAD', async () => {
    const sealed = await seal(identity.x, identity.yOdd, plaintext, AAD);
    const otherAad = utf8('nodecrypt|mk|0xabc|84532|kv=2|mk=1');

    await expect(unseal(identity.privateKey, sealed, otherAad)).rejects.toThrow(
      UnsealError,
    );
  });

  it('fails with a different identity key', async () => {
    const sealed = await seal(identity.x, identity.yOdd, plaintext, AAD);
    const stranger = await createIdentity();

    await expect(unseal(stranger.privateKey, sealed, AAD)).rejects.toThrow(
      UnsealError,
    );
  });

  it('fails when a ciphertext byte is flipped', async () => {
    const sealed = await seal(identity.x, identity.yOdd, plaintext, AAD);
    sealed[60] ^= 0x01;

    await expect(unseal(identity.privateKey, sealed, AAD)).rejects.toThrow(
      UnsealError,
    );
  });

  it('rejects a payload of the wrong length', async () => {
    await expect(
      unseal(identity.privateKey, randomBytes(92), AAD),
    ).rejects.toThrow(/92/);
  });
});
