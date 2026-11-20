import { SiweMessage } from 'siwe';
import { connectWallet } from '@/web3/wallet';
import { setSession } from '@/shared/auth/session';
import { fetchNonce, verifySignIn } from './api';

export async function signInWithEthereum() {
  const { signer, address, chainId } = await connectWallet();
  const { nonce } = await fetchNonce();

  const siweMessage = new SiweMessage({
    domain: import.meta.env.VITE_APP_DOMAIN,
    address,
    statement: 'Sign in to nodecrypt.',
    uri: window.location.origin,
    version: '1',
    chainId,
    nonce,
  });

  const message = siweMessage.prepareMessage();
  const signature = await signer.signMessage(message);

  const tokens = await verifySignIn(message, signature);
  setSession(tokens);
}
