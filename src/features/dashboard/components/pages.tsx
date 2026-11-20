import { useTranslation } from 'react-i18next';
import { useKeyring } from '@/context/keyring';
import { PremiumCard } from '@/features/premium/PremiumCard';
import { FilesPanel } from '@/features/files/components/FilesPanel';
import {
  MigrationBanner,
  RotationPanel,
} from '@/features/rotation/components/RotationPanel';
import { LockedNotice } from './LockedNotice';

export function FilesPage() {
  const { t } = useTranslation('dashboard');
  const { keyring } = useKeyring();

  if (!keyring) return <LockedNotice hint={t('lockedHint.files')} />;

  return (
    <>
      <MigrationBanner keyring={keyring} />
      <FilesPanel keyring={keyring} />
    </>
  );
}

export function PlanPage() {
  return (
    <div className="flex flex-1 items-center justify-center py-8">
      <PremiumCard />
    </div>
  );
}

export function SecurityPage() {
  const { t } = useTranslation('dashboard');
  const { keyring } = useKeyring();

  if (!keyring) return <LockedNotice hint={t('lockedHint.security')} />;

  return (
    <>
      <MigrationBanner keyring={keyring} />
      <RotationPanel keyring={keyring} />
    </>
  );
}
