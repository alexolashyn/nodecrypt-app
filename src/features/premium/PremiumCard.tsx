import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatEther } from 'ethers';
import { useKeyring } from '@/context/keyring';
import { GlowCard } from '@/shared/components/GlowCard';
import type { AppError } from '@/shared/errors';
import { formatBytes, formatDate } from '@/shared/format';
import { toAppError, useErrorText } from '@/shared/useErrorText';
import {
  buyPremiumEth,
  decodeStorageTierError,
  getTierInfo,
} from '@/web3/storageTier';
import type { TierInfo } from '@/web3/types';
import { connectAs, getReadProvider } from '@/web3/wallet';

const DAY = 86_400;

interface Loaded {
  info: TierInfo;
  now: number;
}

function StarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
    </svg>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-black/40 px-4 py-3 text-left">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-base font-medium text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}

const stepBtn =
  'flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-800 text-lg text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40';

export function PremiumCard() {
  const { t, i18n } = useTranslation('premium');
  const errorText = useErrorText();
  const { address } = useKeyring();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [periods, setPeriods] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [success, setSuccess] = useState(false);

  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    void (async () => {
      try {
        const info = await getTierInfo(getReadProvider(), address);
        if (!cancelled) setLoaded({ info, now: Math.floor(Date.now() / 1000) });
      } catch (err) {
        if (!cancelled) setError(toAppError(err, decodeStorageTierError));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, reloadToken]);

  const buy = async () => {
    if (!address || !loaded) return;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const wallet = await connectAs(address);
      await buyPremiumEth(wallet.signer, periods, loaded.info.pricePerPeriod);
      setSuccess(true);
      setPeriods(1);
    } catch (err) {
      setError(toAppError(err, decodeStorageTierError));
    } finally {
      setBusy(false);
      reload();
    }
  };

  if (!loaded) {
    return (
      <div className="w-full max-w-md text-center">
        <p className="text-sm text-neutral-500">
          {error ? errorText(error) : t('loading')}
        </p>
      </div>
    );
  }

  const { info, now } = loaded;
  const purchasable = info.pricePerPeriod > 0n && !info.paused;
  const total = info.pricePerPeriod * BigInt(periods);
  const periodDays = Math.round(info.periodSeconds / DAY);
  const daysLeft = info.isPremium ? Math.ceil((info.premiumUntil - now) / DAY) : 0;
  const newExpiry =
    Math.max(info.premiumUntil, now) + info.periodSeconds * periods;

  return (
    <div className="w-full max-w-md">
      <GlowCard className="p-8">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-green-500/30 bg-green-500/10 text-green-400">
            <StarIcon />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">{t('title')}</h1>
          <span
            className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-medium ${
              info.isPremium
                ? 'bg-green-500/15 text-green-400'
                : 'bg-neutral-800 text-neutral-300'
            }`}
          >
            {info.isPremium ? t('tier.premium') : t('tier.free')}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Stat label={t('limit')} value={formatBytes(info.maxFileBytes)} />
          <Stat
            label={t('expires')}
            value={
              info.premiumUntil > 0
                ? formatDate(info.premiumUntil, i18n.language)
                : t('never')
            }
            sub={
              info.isPremium
                ? t('daysLeft', { count: daysLeft })
                : info.premiumUntil > 0
                  ? t('expired')
                  : undefined
            }
          />
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl border border-neutral-800 px-4 py-3 text-sm">
          <span className={info.isPremium ? 'text-neutral-500' : 'text-white'}>
            {t('tier.free')} · {formatBytes(info.freeMaxFileBytes)}
          </span>
          <span className="text-neutral-600">→</span>
          <span className={info.isPremium ? 'text-green-400' : 'text-neutral-400'}>
            {t('tier.premium')} · {formatBytes(info.premiumMaxFileBytes)}
          </span>
        </div>

        <div className="mt-6 border-t border-neutral-800 pt-6">
          {purchasable ? (
            <>
              <p className="text-center text-xs text-neutral-500">
                {t('periods', { days: periodDays })}
              </p>
              <div className="mt-2 flex items-center justify-center gap-4">
                <button
                  onClick={() => setPeriods((n) => Math.max(1, n - 1))}
                  disabled={busy || periods <= 1}
                  className={stepBtn}
                  aria-label={t('decrease')}
                >
                  −
                </button>
                <span className="w-12 text-center text-2xl font-semibold tabular-nums text-white">
                  {periods}
                </span>
                <button
                  onClick={() => setPeriods((n) => Math.min(info.maxPeriods, n + 1))}
                  disabled={busy || periods >= info.maxPeriods}
                  className={stepBtn}
                  aria-label={t('increase')}
                >
                  +
                </button>
              </div>

              <dl className="mt-5 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-neutral-500">{t('total')}</dt>
                  <dd className="font-medium text-white">{formatEther(total)} ETH</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-500">{t('newExpiry')}</dt>
                  <dd className="text-neutral-200">{formatDate(newExpiry, i18n.language)}</dd>
                </div>
              </dl>

              <button
                onClick={() => void buy()}
                disabled={busy}
                className="mt-5 w-full rounded-lg bg-green-500 px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? t('buying') : info.isPremium ? t('extendShort') : t('buyShort')}
              </button>
              <p className="mt-2 text-center text-xs text-neutral-500">
                {t('pricePerPeriod', { amount: formatEther(info.pricePerPeriod) })}
                {' · '}
                {t('noRefunds')}
              </p>
            </>
          ) : (
            <p className="text-center text-sm text-neutral-500">
              {info.paused ? t('paused') : t('disabled')}
            </p>
          )}

          {success && <p className="mt-3 text-center text-sm text-green-400">{t('success')}</p>}
          {error && <p className="mt-3 text-center text-sm text-red-400">{errorText(error)}</p>}
        </div>
      </GlowCard>
    </div>
  );
}
