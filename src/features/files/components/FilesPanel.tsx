import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type Keyring, useKeyring } from '@/context/keyring';
import type { AppError } from '@/shared/errors';
import { formatBytes, formatDate } from '@/shared/format';
import { toAppError, useErrorText } from '@/shared/useErrorText';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import {
  ArchiveIcon,
  AudioIcon,
  CheckIcon,
  DownloadIcon,
  FileIcon,
  ImageIcon,
  TrashIcon,
  UploadIcon,
  VideoIcon,
} from '@/shared/components/icons';
import { decodeFileRegistryError, getActiveFileCount } from '@/web3/fileRegistry';
import { getReadProvider } from '@/web3/wallet';
import { UploadError } from '../api';
import {
  type FileEntry,
  type RegisteredUpload,
  type UploadProgress,
  type UploadStage,
  deleteFile,
  loadFilesPage,
  openFile,
  pushUpload,
  registerUpload,
  saveBlob,
} from '../service';

const PAGE_SIZE = 20;

interface UploadState {
  name: string;
  size: number;
  progress: UploadProgress | null;
  error: AppError | null;
  registered: RegisteredUpload | null;
  file: File;
}

const STEPS = ['encrypt', 'cid', 'chain', 'upload'] as const;
type Step = (typeof STEPS)[number];

const STEP_OF: Record<UploadStage, Step> = {
  checking: 'encrypt',
  encrypting: 'encrypt',
  hashing: 'cid',
  registering: 'chain',
  uploading: 'upload',
  retrying: 'upload',
};

const ghostBtn =
  'rounded-lg border border-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50';

const iconBtn =
  'flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40';

function TypeIcon({ entry }: { entry: FileEntry }) {
  const type = entry.meta?.type ?? '';
  const name = entry.meta?.name.toLowerCase() ?? '';
  let icon: ReactNode = <FileIcon />;
  if (type.startsWith('image/')) icon = <ImageIcon />;
  else if (type.startsWith('video/')) icon = <VideoIcon />;
  else if (type.startsWith('audio/')) icon = <AudioIcon />;
  else if (/\.(zip|rar|7z|tar|gz)$/.test(name)) icon = <ArchiveIcon />;

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-black/40 text-neutral-400">
      {icon}
    </div>
  );
}

function UploadSteps({ progress }: { progress: UploadProgress | null }) {
  const { t } = useTranslation('files');
  const current = progress ? STEPS.indexOf(STEP_OF[progress.stage]) : -1;

  return (
    <ol className="mt-3 grid grid-cols-4 gap-2">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step}>
            <div
              className={`h-1 rounded-full ${
                done ? 'bg-green-500' : active ? 'bg-green-500/50' : 'bg-neutral-800'
              }`}
            />
            <p
              className={`mt-1.5 truncate text-[11px] ${
                active ? 'text-white' : done ? 'text-neutral-400' : 'text-neutral-600'
              }`}
            >
              {t(`steps.${step}`)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function FilesPanel({ keyring }: { keyring: Keyring }) {
  const { t, i18n } = useTranslation('files');
  const errorText = useErrorText();
  const { address, clear } = useKeyring();

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<AppError | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; error: AppError } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);
  const cancelDelete = useCallback(() => setPendingDelete(null), []);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (error: unknown): AppError => {
      const appError = toAppError(error, decodeFileRegistryError);
      if (appError.key === 'errors:files.keyringStale') clear();
      return appError;
    },
    [clear],
  );

  const load = useCallback(
    async (offset: number) => {
      if (!address) return;
      setLoading(true);
      setListError(null);
      try {
        const provider = getReadProvider();
        const [page, active] = await Promise.all([
          loadFilesPage(provider, keyring, address, offset, PAGE_SIZE),
          getActiveFileCount(provider, address),
        ]);
        setEntries((prev) => (offset === 0 ? page.entries : [...prev, ...page.entries]));
        setNextOffset(page.nextOffset);
        setTotal(page.total);
        setActiveCount(active);
      } catch (error) {
        setListError(handle(error));
      } finally {
        setLoading(false);
      }
    },
    [address, keyring, handle],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const runUpload = async (state: UploadState) => {
    if (!address) return;
    const report = (progress: UploadProgress) =>
      setUpload((prev) => (prev ? { ...prev, progress } : prev));

    setUpload({ ...state, error: null });
    let registered = state.registered;
    try {
      if (!registered) {
        registered = await registerUpload(state.file, keyring, address, report);
        setUpload((prev) => (prev ? { ...prev, registered } : prev));
        void load(0);
      }
      await pushUpload(registered, report);
      setUpload(null);
      setNotice(t('uploaded', { name: state.name }));
      void load(0);
    } catch (error) {
      setUpload((prev) =>
        prev ? { ...prev, registered, progress: null, error: handle(error) } : prev,
      );
    }
  };

  const uploading = upload !== null && upload.error === null;

  const start = (file: File | undefined) => {
    if (!file || uploading) return;
    setNotice(null);
    void runUpload({
      name: file.name,
      size: file.size,
      file,
      progress: null,
      error: null,
      registered: null,
    });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    start(event.dataTransfer.files[0]);
  };

  const open = async (entry: FileEntry) => {
    if (!address) return;
    setBusyId(entry.fileId);
    setRowError(null);
    try {
      const { blob, meta } = await openFile(getReadProvider(), keyring, address, entry.fileId);
      saveBlob(blob, meta.name);
    } catch (error) {
      setRowError({ id: entry.fileId, error: handle(error) });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (entry: FileEntry) => {
    if (!address) return;
    setPendingDelete(null);
    setBusyId(entry.fileId);
    setRowError(null);
    try {
      const { released } = await deleteFile(address, entry.fileId);
      setNotice(released ? t('deleted') : t('deletedNotReleased'));
      void load(0);
    } catch (error) {
      setRowError({ id: entry.fileId, error: handle(error) });
    } finally {
      setBusyId(null);
    }
  };

  const canRetry =
    upload?.error && (!(upload.error instanceof UploadError) || upload.error.retryable);
  const fraction = upload?.progress?.fraction;

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        if (!uploading) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      className={`relative rounded-2xl border bg-neutral-950 p-6 transition-colors ${
        dragging ? 'border-green-500/60' : 'border-neutral-800'
      }`}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/80 text-green-400">
          <UploadIcon className="h-8 w-8" />
          <p className="text-sm font-medium">{t('dropHere')}</p>
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
            {t('title')}
            {activeCount !== null && (
              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-300">
                {activeCount}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">{t('subtitle')}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            start(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <UploadIcon className="h-4 w-4" />
          {t('upload')}
        </button>
      </header>

      {upload && (
        <div
          className={`mt-5 rounded-xl border p-4 ${
            upload.error ? 'border-red-500/30 bg-red-500/5' : 'border-neutral-800 bg-black/40'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{upload.name}</p>
              <p className="text-xs text-neutral-500">{formatBytes(upload.size)}</p>
            </div>
            {upload.progress && (
              <span className="shrink-0 text-xs text-neutral-400">
                {t(`stage.${upload.progress.stage}`, { attempt: upload.progress.attempt })}
                {fraction !== undefined && ` ${Math.round(fraction * 100)}%`}
              </span>
            )}
          </div>

          {!upload.error && <UploadSteps progress={upload.progress} />}

          {upload.error && (
            <>
              <p className="mt-3 text-sm text-red-400">{errorText(upload.error)}</p>
              {upload.registered && (
                <p className="mt-1 text-xs text-neutral-500">{t('registeredNotUploaded')}</p>
              )}
              <div className="mt-3 flex gap-2">
                {canRetry && (
                  <button onClick={() => void runUpload(upload)} className={ghostBtn}>
                    {t('retry')}
                  </button>
                )}
                <button onClick={() => setUpload(null)} className={ghostBtn}>
                  {t('dismiss')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {notice && (
        <p className="mt-4 flex items-center gap-2 text-sm text-green-400">
          <CheckIcon className="h-4 w-4 shrink-0" />
          {notice}
        </p>
      )}
      {listError && <p className="mt-4 text-sm text-red-400">{errorText(listError)}</p>}

      {entries.length > 0 && (
        <ul className="mt-5 space-y-2">
          {entries.map((entry) => {
            const busy = busyId === entry.fileId;
            return (
              <li
                key={entry.fileId}
                className="rounded-xl border border-neutral-900 bg-black/30 px-3 py-3 transition-colors hover:border-neutral-800"
              >
                <div className="flex items-center gap-3">
                  <TypeIcon entry={entry} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-neutral-100">
                      {entry.meta?.name ?? (
                        <span className="text-neutral-500">{t('unreadableName')}</span>
                      )}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatBytes(entry.sizeBytes)} · {formatDate(entry.uploadedAt, i18n.language)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => void open(entry)}
                      disabled={busyId !== null}
                      className={iconBtn}
                      title={t('open')}
                      aria-label={t('open')}
                    >
                      {busy ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
                      ) : (
                        <DownloadIcon className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => setPendingDelete(entry)}
                      disabled={busyId !== null}
                      className={`${iconBtn} hover:border-red-900 hover:text-red-400`}
                      title={t('delete')}
                      aria-label={t('delete')}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {rowError?.id === entry.fileId && (
                  <p className="mt-2 pl-[52px] text-xs text-red-400">
                    {errorText(rowError.error)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loading && entries.length === 0 && !listError && (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="mt-5 flex w-full flex-col items-center gap-3 rounded-xl border border-dashed border-neutral-800 px-6 py-12 text-center transition-colors hover:border-neutral-700"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-green-500/30 bg-green-500/10 text-green-400">
            <UploadIcon />
          </div>
          <p className="text-sm font-medium text-white">{t('empty')}</p>
          <p className="text-xs text-neutral-500">{t('emptyHint')}</p>
        </button>
      )}

      {loading && entries.length === 0 && (
        <div className="mt-5 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-900/60" />
          ))}
        </div>
      )}

      {entries.length > 0 && nextOffset < total && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => void load(nextOffset)}
            disabled={loading}
            className={ghostBtn}
          >
            {loading ? t('loading') : t('loadMore')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('confirmDeleteTitle')}
        confirmLabel={t('delete')}
        tone="danger"
        onConfirm={() => pendingDelete && void remove(pendingDelete)}
        onCancel={cancelDelete}
      >
        {t('confirmDelete', { name: pendingDelete?.meta?.name ?? pendingDelete?.fileId })}
      </ConfirmDialog>
    </section>
  );
}
