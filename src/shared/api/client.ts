import type { RequestOptions, JsonBody, ApiResponse } from './types';

interface AuthHooks {
  getAccessToken: () => string | null;
  refresh: () => Promise<string | null>;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private authHooks: AuthHooks | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setAuthHooks(hooks: AuthHooks): void {
    this.authHooks = hooks;
  }

  private refreshAccessToken(): Promise<string | null> {
    if (!this.authHooks) return Promise.resolve(null);
    this.refreshPromise ??= this.authHooks.refresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { body, rawBody, headers, skipAuthRetry, ...rest } = options;
    const token = this.authHooks?.getAccessToken();

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(rawBody !== undefined
          ? { 'Content-Type': 'application/octet-stream' }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });

    let envelope: ApiResponse<T>;
    try {
      envelope = (await res.json()) as ApiResponse<T>;
    } catch {
      throw new ApiError(res.status, res.statusText || `HTTP ${res.status}`);
    }

    if (!envelope.success) {
      if (envelope.statusCode === 401 && !skipAuthRetry && this.authHooks) {
        const newToken = await this.refreshAccessToken();
        if (newToken) {
          return this.request<T>(path, { ...options, skipAuthRetry: true });
        }
      }
      throw new ApiError(
        envelope.statusCode,
        [envelope.message].flat().join(', '),
      );
    }

    return envelope.data;
  }

  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: JsonBody, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  postBinary<T>(path: string, data: Blob, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'POST', rawBody: data });
  }

  put<T>(path: string, body?: JsonBody, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient(import.meta.env.VITE_API_URL);
