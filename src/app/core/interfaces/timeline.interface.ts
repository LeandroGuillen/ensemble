/** In-world calendar and dates for timelines (see `world-date.utils.ts`). */

export interface CalendarMonth {
  name: string;
  days: number;
}

export interface WorldCalendar {
  /** Display name, e.g. "Coast Reckoning". */
  name?: string;
  /** Short era suffix shown after years, e.g. "CR". */
  suffix?: string;
  months: CalendarMonth[];
}

export interface WorldDate {
  year: number;
  /** 1-based month, when known. */
  month?: number;
  /** 1-based day of the month, when known (requires `month`). */
  day?: number;
  /** Written with `c.`: shown as approximate. */
  approx?: boolean;
}

export interface WorldSpan {
  start: WorldDate;
  /** Last date of a range; null for a single date. */
  end: WorldDate | null;
}

/** Inclusive day range, as absolute day numbers (see `dayNumber`). */
export interface DayRange {
  start: number;
  end: number;
}
