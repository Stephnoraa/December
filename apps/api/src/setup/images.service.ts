import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ErrorCode, type ImageUploadRequest, type UploadUrlDto } from '@app/shared';
import { AppError } from '../common/errors';
import { StorageService } from '../storage/storage.service';

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Photo pipeline: the browser uploads the original straight to storage (pre-signed PUT),
 * then the API downloads it, auto-rotates, resizes and re-encodes it as a small WebP under
 * public/, and deletes the original. Small images matter on Nigerian mobile data.
 */
@Injectable()
export class ImagesService {
  constructor(private readonly storage: StorageService) {}

  async uploadUrl(venueId: string, req: ImageUploadRequest): Promise<UploadUrlDto> {
    const uploadKey = `uploads/${venueId}/${randomUUID()}`;
    const { url, headers } = await this.storage.presignUpload(uploadKey, req.contentType);
    return { uploadUrl: url, headers, uploadKey };
  }

  /** Processes an uploaded original into public/<folder>/<venueId>/<uuid>.webp and returns the key. */
  async process(
    venueId: string,
    uploadKey: string,
    folder: 'menu' | 'logos',
    width: number,
  ): Promise<string> {
    if (!uploadKey.startsWith(`uploads/${venueId}/`) || uploadKey.includes('..')) {
      throw AppError.forbidden('Upload does not belong to this venue');
    }
    let original: Buffer;
    try {
      original = await this.storage.get(uploadKey);
    } catch {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        'Upload not found. Please upload the image again.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (original.length > MAX_BYTES) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Image must be 8 MB or smaller');
    }
    let output: Buffer;
    try {
      output = await sharp(original, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72, effort: 4 })
        .toBuffer();
    } catch {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That file is not a supported image (use JPEG, PNG or WebP)',
      );
    }
    const key = `public/${folder}/${venueId}/${randomUUID()}.webp`;
    await this.storage.put(key, output, 'image/webp');
    await this.storage.delete(uploadKey).catch(() => undefined);
    return key;
  }

  async remove(key: string | null | undefined): Promise<void> {
    if (key) await this.storage.delete(key).catch(() => undefined);
  }
}
