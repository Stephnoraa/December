import { Module } from '@nestjs/common';
import { OrderingModule } from '../ordering/ordering.module';
import { SetupModule } from '../setup/setup.module';
import { AdjustmentsService } from './adjustments.service';
import {
  AdjustmentsController,
  DashboardController,
  PlatformController,
} from './controls.controller';
import { DashboardService } from './dashboard.service';
import { PlatformService } from './platform.service';

@Module({
  imports: [OrderingModule, SetupModule],
  controllers: [AdjustmentsController, DashboardController, PlatformController],
  providers: [AdjustmentsService, DashboardService, PlatformService],
})
export class ControlsModule {}
