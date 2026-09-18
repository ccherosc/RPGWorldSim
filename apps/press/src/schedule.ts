import { assert } from '@rpgsim/shared';
import type { PublicationConfig } from './publication.ts';

/**
 * How many village days the publisher should run today.
 *
 * The village advances one day for each day that passes out here, so the
 * publisher needs to know what "today" is -- and that is the one fact in this
 * whole project that cannot be derived from the seed. So the clock is read in
 * exactly one place, `.github/workflows/publish.yml`, and handed in as a
 * string. Everything below it is integer arithmetic on two dates, which means
 * the schedule can be tested for every day of a century without waiting for
 * one of them to arrive.
 *
 * Nothing here is the village's calendar. `firstPublished` and `today` are real
 * Gregorian dates with leap years and months of twenty-eight days; the village
 * runs twelve tidy months of thirty. The two never meet: this file counts real
 * days elapsed, and the answer is a `--days` argument, not a date.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Days between 1970-01-01 and a real calendar date, negative before it.
 *
 * Howard Hinnant's `days_from_civil`, which is exact in integers and has no
 * opinion about time zones, daylight saving or locale -- three things a `Date`
 * would bring along and none of which belong anywhere near a decision about
 * how long to run a simulation.
 */
export function civilDays(date: string): number {
  const match = DATE.exec(date);
  assert(match !== null, 'that is not a real-world date', { date });
  const [, yearText, monthText, dayText] = match as RegExpExecArray;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  assert(month >= 1 && month <= 12, 'month is outside the year', { date });
  assert(day >= 1 && day <= 31, 'day is outside the month', { date });

  const shifted = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Real days from one date to another. Negative if `to` is the earlier one. */
export const daysBetween = (from: string, to: string): number => civilDays(to) - civilDays(from);

/**
 * How many village days exist as of a given real-world date.
 *
 * The site launched with a history behind it -- the village had already lived a
 * month when anybody could read about it -- so the count is that history plus
 * one day for every day since. A date before the site went up is refused rather
 * than quietly clamped: it means a clock somewhere is wrong, and running the
 * village shorter than its own published archive would delete pages readers
 * have already seen.
 */
export function daysToRun(config: PublicationConfig, today: string): number {
  const elapsed = daysBetween(config.firstPublished, today);
  assert(elapsed >= 0, 'today is before the day the site first went up', {
    today,
    firstPublished: config.firstPublished,
  });
  return config.daysAtFirstPublished + elapsed;
}
