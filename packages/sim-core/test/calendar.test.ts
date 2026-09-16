import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALENDAR,
  SimClock,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  TICKS_PER_MINUTE,
  dateTimeToTick,
  days,
  daysPerYear,
  formatDateTime,
  formatTimestamp,
  hours,
  minutes,
  nextTimeOfDay,
  tickToDateTime,
  ticksPerYear,
} from '@rpgsim/sim-core';

describe('calendar constants', () => {
  it('uses one simulated second as the base tick', () => {
    expect(TICKS_PER_MINUTE).toBe(60);
    expect(TICKS_PER_HOUR).toBe(3600);
    expect(TICKS_PER_DAY).toBe(86_400);
  });

  it('has a 360-day year that stays far inside safe integer range', () => {
    expect(daysPerYear(DEFAULT_CALENDAR)).toBe(360);
    expect(ticksPerYear(DEFAULT_CALENDAR)).toBe(31_104_000);
    // A century of simulated time must remain exactly representable.
    expect(Number.isSafeInteger(ticksPerYear(DEFAULT_CALENDAR) * 100)).toBe(true);
  });

  it('builds durations from readable helpers', () => {
    expect(minutes(30)).toBe(1_800);
    expect(hours(8)).toBe(28_800);
    expect(days(7)).toBe(604_800);
  });
});

describe('tick <-> date conversion', () => {
  it('starts the epoch at the first instant of the first month', () => {
    const dt = tickToDateTime(0);
    expect(dt).toMatchObject({
      dayIndex: 0,
      year: DEFAULT_CALENDAR.epochYear,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      monthName: 'Deepfrost',
      season: 'winter',
    });
  });

  it('decomposes a mid-year tick correctly', () => {
    // Month 3 (Seedtide), day 4, 06:32:10
    const tick = dateTimeToTick({ year: 1200, month: 3, day: 4, hour: 6, minute: 32, second: 10 });
    const dt = tickToDateTime(tick);
    expect(dt.year).toBe(1200);
    expect(dt.month).toBe(3);
    expect(dt.monthName).toBe('Seedtide');
    expect(dt.season).toBe('spring');
    expect(dt.day).toBe(4);
    expect(dt.hour).toBe(6);
    expect(dt.minute).toBe(32);
    expect(dt.second).toBe(10);
  });

  it('round-trips every day boundary of a full year', () => {
    for (let dayIndex = 0; dayIndex < daysPerYear(DEFAULT_CALENDAR); dayIndex++) {
      const tick = dayIndex * TICKS_PER_DAY;
      const dt = tickToDateTime(tick);
      expect(dateTimeToTick({ year: dt.year, month: dt.month, day: dt.day })).toBe(tick);
    }
  });

  it('round-trips across several years', () => {
    for (let year = 1200; year < 1210; year++) {
      for (const month of [1, 6, 12]) {
        for (const day of [1, 15, 30]) {
          const tick = dateTimeToTick({ year, month, day, hour: 13, minute: 45, second: 6 });
          const dt = tickToDateTime(tick);
          expect([dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second]).toEqual([
            year,
            month,
            day,
            13,
            45,
            6,
          ]);
        }
      }
    }
  });

  it('rolls into the next year exactly at the year boundary', () => {
    const lastTick = ticksPerYear(DEFAULT_CALENDAR) - 1;
    expect(tickToDateTime(lastTick)).toMatchObject({ year: 1200, month: 12, day: 30, hour: 23 });
    expect(tickToDateTime(lastTick + 1)).toMatchObject({ year: 1201, month: 1, day: 1, hour: 0 });
  });

  it('cycles weekdays with a 7-day week', () => {
    const first = tickToDateTime(0).weekday;
    expect(tickToDateTime(days(7)).weekday).toBe(first);
    expect(tickToDateTime(days(1)).weekday).not.toBe(first);
  });

  it('rejects dates outside the calendar', () => {
    expect(() => dateTimeToTick({ year: 1200, month: 13, day: 1 })).toThrow();
    expect(() => dateTimeToTick({ year: 1200, month: 1, day: 31 })).toThrow();
    expect(() => dateTimeToTick({ year: 1200, month: 1, day: 0 })).toThrow();
    expect(() => dateTimeToTick({ year: 1199, month: 1, day: 1 })).toThrow();
    expect(() => dateTimeToTick({ year: 1200, month: 1, day: 1, hour: 24 })).toThrow();
    expect(() => tickToDateTime(-1)).toThrow();
    expect(() => tickToDateTime(1.5)).toThrow();
  });
});

describe('formatting', () => {
  it('renders a readable world date', () => {
    const tick = dateTimeToTick({ year: 1200, month: 3, day: 4, hour: 6, minute: 32, second: 10 });
    expect(formatDateTime(tick)).toMatch(/^Seedtide 4, 1200 \(\w+\) 06:32:10$/);
  });

  it('renders a sortable compact timestamp', () => {
    const tick = dateTimeToTick({ year: 1200, month: 3, day: 4, hour: 6, minute: 32, second: 10 });
    expect(formatTimestamp(tick)).toBe('1200-03-04 06:32:10');
  });
});

describe('nextTimeOfDay', () => {
  it('returns today when the time has not yet passed', () => {
    const start = dateTimeToTick({ year: 1200, month: 1, day: 1, hour: 4 });
    expect(tickToDateTime(nextTimeOfDay(start, 5, 47))).toMatchObject({
      day: 1,
      hour: 5,
      minute: 47,
    });
  });

  it('rolls to tomorrow when the time has already passed', () => {
    const start = dateTimeToTick({ year: 1200, month: 1, day: 1, hour: 6 });
    expect(tickToDateTime(nextTimeOfDay(start, 5, 47))).toMatchObject({
      day: 2,
      hour: 5,
      minute: 47,
    });
  });

  it('treats the exact current instant as today, not tomorrow', () => {
    const start = dateTimeToTick({ year: 1200, month: 1, day: 1, hour: 5, minute: 47 });
    expect(nextTimeOfDay(start, 5, 47)).toBe(start);
  });

  it('rejects a time outside a day', () => {
    expect(() => nextTimeOfDay(0, 24)).toThrow();
    expect(() => nextTimeOfDay(0, -1)).toThrow();
  });
});

describe('SimClock', () => {
  it('advances forwards only', () => {
    const clock = new SimClock();
    clock.advanceTo(100);
    expect(clock.tick).toBe(100);
    clock.advanceBy(50);
    expect(clock.tick).toBe(150);
    // Advancing to the same tick is legal: many events share a tick.
    clock.advanceTo(150);
    expect(clock.tick).toBe(150);
  });

  it('refuses to move backwards, rather than silently correcting', () => {
    const clock = new SimClock();
    clock.advanceTo(100);
    expect(() => clock.advanceTo(99)).toThrow(/backwards/);
    expect(() => clock.advanceBy(-1)).toThrow();
    expect(clock.tick).toBe(100);
  });

  it('allows a backwards jump only through restore, which save loading uses', () => {
    const clock = new SimClock();
    clock.advanceTo(1_000);
    clock.restore(10);
    expect(clock.tick).toBe(10);
    expect(() => clock.restore(-1)).toThrow();
  });

  it('rejects non-integer ticks', () => {
    const clock = new SimClock();
    expect(() => clock.advanceTo(1.5)).toThrow();
  });
});
