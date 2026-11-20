import { useTranslation } from 'react-i18next';
import { useKeyring } from '@/context/keyring';
import { KeyIcon, KeyringCard } from './KeyringCard';

export function ProfileSetup() {
  const { t } = useTranslation('keyring');
  const { status, errorKey, register } = useKeyring();

  const busy = status === 'signing' || status === 'registering';

  const label = busy
    ? status === 'signing'
      ? t('setup.button.signing')
      : t('setup.button.registering')
    : t('setup.button.idle');

  return (
    <KeyringCard
      icon={<KeyIcon />}
      title={t('setup.title')}
      subtitle={t('setup.subtitle')}
    >
      <div className="mt-5 flex justify-center gap-2">
        {(['signatures', 'transaction'] as const).map((badge) => (
          <span
            key={badge}
            className="rounded-full border border-neutral-800 px-3 py-1 text-xs text-neutral-400"
          >
            {t(`setup.badges.${badge}`)}
          </span>
        ))}
      </div>

      <button
        onClick={() => void register()}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-green-500 px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {label}
      </button>

      {errorKey && <p className="mt-3 text-sm text-red-400">{t(errorKey)}</p>}
    </KeyringCard>
  );
}
