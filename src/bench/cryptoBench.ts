import { Wallet } from 'ethers';
import { randomBytes } from '@/crypto/bytes';
import { computeCid } from '@/crypto/cid';
import { seal, unseal } from '@/crypto/ecies';
import {
  type FileMeta,
  decryptContainer,
  decryptMeta,
  encryptContainer,
  encryptMeta,
  generateFileId,
  generateFileKey,
  unwrapFileKey,
  wrapFileKey,
} from '@/crypto/fileCrypto';
import { deriveIdentityKey, signDerivationMessage } from '@/crypto/identity';
import { generateMasterKeyBytes, importMasterKey, masterKeyAad } from '@/crypto/masterKey';

export const DEFAULT_SIZES = [10 * 1024, 100 * 1024, 1024 * 1024, 10 * 1024 * 1024, 50 * 1024 * 1024];

export interface BenchOptions {
  sizes: number[];
  repeats: number;
  warmup: number;
  minBatchMs: number;
  only?: string[];
}

export interface BenchResult {
  op: string;
  group: 'file' | 'key' | 'flow';
  sizeBytes: number | null;
  batch: number;
  samplesMs: number[];
  error?: string;
}

export type BenchProgress = (message: string) => void;

interface Case {
  op: string;
  group: BenchResult['group'];
  sizeBytes: number | null;
  setup: () => Promise<() => Promise<unknown>>;
}

const ADDRESS_WALLET = Wallet.createRandom();
const META: FileMeta = { name: 'quarterly-report-2026.pdf', type: 'application/pdf' };

const randomBlob = (size: number): Blob => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 65_536) crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65_536, size)));
  return new Blob([bytes]);
};

const freshMasterKey = () => importMasterKey(generateMasterKeyBytes());

const identity = async () => {
  const address = ADDRESS_WALLET.address;
  const signature = await signDerivationMessage(ADDRESS_WALLET, address, 1);
  return { address, key: await deriveIdentityKey(signature, address, 1), signature };
};

function fileCases(size: number): Case[] {
  const file = (op: string, setup: Case['setup']): Case => ({ op, group: 'file', sizeBytes: size, setup });
  return [
    file('encryptContainer', async () => {
      const plain = randomBlob(size);
      return () => encryptContainer(plain, generateFileKey(), generateFileId());
    }),
    file('decryptContainer', async () => {
      const fileKey = generateFileKey();
      const fileId = generateFileId();
      const container = await encryptContainer(randomBlob(size), fileKey, fileId);
      return () => decryptContainer(container.stream(), fileKey, fileId, container.size, '');
    }),
    file('computeCid', async () => {
      const container = await encryptContainer(randomBlob(size), generateFileKey(), generateFileId());
      return () => computeCid(container);
    }),
    file('uploadCrypto', async () => {
      const plain = randomBlob(size);
      const masterKey = await freshMasterKey();
      return async () => {
        const fileId = generateFileId();
        const fileKey = generateFileKey();
        const container = await encryptContainer(plain, fileKey, fileId);
        await wrapFileKey(masterKey, fileKey, ADDRESS_WALLET.address, fileId, 1);
        await encryptMeta(fileKey, fileId, META);
        return computeCid(container);
      };
    }),
    file('downloadCrypto', async () => {
      const masterKey = await freshMasterKey();
      const fileId = generateFileId();
      const fileKey = generateFileKey();
      const container = await encryptContainer(randomBlob(size), fileKey, fileId);
      const wrapped = await wrapFileKey(masterKey, fileKey, ADDRESS_WALLET.address, fileId, 1);
      const meta = await encryptMeta(fileKey, fileId, META);
      return async () => {
        const key = await unwrapFileKey(masterKey, wrapped, ADDRESS_WALLET.address, fileId, 1);
        await decryptMeta(key, fileId, meta);
        return decryptContainer(container.stream(), key, fileId, container.size, META.type);
      };
    }),
  ];
}

function keyCases(): Case[] {
  const key = (op: string, setup: Case['setup']): Case => ({ op, group: 'key', sizeBytes: null, setup });
  return [
    key('wrapFileKey', async () => {
      const masterKey = await freshMasterKey();
      return () => wrapFileKey(masterKey, generateFileKey(), ADDRESS_WALLET.address, generateFileId(), 1);
    }),
    key('unwrapFileKey', async () => {
      const masterKey = await freshMasterKey();
      const fileId = generateFileId();
      const wrapped = await wrapFileKey(masterKey, generateFileKey(), ADDRESS_WALLET.address, fileId, 1);
      return () => unwrapFileKey(masterKey, wrapped, ADDRESS_WALLET.address, fileId, 1);
    }),
    key('encryptMeta', async () => {
      const fileKey = generateFileKey();
      return () => encryptMeta(fileKey, generateFileId(), META);
    }),
    key('decryptMeta', async () => {
      const fileKey = generateFileKey();
      const fileId = generateFileId();
      const meta = await encryptMeta(fileKey, fileId, META);
      return () => decryptMeta(fileKey, fileId, meta);
    }),
    key('sealMasterKey', async () => {
      const { address, key: id } = await identity();
      const aad = masterKeyAad(address, 1, 1);
      return () => seal(id.x, id.yOdd, randomBytes(32), aad);
    }),
    key('unsealMasterKey', async () => {
      const { address, key: id } = await identity();
      const aad = masterKeyAad(address, 1, 1);
      const sealed = await seal(id.x, id.yOdd, randomBytes(32), aad);
      return () => unseal(id.privateKey, sealed, aad);
    }),
    key('signDerivationMessage', async () => () => signDerivationMessage(ADDRESS_WALLET, ADDRESS_WALLET.address, 1)),
    key('deriveIdentityKey', async () => {
      const { address, signature } = await identity();
      return () => deriveIdentityKey(signature.slice(), address, 1);
    }),
  ];
}

function flowCases(): Case[] {
  const flow = (op: string, setup: Case['setup']): Case => ({ op, group: 'flow', sizeBytes: null, setup });
  return [
    flow('registerCrypto', async () => async () => {
      const address = ADDRESS_WALLET.address;
      const signature = await signDerivationMessage(ADDRESS_WALLET, address, 1, { checkDeterminism: true });
      const id = await deriveIdentityKey(signature, address, 1);
      const masterKeyBytes = generateMasterKeyBytes();
      const aad = masterKeyAad(address, 1, 1);
      const sealed = await seal(id.x, id.yOdd, masterKeyBytes, aad);
      await unseal(id.privateKey, sealed, aad);
      return importMasterKey(masterKeyBytes);
    }),
    flow('unlockCrypto', async () => {
      const { address, key: id } = await identity();
      const aad = masterKeyAad(address, 1, 1);
      const sealed = await seal(id.x, id.yOdd, generateMasterKeyBytes(), aad);
      return async () => {
        const signature = await signDerivationMessage(ADDRESS_WALLET, address, 1);
        const derived = await deriveIdentityKey(signature, address, 1);
        return importMasterKey(await unseal(derived.privateKey, sealed, aad));
      };
    }),
  ];
}

export function benchCases(options: Pick<BenchOptions, 'sizes' | 'only'>): Case[] {
  const all = [...options.sizes.flatMap(fileCases), ...keyCases(), ...flowCases()];
  return options.only?.length ? all.filter((c) => options.only!.includes(c.op)) : all;
}

const timeBatch = async (run: () => Promise<unknown>, batch: number): Promise<number> => {
  const start = performance.now();
  for (let i = 0; i < batch; i += 1) await run();
  return performance.now() - start;
};

async function calibrate(run: () => Promise<unknown>, minBatchMs: number): Promise<number> {
  let batch = 1;
  while (batch < 4096 && (await timeBatch(run, batch)) < minBatchMs) batch *= 2;
  return batch;
}

export function timerResolutionMs(): number {
  let smallest = Infinity;
  for (let i = 0; i < 200; i += 1) {
    const a = performance.now();
    let b = performance.now();
    while (b === a) b = performance.now();
    smallest = Math.min(smallest, b - a);
  }
  return smallest;
}

const label = (c: Case) => (c.sizeBytes === null ? c.op : `${c.op} ${c.sizeBytes} B`);

export async function runCryptoBench(options: BenchOptions, progress: BenchProgress = () => {}): Promise<BenchResult[]> {
  const cases = benchCases(options);
  const results: BenchResult[] = [];
  for (const [index, c] of cases.entries()) {
    progress(`[${index + 1}/${cases.length}] ${label(c)}`);
    const base = { op: c.op, group: c.group, sizeBytes: c.sizeBytes };
    try {
      const run = await c.setup();
      for (let i = 0; i < options.warmup; i += 1) await run();
      const batch = await calibrate(run, options.minBatchMs);
      const samplesMs: number[] = [];
      for (let i = 0; i < options.repeats; i += 1) samplesMs.push((await timeBatch(run, batch)) / batch);
      results.push({ ...base, batch, samplesMs });
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      progress(`  failed: ${message}`);
      results.push({ ...base, batch: 0, samplesMs: [], error: message });
    }
  }
  return results;
}
