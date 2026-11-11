import { Controller, Inject, Put, Req, NotFoundException, HttpCode } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { ENV, type Env } from '../config/env';
import { AppError } from '../common/errors';
import { StorageService } from '../storage/storage.service';

/** Upload target for STORAGE_DRIVER=local (stands in for an S3 pre-signed PUT). Dev only. */
@Controller('v1/dev-storage')
@SkipThrottle()
export class DevStorageController {
  constructor(
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Put(':token')
  @HttpCode(200)
  async upload(@Req() req: Request & { rawBody?: Buffer }) {
    if (this.storage.driver !== 'local' || !this.env.devRoutesEnabled)
      throw new NotFoundException();
    const key = this.storage.verifyLocalUploadToken(String(req.params.token));
    if (!key) throw AppError.forbidden('Upload link expired');
    const body = await readBody(req, 8 * 1024 * 1024);
    await this.storage.put(
      key,
      body,
      String(req.headers['content-type'] ?? 'application/octet-stream'),
    );
    return { ok: true };
  }
}

function readBody(req: Request, limit: number): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(AppError.forbidden('Image must be 8 MB or smaller'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
