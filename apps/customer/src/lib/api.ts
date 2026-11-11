import type { ApiErrorBody } from '@app/shared';

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

function newKey(): string {
  return crypto.randomUUID();
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Reuse a key when retrying the same action; one is generated otherwise. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** fetch wrapper: cookies included, JSON in/out, Idempotency-Key on every mutation. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['Idempotency-Key'] = opts.idempotencyKey ?? newKey();
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers,
      credentials: 'include',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection. Check your internet and try again.');
  }
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
    credentials: 'omit',
  });
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED', 'Upload failed. Please try again.');
  return target.uploadKey;
}
