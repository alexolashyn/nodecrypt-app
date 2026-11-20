import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { LanguageSwitcher } from '@/shared/components/LanguageSwitcher';
import { LogoutButton } from '@/features/auth/components/LogoutButton';
import { KeyringProvider } from '@/context/KeyringContext';
import { KeyringGate } from '@/components/KeyringGate';

const NAV = [
  { to: '/dashboard', key: 'files', end: true },
  { to: '/dashboard/plan', key: 'plan', end: false },
  { to: '/dashboard/security', key: 'security', end: false },
] as const;

function DashboardNav() {
  const { t } = useTranslation('dashboard');

  return (
    <nav className="flex gap-1 overflow-x-auto">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
              isActive
                ? 'bg-neutral-900 font-medium text-white'
                : 'text-neutral-400 hover:text-white'
            }`
          }
        >
          {t(`nav.${item.key}`)}
        </NavLink>
      ))}
    </nav>
  );
}

export function DashboardPage() {
  return (
    <KeyringProvider>
      <div className="flex min-h-screen flex-col bg-black">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-neutral-800 px-6 py-4">
          <div className="flex min-w-0 items-center gap-6">
            <span className="font-mono text-sm font-medium tracking-tight text-white">
              nodecrypt
            </span>
            <DashboardNav />
          </div>
          <div className="flex items-center gap-3">
            <LogoutButton />
            <LanguageSwitcher />
          </div>
        </header>

        <KeyringGate>
          <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
            <Outlet />
          </main>
        </KeyringGate>
      </div>
    </KeyringProvider>
  );
}
