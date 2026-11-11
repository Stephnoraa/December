import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../config/env';

export interface TableTokenPayload {
  venueId: string;
  tableId: string;
  version: number;
}

const MAC_BYTES = 16;

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('Invalid UUID');
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(buf: Buffer): string {
  const h = buf.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Signed table tokens for QR codes: base64url(venueId | tableId | version | HMAC-SHA256[0..16]).
 * Compact (70 chars) so printed QR codes stay easy to scan. Bumping a table's qrVersion
 * invalidates every code printed before.
 */
@Injectable()
export class QrTokenService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private mac(data: Buffer): Buffer {
    return createHmac('sha256', this.env.QR_TOKEN_SECRET)
      .update(data)
      .digest()
      .subarray(0, MAC_BYTES);
  }

  sign(payload: TableTokenPayload): string {
    const version = Buffer.alloc(4);
    version.writeUInt32BE(payload.version);
    const data = Buffer.concat([
      uuidToBytes(payload.venueId),
      uuidToBytes(payload.tableId),
      version,
    ]);
    return Buffer.concat([data, this.mac(data)]).toString('base64url');
  }

  verify(token: string): TableTokenPayload | null {
    if (!/^[A-Za-z0-9_-]{40,120}$/.test(token)) return null;
    const raw = Buffer.from(token, 'base64url');
    if (raw.length !== 36 + MAC_BYTES) return null;
    const data = raw.subarray(0, 36);
    const mac = raw.subarray(36);
    const expected = this.mac(data);
    if (!timingSafeEqual(mac, expected)) return null;
    return {
      venueId: bytesToUuid(data.subarray(0, 16)),
      tableId: bytesToUuid(data.subarray(16, 32)),
      version: data.readUInt32BE(32),
    };
  }

  tableUrl(venueSlug: string, payload: TableTokenPayload): string {
    return `${this.env.CUSTOMER_APP_URL.replace(/\/$/, '')}/t/${venueSlug}/${this.sign(payload)}`;
  }
}
