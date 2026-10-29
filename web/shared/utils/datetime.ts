/**
 * Date formatting pinned to India Standard Time.
 *
 * The backend runs in UTC and sends UTC ISO strings. Rendering those with the browser's
 * timezone shows the wrong clock to anyone outside India, and rolls "Today" over at the
 * wrong moment. Everything here formats in IST regardless of where the browser is.
 */

export const IST_TIME_ZONE = 'Asia/Kolkata';

const fmt = (options: Intl.DateTimeFormatOptions, locale = 'en-IN') =>
  new Intl.DateTimeFormat(locale, { timeZone: IST_TIME_ZONE, ...options });

const timeFormatter = fmt({ hour: '2-digit', minute: '2-digit', hour12: true });
const shortTimeFormatter = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });
const dateFormatter = fmt({ day: '2-digit', month: 'short', year: 'numeric' }, 'en-GB');
const longDateFormatter = fmt({ day: 'numeric', month: 'long', year: 'numeric' });
const shortDateFormatter = fmt({ day: 'numeric', month: 'short' });
const clockFormatter = fmt({
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true,
});
const fullFormatter = fmt({
  day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true,
});
/** ISO-style YYYY-MM-DD in IST, used to compare calendar days. */
const dayKeyFormatter = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA');

const toDate = (value: string | number | Date | null | undefined) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "06:42 am" */
export const formatIstTime = (value: string | number | Date | null | undefined) => {
  const date = toDate(value);
  return date ? timeFormatter.format(date) : '';
};

/** "24 Aug 2026" */
export const formatIstDate = (value: string | number | Date | null | undefined) => {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : '';
};

/** "24 August 2026" — for dates of birth and similar. */
export const formatIstLongDate = (value: string | number | Date | null | undefined) => {
  const date = toDate(value);
  return date ? longDateFormatter.format(date) : '';
};

/** "24 Aug 2026, 6:42 am" */
export const formatIstDateTime = (value: string | number | Date | null | undefined) => {
  const date = toDate(value);
  if (!date) return '';
  return `${dateFormatter.format(date)}, ${shortTimeFormatter.format(date).toLowerCase()}`;
};

/** "Monday, 24 August 2026, 06:42 am IST" — for the live header clocks. */
export const formatIstClock = (value: string | number | Date | null | undefined) => {
  const date = toDate(value);
  return date ? `${clockFormatter.format(date)} IST` : '';
};

/** "24 Aug 2026, 06:42 am IST" — unambiguous, used as hover titles. */
export const formatIstFull = (value: string | number | Date | null | undefined) => {
  const date = toDate(value);
  return date ? `${fullFormatter.format(date)} IST` : '';
};

/** The IST calendar day a timestamp falls on, as YYYY-MM-DD. */
export const istDayKey = (value: string | number | Date | null | undefined) => {
  const date = toDate(value);
  return date ? dayKeyFormatter.format(date) : '';
};

/** Whether two timestamps land on the same IST calendar day. */
export const sameIstDay = (a: string, b: string) => {
  const keyA = istDayKey(a);
  return keyA !== '' && keyA === istDayKey(b);
};

/** "Today" / "Yesterday" / "12 Aug", judged against the current IST day. */
export const formatIstDayLabel = (value: string | number | Date | null | undefined) => {
  const date = toDate(value);
  if (!date) return '';
  const key = dayKeyFormatter.format(date);
  const now = Date.now();
  // IST has no daylight saving, so a flat 24h step always lands on the previous IST day.
  if (key === dayKeyFormatter.format(new Date(now))) return 'Today';
  if (key === dayKeyFormatter.format(new Date(now - 86400000))) return 'Yesterday';
  return shortDateFormatter.format(date);
};

/**
 * "Just now" / "5 min ago" / "3 hr ago" / "2 days ago".
 * Elapsed time is timezone-independent, but this lives here so every dashboard shares
 * one implementation instead of four near-identical copies.
 */
export const formatTimeAgo = (value: string | number | Date | null | undefined) => {
  const date = toDate(value);
  if (!date) return 'Just now';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
};
