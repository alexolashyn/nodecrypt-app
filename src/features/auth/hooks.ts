import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEthereum } from './siwe';

type SignInState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'error'; message: string };

export function useSignIn() {
  const [state, setState] = useState<SignInState>({ status: 'idle' });
  const navigate = useNavigate();

  const signIn = useCallback(async () => {
    setState({ status: 'pending' });
    try {
      await signInWithEthereum();
      navigate('/dashboard');
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Sign-in failed',
      });
    }
  }, [navigate]);

  return { state, signIn };
}
