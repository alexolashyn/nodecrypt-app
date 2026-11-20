export class AppError extends Error {
  readonly key: string;
  readonly detail?: string;
  readonly params?: Record<string, unknown>;

  constructor(key: string, detail?: string, params?: Record<string, unknown>) {
    super(detail ?? key);
    this.name = 'AppError';
    this.key = key;
    this.detail = detail;
    this.params = params;
  }
}

export const isAppError = (error: unknown): error is AppError => {
  return error instanceof AppError;
};
