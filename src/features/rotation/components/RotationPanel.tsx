import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type Keyring, useKeyring } from '@/context/keyring';
import type { AppError } from '@/shared/errors';
import { toAppError, useErrorText } from '@/shared/useErrorText';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import {
  AlertIcon,
  CheckIcon,
  KeyIcon,
  RefreshIcon,
  ShieldIcon,
} from '@/shared/components/icons';
import { decodeFileRegistryError } from '@/web3/fileRegistry';
import {
  type RotationProgress,
  fullRotation,
  resumeMasterKeyRotation,
  rotateIdentityKey,
  startMasterKeyRotation,
} from '../service';

type Scenario = 'identity' | 'masterKey' | 'full';

const SCENARIOS: Array<{ id: Scenario; icon: ReactNode; heavy?: boolean }> = [
  { id: 'identity', icon: <KeyIcon /> },
  { id: 'masterKey', icon: <ShieldIcon /> },
  { id: 'full', icon: <RefreshIcon />, heavy: true },
];

function ProgressLine({ progress }: { progress: RotationProgress }) {
  const { t } = useTranslation('rotation');
  const ratio =
    progress.total !== undefined && progress.total > 0
      ? (progress.done ?? 0) / progress.total
      : undefined;

  return (
    <div className="mt-4 rounded-lg border border-neutral-800 bg-black/40 p-3">
      <div className="flex items-center gap-2 text-xs text-neutral-300">
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-neutral-600 border-t-green-400" />
        <span className="min-w-0 truncate">
          {t(`stage.${progress.stage}`)}
          {progress.upload && ` · ${t(`files:stage.${progress.upload.stage}`)}`}
        </span>
        {progress.total !== undefined && (
          <span className="ml-auto shrink-0 tabular-nums text-neutral-500">
            {progress.done ?? 0}/{progress.total}
          </span>
        )}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-full rounded-full bg-green-500 transition-all ${
            ratio === undefined ? 'w-1/3 animate-pulse' : ''
          }`}
          style={ratio === undefined ? undefined : { width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function MigrationBanner({ keyring }: { keyring: Keyring }) {
  const { t } = useTranslation('rotation');
  const errorText = useErrorText();
  const { address, replaceKeyring } = useKeyring();
  const [progress, setProgress] = useState<RotationProgress | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  if (keyring.migration === 'none') return null;

  const resume = async () => {
    if (!address) return;
    setError(null);
    try {
      await resumeMasterKeyRotation(keyring, address, setProgress, replaceKeyring);
    } catch (err) {
      setError(toAppError(err, decodeFileRegistryError));
    } finally {
      setProgress(null);
    }
  };

  const unreadable = keyring.migration === 'unreadable';

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
          <AlertIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-amber-200">{t('banner.title')}</h2>
          <p className="mt-1 text-sm text-neutral-300">
            {unreadable ? t('banner.unreadable') : t(`banner.${keyring.migration}`)}
          </p>
          {!unreadable && (
            <button
              onClick={() => void resume()}
              disabled={progress !== null}
              className="mt-3 rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('banner.continue')}
            </button>
          )}
          {progress && <ProgressLine progress={progress} />}
          {error && <p className="mt-2 text-sm text-red-400">{errorText(error)}</p>}
        </div>
      </div>
    </section>
  );
}

function VersionTile({ label, version }: { label: string; version: number }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-black/40 px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 font-mono text-lg font-medium text-white">v{version}</p>
    </div>
  );
}

export function RotationPanel({ keyring }: { keyring: Keyring }) {
  const { t } = useTranslation('rotation');
  const errorText = useErrorText();
  const { address, replaceKeyring, clear } = useKeyring();
  const [running, setRunning] = useState<Scenario | null>(null);
  const [progress, setProgress] = useState<RotationProgress | null>(null);
  const [error, setError] = useState<{ scenario: Scenario; error: AppError } | null>(null);
  const [done, setDone] = useState<Scenario | null>(null);
  const [pending, setPending] = useState<Scenario | null>(null);
  const cancelPending = useCallback(() => setPending(null), []);

  const run = async (scenario: Scenario) => {
    if (!address || running) return;
    setPending(null);

    setRunning(scenario);
    setError(null);
    setDone(null);
    try {
      if (scenario === 'identity') {
        replaceKeyring(await rotateIdentityKey(keyring, address, setProgress));
      } else if (scenario === 'masterKey') {
        await startMasterKeyRotation(keyring, address, setProgress, replaceKeyring);
      } else {
        await fullRotation(keyring, address, setProgress);
      }
      setDone(scenario);
    } catch (err) {
      const appError = toAppError(err, decodeFileRegistryError);
      if (appError.key === 'errors:files.keyringStale') clear();
      setError({ scenario, error: appError });
    } finally {
      setRunning(null);
      setProgress(null);
    }
  };

  const blocked = keyring.migration !== 'none';

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-white">{t('title')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('subtitle')}</p>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <VersionTile label={t('identityVersion')} version={keyring.keyVersion} />
        <VersionTile label={t('masterKeyVersion')} version={keyring.mkVersion} />
      </div>

      {blocked && (
        <p className="mt-4 flex items-center gap-2 text-xs text-amber-300">
          <AlertIcon className="h-4 w-4 shrink-0" />
          {t('blockedByMigration')}
        </p>
      )}

      <div className="mt-5 space-y-3">
        {SCENARIOS.map(({ id, icon, heavy }) => {
          const active = running === id;
          return (
            <article
              key={id}
              className={`rounded-xl border p-4 transition-colors ${
                active ? 'border-green-500/40 bg-green-500/5' : 'border-neutral-800 bg-black/30'
              }`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${
                    heavy
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-green-500/30 bg-green-500/10 text-green-400'
                  }`}
                >
                  {icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium text-white">{t(`${id}.title`)}</h2>
                    <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
                      {t(`${id}.cost`)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                    {t(`${id}.description`)}
                  </p>
                </div>
                <button
                  onClick={() => setPending(id)}
                  disabled={running !== null || blocked}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    heavy
                      ? 'border border-amber-500/30 text-amber-200 hover:border-amber-500/60'
                      : 'border border-neutral-800 text-neutral-200 hover:border-neutral-700 hover:text-white'
                  }`}
                >
                  {active ? t('running') : t('start')}
                </button>
              </div>

              {active && progress && <ProgressLine progress={progress} />}
              {done === id && (
                <p className="mt-3 flex items-center gap-2 text-sm text-green-400">
                  <CheckIcon className="h-4 w-4" />
                  {t(`${id}.done`)}
                </p>
              )}
              {error?.scenario === id && (
                <p className="mt-3 text-sm text-red-400">{errorText(error.error)}</p>
              )}
            </article>
          );
        })}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? t(`${pending}.title`) : ''}
        confirmLabel={t('start')}
        onConfirm={() => pending && void run(pending)}
        onCancel={cancelPending}
      >
        {pending && t(`${pending}.confirm`)}
      </ConfirmDialog>
    </section>
  );
}
