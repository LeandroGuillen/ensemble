/**
 * In-world dates for timelines. A project defines its own calendar (month names and
 * lengths, no leap years) in `ensemble.json → settings.calendar`; dates are written as
 * `322`, `322-03`, `322-03-09`, optionally prefixed with `c.` (approximate), and spans
 * as `<date> → <date>` (also `->` or `..`). Years may be negative.
 */

import { CalendarMonth, DayRange, WorldCalendar, WorldDate, WorldSpan } from '../interfaces/timeline.interface';

export type { CalendarMonth, DayRange, WorldCalendar, WorldDate, WorldSpan };

export const DEFAULT_CALENDAR: WorldCalendar = {
  months: [
    { name: 'January', days: 31 },
    { name: 'February', days: 28 },
    { name: 'March', days: 31 },
    { name: 'April', days: 30 },
    { name: 'May', days: 31 },
    { name: 'June', days: 30 },
    { name: 'July', days: 31 },
    { name: 'August', days: 31 },
    { name: 'September', days: 30 },
    { name: 'October', days: 31 },
    { name: 'November', days: 30 },
    { name: 'December', days: 31 },
  ],
};

/** A usable calendar from stored settings: falls back to the default for missing or invalid months. */
export function resolveCalendar(raw: Partial<WorldCalendar> | null | undefined): WorldCalendar {
  const months = Array.isArray(raw?.months)
    ? raw!.months
        .filter((m): m is CalendarMonth => !!m && typeof m === 'object')
        .map((m) => ({
          name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : '',
          days: Math.floor(Number(m.days)),
        }))
        .filter((m) => Number.isFinite(m.days) && m.days > 0 && m.days <= 400)
        .map((m, i) => ({ ...m, name: m.name || `Month ${i + 1}` }))
    : [];
  return {
    ...(typeof raw?.name === 'string' && raw.name.trim() ? { name: raw.name.trim() } : {}),
    ...(typeof raw?.suffix === 'string' && raw.suffix.trim() ? { suffix: raw.suffix.trim() } : {}),
    months: months.length ? months : DEFAULT_CALENDAR.months.map((m) => ({ ...m })),
  };
}

export function daysInYear(calendar: WorldCalendar): number {
  return calendar.months.reduce((sum, month) => sum + month.days, 0);
}

const DATE_RE = /^(c\.\s*|~\s*)?(-?\d{1,6})(?:-(\d{1,3}))?(?:-(\d{1,3}))?$/i;
const SPAN_SEPARATOR_RE = /\s*(?:→|->|\.\.)\s*/;

/** Parse `322`, `322-03`, `322-03-09`, `c. 322`, `-50`. Null when invalid for the calendar. */
export function parseWorldDate(text: string, calendar: WorldCalendar = DEFAULT_CALENDAR): WorldDate | null {
  const match = DATE_RE.exec(text.trim());
  if (!match) return null;
  const year = Number(match[2]);
  const month = match[3] !== undefined ? Number(match[3]) : undefined;
  const day = match[4] !== undefined ? Number(match[4]) : undefined;
  if (month !== undefined && (month < 1 || month > calendar.months.length)) return null;
  if (day !== undefined && (day < 1 || day > calendar.months[month! - 1].days)) return null;
  return {
    year,
    ...(month !== undefined ? { month } : {}),
    ...(day !== undefined ? { day } : {}),
    ...(match[1] ? { approx: true } : {}),
  };
}

/**
 * Parse a date or a span (`322-03-09 → 322-03-12`). A span whose end is before its start is invalid.
 * Returns undefined for unreadable text and null for empty text.
 */
export function parseWorldSpan(text: string, calendar: WorldCalendar = DEFAULT_CALENDAR): WorldSpan | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(SPAN_SEPARATOR_RE);
  if (parts.length > 2) return undefined;
  const start = parseWorldDate(parts[0], calendar);
  if (!start) return undefined;
  if (parts.length === 1) return { start, end: null };
  const end = parseWorldDate(parts[1], calendar);
  if (!end) return undefined;
  if (dayNumber(end, calendar, 'end') < dayNumber(start, calendar, 'start')) return undefined;
  return { start, end };
}

/** Day offset of a month's first day within the year (0-based). */
function monthOffset(calendar: WorldCalendar, month: number): number {
  let offset = 0;
  for (let i = 0; i < month - 1; i++) offset += calendar.months[i].days;
  return offset;
}

/**
 * Absolute day number of a date. A partial date covers a range: `edge` picks its first
 * (`start`) or last (`end`) day, so `322-03` spans the whole of March.
 */
export function dayNumber(date: WorldDate, calendar: WorldCalendar, edge: 'start' | 'end' = 'start'): number {
  const yearDays = daysInYear(calendar);
  const base = date.year * yearDays;
  if (date.month === undefined) return base + (edge === 'start' ? 0 : yearDays - 1);
  const monthStart = base + monthOffset(calendar, date.month);
  if (date.day === undefined) {
    return edge === 'start' ? monthStart : monthStart + calendar.months[date.month - 1].days - 1;
  }
  return monthStart + date.day - 1;
}

export function spanDays(span: WorldSpan, calendar: WorldCalendar): DayRange {
  return {
    start: dayNumber(span.start, calendar, 'start'),
    end: dayNumber(span.end ?? span.start, calendar, 'end'),
  };
}

/** The date of an absolute day number (always with month and day). */
export function dateFromDay(day: number, calendar: WorldCalendar): Required<Omit<WorldDate, 'approx'>> {
  const yearDays = daysInYear(calendar);
  const year = Math.floor(day / yearDays);
  let rest = day - year * yearDays;
  let month = 1;
  for (const m of calendar.months) {
    if (rest < m.days) break;
    rest -= m.days;
    month++;
  }
  return { year, month, day: rest + 1 };
}

/** Year as a decimal (322.5 ≈ mid-year), for charts spanning centuries. */
export function dayToYear(day: number, calendar: WorldCalendar): number {
  return day / daysInYear(calendar);
}

export function yearToDay(year: number, calendar: WorldCalendar): number {
  return Math.round(year * daysInYear(calendar));
}

/** Middle of a date's range as a decimal year. */
export function dateToYear(date: WorldDate, calendar: WorldCalendar, edge: 'start' | 'end' | 'mid' = 'start'): number {
  if (edge === 'mid') {
    return dayToYear((dayNumber(date, calendar, 'start') + dayNumber(date, calendar, 'end') + 1) / 2, calendar);
  }
  return dayToYear(dayNumber(date, calendar, edge) + (edge === 'end' ? 1 : 0), calendar);
}

/** Canonical text written to files: `c. 322-03-09`. */
export function serializeWorldDate(date: WorldDate): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  let text = String(date.year);
  if (date.month !== undefined) text += `-${pad(date.month)}`;
  if (date.month !== undefined && date.day !== undefined) text += `-${pad(date.day)}`;
  return date.approx ? `c. ${text}` : text;
}

export function serializeWorldSpan(span: WorldSpan): string {
  return span.end ? `${serializeWorldDate(span.start)} → ${serializeWorldDate(span.end)}` : serializeWorldDate(span.start);
}

/**
 * Month name for compact labels: `Mar` for the default calendar; a project's own month
 * names are shown in full (`Highsun`), since their first letters rarely read well.
 */
export function shortMonthName(calendar: WorldCalendar, month: number): string {
  const name = calendar.months[month - 1]?.name ?? String(month);
  const isDefault = calendar.months.length === DEFAULT_CALENDAR.months.length &&
    calendar.months.every((m, i) => m.name === DEFAULT_CALENDAR.months[i].name);
  return isDefault && name.length > 4 ? name.slice(0, 3) : name;
}

/** Human text: `9 Mar 322`, `Mar 322`, `c. 322`. With `suffix`, the calendar suffix follows the year. */
export function formatWorldDate(
  date: WorldDate,
  calendar: WorldCalendar,
  options: { suffix?: boolean; longMonth?: boolean } = {}
): string {
  const month = date.month !== undefined
    ? options.longMonth ? calendar.months[date.month - 1]?.name ?? String(date.month) : shortMonthName(calendar, date.month)
    : '';
  const parts = [
    date.day !== undefined && date.month !== undefined ? String(date.day) : '',
    month,
    formatYear(date.year),
  ].filter(Boolean);
  const text = parts.join(' ') + (options.suffix && calendar.suffix ? ` ${calendar.suffix}` : '');
  return date.approx ? `c. ${text}` : text;
}

export function formatYear(year: number): string {
  return year < 0 ? `${-year} before` : String(year);
}

export function formatWorldSpan(span: WorldSpan, calendar: WorldCalendar, options: { suffix?: boolean } = {}): string {
  if (!span.end) return formatWorldDate(span.start, calendar, options);
  const start = { ...span.start };
  const end = span.end;
  // `3 – 9 Mar 330` rather than repeating the shared month and year.
  if (start.year === end.year && !start.approx && !end.approx) {
    if (start.month !== undefined && start.month === end.month && start.day !== undefined && end.day !== undefined) {
      return `${start.day} – ${formatWorldDate(end, calendar, options)}`;
    }
    if (start.month !== undefined && end.month !== undefined) {
      const first = start.day !== undefined ? `${start.day} ${shortMonthName(calendar, start.month)}` : shortMonthName(calendar, start.month);
      return `${first} – ${formatWorldDate(end, calendar, options)}`;
    }
  }
  return `${formatWorldDate(start, calendar)} – ${formatWorldDate(end, calendar, options)}`;
}

/** Day-range text for a chapter: `3 Mar 330` or `3 – 9 Mar 330`. */
export function formatDayRange(range: DayRange, calendar: WorldCalendar): string {
  const start = dateFromDay(range.start, calendar);
  if (range.end === range.start) return formatWorldDate(start, calendar);
  return formatWorldSpan({ start, end: dateFromDay(range.end, calendar) }, calendar);
}

/** `12 days`, `4 mo`, `3 yrs 4 mo`. Months are averaged across the calendar. */
export function formatDuration(days: number, calendar: WorldCalendar): string {
  const yearDays = daysInYear(calendar);
  const monthDays = yearDays / calendar.months.length;
  if (days < monthDays * 1.5) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / monthDays);
  if (months < calendar.months.length) return `${months} mo`;
  const years = Math.floor(months / calendar.months.length);
  const rest = months % calendar.months.length;
  return `${years} yr${years === 1 ? '' : 's'}${rest ? ` ${rest} mo` : ''}`;
}

/** Whole years between a birth date and a moment (decimal year). Null when unknown. */
export function ageAt(born: WorldDate | null, at: number, calendar: WorldCalendar): number | null {
  if (!born) return null;
  return Math.floor(at - dateToYear(born, calendar, 'start') + 1e-9);
}
