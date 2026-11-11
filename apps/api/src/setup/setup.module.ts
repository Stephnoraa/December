import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ChecklistService } from './checklist.service';
import { DevStorageController } from './dev-storage.controller';
import { ImagesService } from './images.service';
import {
  MenuAdminController,
  StaffAdminController,
  StaffStationsController,
  StationsController,
  TablesController,
  VenueController,
} from './setup.controller';
import { StaffService } from './staff.service';
import { TablesService } from './tables.service';
import { VenueService } from './venue.service';

@Module({
  controllers: [
    VenueController,
    StationsController,
    TablesController,
    MenuAdminController,
    StaffAdminController,
    StaffStationsController,
    DevStorageController,
  ],
  providers: [
    VenueService,
    ChecklistService,
    ImagesService,
    CatalogService,
    TablesService,
    StaffService,
  ],
  exports: [VenueService, ChecklistService, CatalogService, TablesService],
})
export class SetupModule {}
