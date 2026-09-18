import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readArchiveManifest, readEventDay } from '@rpgsim/sim-core';
import { main, parseArgs } from '../src/index.ts';

/**
 * The CLI is the only way to drive the simulation until an observer exists, so
 * its contract - exit codes, save round-trips, argument handling - is tested
 * like any other system.
 */

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const record = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  const log = vi.spyOn(console, 'log').mockImplementation(record);
  const error = vi.spyOn(console, 'error').mockImplementation(record);
  return {
    lines,
    restore: () => {
      log.mockRestore();
      error.mockRestore();
    },
  };
}

describe('parseArgs', () => {
  it('defaults every option', () => {
    const { command, options } = parseArgs(['run']);
    expect(command).toBe('run');
    expect(options).toEqual({
      world: 'village',
      seed: 'world-zero',
      days: 30,
      probes: 12,
      dir: './saves',
      key: 'autosave',
      save: false,
      every: 5,
      rewrite: false,
      propose: false,
    });
    // `archive` has no default on purpose: writing history to disk is a
    // publishing decision, so the absence of the flag has to be distinguishable
    // from a path.
    expect(options.archive).toBeUndefined();
    // `on` likewise: the day the casting is checked against defaults to the
    // last day the record actually holds, which parseArgs cannot know.
    expect(options.on).toBeUndefined();
  });

  it('reads which day the casting is checked on, and whether to fill the blanks', () => {
    expect(parseArgs(['cast', '--on', '1212-06-01']).options.on).toBe('1212-06-01');
    expect(parseArgs(['cast', '--propose']).options.propose).toBe(true);
    expect(() => parseArgs(['cast', '--on'])).toThrow(/requires a value/);
  });

  it('reads where the durable history goes, and whether it may be replaced', () => {
    expect(parseArgs(['run', '--archive', 'C:/tmp/arch']).options.archive).toBe('C:/tmp/arch');
    expect(parseArgs(['run', '--archive', 'x', '--rewrite']).options.rewrite).toBe(true);
    expect(() => parseArgs(['run', '--archive'])).toThrow(/requires a value/);
  });

  it('reads values and flags', () => {
    const { options } = parseArgs([
      'run',
      '--seed',
      'my-seed',
      '--days',
      '3',
      '--probes',
      '4',
      '--dir',
      'C:/tmp/saves',
      '--key',
      'slot-1',
      '--every',
      '0',
      '--save',
    ]);
    expect(options).toMatchObject({
      seed: 'my-seed',
      days: 3,
      probes: 4,
      dir: 'C:/tmp/saves',
      key: 'slot-1',
      every: 0,
      save: true,
    });
  });

  it('treats a missing command as help', () => {
    expect(parseArgs([]).command).toBe('help');
  });

  it('reads the world name, and only a name it knows', () => {
    // The default is the village on purpose: the thing somebody types
    // `npm run sim -- run` to see is the world the project is about, not the
    // Phase 0 harness. `probe` has to be asked for.
    expect(parseArgs(['run']).options.world).toBe('village');
    expect(parseArgs(['run', '--world', 'probe']).options.world).toBe('probe');
    expect(() => parseArgs(['run', '--world', 'hamlet'])).toThrow(/must be one of/);
    expect(() => parseArgs(['run', '--world'])).toThrow(/requires a value/);
  });

  it('rejects bad input rather than guessing', () => {
    expect(() => parseArgs(['run', '--nope'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['run', '--seed'])).toThrow(/requires a value/);
    expect(() => parseArgs(['run', '--days', '--seed'])).toThrow(/requires a value/);
    expect(() => parseArgs(['run', '--days', 'many'])).toThrow(/non-negative integer/);
    expect(() => parseArgs(['run', '--days', '-1'])).toThrow(/non-negative integer/);
    expect(() => parseArgs(['run', '--days', '1.5'])).toThrow(/non-negative integer/);
  });
});

describe('main', () => {
  let captured: ReturnType<typeof captureConsole>;
  let directory: string;

  beforeEach(() => {
    captured = captureConsole();
    directory = mkdtempSync(join(tmpdir(), 'rpgsim-cli-'));
  });

  afterEach(() => {
    captured.restore();
    rmSync(directory, { recursive: true, force: true });
  });

  it('prints usage and succeeds for help', () => {
    expect(main(['help'])).toBe(0);
    expect(captured.lines.join('\n')).toContain('headless driver');
  });

  it('fails with a usage message for an unknown command', () => {
    expect(main(['frobnicate'])).toBe(2);
    expect(captured.lines.join('\n')).toContain('Unknown command');
  });

  it('fails with a usage message for a bad option', () => {
    expect(main(['run', '--days', 'lots'])).toBe(2);
  });

  it('runs a world and reports a state hash', () => {
    expect(
      main(['run', '--world', 'probe', '--seed', 'cli-seed', '--days', '2', '--probes', '3']),
    ).toBe(0);
    expect(captured.lines.join('\n')).toMatch(/state hash:\s+[0-9a-f]{16}/);
  });

  it('runs, saves and resumes to the same state as an uninterrupted run', () => {
    const args = [
      '--world',
      'probe',
      '--seed',
      'cli-seed',
      '--probes',
      '4',
      '--dir',
      directory,
      '--every',
      '0',
    ];

    expect(main(['run', ...args, '--days', '6'])).toBe(0);
    const straightThrough = hashFrom(captured.lines);

    captured.lines.length = 0;
    expect(main(['run', ...args, '--days', '2', '--save', '--key', 'slot'])).toBe(0);

    captured.lines.length = 0;
    expect(main(['resume', ...args, '--days', '4', '--key', 'slot'])).toBe(0);
    expect(hashFrom(captured.lines)).toBe(straightThrough);
  });

  it('reports determinism verification and exits zero when it passes', () => {
    expect(
      main(['verify', '--world', 'probe', '--seed', 'cli-seed', '--days', '4', '--probes', '3']),
    ).toBe(0);
    const output = captured.lines.join('\n');
    expect(output).toContain('All determinism checks passed.');
    expect(output).not.toContain('FAIL');
  });

  /**
   * The village, end to end, through the same door a person uses.
   *
   * Short on purpose -- two days of eighty-six villagers is enough to prove the
   * data files load, the world builds, the invariants hold and a save round-
   * trips. What the village *does* over a longer run is `verify`'s job, and
   * village.test.ts runs it.
   */
  it('builds, saves and resumes the village from its data files', () => {
    const args = ['--seed', 'cli-seed', '--dir', directory, '--every', '0'];

    expect(main(['run', ...args, '--days', '2'])).toBe(0);
    const straightThrough = hashFrom(captured.lines);
    expect(captured.lines.join('\n')).toMatch(/people=\d+ +households=\d+/);

    captured.lines.length = 0;
    expect(main(['run', ...args, '--days', '1', '--save', '--key', 'village'])).toBe(0);

    captured.lines.length = 0;
    expect(main(['resume', ...args, '--days', '1', '--key', 'village'])).toBe(0);
    expect(hashFrom(captured.lines)).toBe(straightThrough);
  });

  /**
   * The durable history, end to end.
   *
   * The manifest's per-day hash is the evidence the launch freeze is checked
   * against (docs/CHRONICLE_V1.md slice 7), so the thing worth proving here is
   * that the hash filed against the last day is the hash the run actually
   * finished on -- not merely that some hash was written.
   */
  it('writes one archived day per simulated day, and refuses to overwrite one', () => {
    const archiveRoot = join(directory, 'history');
    const args = ['run', '--seed', 'arch-seed', '--every', '0', '--archive', archiveRoot];

    expect(main([...args, '--days', '2'])).toBe(0);
    const finalHash = hashFrom(captured.lines);

    const manifest = readArchiveManifest(archiveRoot);
    expect(manifest?.world).toBe('village');
    // The run ended on its own terms, so the archive says it is finished. A
    // publisher refuses to print from one that does not.
    expect(manifest?.complete).toBe(true);
    expect(manifest?.days.map((day) => day.key)).toEqual(['1200-04-01', '1200-04-02']);
    expect(manifest?.days.at(-1)?.hash).toBe(finalHash);
    expect(manifest?.days.every((day) => day.events > 0)).toBe(true);

    // The founding is in there.
    //
    // This is the part that is impossible to recover after the fact: worldgen
    // announces every person and every household as it creates them, so an
    // archive attached to the finished world would hold a village of strangers
    // -- correct in every other respect, and useless to a chronicle that has to
    // say who anybody is. Counting `npc.created` is the cheapest proof that the
    // sink was listening before the village existed.
    const firstDay = readEventDay(archiveRoot, '1200-04-01');
    const opening = firstDay.filter((e) => e.type === 'world.generated');
    expect(opening).toHaveLength(1);
    const counts = opening[0]?.data as { people: number; households: number };
    expect(firstDay.filter((e) => e.type === 'npc.created')).toHaveLength(counts.people);
    expect(firstDay.filter((e) => e.type === 'society.household-founded')).toHaveLength(
      counts.households,
    );

    // Every event filed under a day happened during it. A dateline depends on it.
    for (const day of manifest?.days ?? []) {
      const events = readEventDay(archiveRoot, day.key);
      expect(events).toHaveLength(day.events);
      expect(events.every((e) => e.tick >= day.firstTick && e.tick <= day.lastTick)).toBe(true);
    }

    captured.lines.length = 0;
    expect(() => main([...args, '--days', '2'])).toThrow(/already holds 1200-04-01/);

    captured.lines.length = 0;
    expect(main([...args, '--days', '2', '--rewrite'])).toBe(0);
    expect(hashFrom(captured.lines)).toBe(finalHash);
  });
});

function hashFrom(lines: readonly string[]): string {
  const line = lines.find((text) => text.includes('state hash:'));
  expect(line, 'CLI did not print a state hash').toBeDefined();
  return (line as string).split('state hash:')[1]?.trim() as string;
}
