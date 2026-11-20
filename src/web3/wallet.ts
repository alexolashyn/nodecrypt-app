import { BrowserProvider } from 'ethers';
import { CHAIN_ID } from '@/config';
import { AppError } from '@/shared/errors';

export async function connectWallet() {
  if (!window.ethereum) {
    throw new AppError('errors:wallet.notFound');
  }

  const provider = new BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);

  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const { chainId } = await provider.getNetwork();

  return { provider, signer, address, chainId: Number(chainId) };
}

export function getReadProvider(): BrowserProvider {
  if (!window.ethereum) {
    throw new AppError('errors:wallet.notFound');
  }

  return new BrowserProvider(window.ethereum);
}

export async function connectAs(address: string) {
  const wallet = await connectWallet();
  await ensureChain(wallet.provider);

  if (wallet.address.toLowerCase() !== address.toLowerCase()) {
    throw new AppError('errors:wallet.accountMismatch');
  }
  return wallet;
}

export async function ensureChain(provider: BrowserProvider): Promise<void> {
  const { chainId } = await provider.getNetwork();
  if (Number(chainId) === CHAIN_ID) return;

  try {
    await provider.send('wallet_switchEthereumChain', [
      { chainId: `0x${CHAIN_ID.toString(16)}` },
    ]);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;

    if (code === 4902) {
      throw new AppError('errors:wallet.chainNotAdded');
    }
    throw new AppError('errors:wallet.wrongChain');
  }
}
