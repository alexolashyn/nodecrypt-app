import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useKeyring } from '@/context/keyring';
import { ProfileSetup } from './ProfileSetup';

export function KeyringGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('keyring');
  const { status, errorKey, check } = useKeyring();

  const needsRegistration =
    status === 'needsRegistration' ||
    status === 'signing' ||
    status === 'registering';

  if (!needsRegistration && status !== 'checking' && status !== 'error') {
    return children;
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      {status === 'checking' && (
        <p className="text-sm text-neutral-500">{t('checking')}</p>
      )}

      {needsRegistration && <ProfileSetup />}

      {status === 'error' && (
        <div className="max-w-md text-center">
          <p className="mb-4 text-sm text-red-400">
            {errorKey ? t(errorKey) : t('genericError')}
          </p>
          <button
            onClick={() => void check()}
            className="rounded-lg border border-neutral-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-neutral-700"
          >
            {t('retry')}
          </button>
        </div>
      )}
    </div>
  );
}
