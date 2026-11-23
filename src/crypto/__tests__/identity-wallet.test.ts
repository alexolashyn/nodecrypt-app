import { Wallet, type HDNodeWallet, type Signer, type TypedDataDomain, type TypedDataField } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { bytesToHex } from '../bytes';
import {
  UnsupportedWalletError,
  deriveIdentityKey,
  matchesPublicKey,
  signDerivationMessage,
} from '../identity';

const walletA = Wallet.createRandom();
const walletB = Wallet.createRandom();

type SignTypedData = (
  domain: TypedDataDomain,
  types: Record<string, TypedDataField[]>,
  value: Record<string, unknown>,
) => Promise<string>;

const signerFrom = (signTypedData: SignTypedData) => ({ signTypedData }) as unknown as Signer;

const alternating = (...wallets: HDNodeWallet[]) => {
  let call = 0;
  return signerFrom((domain, types, value) => wallets[call++ % wallets.length].signTypedData(domain, types, value));
};

const identityOf = async (signer: Signer, address: string, keyVersion: number) =>
  deriveIdentityKey(await signDerivationMessage(signer, address, keyVersion), address, keyVersion);

const profileOf = async (wallet: HDNodeWallet, keyVersion = 1) => {
  const identity = await identityOf(wallet, wallet.address, keyVersion);
  return { pubKeyX: bytesToHex(identity.x), pubKeyYOdd: identity.yOdd };
};

describe('scenario 11: wallets with non-deterministic signatures are refused', () => {
  it('a regular EOA wallet passes the check and is asked to sign twice', async () => {
    const spy = vi.spyOn(walletA, 'signTypedData');

    const signature = await signDerivationMessage(walletA, walletA.address, 1, { checkDeterminism: true });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(signature).toHaveLength(64);
    expect(signature).toEqual(await signDerivationMessage(walletA, walletA.address, 1));
    spy.mockRestore();
  });

  it('a wallet that signs the same message differently is refused', async () => {
    const signer = alternating(walletA, walletB);

    await expect(
      signDerivationMessage(signer, walletA.address, 1, { checkDeterminism: true }),
    ).rejects.toBeInstanceOf(UnsupportedWalletError);
  });

  it('the refusal carries the translated error key', async () => {
    const error = await signDerivationMessage(alternating(walletA, walletB), walletA.address, 1, {
      checkDeterminism: true,
    }).catch((e: unknown) => e);

    expect((error as UnsupportedWalletError).key).toBe('errors:crypto.unsupportedWallet');
  });

  it('without the check, signing happens once and nothing is refused', async () => {
    const spy = vi.fn((d: TypedDataDomain, t: Record<string, TypedDataField[]>, v: Record<string, unknown>) =>
      walletA.signTypedData(d, t, v),
    );

    await signDerivationMessage(signerFrom(spy), walletA.address, 1);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a non-deterministic wallet would derive a different key every session', async () => {
    const signer = alternating(walletA, walletB);
    const first = await identityOf(signer, walletA.address, 1);
    const second = await identityOf(signer, walletA.address, 1);

    expect(first.x).not.toEqual(second.x);
  });

  it('signs a typed message bound to the account, key version and contract', async () => {
    const spy = vi.fn((d: TypedDataDomain, t: Record<string, TypedDataField[]>, v: Record<string, unknown>) =>
      walletA.signTypedData(d, t, v),
    );

    await signDerivationMessage(signerFrom(spy), walletA.address, 3);

    const [domain, , value] = spy.mock.calls[0];
    expect(domain).toMatchObject({ name: 'nodecrypt', chainId: expect.any(Number) });
    expect(domain.verifyingContract).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(value).toMatchObject({ account: walletA.address, keyVersion: 3 });
  });
});

describe('scenario 12: a key that does not match the on-chain profile is detected', () => {
  it('the same wallet in a later session matches its profile', async () => {
    const profile = await profileOf(walletA);
    const identity = await identityOf(walletA, walletA.address, 1);

    expect(matchesPublicKey(identity, profile.pubKeyX, profile.pubKeyYOdd)).toBe(true);
  });

  it('another wallet does not match', async () => {
    const profile = await profileOf(walletA);
    const identity = await identityOf(walletB, walletB.address, 1);

    expect(matchesPublicKey(identity, profile.pubKeyX, profile.pubKeyYOdd)).toBe(false);
  });

  it('another wallet signing the message for this account does not match', async () => {
    const profile = await profileOf(walletA);
    const identity = await identityOf(walletB, walletA.address, 1);

    expect(matchesPublicKey(identity, profile.pubKeyX, profile.pubKeyYOdd)).toBe(false);
  });

  it('a key derived for an old key version does not match the rotated profile', async () => {
    const rotated = await profileOf(walletA, 2);
    const stale = await identityOf(walletA, walletA.address, 1);

    expect(matchesPublicKey(stale, rotated.pubKeyX, rotated.pubKeyYOdd)).toBe(false);
  });

  it('the same x with the other y parity does not match', async () => {
    const profile = await profileOf(walletA);
    const identity = await identityOf(walletA, walletA.address, 1);

    expect(matchesPublicKey(identity, profile.pubKeyX, !profile.pubKeyYOdd)).toBe(false);
  });

  it('accepts the public key with or without the 0x prefix', async () => {
    const profile = await profileOf(walletA);
    const identity = await identityOf(walletA, walletA.address, 1);

    expect(matchesPublicKey(identity, profile.pubKeyX.slice(2), profile.pubKeyYOdd)).toBe(true);
  });
});
