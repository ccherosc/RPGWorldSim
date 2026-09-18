import { describe, expect, it } from 'vitest';
import { SimAssertionError } from '@rpgsim/shared';
import { loadPublication } from '../src/data.ts';
import { civilDays, daysBetween, daysToRun } from '../src/schedule.ts';

/**
 * The one place a real-world date matters.
 *
 * Everything else in this project is a function of the seed. The publishing
 * schedule is not: the village advances one day per real day, so somebody has
 * to count real days, with real leap years in them. That counting is done in
 * integers here rather than by a `Date`, which means it can be checked against
 * a `Date` -- and a test may use one freely, because a test is not the press.
 *
 * So the same arithmetic is done twice by two unrelated methods over thirty-six
 * thousand consecutive days. If they ever disagree, one of them is wrong, and
 * the failure names the day.
 */

const DATE = (days: number): string => new Date(days * 86_400_000).toISOString().slice(0, 10);

describe('counting real days', () => {
  it('puts the epoch where the rest of the world puts it', () => {
    expect(civilDays('1970-01-01')).toBe(0);
    expect(civilDays('1970-01-02')).toBe(1);
    expect(civilDays('1969-12-31')).toBe(-1);
  });

  it('agrees with the platform date over a century of days', () => {
    // An independent oracle. `Date.UTC` has its own implementation of the
    // Gregorian calendar, so agreement over every day from 1970 to 2069 is
    // strong evidence that neither is guessing.
    for (let day = 0; day < 36_500; day += 1) {
      const date = DATE(day);
      expect(civilDays(date), date).toBe(day);
    }
  });

  it('handles the leap day, the skipped century and the kept one', () => {
    // 1900 was not a leap year. 2000 was. A schedule that gets this wrong is
    // wrong by a day for the following hundred years.
    expect(daysBetween('1900-02-28', '1900-03-01')).toBe(1);
    expect(daysBetween('2000-02-28', '2000-03-01')).toBe(2);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1);
    expect(daysBetween('2023-01-01', '2024-01-01')).toBe(365);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });

  it('counts backwards as readily as forwards', () => {
    expect(daysBetween('2026-09-18', '2026-09-11')).toBe(-7);
    expect(daysBetween('2026-09-18', '2026-09-18')).toBe(0);
  });

  it('refuses anything that is not a date', () => {
    for (const bad of ['2026-9-18', '2026-13-01', '2026-01-32', '2026-00-01', '2026-01-00', 'today', '']) {
      expect(() => civilDays(bad), bad).toThrow(SimAssertionError);
    }
  });
});

describe('how long to run the village', () => {
  // The shipped wording, with the two numbers the schedule reads pinned, so a
  // change to the launch date cannot quietly change what these cases assert.
  const config = {
    ...loadPublication().config,
    firstPublished: '2026-09-18',
    daysAtFirstPublished: 30,
  };

  it('runs the launch archive on the launch day', () => {
    expect(daysToRun(config, '2026-09-18')).toBe(30);
  });

  it('adds one village day for each day that passes', () => {
    expect(daysToRun(config, '2026-09-19')).toBe(31);
    expect(daysToRun(config, '2026-10-18')).toBe(60);
    expect(daysToRun(config, '2027-09-18')).toBe(395);
  });

  it('never shortens the history it has already published', () => {
    // The published archive is the floor. A schedule that dipped below it would
    // delete pages readers have already read.
    for (let day = 0; day < 4000; day += 1) {
      const date = DATE(civilDays(config.firstPublished) + day);
      expect(daysToRun(config, date), date).toBe(30 + day);
    }
  });

  it('refuses a date before the site went up', () => {
    // A clock that has gone backwards is a fault to report, not a length to run.
    expect(() => daysToRun(config, '2026-09-17')).toThrow(SimAssertionError);
  });

  it('starts the shipped file at the archive it shipped with', () => {
    const shipped = loadPublication().config;
    expect(daysToRun(shipped, shipped.firstPublished)).toBe(shipped.daysAtFirstPublished);
    expect(shipped.daysAtFirstPublished).toBeGreaterThan(0);
  });
});
