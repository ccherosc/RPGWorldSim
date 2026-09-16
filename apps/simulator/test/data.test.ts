import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR, TICKS_PER_DAY, formatTimestamp } from '@rpgsim/sim-core';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATA_ROOT, loadCalendar } from '../src/data.ts';
import { createProbeWorld } from '../src/probe-world.ts';

/**
 * The data files are load-bearing: `DEFAULT_CALENDAR` is the built-in default
 * and `data/world/calendar.json` is what the app actually runs on. If the two
 * drift, a world built in a test and a world built by the CLI would keep
 * different time while both looking correct. These tests pin them together and
 * check that a malformed data file fails loudly at the boundary.
 */

function writeCalendar(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'rpgsim-data-'));
  mkdirSync(join(root, 'world'), { recursive: true });
  writeFileSync(join(root, 'world', 'calendar.json'), JSON.stringify(value), 'utf8');
  return root;
}

describe('world data loading', () => {
  it('loads the shipped calendar from data/', () => {
    const calendar = loadCalendar();
    expect(calendar.id).toBe('world-zero-standard');
    expect(calendar.months).toHaveLength(12);
  });

  it('resolves DATA_ROOT from the module, not the process working directory', () => {
    // A CWD-relative path would make `npm run sim` work only from the repo root.
    expect(DATA_ROOT.endsWith('data')).toBe(true);
    expect(loadCalendar(DATA_ROOT).id).toBe(loadCalendar().id);
  });

  it('keeps the data file and the in-code default identical', () => {
    expect(loadCalendar()).toEqual(DEFAULT_CALENDAR);
  });

  it('produces identical timestamps whether the calendar came from data or code', () => {
    const fromData = loadCalendar();
    for (const tick of [0, 1, 3599, TICKS_PER_DAY, 47 * TICKS_PER_DAY + 12345, 359 * TICKS_PER_DAY]) {
      expect(formatTimestamp(tick, fromData)).toBe(formatTimestamp(tick, DEFAULT_CALENDAR));
    }
  });

  it('runs a world on the loaded calendar to the same state as on the default', () => {
    const fromData = createProbeWorld({ seed: 'calendar-parity', probes: 6, calendar: loadCalendar() });
    const fromCode = createProbeWorld({ seed: 'calendar-parity', probes: 6 });
    fromData.sim.runUntil(10 * TICKS_PER_DAY);
    fromCode.sim.runUntil(10 * TICKS_PER_DAY);
    expect(fromData.sim.hash()).toBe(fromCode.sim.hash());
  });

  it('rejects a calendar whose months do not match the schema', () => {
    const root = writeCalendar({ ...DEFAULT_CALENDAR, months: [] });
    expect(() => loadCalendar(root)).toThrow(/is not a valid calendar/);
  });

  it('names the offending field when validation fails', () => {
    const root = writeCalendar({ ...DEFAULT_CALENDAR, epochYear: 'twelve hundred' });
    expect(() => loadCalendar(root)).toThrow(/epochYear/);
  });

  it('fails when the data file is missing rather than falling back silently', () => {
    const root = mkdtempSync(join(tmpdir(), 'rpgsim-empty-'));
    expect(() => loadCalendar(root)).toThrow();
  });
});
