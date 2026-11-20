import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clearSession } from '@/shared/auth/session';
import { logout } from '../api';

export function LogoutButton() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await logout();
    } finally {
      clearSession();
      setPending(false);
      navigate('/');
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={pending}
      className="rounded-lg border border-neutral-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:border-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? t('logout.pending') : t('logout.idle')}
    </button>
  );
}
