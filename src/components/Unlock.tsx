import { useTranslation } from 'react-i18next';
import { useKeyring } from '@/context/keyring';
import { KeyringCard, LockIcon } from './KeyringCard';

export function Unlock({ onCancel }: { onCancel?: () => void }) {
  const { t } = useTranslation('keyring');
  const { status, errorKey, unlock } = useKeyring();

  const busy = status === 'unlocking';

  return (
    <KeyringCard
      icon={<LockIcon />}
      title={t('unlock.title')}
      subtitle={t('unlock.subtitle')}
    >
      <button
        onClick={() => void unlock()}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-green-500 px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? t('unlock.button.pending') : t('unlock.button.idle')}
      </button>

      {onCancel && (
        <button
          onClick={onCancel}
          disabled={busy}
          className="mt-2 w-full rounded-lg border border-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('unlock.cancel')}
        </button>
      )}

      {errorKey && <p className="mt-3 text-sm text-red-400">{t(errorKey)}</p>}
    </KeyringCard>
  );
}
