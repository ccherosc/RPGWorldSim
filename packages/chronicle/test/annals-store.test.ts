import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANNALS_DIRECTORY,
  type AnnalLine,
  AnnalsStore,
  PEOPLE_FILE,
  type PersonRecord,
  listAnnalYears,
  yearOf,
} from '@rpgsim/chronicle';
import { type EntityId, EntityKind, makeEntityId } from '@rpgsim/sim-core';

/**
 * The store, tested for the one property that makes a record trustworthy:
 * nothing already on disk is ever rewritten.
 */

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'annals-'));
  roots.push(path);
  return path;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

const npc = (index: number): EntityId => makeEntityId(EntityKind.Npc, index);

function person(index: number, name: string): PersonRecord {
  return {
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    id: npc(index),
    name,
    sex: 'female',
    born: '1160-03-02',
    family: null,
  };
}

function line(date: string, event: number, type = 'npc.created'): AnnalLine {
  return { date, time: '06:12', type, who: 'agnes-hargrave', detail: 'something', event };
}

const read = (path: string): string => readFileSync(path, 'utf8');

describe('the record on disk', () => {
  it('writes both files with a header a human can read', () => {
    const where = root();
    const store = new AnnalsStore({ root: where });
    store.record({
      key: '1200-04-01',
      lines: [line('1200-04-01', 1)],
      people: [person(0, 'Agnes Hargrave')],
      places: [],
    });

    expect(read(join(where, PEOPLE_FILE)).split('\n')[0]).toBe('# slug\tid\tname\tsex\tborn\tfamily');
    expect(read(join(where, ANNALS_DIRECTORY, '1200.txt')).split('\n')[0]).toBe(
      '# date\ttime\tevent\twho\tdetail\tid',
    );
  });

  it('leaves yesterday untouched when today is appended', () => {
    // Compared as a byte prefix rather than by re-parsing: a rewrite that
    // happened to round-trip to the same values would still be a rewrite, and
    // the promise this record makes is about the bytes.
    const where = root();
    const store = new AnnalsStore({ root: where });
    const annals = join(where, ANNALS_DIRECTORY, '1200.txt');
    const people = join(where, PEOPLE_FILE);

    store.record({
      key: '1200-04-01',
      lines: [line('1200-04-01', 1), line('1200-04-01', 2)],
      people: [person(0, 'Agnes Hargrave')],
      places: [],
    });
    const annalsBefore = read(annals);
    const peopleBefore = read(people);

    store.record({
      key: '1200-04-02',
      lines: [line('1200-04-02', 3)],
      people: [person(1, 'Rob Tomlin')],
      places: [],
    });

    expect(read(annals).startsWith(annalsBefore)).toBe(true);
    expect(read(people).startsWith(peopleBefore)).toBe(true);
    expect(read(annals).slice(annalsBefore.length)).toContain('1200-04-02');
  });

  it('refuses a day the record has already passed', () => {
    const where = root();
    const store = new AnnalsStore({ root: where });
    store.record({ key: '1200-04-02', lines: [line('1200-04-02', 1)], people: [], places: [] });

    expect(() =>
      store.record({ key: '1200-04-01', lines: [line('1200-04-01', 2)], people: [], places: [] }),
    ).toThrow(/already hold a day at or after/);
    expect(() =>
      store.record({ key: '1200-04-02', lines: [line('1200-04-02', 3)], people: [], places: [] }),
    ).toThrow(/already hold a day at or after/);
  });

  it('lets a day with nothing to say pass through, because it changes nothing', () => {
    const where = root();
    const store = new AnnalsStore({ root: where });
    store.record({ key: '1200-04-02', lines: [line('1200-04-02', 1)], people: [], places: [] });
    const before = read(join(where, ANNALS_DIRECTORY, '1200.txt'));

    // A silent day does not move the record forward, so it is offered again on
    // the next run -- which has to be harmless or the command is not re-runnable.
    store.record({ key: '1200-04-01', lines: [], people: [], places: [] });
    expect(read(join(where, ANNALS_DIRECTORY, '1200.txt'))).toBe(before);
    expect(store.lastDate).toBe('1200-04-02');
  });

  it('files each year separately', () => {
    const where = root();
    const store = new AnnalsStore({ root: where });
    store.record({ key: '1200-12-30', lines: [line('1200-12-30', 1)], people: [], places: [] });
    store.record({ key: '1201-01-01', lines: [line('1201-01-01', 2)], people: [], places: [] });

    expect(listAnnalYears(where)).toEqual(['1200', '1201']);
    expect(read(join(where, ANNALS_DIRECTORY, '1201.txt'))).not.toContain('1200-12-30');
  });

  it('picks up where it left off when reopened', () => {
    const where = root();
    const first = new AnnalsStore({ root: where });
    first.record({
      key: '1200-04-01',
      lines: [line('1200-04-01', 1)],
      people: [person(0, 'Agnes Hargrave')],
      places: [],
    });

    const second = new AnnalsStore({ root: where });
    expect(second.lastDate).toBe('1200-04-01');
    expect(second.people.size).toBe(1);
    expect(second.people.require(npc(0)).slug).toBe('agnes-hargrave');
  });

  it('reports nothing at all for a record that has never been written', () => {
    const store = new AnnalsStore({ root: root() });
    expect(store.lastDate).toBeNull();
    expect(store.people.size).toBe(0);
  });
});

describe('filing a day under a year', () => {
  it('reads the year off the front of the key', () => {
    expect(yearOf('1200-04-01')).toBe('1200');
    expect(yearOf('0007-12-30')).toBe('0007');
  });

  it('refuses a key that does not start with one', () => {
    expect(() => yearOf('not-a-date')).toThrow(/must start with a year/);
  });
});
