import type { ApiErrorBody } from '@app/shared';
import { isAuthTokens, TokenStore } from './auth';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

/** Staff sessions (email or PIN) and platform-admin sessions are kept separately. */
export const staffTokens = new TokenStore('qr.staff.refresh', () => apiUrl('/v1/auth/refresh'));
export const adminTokens = new TokenStore('qr.admin.refresh', () =>
  apiUrl('/v1/platform/auth/refresh'),
);

/** Long-lived credential of a PIN-login device, sent as X-Device-Token to /v1/auth/*. */
const DEVICE_KEY = 'qr.device';
export const deviceToken = {
  get(): string | null {
    try {
      return localStorage.getItem(DEVICE_KEY);
    } catch {
      return null;
    }
  },
  set(value: string | null): void {
    try {
      if (value) localStorage.setItem(DEVICE_KEY, value);
      else localStorage.removeItem(DEVICE_KEY);
    } catch {
      // Storage unavailable: PIN login can't be enabled on this browser.
    }
  },
};

function storeFor(path: string): TokenStore {
  return path.startsWith('/v1/platform/') ? adminTokens : staffTokens;
}

function newKey(): string {
  return crypto.randomUUID();
}

const offline = () =>
  new ApiError(0, 'NETWORK', 'No connection. Check your internet and try again.');

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Reuse a key when retrying the same action; one is generated otherwise. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Sends a request with the session's bearer token. When the API rejects the access token (it
 * expired or was revoked) the token is refreshed once and the request retried; a 401 is only
 * rejected by guards, before anything runs, so the retry is safe.
 */
async function send(path: string, opts: RequestOptions): Promise<Response> {
  const store = storeFor(path);
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['Idempotency-Key'] = opts.idempotencyKey ?? newKey();
  const device = path.startsWith('/v1/auth/') ? deviceToken.get() : null;
  if (device) headers['X-Device-Token'] = device;
  const attempt = async (token: string | null) => {
    try {
      return await fetch(apiUrl(path), {
        method,
        headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: opts.signal,
      });
    } catch {
      throw offline();
    }
  };
  const token = await store.accessToken().catch(() => {
    throw offline();
  });
  const res = await attempt(token);
  if (res.status !== 401 || !token) return res;
  const fresh = await store.accessToken(true).catch(() => {
    throw offline();
  });
  return fresh ? attempt(fresh) : res;
}

async function toError(res: Response): Promise<ApiError> {
  const text = await res.text();
  const err = (text ? (JSON.parse(text) as ApiErrorBody) : undefined)?.error;
  return new ApiError(
    res.status,
    err?.code ?? 'HTTP_ERROR',
    err?.message ?? `Request failed (${res.status})`,
    err?.details,
  );
}

/** fetch wrapper: bearer auth, JSON in/out, Idempotency-Key on every mutation. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await send(path, opts);
  if (!res.ok) {
    const err = await toError(res);
    if (err.code === 'DEVICE_NOT_REGISTERED') deviceToken.set(null);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  // Sign-in responses carry the new session's tokens; device enrolment carries the device token.
  if (isAuthTokens(data)) storeFor(path).save(data);
  const enrolled = (data as { deviceToken?: unknown } | undefined)?.deviceToken;
  if (typeof enrolled === 'string') deviceToken.set(enrolled);
  return data as T;
}

/** Downloads an authenticated file (e.g. the QR sheet PDF) and saves it. */
export async function download(path: string, filename: string): Promise<void> {
  const res = await send(path, {});
  if (!res.ok) throw await toError(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = (err.details as { issues?: { path: string; message: string }[] } | undefined)
      ?.issues;
    if (issues?.length)
      return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n');
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

/** Uploads an image via a pre-signed URL and returns the upload key to confirm. */
export async function uploadImage(uploadUrlPath: string, file: File): Promise<string> {
  const target = await post<{
    uploadUrl: string;
    headers: Record<string, string>;
    uploadKey: string;
  }>(uploadUrlPath, {
    contentType: file.type,
    sizeBytes: file.size,
  });
  const res = await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: target.headers,
    body: file,
  });
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED', 'Upload failed. Please try again.');
  return target.uploadKey;
}
