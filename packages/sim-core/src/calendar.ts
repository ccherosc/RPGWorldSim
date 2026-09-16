import { assert, assertInt, divFloor, mod } from '@rpgsim/shared';
import { z } from 'zod';

/**
 * Time model.
 *
 * The base unit is the *tick*, which is one simulated second. Everything the
 * simulation schedules is an integer tick count, so time arithmetic is exact
 * and there is no floating-point drift over a simulated year.
 *
 * Tick 0 is the first instant of day 1 of the first month of `epochYear`.
 *
 * A simulated year is 31,104,000 ticks with the default calendar, comfortably
 * inside `Number.MAX_SAFE_INTEGER` (about 285 million simulated years).
 */
export type Tick = number;

export const TICKS_PER_SECOND = 1;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;

export const TICKS_PER_MINUTE = SECONDS_PER_MINUTE * TICKS_PER_SECOND;
export const TICKS_PER_HOUR = MINUTES_PER_HOUR * TICKS_PER_MINUTE;
export const TICKS_PER_DAY = HOURS_PER_DAY * TICKS_PER_HOUR;

/** Convenience constructors so call sites read as durations, not magic numbers. */
export const minutes = (n: number): Tick => Math.round(n * TICKS_PER_MINUTE);
export const hours = (n: number): Tick => Math.round(n * TICKS_PER_HOUR);
export const days = (n: number): Tick => Math.round(n * TICKS_PER_DAY);

export const MonthSchema = z.object({
  name: z.string().min(1),
  days: z.number().int().positive(),
  season: z.string().min(1),
});

export const CalendarSchema = z.object({
  id: z.string().min(1),
  epochYear: z.number().int(),
  months: z.array(MonthSchema).min(1),
  weekdayNames: z.array(z.string().min(1)).min(1),
});

export type MonthConfig = z.infer<typeof MonthSchema>;
export type CalendarConfig = z.infer<typeof CalendarSchema>;

/**
 * The world's calendar: twelve thirty-day months.
 *
 * This deliberately is not the Gregorian calendar. Uniform months remove leap
 * years and irregular month lengths from every agricultural, demographic and
 * scheduling calculation, and the invented month names make it obvious at a
 * glance that world dates are not Earth dates.
 *
 * `data/world/calendar.json` holds the same calendar as data, and the simulator
 * app loads it from there. This constant is the built-in default used by tests
 * and by any world constructed without one. A test asserts the two agree, so
 * they cannot drift apart; sim-core itself never touches the filesystem.
 */
export const DEFAULT_CALENDAR: CalendarConfig = Object.freeze({
  id: 'world-zero-standard',
  epochYear: 1200,
  months: [
    { name: 'Deepfrost', days: 30, season: 'winter' },
    { name: 'Thawmoon', days: 30, season: 'winter' },
    { name: 'Seedtide', days: 30, season: 'spring' },
    { name: 'Blossom', days: 30, season: 'spring' },
    { name: 'Greenreach', days: 30, season: 'spring' },
    { name: 'Highsun', days: 30, season: 'summer' },
    { name: 'Haymoon', days: 30, season: 'summer' },
    { name: 'Goldfall', days: 30, season: 'summer' },
    { name: 'Harvestide', days: 30, season: 'autumn' },
    { name: 'Emberfall', days: 30, season: 'autumn' },
    { name: 'Dimming', days: 30, season: 'autumn' },
    { name: 'Frostwane', days: 30, season: 'winter' },
  ],
  weekdayNames: ['Sunsday', 'Moonsday', 'Tilsday', 'Midweek', 'Thundsday', 'Faersday', 'Restday'],
}) as CalendarConfig;

/** A tick decomposed into human-readable calendar fields. */
export interface WorldDateTime {
  /** Absolute day index since epoch (day 0 is the first day of `epochYear`). */
  readonly dayIndex: number;
  readonly year: number;
  /** 1-based index into `calendar.months`. */
  readonly month: number;
  readonly monthName: string;
  readonly season: string;
  /** 1-based day within the month. */
  readonly day: number;
  readonly weekday: string;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export function daysPerYear(calendar: CalendarConfig): number {
  let total = 0;
  for (const month of calendar.months) total += month.days;
  return total;
}

export function ticksPerYear(calendar: CalendarConfig): number {
  return daysPerYear(calendar) * TICKS_PER_DAY;
}

/** Decompose an absolute tick into calendar fields. */
export function tickToDateTime(tick: Tick, calendar: CalendarConfig = DEFAULT_CALENDAR): WorldDateTime {
  assertInt(tick, 'tick must be an integer');
  assert(tick >= 0, 'tick must not be negative', { tick });

  const dayIndex = divFloor(tick, TICKS_PER_DAY);
  const timeOfDay = mod(tick, TICKS_PER_DAY);

  const yearLength = daysPerYear(calendar);
  const year = calendar.epochYear + divFloor(dayIndex, yearLength);

  let dayOfYear = mod(dayIndex, yearLength);
  let monthIndex = 0;
  while (monthIndex < calendar.months.length) {
    const month = calendar.months[monthIndex] as MonthConfig;
    if (dayOfYear < month.days) break;
    dayOfYear -= month.days;
    monthIndex++;
  }
  const month = calendar.months[monthIndex] as MonthConfig;

  return {
    dayIndex,
    year,
    month: monthIndex + 1,
    monthName: month.name,
    season: month.season,
    day: dayOfYear + 1,
    weekday: calendar.weekdayNames[mod(dayIndex, calendar.weekdayNames.length)] as string,
    hour: divFloor(timeOfDay, TICKS_PER_HOUR),
    minute: divFloor(mod(timeOfDay, TICKS_PER_HOUR), TICKS_PER_MINUTE),
    second: mod(timeOfDay, TICKS_PER_MINUTE),
  };
}

/** Inverse of `tickToDateTime`. Month and day are 1-based. */
export function dateTimeToTick(
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  calendar: CalendarConfig = DEFAULT_CALENDAR,
): Tick {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = parts;
  assert(
    month >= 1 && month <= calendar.months.length,
    'month is outside the calendar',
    { month, months: calendar.months.length },
  );
  const monthConfig = calendar.months[month - 1] as MonthConfig;
  assert(day >= 1 && day <= monthConfig.days, 'day is outside the month', {
    day,
    monthName: monthConfig.name,
    days: monthConfig.days,
  });
  assert(hour >= 0 && hour < HOURS_PER_DAY, 'hour is outside the day', { hour });
  assert(minute >= 0 && minute < MINUTES_PER_HOUR, 'minute is outside the hour', { minute });
  assert(second >= 0 && second < SECONDS_PER_MINUTE, 'second is outside the minute', { second });
  assert(year >= calendar.epochYear, 'year precedes the calendar epoch', {
    year,
    epochYear: calendar.epochYear,
  });

  let dayIndex = (year - calendar.epochYear) * daysPerYear(calendar);
  for (let i = 0; i < month - 1; i++) dayIndex += (calendar.months[i] as MonthConfig).days;
  dayIndex += day - 1;

  return (
    dayIndex * TICKS_PER_DAY +
    hour * TICKS_PER_HOUR +
    minute * TICKS_PER_MINUTE +
    second * TICKS_PER_SECOND
  );
}

/** `Seedtide 4, 1200 (Midweek) 06:32:10` */
export function formatDateTime(tick: Tick, calendar: CalendarConfig = DEFAULT_CALENDAR): string {
  const dt = tickToDateTime(tick, calendar);
  return (
    `${dt.monthName} ${dt.day}, ${dt.year} (${dt.weekday}) ` +
    `${pad2(dt.hour)}:${pad2(dt.minute)}:${pad2(dt.second)}`
  );
}

/** `1200-03-04 06:32` - compact, sortable, for logs and event feeds. */
export function formatTimestamp(tick: Tick, calendar: CalendarConfig = DEFAULT_CALENDAR): string {
  const dt = tickToDateTime(tick, calendar);
  return (
    `${dt.year}-${pad2(dt.month)}-${pad2(dt.day)} ` +
    `${pad2(dt.hour)}:${pad2(dt.minute)}:${pad2(dt.second)}`
  );
}

/** Tick of the next occurrence of a wall-clock time at or after `fromTick`. */
export function nextTimeOfDay(fromTick: Tick, hour: number, minute = 0, second = 0): Tick {
  const target = hour * TICKS_PER_HOUR + minute * TICKS_PER_MINUTE + second * TICKS_PER_SECOND;
  assert(target >= 0 && target < TICKS_PER_DAY, 'time of day is outside a day', {
    hour,
    minute,
    second,
  });
  const dayStart = divFloor(fromTick, TICKS_PER_DAY) * TICKS_PER_DAY;
  const candidate = dayStart + target;
  return candidate >= fromTick ? candidate : candidate + TICKS_PER_DAY;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
