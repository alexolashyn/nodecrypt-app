import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CHAIN_ID } from '@/config';
import { bytesEqual, bytesToHex, hexToBytes, wipe } from '@/crypto/bytes';
import { seal, unseal } from '@/crypto/ecies';
import {
  deriveIdentityKey,
  matchesPublicKey,
  signDerivationMessage,
} from '@/crypto/identity';
import {
  generateMasterKeyBytes,
  importMasterKey,
  masterKeyAad,
} from '@/crypto/masterKey';
import { AppError } from '@/shared/errors';
import { useAuthState } from '@/shared/auth/useAuthState';
import { connectWallet, ensureChain, getReadProvider } from '@/web3/wallet';
import {
  decodeContractError,
  getProfile,
  hasProfile,
  registerProfile,
} from '@/web3/profileRegistry';
import { UnlockPrompt } from '@/components/UnlockPrompt';
import { loadPendingState } from '@/features/rotation/pending';
import { KeyringContext, type Keyring, type KeyringStatus } from './keyring';

interface PendingUnlock {
  promise: Promise<Keyring>;
  resolve: (value: Keyring) => void;
  reject: (reason: unknown) => void;
}

export function KeyringProvider({ children }: { children: ReactNode }) {
  const authState = useAuthState();
  const address = authState.status === 'authenticated' ? authState.address : null;

  const [status, setStatus] = useState<KeyringStatus>('checking');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [keyring, setKeyring] = useState<Keyring | null>(null);
  const [isUnlockPromptOpen, setUnlockPromptOpen] = useState(false);

  const keyringRef = useRef<Keyring | null>(null);
  const addressRef = useRef<string | null>(null);
  const pendingUnlockRef = useRef<PendingUnlock | null>(null);

  useEffect(() => {
    addressRef.current = address;
  }, [address]);

  const settlePending = useCallback(
    (outcome: { keyring: Keyring } | { error: unknown }) => {
      const pending = pendingUnlockRef.current;
      pendingUnlockRef.current = null;
      if (!pending) return;

      if ('keyring' in outcome) pending.resolve(outcome.keyring);
      else pending.reject(outcome.error);
    },
    [],
  );

  const clear = useCallback(() => {
    if (keyringRef.current) {
      wipe(keyringRef.current.x);
    }
    keyringRef.current = null;
    setKeyring(null);
    setUnlockPromptOpen(false);
    setErrorKey(null);
    setStatus('checking');
    settlePending({ error: new AppError('errors:crypto.unlockCancelled') });
  }, [settlePending]);

  const fail = useCallback((error: unknown) => {
    const appError =
      error instanceof AppError ? error : decodeContractError(error);
    console.error(appError.detail ?? appError.key, error);
    setErrorKey(appError.key);
    setStatus('error');
  }, []);

  const store = useCallback(
    (next: Keyring) => {
      keyringRef.current = next;
      setKeyring(next);
      setStatus('unlocked');
      setUnlockPromptOpen(false);
      settlePending({ keyring: next });
    },
    [settlePending],
  );

  const check = useCallback(() => {
    setErrorKey(null);
    setStatus('checking');
  }, []);

  const register = useCallback(async () => {
    setErrorKey(null);

    try {
      const wallet = await connectWallet();
      await ensureChain(wallet.provider);

      setStatus('signing');
      const signature = await signDerivationMessage(
        wallet.signer,
        wallet.address,
        1,
        { checkDeterminism: true },
      );
      const identity = await deriveIdentityKey(signature, wallet.address, 1);
      wipe(signature);

      const masterKeyBytes = generateMasterKeyBytes();
      const aad = masterKeyAad(wallet.address, 1, 1);
      const sealed = await seal(identity.x, identity.yOdd, masterKeyBytes, aad);

      const roundTrip = await unseal(identity.privateKey, sealed, aad);
      const sealIsValid = bytesEqual(roundTrip, masterKeyBytes);
      wipe(roundTrip);
      if (!sealIsValid) {
        wipe(masterKeyBytes);
        throw new AppError('errors:crypto.selfCheckFailed');
      }

      setStatus('registering');
      await registerProfile(
        wallet.signer,
        bytesToHex(identity.x),
        identity.yOdd,
        bytesToHex(sealed),
      );

      const stored = await getProfile(wallet.provider, wallet.address);
      const storedMatches =
        stored.exists && matchesPublicKey(identity, stored.pubKeyX, stored.pubKeyYOdd);
      if (!storedMatches) {
        wipe(masterKeyBytes);
        throw new AppError('errors:crypto.selfCheckFailed');
      }

      const masterKey = await importMasterKey(masterKeyBytes);
      store({
        identityPrivateKey: identity.privateKey,
        x: identity.x,
        yOdd: identity.yOdd,
        masterKey,
        keyVersion: 1,
        mkVersion: 1,
        pendingMasterKey: null,
        migration: 'none',
      });
    } catch (error) {
      fail(error);
    }
  }, [fail, store]);

  const unlock = useCallback(async () => {
    setErrorKey(null);
    setStatus('unlocking');

    try {
      const wallet = await connectWallet();
      await ensureChain(wallet.provider);

      const profile = await getProfile(wallet.provider, wallet.address);
      if (!profile.exists) {
        setStatus('needsRegistration');
        setUnlockPromptOpen(false);
        return;
      }

      const signature = await signDerivationMessage(
        wallet.signer,
        wallet.address,
        profile.keyVersion,
      );
      const identity = await deriveIdentityKey(
        signature,
        wallet.address,
        profile.keyVersion,
      );
      wipe(signature);

      if (!matchesPublicKey(identity, profile.pubKeyX, profile.pubKeyYOdd)) {
        throw new AppError('errors:crypto.keyMismatch');
      }

      const masterKeyBytes = await unseal(
        identity.privateKey,
        hexToBytes(profile.wrappedMasterKey),
        masterKeyAad(wallet.address, profile.keyVersion, profile.mkVersion),
      );
      const masterKey = await importMasterKey(masterKeyBytes);

      const pending = await loadPendingState(
        wallet.provider,
        wallet.address,
        identity.privateKey,
        profile.keyVersion,
        profile.mkVersion,
      );

      store({
        identityPrivateKey: identity.privateKey,
        x: identity.x,
        yOdd: identity.yOdd,
        masterKey,
        keyVersion: profile.keyVersion,
        mkVersion: profile.mkVersion,
        ...pending,
      });
    } catch (error) {
      fail(error);
    }
  }, [fail, store]);

  const ensureUnlocked = useCallback((): Promise<Keyring> => {
    if (keyringRef.current) return Promise.resolve(keyringRef.current);
    if (pendingUnlockRef.current) return pendingUnlockRef.current.promise;

    let resolve!: (value: Keyring) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<Keyring>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    pendingUnlockRef.current = { promise, resolve, reject };
    setErrorKey(null);
    setUnlockPromptOpen(true);

    return promise;
  }, []);

  const cancelUnlock = useCallback(() => {
    setUnlockPromptOpen(false);
    setErrorKey(null);
    setStatus('locked');
    settlePending({ error: new AppError('errors:crypto.unlockCancelled') });
  }, [settlePending]);

  useEffect(() => {
    if (!address || status !== 'checking') return;

    let cancelled = false;

    void (async () => {
      try {
        const exists = await hasProfile(getReadProvider(), address);
        if (!cancelled) setStatus(exists ? 'locked' : 'needsRegistration');
      } catch (error) {
        if (!cancelled) fail(error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, status, fail]);

  useEffect(() => {
    type Listener = (payload: never) => void;
    const ethereum = window.ethereum as
      | {
          on?: (event: string, handler: Listener) => void;
          removeListener?: (event: string, handler: Listener) => void;
        }
      | undefined;
    if (!ethereum?.on) return;

    const handleAccountsChanged = ((accounts: string[]) => {
      const next = accounts[0]?.toLowerCase() ?? null;
      const current = addressRef.current?.toLowerCase() ?? null;
      if (current && next !== current) clear();
    }) as Listener;

    const handleChainChanged = ((chainIdHex: string) => {
      if (Number.parseInt(chainIdHex, 16) !== CHAIN_ID) clear();
    }) as Listener;

    ethereum.on('accountsChanged', handleAccountsChanged);
    ethereum.on('chainChanged', handleChainChanged);

    return () => {
      ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
      ethereum.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [clear]);

  return (
    <KeyringContext.Provider
      value={{
        status,
        errorKey,
        address,
        keyring,
        isUnlockPromptOpen,
        check,
        register,
        unlock,
        ensureUnlocked,
        replaceKeyring: store,
        cancelUnlock,
        clear,
      }}
    >
      {children}
      {isUnlockPromptOpen && <UnlockPrompt />}
    </KeyringContext.Provider>
  );
}
