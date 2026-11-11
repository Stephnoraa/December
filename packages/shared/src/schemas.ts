import { z } from 'zod';
import { PAYMENT_MODES, SERVICE_REQUEST_TYPES, STAFF_ROLES } from './enums';

/** Request body schemas shared by the API (validation) and the PWAs (form types). */

const id = z.uuid();
const kobo = z.number().int().nonnegative().max(1_000_000_000_00);
const positiveKobo = z.number().int().positive().max(1_000_000_000_00);
const bps = z.number().int().min(0).max(10_000);
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const pinSchema = z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');
export const emailSchema = z.email().trim().toLowerCase().max(254);
export const passwordSchema = z.string().min(8, 'Use at least 8 characters').max(200);

// ---- Auth -------------------------------------------------------------------------------

export const signupSchema = z.object({
  ownerName: trimmed(2, 100),
  email: emailSchema,
  password: passwordSchema,
  pin: pinSchema,
  venueName: trimmed(2, 100),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const pinLoginSchema = z.object({
  staffId: id,
  pin: pinSchema,
});
export type PinLoginInput = z.infer<typeof pinLoginSchema>;

export const enableDeviceSchema = z.object({
  name: trimmed(1, 60),
});
export type EnableDeviceInput = z.infer<typeof enableDeviceSchema>;

export const platformLoginSchema = loginSchema;

// ---- Venue settings -----------------------------------------------------------------------

export const venueSettingsSchema = z
  .object({
    name: trimmed(2, 100),
    paymentMode: z.enum(PAYMENT_MODES),
    vatBps: bps,
    serviceChargeBps: bps,
    pricesIncludeVat: z.boolean(),
    address: z.string().trim().max(200).nullable(),
  })
  .partial();
export type VenueSettingsInput = z.infer<typeof venueSettingsSchema>;

export const resolveAccountSchema = z.object({
  bankCode: trimmed(1, 20),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits (NUBAN)'),
});
export type ResolveAccountInput = z.infer<typeof resolveAccountSchema>;

export const payoutSetupSchema = resolveAccountSchema.extend({
  bankName: trimmed(1, 100),
});
export type PayoutSetupInput = z.infer<typeof payoutSetupSchema>;

// ---- Stations, tables ---------------------------------------------------------------------

export const stationSchema = z.object({
  name: trimmed(1, 50),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type StationInput = z.infer<typeof stationSchema>;

export const tableSchema = z.object({
  label: trimmed(1, 30),
  area: z.string().trim().max(50).nullable().optional(),
  active: z.boolean().optional(),
});
export type TableInput = z.infer<typeof tableSchema>;

export const bulkTablesSchema = z.object({
  prefix: z.string().trim().max(20),
  from: z.number().int().min(1).max(999),
  to: z.number().int().min(1).max(999),
  area: z.string().trim().max(50).nullable().optional(),
});
export type BulkTablesInput = z.infer<typeof bulkTablesSchema>;

// ---- Menu ---------------------------------------------------------------------------------

export const categorySchema = z.object({
  name: trimmed(1, 60),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const menuItemSchema = z.object({
  categoryId: id,
  stationId: id,
  name: trimmed(1, 80),
  description: z.string().trim().max(500).nullable().optional(),
  priceKobo: kobo,
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type MenuItemInput = z.infer<typeof menuItemSchema>;
export const menuItemUpdateSchema = menuItemSchema.partial();
export type MenuItemUpdateInput = z.infer<typeof menuItemUpdateSchema>;

export const addOnSchema = z.object({
  name: trimmed(1, 60),
  priceDeltaKobo: kobo,
  isAvailable: z.boolean().optional(),
});
export type AddOnInput = z.infer<typeof addOnSchema>;

export const availabilitySchema = z.object({ isAvailable: z.boolean() });

export const imageContentTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const imageUploadRequestSchema = z.object({
  contentType: z.enum(imageContentTypes),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(8 * 1024 * 1024, 'Image must be 8 MB or smaller'),
});
export type ImageUploadRequest = z.infer<typeof imageUploadRequestSchema>;
export const imageUploadCompleteSchema = z.object({ uploadKey: z.string().min(1).max(300) });

// ---- Staff --------------------------------------------------------------------------------

export const staffCreateSchema = z
  .object({
    name: trimmed(2, 100),
    role: z.enum(STAFF_ROLES),
    pin: pinSchema,
    email: emailSchema.nullable().optional(),
    password: passwordSchema.nullable().optional(),
  })
  .refine((v) => !(v.role === 'WAITER' || v.role === 'STATION') || (!v.email && !v.password), {
    message: 'Waiters and station staff sign in with a PIN only',
    path: ['email'],
  })
  .refine((v) => !v.password || !!v.email, {
    message: 'Email is required with a password',
    path: ['email'],
  });
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

export const staffUpdateSchema = z.object({
  name: trimmed(2, 100).optional(),
  active: z.boolean().optional(),
  pin: pinSchema.optional(),
  password: passwordSchema.optional(),
});
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

// ---- Ordering -----------------------------------------------------------------------------

export const orderItemInputSchema = z.object({
  menuItemId: id,
  quantity: z.number().int().min(1).max(50),
  addOnIds: z.array(id).max(20).default([]),
  note: z.string().trim().max(200).nullable().optional(),
});
export const createOrderSchema = z.object({
  items: z.array(orderItemInputSchema).min(1).max(50),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

export const serviceRequestSchema = z.object({ type: z.enum(SERVICE_REQUEST_TYPES) });
export type ServiceRequestInput = z.infer<typeof serviceRequestSchema>;

export const markUnavailableSchema = z.object({
  /** Also switch the menu item off venue-wide (default true). */
  disableMenuItem: z.boolean().default(true),
});

// ---- Payments -----------------------------------------------------------------------------

export const startPaymentSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('FULL'), email: emailSchema }),
  z.object({ mode: z.literal('CUSTOM'), email: emailSchema, amountKobo: positiveKobo }),
  z.object({ mode: z.literal('ORDER'), email: emailSchema, orderId: id }),
]);
export type StartPaymentInput = z.infer<typeof startPaymentSchema>;

export const recordPaymentSchema = z.object({
  method: z.enum(['CASH', 'POS']),
  amountKobo: positiveKobo,
  /** PREPAY venues: settle a specific order awaiting payment (releases it to stations). */
  orderId: id.optional(),
  note: z.string().trim().max(200).optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

// ---- Adjustments --------------------------------------------------------------------------

export const approverSchema = z.object({ staffId: id, pin: pinSchema });

// Plain union: DISCOUNT appears twice (AMOUNT / PERCENT), so it can't be a discriminated union on `type`.
export const adjustmentSchema = z.union([
  z.object({
    type: z.literal('VOID'),
    orderItemId: id,
    reason: trimmed(3, 200),
    approver: approverSchema,
  }),
  z.object({
    type: z.literal('DISCOUNT'),
    kind: z.literal('AMOUNT'),
    amountKobo: positiveKobo,
    orderItemId: id.optional(),
    reason: trimmed(3, 200),
    approver: approverSchema,
  }),
  z.object({
    type: z.literal('DISCOUNT'),
    kind: z.literal('PERCENT'),
    percentBps: z.number().int().min(1).max(10_000),
    orderItemId: id.optional(),
    reason: trimmed(3, 200),
    approver: approverSchema,
  }),
]);
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const auditQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().max(60).optional(),
});
