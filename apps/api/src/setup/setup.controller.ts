import {
  Controller,
  Get,
  Header,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  Delete,
} from '@nestjs/common';
import { z } from 'zod';
import {
  addOnSchema,
  availabilitySchema,
  bulkTablesSchema,
  categorySchema,
  imageUploadCompleteSchema,
  imageUploadRequestSchema,
  menuItemSchema,
  menuItemUpdateSchema,
  Permission,
  staffCreateSchema,
  staffUpdateSchema,
  stationSchema,
  tableSchema,
  venueSettingsSchema,
  type AddOnInput,
  type BulkTablesInput,
  type CategoryInput,
  type ImageUploadRequest,
  type MenuItemInput,
  type MenuItemUpdateInput,
  type StaffCreateInput,
  type StaffUpdateInput,
  type StationInput,
  type TableInput,
  type VenueSettingsInput,
} from '@app/shared';
import { CurrentStaff, StaffAuth } from '../auth/guards';
import { clientIp, type AppRequest, type StaffPrincipal } from '../common/request';
import { UuidParam, ZBody } from '../common/zod.pipe';
import { CatalogService } from './catalog.service';
import { ChecklistService } from './checklist.service';
import { ImagesService } from './images.service';
import { StaffService } from './staff.service';
import { TablesService } from './tables.service';
import { VenueService } from './venue.service';

const stationUpdateSchema = stationSchema.partial().extend({ active: z.boolean().optional() });
const rotateSchema = z.object({ tableIds: z.array(z.uuid()).min(1).max(500).optional() });
const uploadKeySchema = imageUploadCompleteSchema;

@Controller('v1/admin/venue')
export class VenueController {
  constructor(
    private readonly venue: VenueService,
    private readonly checklist: ChecklistService,
    private readonly images: ImagesService,
  ) {}

  @Get()
  @StaffAuth(Permission.VENUE_SETTINGS)
  get(@CurrentStaff() staff: StaffPrincipal) {
    return this.venue.get(staff.venueId);
  }

  @Patch()
  @StaffAuth(Permission.VENUE_SETTINGS)
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @ZBody(venueSettingsSchema) body: VenueSettingsInput,
    @Req() req: AppRequest,
  ) {
    return this.venue.update(staff, body, clientIp(req));
  }

  @Get('checklist')
  @StaffAuth(Permission.DASHBOARD_VIEW)
  getChecklist(@CurrentStaff() staff: StaffPrincipal) {
    return this.checklist.forCurrentVenue(staff.venueId);
  }

  @Post('logo/upload-url')
  @StaffAuth(Permission.VENUE_SETTINGS)
  logoUploadUrl(
    @CurrentStaff() staff: StaffPrincipal,
    @ZBody(imageUploadRequestSchema) body: ImageUploadRequest,
  ) {
    return this.images.uploadUrl(staff.venueId, body);
  }

  @Post('logo')
  @HttpCode(200)
  @StaffAuth(Permission.VENUE_SETTINGS)
  setLogo(
    @CurrentStaff() staff: StaffPrincipal,
    @ZBody(uploadKeySchema) body: { uploadKey: string },
    @Req() req: AppRequest,
  ) {
    return this.venue.setLogo(staff, body.uploadKey, clientIp(req));
  }
}

@Controller('v1/admin/stations')
export class StationsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @StaffAuth(Permission.STATIONS_MANAGE)
  list() {
    return this.catalog.listStations();
  }

  @Post()
  @StaffAuth(Permission.STATIONS_MANAGE)
  create(@CurrentStaff() staff: StaffPrincipal, @ZBody(stationSchema) body: StationInput) {
    return this.catalog.createStation(staff.venueId, body);
  }

  @Patch(':id')
  @StaffAuth(Permission.STATIONS_MANAGE)
  update(
    @UuidParam() id: string,
    @ZBody(stationUpdateSchema) body: z.infer<typeof stationUpdateSchema>,
  ) {
    return this.catalog.updateStation(id, body);
  }
}

@Controller('v1/admin/tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  @StaffAuth(Permission.TABLES_MANAGE)
  list(@CurrentStaff() staff: StaffPrincipal) {
    return this.tables.list(staff.venueId);
  }

  @Post()
  @StaffAuth(Permission.TABLES_MANAGE)
  create(@CurrentStaff() staff: StaffPrincipal, @ZBody(tableSchema) body: TableInput) {
    return this.tables.create(staff.venueId, body);
  }

  @Post('bulk')
  @StaffAuth(Permission.TABLES_MANAGE)
  bulk(@CurrentStaff() staff: StaffPrincipal, @ZBody(bulkTablesSchema) body: BulkTablesInput) {
    return this.tables.bulkCreate(staff.venueId, body);
  }

  @Patch(':id')
  @StaffAuth(Permission.TABLES_MANAGE)
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @UuidParam() id: string,
    @ZBody(tableSchema.partial()) body: Partial<TableInput>,
  ) {
    return this.tables.update(staff.venueId, id, body);
  }

  /** Invalidates printed QR codes (given tables, or every table). */
  @Post('rotate-qr')
  @HttpCode(200)
  @StaffAuth(Permission.TABLES_MANAGE)
  rotate(
    @CurrentStaff() staff: StaffPrincipal,
    @ZBody(rotateSchema) body: z.infer<typeof rotateSchema>,
    @Req() req: AppRequest,
  ) {
    return this.tables.rotate(staff, body.tableIds ?? null, clientIp(req));
  }

  @Get('qr.pdf')
  @StaffAuth(Permission.TABLES_MANAGE)
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="table-qr-codes.pdf"')
  async pdf(@CurrentStaff() staff: StaffPrincipal, @Query('ids') ids?: string) {
    const list = ids?.split(',').filter((s) => z.uuid().safeParse(s).success);
    return new StreamableFile(await this.tables.qrPdf(staff.venueId, list));
  }
}

@Controller('v1/admin/menu')
export class MenuAdminController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly images: ImagesService,
  ) {}

  @Get()
  @StaffAuth(Permission.MENU_MANAGE)
  menu() {
    return this.catalog.adminMenu();
  }

  @Post('categories')
  @StaffAuth(Permission.MENU_MANAGE)
  createCategory(
    @CurrentStaff() staff: StaffPrincipal,
    @ZBody(categorySchema) body: CategoryInput,
  ) {
    return this.catalog.createCategory(staff.venueId, body);
  }

  @Patch('categories/:id')
  @StaffAuth(Permission.MENU_MANAGE)
  updateCategory(
    @CurrentStaff() staff: StaffPrincipal,
    @UuidParam() id: string,
    @ZBody(categorySchema.partial()) body: Partial<CategoryInput>,
  ) {
    return this.catalog.updateCategory(staff.venueId, id, body);
  }

  @Post('items')
  @StaffAuth(Permission.MENU_MANAGE)
  createItem(@CurrentStaff() staff: StaffPrincipal, @ZBody(menuItemSchema) body: MenuItemInput) {
    return this.catalog.createItem(staff.venueId, body);
  }

  @Patch('items/:id')
  @StaffAuth(Permission.MENU_MANAGE)
  updateItem(
    @CurrentStaff() staff: StaffPrincipal,
    @UuidParam() id: string,
    @ZBody(menuItemUpdateSchema) body: MenuItemUpdateInput,
    @Req() req: AppRequest,
  ) {
    return this.catalog.updateItem(staff, id, body, clientIp(req));
  }

  @Delete('items/:id')
  @HttpCode(200)
  @StaffAuth(Permission.MENU_MANAGE)
  async archiveItem(@CurrentStaff() staff: StaffPrincipal, @UuidParam() id: string) {
    await this.catalog.archiveItem(staff.venueId, id);
    return { ok: true };
  }

  /** Managers toggle availability from the menu screen (stations do it from their queue). */
  @Patch('items/:id/availability')
  @StaffAuth(Permission.MENU_MANAGE)
  availability(
    @CurrentStaff() staff: StaffPrincipal,
    @UuidParam() id: string,
    @ZBody(availabilitySchema) body: { isAvailable: boolean },
    @Req() req: AppRequest,
  ) {
    return this.catalog.setAvailability(staff, id, body.isAvailable, clientIp(req));
  }

  @Post('items/:id/image/upload-url')
  @StaffAuth(Permission.MENU_MANAGE)
  imageUploadUrl(
    @CurrentStaff() staff: StaffPrincipal,
    @ZBody(imageUploadRequestSchema) body: ImageUploadRequest,
  ) {
    return this.images.uploadUrl(staff.venueId, body);
  }

  @Post('items/:id/image')
  @HttpCode(200)
  @StaffAuth(Permission.MENU_MANAGE)
  setImage(
    @CurrentStaff() staff: StaffPrincipal,
    @UuidParam() id: string,
    @ZBody(uploadKeySchema) body: { uploadKey: string },
  ) {
    return this.catalog.setItemImage(staff, id, body.uploadKey);
  }

  @Delete('items/:id/image')
  @HttpCode(200)
  @StaffAuth(Permission.MENU_MANAGE)
  removeImage(@CurrentStaff() staff: StaffPrincipal, @UuidParam() id: string) {
    return this.catalog.removeItemImage(staff, id);
  }

  @Post('items/:id/add-ons')
  @StaffAuth(Permission.MENU_MANAGE)
  createAddOn(
    @CurrentStaff() staff: StaffPrincipal,
    @UuidParam() id: string,
    @ZBody(addOnSchema) body: AddOnInput,
  ) {
    return this.catalog.createAddOn(staff.venueId, id, body);
  }

  @Patch('add-ons/:id')
  @StaffAuth(Permission.MENU_MANAGE)
  updateAddOn(
    @CurrentStaff() staff: StaffPrincipal,
    @UuidParam() id: string,
    @ZBody(addOnSchema.partial()) body: Partial<AddOnInput>,
  ) {
    return this.catalog.updateAddOn(staff.venueId, id, body);
  }

  @Delete('add-ons/:id')
  @HttpCode(200)
  @StaffAuth(Permission.MENU_MANAGE)
  archiveAddOn(@CurrentStaff() staff: StaffPrincipal, @UuidParam() id: string) {
    return this.catalog.archiveAddOn(staff.venueId, id);
  }
}

@Controller('v1/admin')
export class StaffAdminController {
  constructor(private readonly staff: StaffService) {}

  @Get('staff')
  @StaffAuth(Permission.STAFF_MANAGE)
  list() {
    return this.staff.list();
  }

  @Post('staff')
  @StaffAuth(Permission.STAFF_MANAGE)
  create(
    @CurrentStaff() actor: StaffPrincipal,
    @ZBody(staffCreateSchema) body: StaffCreateInput,
    @Req() req: AppRequest,
  ) {
    return this.staff.create(actor, body, clientIp(req));
  }

  @Patch('staff/:id')
  @StaffAuth(Permission.STAFF_MANAGE)
  update(
    @CurrentStaff() actor: StaffPrincipal,
    @UuidParam() id: string,
    @ZBody(staffUpdateSchema) body: StaffUpdateInput,
    @Req() req: AppRequest,
  ) {
    return this.staff.update(actor, id, body, clientIp(req));
  }

  @Get('devices')
  @StaffAuth(Permission.DEVICES_MANAGE)
  devices() {
    return this.staff.listDevices();
  }

  @Post('devices/:id/revoke')
  @HttpCode(200)
  @StaffAuth(Permission.DEVICES_MANAGE)
  async revoke(@UuidParam() id: string) {
    await this.staff.revokeDevice(id);
    return { ok: true };
  }
}

/** Any signed-in staff member: station picker for the station screen. */
@Controller('v1/staff/stations')
export class StaffStationsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @StaffAuth()
  list() {
    return this.catalog.listStations(false);
  }
}
