import { HttpStatus, Injectable } from '@nestjs/common';
import type { DbClient, DbTx, Prisma } from '@app/db';
import {
  ErrorCode,
  Rooms,
  SocketEvent,
  type AddOnInput,
  type AdminMenuCategoryDto,
  type AdminMenuItemDto,
  type CategoryInput,
  type MenuItemInput,
  type MenuItemUpdateInput,
  type StationDto,
  type StationInput,
} from '@app/shared';
import { AuditService, type Actor } from '../common/audit.service';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import { EventsService } from '../common/events.service';
import type { StaffPrincipal } from '../common/request';
import { StorageService } from '../storage/storage.service';
import { ImagesService } from './images.service';

const ITEM_INCLUDE = {
  addOns: { where: { archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.MenuItemInclude;

/** Stations and menu (categories, items, add-ons, photos, availability). */
@Injectable()
export class CatalogService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly storage: StorageService,
    private readonly images: ImagesService,
  ) {}

  // ---- Stations ----------------------------------------------------------------------------

  async listStations(includeInactive = true): Promise<StationDto[]> {
    const rows = await this.db.station.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((s) => ({ id: s.id, name: s.name, sortOrder: s.sortOrder, active: s.active }));
  }

  async createStation(venueId: string, input: StationInput): Promise<StationDto> {
    const s = await this.db.station.create({
      data: { venueId, name: input.name, sortOrder: input.sortOrder ?? 0 },
    });
    return { id: s.id, name: s.name, sortOrder: s.sortOrder, active: s.active };
  }

  async updateStation(
    id: string,
    input: Partial<StationInput> & { active?: boolean },
  ): Promise<StationDto> {
    if (input.active === false) {
      const items = await this.db.menuItem.count({ where: { stationId: id, archivedAt: null } });
      if (items > 0) {
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          'Move this station’s menu items to another station first',
        );
      }
    }
    const s = await this.db.station.update({ where: { id }, data: input });
    return { id: s.id, name: s.name, sortOrder: s.sortOrder, active: s.active };
  }

  // ---- Menu --------------------------------------------------------------------------------

  private itemDto(i: Awaited<ReturnType<CatalogService['loadItem']>>): AdminMenuItemDto {
    return {
      id: i.id,
      categoryId: i.categoryId,
      stationId: i.stationId,
      name: i.name,
      description: i.description,
      priceKobo: i.priceKobo,
      imageUrl: this.storage.publicUrl(i.imageKey),
      isAvailable: i.isAvailable,
      sortOrder: i.sortOrder,
      addOns: i.addOns.map((a) => ({
        id: a.id,
        name: a.name,
        priceDeltaKobo: a.priceDeltaKobo,
        isAvailable: a.isAvailable,
      })),
    };
  }

  private loadItem(id: string) {
    return this.db.menuItem.findFirstOrThrow({
      where: { id, archivedAt: null },
      include: ITEM_INCLUDE,
    });
  }

  async adminMenu(): Promise<AdminMenuCategoryDto[]> {
    const categories = await this.db.menuCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        items: {
          where: { archivedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: ITEM_INCLUDE,
        },
      },
    });
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
      active: c.active,
      items: c.items.map((i) => this.itemDto(i)),
    }));
  }

  async createCategory(venueId: string, input: CategoryInput) {
    const sortOrder = input.sortOrder ?? (await this.db.menuCategory.count());
    const c = await this.db.menuCategory.create({
      data: { venueId, name: input.name, sortOrder, active: input.active ?? true },
    });
    this.menuChanged(venueId);
    return { id: c.id, name: c.name, sortOrder: c.sortOrder, active: c.active, items: [] };
  }

  async updateCategory(venueId: string, id: string, input: Partial<CategoryInput>) {
    const c = await this.db.menuCategory.update({ where: { id }, data: input });
    this.menuChanged(venueId);
    return { id: c.id, name: c.name, sortOrder: c.sortOrder, active: c.active };
  }

  private async assertRefs(categoryId?: string, stationId?: string) {
    if (categoryId && !(await this.db.menuCategory.findUnique({ where: { id: categoryId } }))) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Unknown category', HttpStatus.BAD_REQUEST);
    }
    if (stationId) {
      const station = await this.db.station.findUnique({ where: { id: stationId } });
      if (!station || !station.active)
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'Unknown station');
    }
  }

  async createItem(venueId: string, input: MenuItemInput): Promise<AdminMenuItemDto> {
    await this.assertRefs(input.categoryId, input.stationId);
    const sortOrder =
      input.sortOrder ??
      (await this.db.menuItem.count({ where: { categoryId: input.categoryId } }));
    const item = await this.db.menuItem.create({
      data: {
        venueId,
        categoryId: input.categoryId,
        stationId: input.stationId,
        name: input.name,
        description: input.description ?? null,
        priceKobo: input.priceKobo,
        isAvailable: input.isAvailable ?? true,
        sortOrder,
      },
      include: ITEM_INCLUDE,
    });
    this.menuChanged(venueId);
    return this.itemDto(item);
  }

  async updateItem(
    staff: StaffPrincipal,
    id: string,
    input: MenuItemUpdateInput,
    ip: string | null,
  ) {
    await this.assertRefs(input.categoryId, input.stationId);
    const { isAvailable, ...rest } = input;
    await this.db.$transaction(async (tx) => {
      await tx.menuItem.findFirstOrThrow({ where: { id, archivedAt: null } });
      if (Object.keys(rest).length > 0) await tx.menuItem.update({ where: { id }, data: rest });
      if (isAvailable !== undefined) await this.setAvailabilityTx(tx, staff, id, isAvailable, ip);
    });
    this.menuChanged(staff.venueId, id);
    return this.itemDto(await this.loadItem(id));
  }

  async archiveItem(venueId: string, id: string): Promise<void> {
    await this.db.menuItem.update({
      where: { id },
      data: { archivedAt: new Date(), isAvailable: false },
    });
    this.menuChanged(venueId, id);
  }

  /** Switches an item on/off venue-wide, audited. Returns false when nothing changed. */
  async setAvailabilityTx(
    tx: DbTx,
    actor: Actor,
    id: string,
    isAvailable: boolean,
    ip: string | null,
  ) {
    const item = await tx.menuItem.findFirstOrThrow({ where: { id, archivedAt: null } });
    if (item.isAvailable === isAvailable) return false;
    await tx.menuItem.update({ where: { id }, data: { isAvailable } });
    await this.audit.record(tx, {
      venueId: item.venueId,
      actor,
      action: 'MENU_AVAILABILITY_CHANGED',
      entityType: 'MenuItem',
      entityId: id,
      before: { isAvailable: item.isAvailable, name: item.name },
      after: { isAvailable, name: item.name },
      ip,
    });
    return true;
  }

  async setAvailability(
    staff: StaffPrincipal,
    id: string,
    isAvailable: boolean,
    ip: string | null,
  ) {
    await this.db.$transaction((tx) => this.setAvailabilityTx(tx, staff, id, isAvailable, ip));
    this.menuChanged(staff.venueId, id);
    return this.itemDto(await this.loadItem(id));
  }

  async setItemImage(staff: StaffPrincipal, id: string, uploadKey: string) {
    const item = await this.loadItem(id);
    const key = await this.images.process(staff.venueId, uploadKey, 'menu', 640);
    await this.db.menuItem.update({ where: { id }, data: { imageKey: key } });
    await this.images.remove(item.imageKey);
    this.menuChanged(staff.venueId, id);
    return this.itemDto(await this.loadItem(id));
  }

  async removeItemImage(staff: StaffPrincipal, id: string) {
    const item = await this.loadItem(id);
    await this.db.menuItem.update({ where: { id }, data: { imageKey: null } });
    await this.images.remove(item.imageKey);
    this.menuChanged(staff.venueId, id);
    return this.itemDto(await this.loadItem(id));
  }

  async createAddOn(venueId: string, itemId: string, input: AddOnInput) {
    await this.loadItem(itemId);
    const sortOrder = await this.db.menuAddOn.count({ where: { menuItemId: itemId } });
    await this.db.menuAddOn.create({
      data: {
        venueId,
        menuItemId: itemId,
        name: input.name,
        priceDeltaKobo: input.priceDeltaKobo,
        isAvailable: input.isAvailable ?? true,
        sortOrder,
      },
    });
    this.menuChanged(venueId, itemId);
    return this.itemDto(await this.loadItem(itemId));
  }

  async updateAddOn(venueId: string, id: string, input: Partial<AddOnInput>) {
    const addOn = await this.db.menuAddOn.update({ where: { id }, data: input });
    this.menuChanged(venueId, addOn.menuItemId);
    return this.itemDto(await this.loadItem(addOn.menuItemId));
  }

  async archiveAddOn(venueId: string, id: string) {
    const addOn = await this.db.menuAddOn.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    this.menuChanged(venueId, addOn.menuItemId);
    return this.itemDto(await this.loadItem(addOn.menuItemId));
  }

  menuChanged(venueId: string, menuItemId?: string): void {
    this.events.emit([Rooms.venueMenu(venueId), Rooms.venue(venueId)], SocketEvent.MENU_CHANGED, {
      venueId,
      menuItemId,
    });
  }
}
