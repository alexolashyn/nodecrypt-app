import { useSyncExternalStore } from 'react';
import { getAuthState, subscribeToAuthState } from './session';

export function useAuthState() {
  return useSyncExternalStore(subscribeToAuthState, getAuthState);
}
