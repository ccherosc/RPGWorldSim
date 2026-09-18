import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SimAssertionError } from '@rpgsim/shared';
import { type ArchiveManifest, readArchiveManifest } from '@rpgsim/sim-core';
import { main as sim } from '@rpgsim/simulator';
import { main as press } from '../src/cli.ts';
import { DATA_ROOT, loadPublication } from '../src/data.ts';
import {
  type FrozenHistory,
  checkFrozen,
  frozenPath,
  loadFrozenHistory,
  writeFrozenHistory,
} from '../src/freeze.ts';

/**
 * The freeze, which is the only thing standing between a published day and a
 * rewrite of it.
 *
 * Every publish regenerates the village from the seed, so a change to worldgen
 * or to a balance number in `data/world/` would reprint days people have
 * already read -- with different weather, different names, a different paper --
 * and every page would still look right. The only way to catch that is to have
 * written the day's world hash down at the time and to compare.
 *
 * Which makes this a check that has to fail correctly, not merely pass
 * correctly. Most of the cases below are the ways it could pass while checking
 * nothing: no hashes behind a freeze, hashes left behind after one, a day in
 * the file that is not in the archive. A green tick over an unguarded archive
 * is worse than no tick at all.
 */

const DAYS = 3;
const SEED = 'world-zero';

let root: string;
let archive: string;
let data: string;
let manifest: ArchiveManifest;
let frozenThrough: string;

/** A data directory holding nothing but the wording, with the freeze moved. */
function dataRootFrozenTo(through: string | null): string {
  const dir = mkdtempSync(join(root, 'data-'));
  mkdirSync(join(dir, 'chronicle'), { recursive: true });
  const config = { ...loadPublication().config, frozenThrough: through };
  writeFileSync(join(dir, 'chronicle', 'publication.json'), JSON.stringify(config, null, 2), 'utf8');
  return dir;
}

/** Run the press with both output streams captured, and return what it said. */
function spoken(argv: readonly string[]): { code: number; said: string } {
  const said: string[] = [];
  const keep = (...parts: unknown[]): void => {
    said.push(parts.map((part) => String(part)).join(' '));
  };
  const out = vi.spyOn(console, 'log').mockImplementation(keep);
  const err = vi.spyOn(console, 'error').mockImplementation(keep);
  try {
    return { code: press(argv), said: said.join('|') };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'press-frozen-'));
  archive = join(root, 'archive');

  const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    expect(
      sim(['run', '--seed', SEED, '--days', String(DAYS), '--every', '0', '--archive', archive]),
    ).toBe(0);
  } finally {
    quiet.mockRestore();
  }

  manifest = readArchiveManifest(archive) as ArchiveManifest;
  frozenThrough = manifest.days[DAYS - 2]?.key as string;
  data = dataRootFrozenTo(frozenThrough);
  writeFrozenHistory({ archive, frozenThrough, dataRoot: data });
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('writing the hashes down', () => {
  it('takes one hash per published day and stops at the freeze', () => {
    const frozen = loadFrozenHistory(data);
    expect(Object.keys(frozen.days)).toEqual(manifest.days.slice(0, DAYS - 1).map((day) => day.key));
    for (const day of manifest.days.slice(0, DAYS - 1)) {
      expect(frozen.days[day.key], day.key).toBe(day.hash);
    }
  });

  it('writes hashes that are not all the same', () => {
    // Guards every comparison below. If the driver handed the archive one hash
    // for the whole run, a rewritten day would still match its neighbour's.
    const values = Object.values(loadFrozenHistory(data).days);
    expect(new Set(values).size).toBe(values.length);
  });

  it('writes a note, because somebody will open the file and wonder', () => {
    expect(loadFrozenHistory(data).note).toMatch(/publish/);
  });

  it('refuses a freeze date the archive never reached', () => {
    expect(() => writeFrozenHistory({ archive, frozenThrough: '1199-12-30', dataRoot: data })).toThrow(
      SimAssertionError,
    );
  });

  it('refuses an archive that is not there', () => {
    expect(() =>
      writeFrozenHistory({ archive: join(root, 'nowhere'), frozenThrough, dataRoot: data }),
    ).toThrow(/no archive to freeze from/);
  });
});

describe('checking a rebuild against them', () => {
  it('passes when the rebuilt archive still agrees', () => {
    const report = checkFrozen({ manifest, frozen: loadFrozenHistory(data), frozenThrough });
    expect(report).toEqual({ checked: DAYS - 1, idle: false });
  });

  it('ignores the days past the freeze, which are not published yet', () => {
    // The freeze is a floor under the archive, not a ceiling on the run: the
    // village keeps going, and today's unfrozen day has nothing to compare to.
    expect(manifest.days).toHaveLength(DAYS);
    expect(checkFrozen({ manifest, frozen: loadFrozenHistory(data), frozenThrough }).checked).toBe(
      DAYS - 1,
    );
  });

  it('fails when a published day comes back with a different world', () => {
    const frozen = loadFrozenHistory(data);
    const first = Object.keys(frozen.days)[0] as string;
    const tampered = { ...frozen, days: { ...frozen.days, [first]: 'deadbeefdeadbeef' } };
    expect(() => checkFrozen({ manifest, frozen: tampered, frozenThrough })).toThrow(
      /has been rewritten/,
    );
  });

  it('fails when a rebuild loses a day it had published', () => {
    const short: ArchiveManifest = { ...manifest, days: manifest.days.slice(1) };
    expect(() =>
      checkFrozen({ manifest: short, frozen: loadFrozenHistory(data), frozenThrough }),
    ).toThrow(/missing a frozen day/);
  });

  it('fails when a published day was never frozen at all', () => {
    // The gap that would otherwise be invisible: a day inside the published
    // window with no hash written for it is a day nothing is guarding.
    const frozen = loadFrozenHistory(data);
    const first = Object.keys(frozen.days)[0] as string;
    const days = { ...frozen.days };
    delete days[first];
    expect(() => checkFrozen({ manifest, frozen: { ...frozen, days }, frozenThrough })).toThrow(
      /nobody froze/,
    );
  });

  it('fails when the file freezes a day the site does not publish', () => {
    const frozen = loadFrozenHistory(data);
    const beyond = manifest.days[DAYS - 1]?.key as string;
    const days = { ...frozen.days, [beyond]: 'whatever' };
    expect(() => checkFrozen({ manifest, frozen: { ...frozen, days }, frozenThrough })).toThrow(
      /days the site does not publish/,
    );
  });

  it('fails when a frozen day was archived without a hash', () => {
    const unsealed: ArchiveManifest = {
      ...manifest,
      days: manifest.days.map((day, at) => (at === 0 ? { ...day, hash: null } : day)),
    };
    expect(() =>
      checkFrozen({ manifest: unsealed, frozen: loadFrozenHistory(data), frozenThrough }),
    ).toThrow(/without a hash/);
  });

  it('fails when the freeze is set and nothing is written down', () => {
    expect(() => checkFrozen({ manifest, frozen: { days: {} }, frozenThrough })).toThrow(
      /no hashes are committed/,
    );
  });

  it('fails when hashes are left behind after the freeze is lifted', () => {
    // Otherwise lifting a freeze would leave a file that looks like protection
    // and checks nothing.
    expect(() =>
      checkFrozen({ manifest, frozen: loadFrozenHistory(data), frozenThrough: null }),
    ).toThrow(/nothing is frozen/);
  });

  it('checks nothing, and says so, while nothing is frozen', () => {
    expect(checkFrozen({ manifest, frozen: { days: {} }, frozenThrough: null })).toEqual({
      checked: 0,
      idle: true,
    });
  });
});

describe('the file on disk', () => {
  it('reads an absent file as an empty history', () => {
    // Before launch there is nothing to freeze, and a missing file is the
    // correct state rather than a fault.
    expect(loadFrozenHistory(dataRootFrozenTo(null))).toEqual({ days: {} });
  });

  it('reports the path when the file is malformed', () => {
    const bad = dataRootFrozenTo(frozenThrough);
    writeFileSync(frozenPath(bad), JSON.stringify({ days: { '1200-04-01': 1 } }), 'utf8');
    expect(() => loadFrozenHistory(bad)).toThrow(/is not a valid frozen history/);
  });

  it('refuses a key that is not a day', () => {
    const bad = dataRootFrozenTo(frozenThrough);
    writeFileSync(frozenPath(bad), JSON.stringify({ days: { yesterday: 'x' } }), 'utf8');
    expect(() => loadFrozenHistory(bad)).toThrow(/is not a valid frozen history/);
  });

  it('round-trips through JSON as written', () => {
    const written: unknown = JSON.parse(readFileSync(frozenPath(data), 'utf8'));
    expect(loadFrozenHistory(data).days).toEqual((written as FrozenHistory).days);
  });

  it('ships with nothing frozen, because the village has not launched', () => {
    // The day this turns red is the day the freeze goes on, and on that day the
    // committed hashes and `frozenThrough` have to be set together.
    const shipped = loadPublication(DATA_ROOT);
    expect(
      checkFrozen({
        manifest,
        frozen: loadFrozenHistory(DATA_ROOT),
        frozenThrough: shipped.frozenThrough,
      }).idle,
    ).toBe(shipped.frozenThrough === null);
  });
});

describe('the freeze from the command line', () => {
  it('checks the archive and says how many days it checked', () => {
    const { code, said } = spoken(['freeze', '--archive', archive, '--data', data]);
    expect(code).toBe(0);
    expect(said).toContain(`${DAYS - 1} published days still match`);
  });

  it('says plainly that nothing is frozen yet', () => {
    const { code, said } = spoken(['freeze', '--archive', archive, '--data', dataRootFrozenTo(null)]);
    expect(code).toBe(0);
    expect(said).toContain('nothing is frozen yet');
  });

  it('will not write hashes for a freeze nobody has set', () => {
    const open = dataRootFrozenTo(null);
    const { code, said } = spoken(['freeze', '--archive', archive, '--data', open, '--write']);
    expect(code).toBe(2);
    expect(said).toContain('set frozenThrough');
    expect(loadFrozenHistory(open)).toEqual({ days: {} });
  });

  it('refuses to check an archive that is not there', () => {
    const { code, said } = spoken(['freeze', '--archive', join(root, 'nowhere'), '--data', data]);
    expect(code).toBe(2);
    expect(said).toContain('no archive to check');
  });

  it('needs an archive to check at all', () => {
    const { code, said } = spoken(['freeze']);
    expect(code).toBe(2);
    expect(said).toContain('freeze needs --archive');
  });
});

describe('the day count from the command line', () => {
  it('prints the number and nothing else, because a shell reads it', () => {
    // `press days` is consumed by a command substitution in the workflow, so a
    // friendly extra line would be parsed as part of the number.
    const shipped = loadPublication(DATA_ROOT).config;
    const { code, said } = spoken(['days', '--today', shipped.firstPublished]);
    expect(code).toBe(0);
    expect(said).toBe(String(shipped.daysAtFirstPublished));
  });

  it('will not guess what day it is', () => {
    const { code, said } = spoken(['days']);
    expect(code).toBe(2);
    expect(said).toContain('days needs --today');
  });
});
