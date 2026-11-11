import { HttpStatus, Injectable } from '@nestjs/common';
import { lockRow, type DbClient } from '@app/db';
import {
  assertOrderItemTransition,
  canApproveAdjustments,
  ErrorCode,
  isBillableItemStatus,
  type AdjustmentInput,
  type StaffRole,
} from '@app/shared';
import { AuditService } from '../common/audit.service';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import { EventsService } from '../common/events.service';
import type { StaffPrincipal } from '../common/request';
import { CredentialsService } from '../auth/credentials.service';
import { notify } from '../ordering/notify';
import { TabsService } from '../ordering/tabs.service';

/**
 * Voids and discounts. Each needs a manager or owner PIN entered at the moment of the action
 * (on the requesting device) and a reason; requester and approver are stored on the
 * Adjustment and in the append-only audit log.
 */
@Injectable()
export class AdjustmentsService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly credentials: CredentialsService,
    private readonly tabs: TabsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  approvers() {
    return this.db.staffMember.findMany({
      where: { active: true, role: { in: ['OWNER', 'MANAGER'] } },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  async create(
    staff: StaffPrincipal,
    tableSessionId: string,
    input: AdjustmentInput,
    ip: string | null,
  ) {
    // PIN first, outside the transaction: wrong attempts must count even though we then fail.
    const approver = await this.credentials.verifyPin(
      this.db,
      input.approver.staffId,
      input.approver.pin,
      staff,
      ip,
    );
    if (!canApproveAdjustments(approver.role as StaffRole)) {
      throw new AppError(
        ErrorCode.APPROVAL_REQUIRED,
        'A manager or owner must approve this',
        HttpStatus.FORBIDDEN,
      );
    }
    const session = await this.db.tableSession.findUnique({
      where: { id: tableSessionId },
      include: { tab: true },
    });
    if (!session?.tab) throw AppError.notFound('Table session');
    if (session.status !== 'OPEN')
      throw AppError.conflict(ErrorCode.TABLE_NOT_OPEN, 'This table is closed');
    const tabId = session.tab.id;

    const result = await this.db.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'Tab', tabId, staff.venueId))) throw AppError.notFound('Tab');
      let item = null;
      if (input.orderItemId) {
        item = await tx.orderItem.findFirst({
          where: { id: input.orderItemId, tabId },
          include: { order: true },
        });
        if (!item || item.order.status !== 'PLACED' || !isBillableItemStatus(item.status)) {
          throw AppError.conflict(ErrorCode.INVALID_TRANSITION, 'That item is not on the bill');
        }
      }
      let adjustment;
      if (input.type === 'VOID') {
        assertOrderItemTransition(item!.status, 'VOIDED');
        const moved = await tx.orderItem.updateMany({
          where: { id: item!.id, status: item!.status },
          data: {
            status: 'VOIDED',
            voidedAt: new Date(),
            version: { increment: 1 },
            actedByStaffId: staff.staffId,
          },
        });
        if (moved.count !== 1)
          throw AppError.conflict(
            ErrorCode.INVALID_TRANSITION,
            'Someone else just updated this item',
          );
        adjustment = await tx.adjustment.create({
          data: {
            venueId: staff.venueId,
            tabId,
            type: 'VOID',
            amountKobo: item!.unitPriceKobo * item!.quantity,
            orderItemId: item!.id,
            reason: input.reason,
            requestedByStaffId: staff.staffId,
            approvedByStaffId: approver.id,
          },
        });
      } else {
        adjustment = await tx.adjustment.create({
          data: {
            venueId: staff.venueId,
            tabId,
            type: 'DISCOUNT',
            discountKind: input.kind,
            amountKobo: input.kind === 'AMOUNT' ? input.amountKobo : null,
            percentBps: input.kind === 'PERCENT' ? input.percentBps : null,
            orderItemId: input.orderItemId ?? null,
            reason: input.reason,
            requestedByStaffId: staff.staffId,
            approvedByStaffId: approver.id,
          },
        });
      }
      const before = await tx.tab.findUniqueOrThrow({ where: { id: tabId } });
      const after = await this.tabs.recalculate(tx, tabId, staff.venueId);
      await this.audit.record(tx, {
        venueId: staff.venueId,
        actor: staff,
        approverId: approver.id,
        action: input.type === 'VOID' ? 'ITEM_VOIDED' : 'DISCOUNT_APPLIED',
        entityType: input.type === 'VOID' ? 'OrderItem' : 'Adjustment',
        entityId: input.type === 'VOID' ? item!.id : adjustment.id,
        before: {
          totalKobo: before.totalKobo,
          item: item ? { name: item.name, quantity: item.quantity, status: item.status } : null,
        },
        after: {
          totalKobo: after.totalKobo,
          adjustmentId: adjustment.id,
          kind: adjustment.discountKind,
          amountKobo: adjustment.amountKobo,
          percentBps: adjustment.percentBps,
          approvedBy: approver.name,
        },
        reason: input.reason,
        ip,
      });
      return { adjustment, tab: after, item };
    });
    const events = notify.tab(staff.venueId, tableSessionId, result.tab.id, result.tab.version);
    if (result.item) {
      events.push(
        notify.item(staff.venueId, tableSessionId, result.item.id, result.item.version + 1),
      );
      events.push(...notify.stations(staff.venueId, [result.item.stationId]));
    }
    this.events.emitAll(events);
    const names = await this.tabs.staffNames(this.db, result.tab);
    return this.tabs.adjustmentDtos(result.tab, names).find((a) => a.id === result.adjustment.id)!;
  }
}
