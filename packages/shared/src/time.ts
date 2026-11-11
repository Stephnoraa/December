/** Times are stored in UTC and shown in the venue timezone (Africa/Lagos for the MVP). */
export const VENUE_TIMEZONE = 'Africa/Lagos';
/** Lagos is UTC+1 all year (no daylight saving). */
const LAGOS_OFFSET_MINUTES = 60;
/** The trading day starts at 06:00 local time so late-night sales count towards the evening. */
export const BUSINESS_DAY_START_HOUR = 6;

/** UTC start of the business day (06:00 Lagos) containing `now`. */
export function businessDayStart(now: Date = new Date()): Date {
  const localMs = now.getTime() + LAGOS_OFFSET_MINUTES * 60_000;
  const local = new Date(localMs);
  const startLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    BUSINESS_DAY_START_HOUR,
  );
  let start = startLocal - LAGOS_OFFSET_MINUTES * 60_000;
  if (start > now.getTime()) start -= 24 * 60 * 60_000;
  return new Date(start);
}

const timeFormatter = new Intl.DateTimeFormat('en-NG', {
  timeZone: VENUE_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
});
const dateTimeFormatter = new Intl.DateTimeFormat('en-NG', {
  timeZone: VENUE_TIMEZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatVenueTime(iso: string | Date): string {
  return timeFormatter.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function formatVenueDateTime(iso: string | Date): string {
  return dateTimeFormatter.format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** "3m", "1h 05m" since `iso`. */
export function elapsedLabel(iso: string | Date, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - (typeof iso === 'string' ? new Date(iso) : iso).getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
