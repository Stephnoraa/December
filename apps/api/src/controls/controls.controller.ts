import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { adjustmentSchema, auditQuerySchema, Permission, type AdjustmentInput } from '@app/shared';
import { AdminAuth, CurrentAdmin, CurrentStaff, StaffAuth } from '../auth/guards';
import {
  clientIp,
  type AdminPrincipal,
  type AppRequest,
  type StaffPrincipal,
} from '../common/request';
import { UuidParam, ZBody, ZQuery } from '../common/zod.pipe';
import { AdjustmentsService } from './adjustments.service';
import { DashboardService } from './dashboard.service';
import { PlatformService } from './platform.service';

@Controller('v1/staff')
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}

  @Get('approvers')
  @StaffAuth(Permission.ADJUSTMENTS_REQUEST)
  approvers() {
    return this.adjustments.approvers();
  }

  @Post('sessions/:id/adjustments')
  @StaffAuth(Permission.ADJUSTMENTS_REQUEST)
  create(
    @CurrentStaff() staff: StaffPrincipal,
    @UuidParam() id: string,
    @ZBody(adjustmentSchema) body: AdjustmentInput,
    @Req() req: AppRequest,
  ) {
    return this.adjustments.create(staff, id, body, clientIp(req));
  }
}

@Controller('v1/admin')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard')
  @StaffAuth(Permission.DASHBOARD_VIEW)
  get() {
    return this.dashboard.dashboard();
  }

  @Get('audit')
  @StaffAuth(Permission.AUDIT_VIEW)
  audit(@ZQuery(auditQuerySchema) query: z.infer<typeof auditQuerySchema>) {
    return this.dashboard.audit(query);
  }
}

const statusSchema = z.object({ reason: z.string().trim().max(200).optional() });

@Controller('v1/platform/venues')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  @AdminAuth()
  list() {
    return this.platform.venues();
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @AdminAuth()
  suspend(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam() id: string,
    @ZBody(statusSchema) body: z.infer<typeof statusSchema>,
  ) {
    return this.platform.setStatus(admin, id, 'SUSPENDED', body.reason ?? null);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @AdminAuth()
  activate(
    @CurrentAdmin() admin: AdminPrincipal,
    @UuidParam() id: string,
    @ZBody(statusSchema) body: z.infer<typeof statusSchema>,
  ) {
    return this.platform.setStatus(admin, id, 'ACTIVE', body.reason ?? null);
  }
}
