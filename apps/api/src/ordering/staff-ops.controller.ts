import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { markUnavailableSchema, Permission } from '@app/shared';
import { CurrentStaff, StaffAuth } from '../auth/guards';
import { clientIp, type AppRequest, type StaffPrincipal } from '../common/request';
import { UuidParam, ZBody } from '../common/zod.pipe';
import { OrdersService } from './orders.service';
import { SessionsService } from './sessions.service';

@Controller('v1/staff')
export class StaffOpsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly orders: OrdersService,
  ) {}

  @Get('floor')
  @StaffAuth(Permission.FLOOR_OPERATE)
  floor() {
    return this.sessions.floor();
  }

  @Post('tables/:id/open')
  @StaffAuth(Permission.FLOOR_OPERATE)
  open(@CurrentStaff() staff: StaffPrincipal, @UuidParam() id: string, @Req() req: AppRequest) {
    return this.sessions.open(staff, id, clientIp(req));
  }

  @Get('sessions/:id')
  @StaffAuth(Permission.FLOOR_OPERATE)
  tab(@UuidParam() id: string) {
    return this.sessions.staffTab(id);
  }

  @Post('sessions/:id/close')
  @HttpCode(200)
  @StaffAuth(Permission.FLOOR_OPERATE)
  close(@CurrentStaff() staff: StaffPrincipal, @UuidParam() id: string, @Req() req: AppRequest) {
    return this.sessions.close(staff, id, clientIp(req));
  }

  @Post('service-requests/:id/ack')
  @HttpCode(200)
  @StaffAuth(Permission.FLOOR_OPERATE)
  ack(@CurrentStaff() staff: StaffPrincipal, @UuidParam() id: string) {
    return this.sessions.acknowledge(staff, id);
  }

  @Post('order-items/:id/serve')
  @HttpCode(200)
  @StaffAuth(Permission.FLOOR_OPERATE)
  serve(@CurrentStaff() staff: StaffPrincipal, @UuidParam() id: string) {
    return this.orders.itemAction(staff, id, 'serve');
  }

  // ---- Station screen ------------------------------------------------------------------------

  @Get('stations/:id/queue')
  @StaffAuth(Permission.STATION_OPERATE)
  queue(@UuidParam() id: string) {
    return this.orders.stationQueue(id);
  }

  @Post('order-items/:id/accept')
  @HttpCode(200)
  @StaffAuth(Permission.STATION_OPERATE)
  accept(@CurrentStaff() staff: StaffPrincipal, @UuidParam() id: string) {
    return this.orders.itemAction(staff, id, 'accept');
  }

  @Post('order-items/:id/unavailable')
  @HttpCode(200)
  @StaffAuth(Permission.STATION_OPERATE)
  unavailable(
    @CurrentStaff() staff: StaffPrincipal,
    @UuidParam() id: string,
    @ZBody(markUnavailableSchema) body: { disableMenuItem: boolean },
    @Req() req: AppRequest,
  ) {
    return this.orders.itemAction(staff, id, 'unavailable', {
      disableMenuItem: body.disableMenuItem,
      ip: clientIp(req),
    });
  }

  @Post('order-items/:id/undo-unavailable')
  @HttpCode(200)
  @StaffAuth(Permission.STATION_OPERATE)
  undo(@CurrentStaff() staff: StaffPrincipal, @UuidParam() id: string, @Req() req: AppRequest) {
    return this.orders.itemAction(staff, id, 'undo-unavailable', { ip: clientIp(req) });
  }

  @Post('order-items/:id/ready')
  @HttpCode(200)
  @StaffAuth(Permission.STATION_OPERATE)
  ready(@CurrentStaff() staff: StaffPrincipal, @UuidParam() id: string) {
    return this.orders.itemAction(staff, id, 'ready');
  }
}
