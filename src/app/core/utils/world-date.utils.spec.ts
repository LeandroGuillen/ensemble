import {
  DEFAULT_CALENDAR,
  WorldCalendar,
  dateFromDay,
  dayNumber,
  formatDuration,
  formatWorldDate,
  formatWorldSpan,
  parseWorldDate,
  parseWorldSpan,
  resolveCalendar,
  serializeWorldSpan,
  spanDays,
} from './world-date.utils';

const COAST: WorldCalendar = {
  name: 'Coast Reckoning',
  suffix: 'CR',
  months: [
    { name: 'Thaw', days: 30 },
    { name: 'Gale', days: 30 },
    { name: 'Salt', days: 40 },
  ],
};

describe('world-date.utils', () => {
  it('parses years, months, days and approximate dates', () => {
    expect(parseWorldDate('322')).toEqual({ year: 322 });
    expect(parseWorldDate('322-03')).toEqual({ year: 322, month: 3 });
    expect(parseWorldDate('322-03-09')).toEqual({ year: 322, month: 3, day: 9 });
    expect(parseWorldDate('c. 1')).toEqual({ year: 1, approx: true });
    expect(parseWorldDate('-50')).toEqual({ year: -50 });
  });

  it('rejects dates outside the calendar', () => {
    expect(parseWorldDate('322-13')).toBeNull();
    expect(parseWorldDate('322-02-30')).toBeNull();
    expect(parseWorldDate('322-03-35', COAST)).toEqual({ year: 322, month: 3, day: 35 });
    expect(parseWorldDate('322-04', COAST)).toBeNull();
    expect(parseWorldDate('spring')).toBeNull();
  });

  it('parses spans with →, -> and ..', () => {
    expect(parseWorldSpan('330-03-09 → 330-03-10')).toEqual({ start: { year: 330, month: 3, day: 9 }, end: { year: 330, month: 3, day: 10 } });
    expect(parseWorldSpan('330 -> 331')!.end).toEqual({ year: 331 });
    expect(parseWorldSpan('330..331')!.end).toEqual({ year: 331 });
    expect(parseWorldSpan('')).toBeNull();
    expect(parseWorldSpan('331 → 330')).toBeUndefined();
    expect(parseWorldSpan('soon')).toBeUndefined();
  });

  it('maps partial dates to day ranges', () => {
    const march = spanDays({ start: { year: 1, month: 3 }, end: null }, DEFAULT_CALENDAR);
    expect(march.end - march.start + 1).toBe(31);
    const year = spanDays({ start: { year: 1 }, end: null }, COAST);
    expect(year.end - year.start + 1).toBe(100);
    expect(dateFromDay(dayNumber({ year: 330, month: 3, day: 9 }, COAST), COAST)).toEqual({ year: 330, month: 3, day: 9 });
    expect(dateFromDay(dayNumber({ year: -2, month: 2, day: 1 }, COAST), COAST)).toEqual({ year: -2, month: 2, day: 1 });
  });

  it('formats dates and spans for display', () => {
    expect(formatWorldDate({ year: 330, month: 3, day: 9 }, DEFAULT_CALENDAR)).toBe('9 Mar 330');
    expect(formatWorldDate({ year: 1, approx: true }, COAST, { suffix: true })).toBe('c. 1 CR');
    // A project's own month names are shown in full; the default calendar abbreviates.
    expect(formatWorldDate({ year: 1, month: 3, day: 2 }, COAST)).toBe('2 Salt 1');
    expect(formatWorldSpan({ start: { year: 330, month: 3, day: 3 }, end: { year: 330, month: 3, day: 9 } }, DEFAULT_CALENDAR)).toBe('3 – 9 Mar 330');
    expect(serializeWorldSpan({ start: { year: 330, month: 3, day: 3 }, end: { year: 330, month: 4 } })).toBe('330-03-03 → 330-04');
  });

  it('formats durations', () => {
    expect(formatDuration(1, DEFAULT_CALENDAR)).toBe('1 day');
    expect(formatDuration(34, DEFAULT_CALENDAR)).toBe('34 days');
    expect(formatDuration(120, DEFAULT_CALENDAR)).toBe('4 mo');
    expect(formatDuration(365 * 3 + 120, DEFAULT_CALENDAR)).toBe('3 yrs 4 mo');
  });

  it('falls back to the default months for invalid calendars', () => {
    expect(resolveCalendar(undefined).months.length).toBe(12);
    expect(resolveCalendar({ months: [{ name: '', days: 0 }] }).months.length).toBe(12);
    expect(resolveCalendar({ name: ' Reckoning ', months: [{ name: '', days: 20 }] })).toEqual({ name: 'Reckoning', months: [{ name: 'Month 1', days: 20 }] });
  });
});
