import { apiClient } from '@/shared/api/client';
import { getAccessToken, setSession, clearSession } from '@/shared/auth/session';
import { refreshAccessToken } from './api';

apiClient.setAuthHooks({
  getAccessToken,
  refresh: async () => {
    try {
      const tokens = await refreshAccessToken();
      setSession(tokens);
      return tokens.accessToken;
    } catch {
      clearSession();
      return null;
    }
  },
});

void (async () => {
  try {
    const tokens = await refreshAccessToken();
    setSession(tokens);
  } catch {
    clearSession();
  }
})();
