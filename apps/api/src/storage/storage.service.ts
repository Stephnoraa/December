import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ENV, type Env } from '../config/env';

/**
 * Object storage for menu photos and logos.
 * - s3: any S3-compatible store (Cloudflare R2 in production, MinIO locally). Browsers upload
 *   originals straight to the bucket with a pre-signed PUT URL; the API then resizes them.
 * - local: files on disk under LOCAL_STORAGE_DIR, uploads go to a signed API route. Dev only.
 * Keys under public/ are served publicly; uploads/ holds unprocessed originals.
 * Docs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
 */
@Injectable()
export class StorageService {
  private readonly s3: S3Client | null;
  private readonly localDir: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.localDir = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
    this.s3 =
      env.STORAGE_DRIVER === 's3'
        ? new S3Client({
            region: env.S3_REGION,
            endpoint: env.S3_ENDPOINT,
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
            credentials: {
              accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
              secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
            },
          })
        : null;
  }

  get driver(): 's3' | 'local' {
    return this.env.STORAGE_DRIVER;
  }

  publicUrl(key: string | null | undefined): string | null {
    if (!key) return null;
    if (this.env.STORAGE_DRIVER === 'local') return `${this.env.API_PUBLIC_URL}/assets/${key}`;
    return `${(this.env.PUBLIC_ASSET_BASE_URL ?? '').replace(/\/$/, '')}/${key}`;
  }

  async presignUpload(
    key: string,
    contentType: string,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    if (this.s3) {
      const url = await getSignedUrl(
        this.s3,
        new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, ContentType: contentType }),
        { expiresIn: 600 },
      );
      return { url, headers: { 'Content-Type': contentType } };
    }
    const expires = Date.now() + 600_000;
    const sig = this.sign(`${key}:${expires}`);
    const token = Buffer.from(JSON.stringify({ key, expires, sig })).toString('base64url');
    return {
      url: `${this.env.API_PUBLIC_URL}/v1/dev-storage/${token}`,
      headers: { 'Content-Type': contentType },
    };
  }

  /** Validates a local upload token (dev-storage route). */
  verifyLocalUploadToken(token: string): string | null {
    try {
      const { key, expires, sig } = JSON.parse(Buffer.from(token, 'base64url').toString()) as {
        key: string;
        expires: number;
        sig: string;
      };
      const expected = Buffer.from(this.sign(`${key}:${expires}`));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      if (Date.now() > expires) return null;
      return key;
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<Buffer> {
    if (this.s3) {
      const out = await this.s3.send(
        new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
      );
      const bytes = await out.Body?.transformToByteArray();
      if (!bytes) throw new Error(`Empty object ${key}`);
      return Buffer.from(bytes);
    }
    return readFile(this.localPath(key));
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.env.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return;
    }
    const file = this.localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async delete(key: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      return;
    }
    await rm(this.localPath(key), { force: true });
  }

  localRoot(): string {
    return this.localDir;
  }

  private localPath(key: string): string {
    const file = path.resolve(this.localDir, key);
    if (!file.startsWith(this.localDir + path.sep)) throw new Error('Invalid storage key');
    return file;
  }

  private sign(value: string): string {
    return createHmac('sha256', this.env.SESSION_SECRET)
      .update(`storage:${value}`)
      .digest('base64url');
  }
}
