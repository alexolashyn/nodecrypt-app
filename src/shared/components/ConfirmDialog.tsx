import { useEffect, useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertIcon } from './icons';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

const confirmTone = {
  danger: 'bg-red-500 text-white hover:bg-red-400',
  warning: 'bg-amber-400 text-black hover:bg-amber-300',
};

const iconTone = {
  danger: 'border-red-500/30 bg-red-500/10 text-red-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
};

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'warning',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${iconTone[tone]}`}
          >
            <AlertIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-white">
              {title}
            </h2>
            <div className="mt-1 break-words text-sm leading-relaxed text-neutral-400">
              {children}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-neutral-800 px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
          >
            {t('cancel')}
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${confirmTone[tone]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
