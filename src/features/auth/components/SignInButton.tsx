import { useTranslation } from 'react-i18next';
import { useSignIn } from '../hooks';

export function SignInButton() {
  const { t } = useTranslation('auth');
  const { state, signIn } = useSignIn();

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={signIn}
        disabled={state.status === 'pending'}
        className="w-full rounded-lg bg-green-500 px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.status === 'pending' ? t('button.pending') : t('button.idle')}
      </button>

      {state.status === 'error' && (
        <p className="text-sm text-red-400">{state.message}</p>
      )}
    </div>
  );
}
