import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANNALS_DIRECTORY, PEOPLE_FILE, PeopleRegister } from '@rpgsim/chronicle';
import { readEventDay } from '@rpgsim/sim-core';
import { main } from '../src/index.ts';

/**
 * The annals, against a real village rather than hand-built events.
 *
 * The claim this slice makes is a strong one and it is worth stating plainly:
 * **the day archive is a cache and the annals are the record.** Delete the
 * archive, rebuild it from the seed, distil it again, and the annals must come
 * out byte for byte the same. If that holds, eighty megabytes of JSONL a year
 * never has to be kept, never has to be committed, and never has to be trusted.
 * If it does not hold, the archive is load-bearing and the whole design is
 * wrong. So it is tested directly, not reasoned about.
 */

const DAYS = 3;
const SEED = 'annals';

let directory: string;
let captured: { lines: string[]; restore: () => void };

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

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sim-annals-'));
  captured = captureConsole();
});

afterEach(() => {
  captured.restore();
  rmSync(directory, { recursive: true, force: true });
});

/** Run the village into an archive, then distil that archive into a record. */
function remember(archive: string, annals: string, days = DAYS): void {
  expect(main(['run', '--seed', SEED, '--days', String(days), '--every', '0', '--archive', archive])).toBe(0);
  expect(main(['annals', '--archive', archive, '--annals', annals])).toBe(0);
}

const read = (root: string, ...parts: string[]): string =>
  readFileSync(join(root, ...parts), 'utf8');

const annalYear = (root: string): string => read(root, ANNALS_DIRECTORY, '1200.txt');

/** Every annal line, split into cells, header skipped. */
function annalRows(root: string): string[][] {
  return annalYear(root)
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split('\t'));
}

describe('distilling a village into its memory', () => {
  it('writes down everybody the village announced, once each', () => {
    const archive = join(directory, 'archive');
    const record = join(directory, 'record');
    remember(archive, record);

    const founding = readEventDay(archive, '1200-04-01');
    const created = founding.filter((event) => event.type === 'npc.created');
    const people = PeopleRegister.parse(read(record, PEOPLE_FILE));

    expect(created.length).toBeGreaterThan(50);
    expect(people.size).toBe(created.length);
    // Same people, same order, and every one of them under a roof: worldgen
    // announces a person before the house that holds them, so an empty family
    // column here would mean the second pass never ran.
    expect(people.records().map((person) => person.id)).toEqual(
      created.map((event) => (event.data as { npc: string }).npc),
    );
    expect(people.records().every((person) => person.family !== null)).toBe(true);
    expect(new Set(people.records().map((person) => person.slug)).size).toBe(people.size);
  });

  it('keeps the founding and throws the walking away', () => {
    const archive = join(directory, 'archive');
    const record = join(directory, 'record');
    remember(archive, record);

    const types = new Set(annalRows(record).map((row) => row[2] as string));
    expect(types.has('npc.created')).toBe(true);
    expect(types.has('society.household-founded')).toBe(true);
    // The mechanics of a day are nine tenths of the archive and none of the
    // memory. A village does not remember getting out of bed.
    expect(types.has('npc.woke')).toBe(false);
    expect(types.has('travel.departed')).toBe(false);
    expect(types.has('travel.arrived')).toBe(false);
    expect(types.has('npc.went-to-bed')).toBe(false);
  });

  it('is a small fraction of the archive it came from', () => {
    const archive = join(directory, 'archive');
    const record = join(directory, 'record');
    remember(archive, record);

    const archived = readdirSync(join(archive, 'days')).reduce(
      (total, key) => total + read(archive, 'days', key, 'events.jsonl').length,
      0,
    );
    const remembered = annalYear(record).length + read(record, PEOPLE_FILE).length;
    expect(remembered * 10).toBeLessThan(archived);
  });

  it('gives every line an event that is really in the day it names', () => {
    // This is the "every sentence traces to an event id" bar from
    // docs/CHRONICLE.md, met at the memory layer rather than only at the page.
    const archive = join(directory, 'archive');
    const record = join(directory, 'record');
    remember(archive, record);

    const byDay = new Map<string, Set<number>>();
    for (const row of annalRows(record)) {
      const date = row[0] as string;
      if (!byDay.has(date)) {
        byDay.set(date, new Set(readEventDay(archive, date).map((event) => event.id)));
      }
      const id = Number((row[5] as string).slice(1));
      expect(byDay.get(date)?.has(id), `${date} #${id}`).toBe(true);
    }
    expect(byDay.size).toBe(DAYS);
  });

  it('names people by a handle the people file explains', () => {
    const archive = join(directory, 'archive');
    const record = join(directory, 'record');
    remember(archive, record);

    const known = new Set(PeopleRegister.parse(read(record, PEOPLE_FILE)).records().map((p) => p.slug));
    for (const row of annalRows(record)) {
      const who = row[3] as string;
      if (who === '-') continue;
      for (const slug of who.split(',')) expect(known.has(slug), slug).toBe(true);
    }
  });
});

describe('the archive is a cache, the annals are the record', () => {
  it('rebuilds byte-identically after the archive is destroyed', () => {
    const first = join(directory, 'record-a');
    const second = join(directory, 'record-b');
    const archive = join(directory, 'archive');

    remember(archive, first);
    const people = read(first, PEOPLE_FILE);
    const year = annalYear(first);

    // Burn it down. Everything the record needs to be rebuilt is the seed.
    rmSync(archive, { recursive: true, force: true });
    remember(archive, second);

    expect(read(second, PEOPLE_FILE)).toBe(people);
    expect(annalYear(second)).toBe(year);
  });

  it('adds later days without touching the ones already written', () => {
    const archive = join(directory, 'archive');
    const record = join(directory, 'record');
    remember(archive, record, 1);
    const afterOneDay = annalYear(record);
    const peopleAfterOneDay = read(record, PEOPLE_FILE);

    // A second run, three days this time, into a fresh archive and the same
    // record. Compared as a byte prefix rather than by re-parsing: a rewrite
    // that happened to round-trip to the same values would still be a rewrite.
    rmSync(archive, { recursive: true, force: true });
    remember(archive, record, DAYS);

    expect(annalYear(record).startsWith(afterOneDay)).toBe(true);
    expect(read(record, PEOPLE_FILE)).toBe(peopleAfterOneDay);
    expect(annalYear(record).length).toBeGreaterThan(afterOneDay.length);
  });

  it('distils the same archive twice without saying anything twice', () => {
    const archive = join(directory, 'archive');
    const record = join(directory, 'record');
    remember(archive, record);
    const before = annalYear(record);
    const people = read(record, PEOPLE_FILE);

    expect(main(['annals', '--archive', archive, '--annals', record])).toBe(0);
    expect(annalYear(record)).toBe(before);
    expect(read(record, PEOPLE_FILE)).toBe(people);
  });
});

describe('what the annals command refuses', () => {
  it('needs somewhere to read from and somewhere to write to', () => {
    expect(main(['annals', '--annals', join(directory, 'record')])).toBe(2);
    expect(captured.lines.join('\n')).toMatch(/needs both --archive .* and --annals/);
  });

  it('refuses an archive that is not there', () => {
    expect(
      main(['annals', '--archive', join(directory, 'nothing'), '--annals', join(directory, 'record')]),
    ).toBe(1);
    expect(captured.lines.join('\n')).toMatch(/no archive at/);
  });

  it('refuses an archive whose run never finished', () => {
    // Half a day written into a permanent record stays half a day forever.
    const archive = join(directory, 'archive');
    expect(main(['run', '--seed', SEED, '--days', '1', '--every', '0', '--archive', archive])).toBe(0);

    const manifest = join(archive, 'manifest.json');
    const text = readFileSync(manifest, 'utf8');
    expect(text).toMatch(/"complete":\s*true/);
    writeFileSync(manifest, text.replace(/"complete":\s*true/, '"complete": false'), 'utf8');

    expect(main(['annals', '--archive', archive, '--annals', join(directory, 'record')])).toBe(1);
    expect(captured.lines.join('\n')).toMatch(/never closed/);
  });
});
