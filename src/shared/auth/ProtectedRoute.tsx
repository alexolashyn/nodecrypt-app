import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthState } from './useAuthState';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const authState = useAuthState();

  if (authState.status === 'loading') {
    return null;
  }

  if (authState.status === 'unauthenticated') {
    return <Navigate to="/" replace />;
  }

  return children;
}
