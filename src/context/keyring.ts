import { createContext, useContext } from 'react';
import type { Bytes } from '@/crypto/bytes';
import { AppError } from '@/shared/errors';

export type KeyringStatus =
  | 'checking'
  | 'needsRegistration'
  | 'signing'
  | 'registering'
  | 'locked'
  | 'unlocking'
  | 'unlocked'
  | 'error';

export type MigrationState = 'none' | 'inProgress' | 'needsCleanup' | 'unreadable';

export interface Keyring {
  identityPrivateKey: CryptoKey;
  x: Bytes;
  yOdd: boolean;
  masterKey: CryptoKey;
  keyVersion: number;
  mkVersion: number;
  pendingMasterKey: CryptoKey | null;
  migration: MigrationState;
}

export const masterKeyFor = (keyring: Keyring, mkVersion: number): CryptoKey => {
  if (mkVersion === keyring.mkVersion) return keyring.masterKey;
  if (mkVersion === keyring.mkVersion + 1 && keyring.pendingMasterKey) {
    return keyring.pendingMasterKey;
  }
  throw new AppError(
    'errors:files.keyringStale',
    `record mk=${mkVersion}, keyring mk=${keyring.mkVersion}`,
  );
};

export interface KeyringContextValue {
  status: KeyringStatus;
  errorKey: string | null;
  address: string | null;
  keyring: Keyring | null;
  isUnlockPromptOpen: boolean;
  check: () => void;
  register: () => Promise<void>;
  unlock: () => Promise<void>;
  ensureUnlocked: () => Promise<Keyring>;
  replaceKeyring: (next: Keyring) => void;
  cancelUnlock: () => void;
  clear: () => void;
}

export const KeyringContext = createContext<KeyringContextValue | null>(null);

export const useKeyring = (): KeyringContextValue => {
  const value = useContext(KeyringContext);
  if (!value) {
    throw new Error('useKeyring must be used inside <KeyringProvider>');
  }
  return value;
};
