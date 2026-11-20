import type { ReactNode } from 'react';

interface GlowCardProps {
  children: ReactNode;
  className?: string;
}

export function GlowCard({ children, className = '' }: GlowCardProps) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-green-500/30 blur-3xl"
      />

      <div
        className={`relative rounded-2xl border border-green-500/20 bg-neutral-950/90 ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
