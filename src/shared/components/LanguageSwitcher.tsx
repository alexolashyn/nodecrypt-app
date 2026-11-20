import { useTranslation } from 'react-i18next';

const languages = ['en', 'uk'] as const;

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation('common');

  return (
    <div className="inline-flex rounded-full border border-neutral-800 bg-neutral-900 p-0.5 text-xs">
      {languages.map((lng) => {
        const active = i18n.resolvedLanguage === lng;
        return (
          <button
            key={lng}
            onClick={() => void i18n.changeLanguage(lng)}
            aria-label={t(`language.${lng}`)}
            aria-pressed={active}
            className={
              active
                ? 'rounded-full bg-green-500 px-3 py-1 font-medium text-black'
                : 'rounded-full px-3 py-1 text-neutral-400 transition-colors hover:text-white'
            }
          >
            {lng.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
