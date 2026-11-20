import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import commonEn from './locales/en/common.json';
import commonUk from './locales/uk/common.json';
import authEn from './locales/en/auth.json';
import authUk from './locales/uk/auth.json';
import dashboardEn from './locales/en/dashboard.json';
import dashboardUk from './locales/uk/dashboard.json';
import errorsEn from './locales/en/errors.json';
import errorsUk from './locales/uk/errors.json';
import keyringEn from './locales/en/keyring.json';
import keyringUk from './locales/uk/keyring.json';
import filesEn from './locales/en/files.json';
import filesUk from './locales/uk/files.json';
import premiumEn from './locales/en/premium.json';
import premiumUk from './locales/uk/premium.json';
import rotationEn from './locales/en/rotation.json';
import rotationUk from './locales/uk/rotation.json';

export const defaultNS = 'common';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: commonEn,
        auth: authEn,
        dashboard: dashboardEn,
        errors: errorsEn,
        keyring: keyringEn,
        files: filesEn,
        premium: premiumEn,
        rotation: rotationEn,
      },
      uk: {
        common: commonUk,
        auth: authUk,
        dashboard: dashboardUk,
        errors: errorsUk,
        keyring: keyringUk,
        files: filesUk,
        premium: premiumUk,
        rotation: rotationUk,
      },
    },
    defaultNS,
    fallbackLng: 'en',
    supportedLngs: ['en', 'uk'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
