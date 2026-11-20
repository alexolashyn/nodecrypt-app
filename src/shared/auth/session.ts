export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; accessToken: string; address: string }
  | { status: 'unauthenticated' };

type Listener = () => void;

let state: AuthState = { status: 'loading' };
const listeners = new Set<Listener>();

function setState(next: AuthState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getAuthState(): AuthState {
  return state;
}

export function getAccessToken(): string | null {
  return state.status === 'authenticated' ? state.accessToken : null;
}

export function setSession(session: { accessToken: string; address: string }): void {
  setState({ status: 'authenticated', ...session });
}

export function clearSession(): void {
  setState({ status: 'unauthenticated' });
}

export function subscribeToAuthState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
