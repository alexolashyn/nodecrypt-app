import { apiClient } from '@/shared/api/client';
import type { Nonce, Tokens } from './types';

export function fetchNonce() {
  return apiClient.get<Nonce>('/auth/nonce');
}

export function verifySignIn(message: string, signature: string) {
  return apiClient.post<Tokens>('/auth/verify', { message, signature });
}

export function refreshAccessToken() {
  return apiClient.post<Tokens>('/auth/refresh', undefined, {
    skipAuthRetry: true,
  });
}

export function logout() {
  return apiClient.post<{ loggedOut: boolean }>('/auth/logout', undefined, {
    skipAuthRetry: true,
  });
}
