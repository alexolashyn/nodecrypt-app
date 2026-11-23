import { type BenchOptions, type BenchResult, DEFAULT_SIZES, runCryptoBench, timerResolutionMs } from './cryptoBench';

interface BenchState {
  status: 'running' | 'done' | 'failed';
  progress: string;
  environment?: Record<string, unknown>;
  results?: BenchResult[];
  error?: string;
}

declare global {
  interface Window {
    __bench: BenchState;
  }
}

const params = new URLSearchParams(location.search);
const numbers = (name: string) => params.get(name)?.split(',').map(Number).filter((n) => n > 0);
const options: BenchOptions = {
  sizes: numbers('sizes') ?? DEFAULT_SIZES,
  repeats: Number(params.get('repeats') ?? 30),
  warmup: Number(params.get('warmup') ?? 3),
  minBatchMs: Number(params.get('minBatchMs') ?? 20),
  only: params.get('only')?.split(',').filter(Boolean),
};

const output = document.getElementById('progress')!;
window.__bench = { status: 'running', progress: 'starting' };

const report = (message: string) => {
  window.__bench.progress = message;
  output.textContent = message;
};

const environment = {
  runtime: 'browser',
  userAgent: navigator.userAgent,
  hardwareConcurrency: navigator.hardwareConcurrency,
  crossOriginIsolated: globalThis.crossOriginIsolated,
  timerResolutionMs: timerResolutionMs(),
  options,
};

runCryptoBench(options, report)
  .then((results) => {
    window.__bench = { status: 'done', progress: 'done', environment, results };
    output.textContent = `done: ${results.length} cases`;
  })
  .catch((error: unknown) => {
    window.__bench = { status: 'failed', progress: 'failed', environment, error: String(error) };
    output.textContent = `failed: ${String(error)}`;
  });
