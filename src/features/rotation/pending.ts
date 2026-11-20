import type { Provider } from 'ethers';
import { unseal } from '@/crypto/ecies';
import { importMasterKey, masterKeyAad } from '@/crypto/masterKey';
import type { MigrationState } from '@/context/keyring';
import { getPendingMasterKey } from '@/web3/fileRegistry';

export interface PendingState {
  migration: MigrationState;
  pendingMasterKey: CryptoKey | null;
}

export const loadPendingState = async (
  provider: Provider,
  address: string,
  identityPrivateKey: CryptoKey,
  keyVersion: number,
  mkVersion: number,
): Promise<PendingState> => {
  const sealed = await getPendingMasterKey(provider, address);
  if (sealed.length === 0) return { migration: 'none', pendingMasterKey: null };

  try {
    const bytes = await unseal(
      identityPrivateKey,
      sealed,
      masterKeyAad(address, keyVersion, mkVersion + 1),
    );
    return { migration: 'inProgress', pendingMasterKey: await importMasterKey(bytes) };
  } catch {}

  try {
    const bytes = await unseal(
      identityPrivateKey,
      sealed,
      masterKeyAad(address, keyVersion, mkVersion),
    );
    bytes.fill(0);
    return { migration: 'needsCleanup', pendingMasterKey: null };
  } catch {
    return { migration: 'unreadable', pendingMasterKey: null };
  }
};
