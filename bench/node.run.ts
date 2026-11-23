import { writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { it } from 'vitest';
import { type BenchOptions, DEFAULT_SIZES, runCryptoBench, timerResolutionMs } from '@/bench/cryptoBench';

const list = (value: string | undefined) => value?.split(',').filter(Boolean);

it('crypto benchmark', async () => {
  const options: BenchOptions = {
    sizes: list(process.env.BENCH_SIZES)?.map(Number) ?? DEFAULT_SIZES,
    repeats: Number(process.env.BENCH_REPEATS ?? 30),
    warmup: Number(process.env.BENCH_WARMUP ?? 3),
    minBatchMs: Number(process.env.BENCH_MIN_BATCH_MS ?? 20),
    only: list(process.env.BENCH_ONLY),
  };
  const environment = {
    runtime: 'node',
    nodeVersion: process.version,
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    timerResolutionMs: timerResolutionMs(),
    options,
  };
  const results = await runCryptoBench(options, (message) => process.stderr.write(`${message}\n`));
  const out = process.env.BENCH_OUT;
  const json = JSON.stringify({ environment, results });
  if (out) writeFileSync(out, json);
  else process.stdout.write(`${json}\n`);
});
