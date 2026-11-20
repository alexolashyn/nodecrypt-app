import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AppError } from './errors';

export const toAppError = (
  error: unknown,
  decode?: (error: unknown) => AppError,
): AppError => {
  const appError =
    error instanceof AppError
      ? error
      : decode
        ? decode(error)
        : new AppError('errors:contract.unknown', String(error));
  console.error(appError.detail ?? appError.key, error);
  return appError;
};

export const useErrorText = () => {
  const { t } = useTranslation();
  return useCallback(
    (error: AppError) => t(error.key, (error.params ?? {}) as Record<string, string>),
    [t],
  );
};
