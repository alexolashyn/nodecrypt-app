import { useTranslation } from 'react-i18next';
import { useKeyring } from '@/context/keyring';
import { isAppError } from '@/shared/errors';

export function LockedNotice({ hint }: { hint: string }) {
  const { t } = useTranslation('dashboard');
  const { ensureUnlocked } = useKeyring();

  const unlock = async () => {
    try {
      await ensureUnlocked();
    } catch (error) {
      if (!isAppError(error)) throw error;
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-sm text-neutral-500">{hint}</p>
      <button
        onClick={() => void unlock()}
        className="rounded-lg bg-green-500 px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-green-400"
      >
        {t('unlock')}
      </button>
    </div>
  );
}
