import type { AuthTokensDto } from '@app/shared';

/** Refresh this long before the access token expires, so in-flight requests don't race it. */
const EARLY_REFRESH_MS = 30_000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode): the session lasts until the tab closes.
  }
}

/**
 * Holds one kind of session's tokens. The access token lives in memory only; the refresh token
 * is kept in localStorage so a reload stays signed in. Refreshes are serialised across tabs
 * (Web Locks) and each re-reads the stored token, because a refresh token works only once.
 */
export class TokenStore {
  private access: { token: string; expiresAt: number } | null = null;
  private inflight: Promise<string | null> | null = null;

  constructor(
    private readonly storageKey: string,
    private readonly refreshUrl: () => string,
  ) {}

  save(tokens: AuthTokensDto): void {
    this.access = { token: tokens.accessToken, expiresAt: Date.now() + tokens.expiresIn * 1000 };
    write(this.storageKey, tokens.refreshToken);
  }

  clear(): void {
    this.access = null;
    write(this.storageKey, null);
  }

  /** A usable access token (refreshing when missing or about to expire), or null if signed out. */
  accessToken(forceRefresh = false): Promise<string | null> {
    const a = this.access;
    if (!forceRefresh && a && a.expiresAt - Date.now() > EARLY_REFRESH_MS) {
      return Promise.resolve(a.token);
    }
    if (!read(this.storageKey)) return Promise.resolve(null);
    this.inflight ??= this.refreshExclusive().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refreshExclusive(): Promise<string | null> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks) return this.refresh();
    return await locks.request(`refresh:${this.storageKey}`, () => this.refresh());
  }

  private async refresh(): Promise<string | null> {
    // Read inside the lock: another tab may have just rotated it.
    const refreshToken = read(this.storageKey);
    if (!refreshToken) return null;
    const res = await fetch(this.refreshUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (res.status === 401 || res.status === 400) {
      // Expired, revoked or reused: this session is over.
      if (read(this.storageKey) === refreshToken) this.clear();
      return null;
    }
    if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
    const tokens = (await res.json()) as AuthTokensDto;
    this.save(tokens);
    return tokens.accessToken;
  }
}

export function isAuthTokens(data: unknown): data is AuthTokensDto {
  const d = data as Partial<AuthTokensDto> | null | undefined;
  return (
    typeof d?.accessToken === 'string' &&
    typeof d.refreshToken === 'string' &&
    typeof d.expiresIn === 'number'
  );
}
