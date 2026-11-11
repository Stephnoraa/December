import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { DbClient } from '@app/db';
import { ErrorCode, type BulkTablesInput, type TableDto, type TableInput } from '@app/shared';
import { AuditService } from '../common/audit.service';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import type { StaffPrincipal } from '../common/request';
import { QrTokenService } from '../qr/qr-token.service';

type TableRow = {
  id: string;
  venueId: string;
  label: string;
  area: string | null;
  active: boolean;
  qrVersion: number;
};

@Injectable()
export class TablesService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly audit: AuditService,
    private readonly qr: QrTokenService,
  ) {}

  private async slug(venueId: string): Promise<string> {
    return (
      await this.db.venue.findUniqueOrThrow({ where: { id: venueId }, select: { slug: true } })
    ).slug;
  }

  private toDto(t: TableRow, slug: string): TableDto {
    return {
      id: t.id,
      label: t.label,
      area: t.area,
      active: t.active,
      qrVersion: t.qrVersion,
      qrUrl: this.qr.tableUrl(slug, { venueId: t.venueId, tableId: t.id, version: t.qrVersion }),
    };
  }

  async list(venueId: string): Promise<TableDto[]> {
    const [rows, slug] = await Promise.all([
      this.db.table.findMany({ orderBy: [{ area: 'asc' }, { label: 'asc' }] }),
      this.slug(venueId),
    ]);
    return sortTables(rows).map((t) => this.toDto(t, slug));
  }

  async create(venueId: string, input: TableInput): Promise<TableDto> {
    const t = await this.db.table.create({
      data: { venueId, label: input.label, area: input.area ?? null, active: input.active ?? true },
    });
    return this.toDto(t, await this.slug(venueId));
  }

  async bulkCreate(venueId: string, input: BulkTablesInput): Promise<TableDto[]> {
    if (input.to < input.from || input.to - input.from > 199) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Choose a range of up to 200 tables');
    }
    const existing = new Set(
      (await this.db.table.findMany({ select: { label: true } })).map((t) => t.label),
    );
    const labels: string[] = [];
    for (let n = input.from; n <= input.to; n++) {
      const label = `${input.prefix}${n}`;
      if (!existing.has(label)) labels.push(label);
    }
    await this.db.table.createMany({
      data: labels.map((label) => ({ venueId, label, area: input.area ?? null })),
    });
    return this.list(venueId);
  }

  async update(venueId: string, id: string, input: Partial<TableInput>): Promise<TableDto> {
    if (input.active === false) {
      const live = await this.db.tableSession.count({
        where: { tableId: id, status: { not: 'CLOSED' } },
      });
      if (live > 0)
        throw AppError.conflict(ErrorCode.CONFLICT, 'Close the table before deactivating it');
    }
    const t = await this.db.table.update({ where: { id }, data: input });
    return this.toDto(t, await this.slug(venueId));
  }

  /** Invalidates printed QR codes for the given tables (all tables when ids is empty). */
  async rotate(
    staff: StaffPrincipal,
    ids: string[] | null,
    ip: string | null,
  ): Promise<TableDto[]> {
    await this.db.$transaction(async (tx) => {
      const tables = await tx.table.findMany({ where: ids ? { id: { in: ids } } : {} });
      if (ids && tables.length !== ids.length) throw AppError.notFound('Table');
      await tx.table.updateMany({
        where: { id: { in: tables.map((t) => t.id) } },
        data: { qrVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        venueId: staff.venueId,
        actor: staff,
        action: 'QR_ROTATED',
        entityType: 'Table',
        entityId: ids && ids.length === 1 ? ids[0] : null,
        after: { tables: tables.map((t) => t.label) },
        ip,
      });
    });
    return this.list(staff.venueId);
  }

  /** Printable A4 sheet: six QR cards per page with table label and instructions. */
  async qrPdf(venueId: string, ids?: string[]): Promise<Buffer> {
    const venue = await this.db.venue.findUniqueOrThrow({ where: { id: venueId } });
    const rows = sortTables(
      await this.db.table.findMany({
        where: { active: true, ...(ids?.length ? { id: { in: ids } } : {}) },
      }),
    );
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      info: { Title: `${venue.name} table QR codes` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    const cols = 2;
    const perPage = 6;
    const cardW = (doc.page.width - 72 - 18) / cols;
    const cardH = (doc.page.height - 72 - 36) / 3;
    if (rows.length === 0) {
      doc
        .fontSize(16)
        .text('No active tables yet. Add tables first, then download this sheet again.');
    }
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i]!;
      if (i > 0 && i % perPage === 0) doc.addPage();
      const slot = i % perPage;
      const x = 36 + (slot % cols) * (cardW + 18);
      const y = 36 + Math.floor(slot / cols) * (cardH + 18);
      const url = this.qr.tableUrl(venue.slug, { venueId, tableId: t.id, version: t.qrVersion });
      const png = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, width: 480 });
      doc.roundedRect(x, y, cardW, cardH, 10).lineWidth(1).strokeColor('#999999').stroke();
      doc
        .fillColor('#111111')
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(venue.name, x, y + 12, { width: cardW, align: 'center' });
      doc
        .font('Helvetica-Bold')
        .fontSize(26)
        .text(`Table ${t.label}`, x, y + 30, { width: cardW, align: 'center' });
      if (t.area)
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#555555')
          .text(t.area, x, y + 60, { width: cardW, align: 'center' });
      const qrSize = Math.min(cardW - 60, cardH - 120);
      doc.image(png, x + (cardW - qrSize) / 2, y + 76, { width: qrSize, height: qrSize });
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#111111')
        .text('Scan to see the menu and order from your phone.', x + 10, y + 80 + qrSize, {
          width: cardW - 20,
          align: 'center',
        })
        .text('Your waiter opens the table before you can order.', {
          width: cardW - 20,
          align: 'center',
        });
      doc
        .fontSize(7)
        .fillColor('#888888')
        .text(`v${t.qrVersion}`, x + cardW - 30, y + cardH - 14, { width: 24, align: 'right' });
    }
    doc.end();
    return done;
  }
}

/** Natural sort: area, then label with numbers compared numerically (M2 before M10). */
export function sortTables<T extends { label: string; area: string | null }>(rows: T[]): T[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return [...rows].sort(
    (a, b) => collator.compare(a.area ?? '', b.area ?? '') || collator.compare(a.label, b.label),
  );
}
