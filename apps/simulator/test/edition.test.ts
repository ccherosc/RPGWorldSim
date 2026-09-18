import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnnalsStore,
  ChronicleDay,
  type Edition,
  type PublishedDay,
  rank,
  select,
} from '@rpgsim/chronicle';
import { readArchiveManifest, readEventDay } from '@rpgsim/sim-core';
import { loadScoring, loadSelection } from '../src/data.ts';
import { main } from '../src/index.ts';

/**
 * The edition, against a real village rather than hand-built events.
 *
 * `packages/chronicle/test/score.test.ts` and `select.test.ts` ask whether the
 * arithmetic is right on days small enough to check by hand. This asks the
 * question those cannot: **does any of it survive contact with a real day.** A
 * real day is twelve hundred events of which nine hundred and seventy-six are
 * somebody walking somewhere, and the failure this guards against is not a
 * wrong number — it is a front page that is technically correct and reads like
 * a travel log.
 *
 * It also holds the line the whole press side depends on: every name the page
 * prints comes out of the record, so an id that the record has never heard of
 * throws here rather than reaching a reader as `location:3`.
 */

const DAYS = 6;
const SEED = 'edition';

let directory: string;
let restore: () => void;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sim-edition-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  restore = () => {
    log.mockRestore();
    error.mockRestore();
  };
});

afterEach(() => {
  restore();
  rmSync(directory, { recursive: true, force: true });
});

const scoring = loadScoring();
const selection = loadSelection();

interface Village {
  readonly store: AnnalsStore;
  readonly days: readonly ChronicleDay[];
}

/**
 * Run a real village, distil it, and hand back its days ready to read.
 *
 * `--every 0` silences the progress ticker; the archive and the record go into
 * a fresh temporary directory so nothing here can read or write the repository
 * copies. The days come back in key order because the manifest is in key order.
 */
function village(root: string): Village {
  const archive = join(root, 'archive');
  const annals = join(root, 'annals');
  expect(
    main(['run', '--seed', SEED, '--days', String(DAYS), '--every', '0', '--archive', archive]),
  ).toBe(0);
  expect(main(['annals', '--archive', archive, '--annals', annals])).toBe(0);

  const store = new AnnalsStore({ root: annals });
  const manifest = readArchiveManifest(archive);
  expect(manifest).toBeDefined();

  const days = (manifest?.days ?? []).map(
    (day) =>
      new ChronicleDay({
        key: day.key,
        events: readEventDay(archive, day.key),
        people: store.people,
        places: store.places,
      }),
  );
  return { store, days };
}

/** Build every edition in order, feeding each day the days already published. */
function editions(days: readonly ChronicleDay[]): readonly Edition[] {
  const published: PublishedDay[] = [];
  const built: Edition[] = [];
  for (const day of days) {
    const edition = select({ day, scoring, selection, published });
    built.push(edition);
    published.push({ key: day.key, posters: edition.posters.map((c) => c.person.slug) });
  }
  return built;
}

/** An edition reduced to what a reader would actually see. */
const printed = (edition: Edition): unknown => ({
  key: edition.key,
  headlines: edition.headlines.map((h) => [h.event.id, h.event.type, h.total]),
  posters: edition.posters.map((c) => [c.person.slug, c.best.event.id, c.merit]),
});

describe('a real village, read as an edition', () => {
  it('knows the name of everywhere and everybody the page mentions', () => {
    const { store, days } = village(directory);

    // The point of `place.created`. Before it, this loop could only have
    // asserted that ids looked like ids.
    for (const edition of editions(days)) {
      for (const headline of edition.headlines) {
        if (headline.event.location !== undefined) {
          expect(store.places.require(headline.event.location).name.length).toBeGreaterThan(0);
        }
      }
      for (const poster of edition.posters) {
        expect(store.people.require(poster.person.id).name).toBe(poster.person.name);
      }
    }
  });

  it('has a record of every place the founding day built', () => {
    const { store } = village(directory);
    // Fourteen named places plus twenty-four cottages, none of them anonymous.
    expect(store.places.size).toBe(38);
    expect(store.places.findBySlug('green')?.access).toBe('public');
    expect(store.places.records().some((p) => p.type === 'dwelling')).toBe(true);
  });

  it('throws on an id the record has never heard of rather than printing it', () => {
    const { store } = village(directory);
    expect(() => store.places.require('location:9999' as never)).toThrow(/no record of this place/);
    expect(() => store.people.require('npc:9999' as never)).toThrow();
  });

  it('scores every event of every day as a non-negative whole number', () => {
    const { days } = village(directory);
    for (const day of days) {
      const scored = rank(scoring, day);
      expect(scored).toHaveLength(day.size);
      for (const one of scored) {
        expect(Number.isInteger(one.total)).toBe(true);
        expect(one.total).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('does not put the day’s walking about on the front page', () => {
    const { days } = village(directory);
    // Roughly four in five events of an ordinary day are somebody leaving or
    // arriving somewhere. If the filter is worth anything, none of that leads.
    for (const edition of editions(days)) {
      for (const headline of edition.headlines) {
        expect(headline.event.type).not.toBe('travel.departed');
        expect(headline.event.type).not.toBe('travel.arrived');
      }
    }
  });

  it('runs no repeated kind beyond the cap and nothing below the floor', () => {
    const { days } = village(directory);
    for (const edition of editions(days)) {
      expect(edition.headlines.length).toBeLessThanOrEqual(selection.headlines);
      const taken = new Map<string, number>();
      for (const headline of edition.headlines) {
        expect(headline.total).toBeGreaterThanOrEqual(selection.floor);
        const already = (taken.get(headline.event.type) ?? 0) + 1;
        expect(already).toBeLessThanOrEqual(selection.perType);
        taken.set(headline.event.type, already);
      }
    }
  });

  it('gives the same edition every time the same world is rebuilt', () => {
    // Not two passes over one run: two separate villages, generated from the
    // same seed into different directories. That is the claim the site rests
    // on -- delete everything, rebuild, and yesterday's page comes back.
    const first = mkdtempSync(join(tmpdir(), 'sim-edition-a-'));
    const second = mkdtempSync(join(tmpdir(), 'sim-edition-b-'));
    try {
      const one = editions(village(first).days).map(printed);
      const other = editions(village(second).days).map(printed);
      expect(other).toEqual(one);
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('shares the blog out rather than handing it to the same few', () => {
    const { days } = village(directory);
    const times = new Map<string, number>();
    for (const edition of editions(days)) {
      for (const poster of edition.posters) {
        times.set(poster.person.slug, (times.get(poster.person.slug) ?? 0) + 1);
      }
    }

    // Six days is too short to prove the rota turns -- that is what the
    // thirty-day test in `packages/chronicle` is for. What it can show is that
    // on real data nobody is posting every day and the page is not empty.
    expect(times.size).toBeGreaterThan(selection.posters);
    expect(Math.max(...times.values())).toBeLessThan(days.length);
  });
});
