import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A disk that can be made to die half way through a write.
 *
 * There is no other way to see the difference between writing a file in place
 * and writing it through a rename, and that difference is the whole reason a
 * day is written the way it is.
 */
let tornWrite = false;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (target: string, body: string, encoding?: unknown) => {
      if (!tornWrite) return actual.writeFileSync(target, body, encoding as never);
      // One byte short: the trailing newline never lands. That is the smallest
      // tear a reader can still detect, and it does not depend on where in the
      // body the write happened to stop - half of a two-line day can fall
      // exactly on the line break and read back as a clean file.
      actual.writeFileSync(target, body.slice(0, -1), 'utf8');
      throw new Error('the disk filled up');
    },
  };
});
import {
  DEFAULT_CALENDAR,
  type EntityId,
  EventArchive,
  Priority,
  type SimEvent,
  Simulation,
  TICKS_PER_DAY,
  dateTimeToTick,
  dayIndexOf,
  dayKeyOf,
  hours,
  listArchivedDays,
  readArchiveManifest,
  readEventDay,
} from '@rpgsim/sim-core';

/**
 * The archive is the Chronicle's source of truth, so the questions these tests
 * ask are the ones a publication asks: is a day complete, is it the day it says
 * it is, and would two runs of one seed print the same paper?
 *
 * `docs/CHRONICLE_V1.md` slice 1 is the plan this is written against.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rpgsim-archive-'));
});

afterEach(() => {
  tornWrite = false;
  rmSync(root, { recursive: true, force: true });
});

function archive(options: { rewrite?: boolean; root?: string } = {}): EventArchive {
  return new EventArchive({
    root: options.root ?? root,
    world: 'village',
    seed: 'world-zero',
    calendar: DEFAULT_CALENDAR,
    ...(options.rewrite === undefined ? {} : { rewrite: options.rewrite }),
  });
}

/** An event with every field populated, so round-tripping proves something. */
function event(id: number, tick: number, overrides: Partial<SimEvent> = {}): SimEvent {
  return {
    id,
    tick,
    type: 'npc.woke',
    actors: ['npc:3' as EntityId, 'npc:4' as EntityId],
    location: 'location:7' as EntityId,
    data: { rise: 21_600, nested: { deep: [1, 2, null, 'x'] } },
    causes: [id - 1],
    ...overrides,
  };
}

describe('day keys', () => {
  it('names a day by the date it is, padded so it sorts', () => {
    const opening = dateTimeToTick({ year: 1200, month: 4, day: 1 }, DEFAULT_CALENDAR);
    expect(dayKeyOf(opening, DEFAULT_CALENDAR)).toBe('1200-04-01');
    expect(dayKeyOf(opening + TICKS_PER_DAY - 1, DEFAULT_CALENDAR)).toBe('1200-04-01');
    expect(dayKeyOf(opening + TICKS_PER_DAY, DEFAULT_CALENDAR)).toBe('1200-04-02');
    // The padding is what makes a plain string sort chronological, which
    // `listArchivedDays` and the site's archive page both depend on.
    expect(['1200-04-10', '1200-04-02'].sort()).toEqual(['1200-04-02', '1200-04-10']);
  });

  it('rolls the day index exactly on the boundary tick', () => {
    expect(dayIndexOf(0)).toBe(0);
    expect(dayIndexOf(TICKS_PER_DAY - 1)).toBe(0);
    expect(dayIndexOf(TICKS_PER_DAY)).toBe(1);
    expect(() => dayIndexOf(-1)).toThrow(/negative/);
    expect(() => dayIndexOf(1.5)).toThrow(/integer/);
  });
});

describe('writing an archive', () => {
  it('round-trips every field of an event, including a nested payload', () => {
    const sink = archive();
    const written = [event(1, 10), event(2, 20, { location: undefined, causes: [] })];
    for (const e of written) sink.write(e);
    sink.close();

    expect(readEventDay(root, '1200-01-01')).toEqual(written);
  });

  it('starts a new file the moment a tick crosses midnight', () => {
    const sink = archive();
    sink.write(event(1, TICKS_PER_DAY - 1));
    sink.write(event(2, TICKS_PER_DAY));
    sink.close();

    expect(listArchivedDays(root)).toEqual(['1200-01-01', '1200-01-02']);
    expect(readEventDay(root, '1200-01-01').map((e) => e.id)).toEqual([1]);
    expect(readEventDay(root, '1200-01-02').map((e) => e.id)).toEqual([2]);
  });

  it('writes an empty day rather than leaving a hole', () => {
    const sink = archive();
    sink.sealDay(0, 'abc123');
    sink.close();

    // A silent village is a fact. An absent file would be indistinguishable
    // from a day nobody simulated, which is how a paper gets published for a
    // day that never happened.
    expect(readEventDay(root, '1200-01-01')).toEqual([]);
    expect(readArchiveManifest(root)?.days[0]).toMatchObject({ events: 0, hash: 'abc123' });
  });

  it('records what it wrote in a manifest that matches the disk', () => {
    const sink = archive();
    sink.write(event(1, 5));
    sink.write(event(2, TICKS_PER_DAY + 5));
    sink.close();

    const manifest = readArchiveManifest(root);
    expect(manifest?.world).toBe('village');
    expect(manifest?.seed).toBe('world-zero');
    expect(manifest?.complete).toBe(true);
    expect(manifest?.days.map((day) => day.key)).toEqual(listArchivedDays(root));
    expect(manifest?.days[0]).toEqual({
      key: '1200-01-01',
      dayIndex: 0,
      firstTick: 0,
      lastTick: TICKS_PER_DAY - 1,
      events: 1,
      hash: null,
    });
  });

  it('keeps the hash a driver seals a day with', () => {
    const sink = archive();
    sink.write(event(1, 5));
    sink.sealDay(0, 'deadbeefdeadbeef');
    sink.write(event(2, TICKS_PER_DAY + 5));
    sink.sealDay(1, '0123456789abcdef');
    sink.close();

    expect(readArchiveManifest(root)?.days.map((day) => day.hash)).toEqual([
      'deadbeefdeadbeef',
      '0123456789abcdef',
    ]);
  });

  it('leaves a readable partial day when a run is interrupted', () => {
    const sink = archive();
    sink.write(event(1, 5));
    sink.flush();

    // No close, no seal: the day is still open, and the file already reads.
    expect(readEventDay(root, '1200-01-01').map((e) => e.id)).toEqual([1]);
    // But the manifest says so, because a publisher must not mistake the
    // wreckage of a dead run for a finished day.
    expect(readArchiveManifest(root)?.complete).toBe(false);

    sink.write(event(2, 6));
    sink.close();
    expect(readEventDay(root, '1200-01-01').map((e) => e.id)).toEqual([1, 2]);
  });

  it('writes nothing but the day files and the manifest', () => {
    const sink = archive();
    sink.write(event(1, 5));
    sink.close();

    // A stray `.writing` temp file left behind would eventually be picked up by
    // the site builder as if it were content.
    expect(readdirSync(root).sort()).toEqual(['days', 'manifest.json']);
    expect(readdirSync(join(root, 'days', '1200-01-01'))).toEqual(['events.jsonl']);
  });
});

describe('what the archive refuses', () => {
  it('will not write over a day it did not write itself', () => {
    const first = archive();
    first.write(event(1, 5));
    first.close();

    const second = archive();
    expect(() => {
      second.write(event(1, 5));
      second.close();
    }).toThrow(/already holds 1200-01-01/);
  });

  it('writes over it when asked to, which is what the young world does', () => {
    const first = archive();
    first.write(event(1, 5));
    first.close();

    const second = archive({ rewrite: true });
    second.write(event(1, 5, { type: 'npc.went-to-bed' }));
    second.close();

    expect(readEventDay(root, '1200-01-01').map((e) => e.type)).toEqual(['npc.went-to-bed']);
  });

  it('refuses events that arrive out of tick order', () => {
    const sink = archive();
    sink.write(event(2, 100));
    expect(() => sink.write(event(1, 99))).toThrow(/out of tick order/);
  });

  it('refuses an event for a day it has already closed', () => {
    const sink = archive();
    sink.write(event(1, 5));
    sink.sealDay(0, 'abc');
    // Same tick as before is still ordered, but its day is finished.
    expect(() => sink.write(event(2, 6))).toThrow(/already closed/);
  });

  it('refuses to seal a day other than the one it has open', () => {
    const sink = archive();
    sink.write(event(1, 5));
    expect(() => sink.sealDay(1, 'abc')).toThrow(/a different day is open/);
  });

  it('refuses to seal a day it has already sealed', () => {
    const sink = archive();
    sink.sealDay(0, 'abc');
    expect(() => sink.sealDay(0, 'def')).toThrow(/already been sealed/);
  });

  it('refuses to seal a day older than the one it has already closed', () => {
    const sink = archive();
    sink.sealDay(0, 'abc');
    sink.sealDay(1, 'def');
    expect(() => sink.sealDay(0, 'ghi')).toThrow(/already been closed/);
  });

  it('treats a missing day as missing, not as empty', () => {
    const sink = archive();
    sink.write(event(1, 5));
    sink.close();

    expect(() => readEventDay(root, '1200-01-02')).toThrow(/has no day 1200-01-02/);
  });

  it('refuses a truncated file rather than dropping the torn line', () => {
    const sink = archive();
    sink.write(event(1, 5));
    sink.write(event(2, 6));
    sink.close();

    const path = join(root, 'days', '1200-01-01', 'events.jsonl');
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, text.slice(0, text.length - 20), 'utf8');

    expect(() => readEventDay(root, '1200-01-01')).toThrow(/truncated/);
  });

  it('names the line when a line is not an event', () => {
    const sink = archive();
    sink.write(event(1, 5));
    sink.write(event(2, 6));
    sink.close();

    const path = join(root, 'days', '1200-01-01', 'events.jsonl');
    const lines = readFileSync(path, 'utf8').split('\n');
    lines[1] = '{"id":2}';
    writeFileSync(path, lines.join('\n'), 'utf8');

    expect(() => readEventDay(root, '1200-01-01')).toThrow(/events\.jsonl:2 is not a valid event/);
  });

  it('names the line when a line is not JSON', () => {
    const sink = archive();
    sink.write(event(1, 5));
    sink.close();

    const path = join(root, 'days', '1200-01-01', 'events.jsonl');
    writeFileSync(path, 'not json at all\n', 'utf8');

    expect(() => readEventDay(root, '1200-01-01')).toThrow(/events\.jsonl:1 is not valid JSON/);
  });

  it('refuses a manifest that is not a manifest', () => {
    archive().close();
    writeFileSync(join(root, 'manifest.json'), '{"world":"village"}', 'utf8');
    expect(() => readArchiveManifest(root)).toThrow(/missing seed/);
  });

  it('reports an archive that has never been written as absent', () => {
    expect(readArchiveManifest(join(root, 'nowhere'))).toBeUndefined();
    expect(listArchivedDays(join(root, 'nowhere'))).toEqual([]);
  });
});

describe('the archive under a running simulation', () => {
  /** Two villagers who wake, walk and sleep on a fixed rhythm for `days` days. */
  function runDays(directory: string, seed: string, days: number): string[] {
    const sim = new Simulation({ seed, calendar: DEFAULT_CALENDAR });
    const sink = new EventArchive({ root: directory, world: 'test', seed });
    sim.log.addSink(sink);

    sim.on('rise', (s) => {
      for (const who of ['npc:1', 'npc:2'] as EntityId[]) {
        s.emit({ type: 'npc.woke', actors: [who], location: 'location:1' as EntityId });
      }
      s.schedule(hours(24), 'rise', null, Priority.Bookkeeping);
    });
    sim.schedule(hours(6), 'rise', null, Priority.Bookkeeping);

    const hashes: string[] = [];
    for (let day = 0; day < days; day++) {
      sim.runFor(TICKS_PER_DAY);
      const hash = sim.hash();
      sink.sealDay(day, hash);
      hashes.push(hash);
    }
    sink.close();
    return hashes;
  }

  it('gives one file per simulated day, with the manifest hashes the world had', () => {
    const hashes = runDays(root, 'archive-seed', 3);

    expect(listArchivedDays(root)).toEqual(['1200-01-01', '1200-01-02', '1200-01-03']);
    const manifest = readArchiveManifest(root);
    expect(manifest?.days.map((day) => day.hash)).toEqual(hashes);
    expect(manifest?.days.map((day) => day.events)).toEqual([2, 2, 2]);

    // Every event in a day file belongs to that day, which is the property the
    // dateline on a published page rests on.
    for (const day of manifest?.days ?? []) {
      for (const recorded of readEventDay(root, day.key)) {
        expect(recorded.tick).toBeGreaterThanOrEqual(day.firstTick);
        expect(recorded.tick).toBeLessThanOrEqual(day.lastTick);
      }
    }
  });

  it('produces byte-identical archives from the same seed', () => {
    const second = mkdtempSync(join(tmpdir(), 'rpgsim-archive-b-'));
    try {
      runDays(root, 'archive-seed', 3);
      runDays(second, 'archive-seed', 3);

      for (const key of listArchivedDays(root)) {
        const path = join('days', key, 'events.jsonl');
        expect(readFileSync(join(second, path), 'utf8')).toBe(readFileSync(join(root, path), 'utf8'));
      }
      expect(readFileSync(join(second, 'manifest.json'), 'utf8')).toBe(
        readFileSync(join(root, 'manifest.json'), 'utf8'),
      );
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('produces a different archive from a different seed', () => {
    const second = mkdtempSync(join(tmpdir(), 'rpgsim-archive-c-'));
    try {
      runDays(root, 'archive-seed', 2);
      runDays(second, 'another-seed', 2);
      expect(readFileSync(join(second, 'manifest.json'), 'utf8')).not.toBe(
        readFileSync(join(root, 'manifest.json'), 'utf8'),
      );
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('sorts the keys in every line, so two histories diff cleanly', () => {
    runDays(root, 'archive-seed', 1);
    const [line] = readFileSync(join(root, 'days', '1200-01-01', 'events.jsonl'), 'utf8').split('\n');
    expect(line?.startsWith('{"actors":')).toBe(true);
    expect(line).toMatch(/"causes":.*"data":.*"id":.*"location":.*"tick":.*"type":/);
  });
});

describe('sealing a day that rolled on its own', () => {
  it('attaches the hash to the day that has just closed', () => {
    const sink = archive();
    sink.write(event(1, 5));
    // A driver running "up to and including the first tick of tomorrow" hands
    // over tomorrow's first event before it gets to seal today.
    sink.write(event(2, TICKS_PER_DAY));
    sink.sealDay(0, 'hash-for-day-zero');
    sink.close();

    const days = readArchiveManifest(root)?.days ?? [];
    expect(days.map((day) => [day.dayIndex, day.hash])).toEqual([
      [0, 'hash-for-day-zero'],
      [1, null],
    ]);
    expect(readEventDay(root, '1200-01-01').map((e) => e.id)).toEqual([1]);
    expect(readEventDay(root, '1200-01-02').map((e) => e.id)).toEqual([2]);
  });

  it('refuses to seal the same day twice', () => {
    const sink = archive();
    sink.write(event(1, 5));
    sink.write(event(2, TICKS_PER_DAY));
    sink.sealDay(0, 'once');
    expect(() => sink.sealDay(0, 'twice')).toThrow(/already been sealed/);
  });
});

describe('a write that dies half way through', () => {
  it('leaves the day that was already there readable', () => {
    const sink = archive();
    sink.write(event(1, 5));
    sink.flush();

    sink.write(event(2, 6));
    tornWrite = true;
    expect(() => sink.flush()).toThrow(/disk filled up/);
    tornWrite = false;

    // The half-written bytes went to a temporary file and the rename never
    // happened, so the reader still sees the last complete version. Writing in
    // place would leave a torn line here instead.
    expect(readEventDay(root, '1200-01-01').map((e) => e.id)).toEqual([1]);
  });
});
