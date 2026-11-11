import { Module } from '@nestjs/common';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SetupModule } from '../setup/setup.module';
import { CustomerService } from './customer.service';
import { OrdersService } from './orders.service';
import { PublicController } from './public.controller';
import { PublicMenuService } from './public-menu.service';
import { SessionsService } from './sessions.service';
import { StaffOpsController } from './staff-ops.controller';
import { TabsService } from './tabs.service';

@Module({
  imports: [SetupModule],
  controllers: [PublicController, StaffOpsController],
  providers: [
    TabsService,
    PublicMenuService,
    SessionsService,
    OrdersService,
    CustomerService,
    RealtimeGateway,
  ],
  exports: [TabsService, PublicMenuService, SessionsService, OrdersService, CustomerService],
})
export class OrderingModule {}
