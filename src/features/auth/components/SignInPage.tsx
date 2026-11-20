import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '@/shared/components/LanguageSwitcher';
import { GlowCard } from '@/shared/components/GlowCard';
import { SignInButton } from './SignInButton';

const steps = ['connect', 'sign', 'verified'] as const;

export function SignInPage() {
  const { t } = useTranslation('auth');

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <span className="font-mono text-sm font-medium tracking-tight text-white">
          {t('title')}
        </span>
        <LanguageSwitcher />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <GlowCard className="p-6">
            <h1 className="mb-6 text-center text-lg font-semibold text-white">
              {t('tagline')}
            </h1>

            <ol className="mb-8 space-y-4">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-green-500/30 bg-green-500/10 text-xs font-medium text-green-400">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {t(`steps.${step}.title`)}
                    </p>
                    <p className="text-sm text-neutral-400">
                      {t(`steps.${step}.description`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <SignInButton />
          </GlowCard>
        </div>
      </main>
    </div>
  );
}
