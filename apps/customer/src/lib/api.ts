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

/** The anonymous table session's tokens (issued when the guest joins a table). */
export const customerTokens = new TokenStore('qr.customer.refresh', () =>
  apiUrl('/v1/public/session/refresh'),
);

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
 * Sends a request with the guest's bearer token. When the API rejects the access token it is
 * refreshed once and the request retried (a 401 comes from guards, before anything runs).
 */
async function send(path: string, opts: RequestOptions): Promise<Response> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['Idempotency-Key'] = opts.idempotencyKey ?? newKey();
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
  const token = await customerTokens.accessToken().catch(() => {
    throw offline();
  });
  const res = await attempt(token);
  if (res.status !== 401 || !token) return res;
  const fresh = await customerTokens.accessToken(true).catch(() => {
    throw offline();
  });
  return fresh ? attempt(fresh) : res;
}

/** fetch wrapper: bearer auth, JSON in/out, Idempotency-Key on every mutation. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await send(path, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  // Joining a table returns the session's tokens.
  if (isAuthTokens(data)) customerTokens.save(data);
  return data as T;
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
