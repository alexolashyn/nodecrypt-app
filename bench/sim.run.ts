import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { JsonRpcProvider, Wallet } from 'ethers';
import { it, vi } from 'vitest';
import { ApiClient } from '@/shared/api/client';
import { type SimUser, type SimWallet, type StepRecord, runUser } from '@/sim/userFlow';

const { context } = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return { context: new AsyncLocalStorage<{ wallet: SimWallet; api: ApiClient }>() };
});

const current = () => {
  const store = context.getStore();
  if (!store) throw new Error('No simulated user in this async context');
  return store;
};

vi.mock('@/web3/wallet', () => ({
  connectWallet: async () => current().wallet,
  connectAs: async (address: string) => {
    const { wallet } = current();
    if (wallet.address.toLowerCase() !== address.toLowerCase()) throw new Error('simulated wallet mismatch');
    return wallet;
  },
  getReadProvider: () => current().wallet.provider,
  ensureChain: async () => {},
}));

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>();
  const apiClient = new Proxy({} as InstanceType<typeof actual.ApiClient>, {
    get: (_target, prop) => {
      const api = current().api as unknown as Record<string | symbol, unknown>;
      const value = api[prop];
      return typeof value === 'function' ? value.bind(api) : value;
    },
  });
  return { ...actual, apiClient };
});

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
};

it('user simulation', async () => {
  const levels = env('SIM_USERS', '1').split(',').map(Number);
  const options = {
    files: Number(env('SIM_FILES', '3')),
    sizeBytes: Number(env('SIM_SIZE_BYTES', String(100 * 1024))),
    rotate: env('SIM_ROTATE', 'true') === 'true',
    cleanup: env('SIM_CLEANUP', 'false') === 'true',
    siweDomain: env('SIM_SIWE_DOMAIN', 'localhost'),
    siweUri: env('SIM_SIWE_URI', 'http://localhost:5173'),
  };
  const rpcUrl = env('SIM_RPC_URL');
  const apiUrl = env('VITE_API_URL');

  const stored = new Map<string, Uint8Array>();
  const gateway = createServer((req, res) => {
    const bytes = stored.get(req.url?.replace(/^\/ipfs\//, '') ?? '');
    if (!bytes) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length }).end(bytes);
  });
  await new Promise<void>((resolve) => gateway.listen(Number(env('SIM_GATEWAY_PORT')), '127.0.0.1', resolve));

  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true, cacheTimeout: -1 });
  provider.pollingInterval = 100;
  const chainId = Number((await provider.getNetwork()).chainId);

  const records: (StepRecord & { level: number; round: number })[] = [];
  const rounds: { level: number; users: number; succeeded: number; wallMs: number }[] = [];
  let userIndex = 0;

  for (const [round, level] of levels.entries()) {
    process.stderr.write(`round ${round + 1}/${levels.length}: ${level} users\n`);
    const users = await Promise.all(
      Array.from({ length: level }, async () => {
        const signer = Wallet.createRandom().connect(provider);
        await provider.send('hardhat_setBalance', [signer.address, '0x56BC75E2D63100000']);
        const wallet: SimWallet = { provider, signer, address: signer.address, chainId };
        const user: SimUser = { index: userIndex++, wallet, accessToken: null };
        const api = new ApiClient(apiUrl);
        api.setAuthHooks({ getAccessToken: () => user.accessToken, refresh: async () => null });
        return { user, api };
      }),
    );

    const start = performance.now();
    const outcomes = await Promise.all(
      users.map(({ user, api }) =>
        context.run({ wallet: user.wallet, api }, () =>
          runUser(
            user,
            {
              ...options,
              onUploaded: async (cid, container) => {
                stored.set(cid, new Uint8Array(await container.arrayBuffer()));
              },
            },
            (record) => records.push({ ...record, level, round }),
          ),
        ),
      ),
    );
    const wallMs = performance.now() - start;
    const succeeded = outcomes.filter(Boolean).length;
    rounds.push({ level, users: level, succeeded, wallMs });
    process.stderr.write(`  ${succeeded}/${level} users finished in ${(wallMs / 1000).toFixed(1)} s\n`);
  }

  gateway.close();
  writeFileSync(env('SIM_OUT'), JSON.stringify({ options, rounds, records }));
});
