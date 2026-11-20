import type { ReactNode } from 'react';
import { GlowCard } from '@/shared/components/GlowCard';

interface KeyringCardProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function KeyringCard({
  icon,
  title,
  subtitle,
  children,
}: KeyringCardProps) {
  return (
    <div className="w-full max-w-sm">
      <GlowCard className="p-8 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-green-500/30 bg-green-500/10 text-green-400">
          {icon}
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-white">
          {title}
        </h1>
        <p className="mt-2 text-sm text-neutral-400">{subtitle}</p>

        {children}
      </GlowCard>
    </div>
  );
}

export function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <circle cx="8" cy="15" r="4" />
      <path d="M10.85 12.15 19 4" />
      <path d="m17.5 5.5 2 2" />
      <path d="m14.5 8.5 2 2" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
