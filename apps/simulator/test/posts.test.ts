import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AnnalsStore,
  ChronicleDay,
  type Post,
  type PublishedDay,
  type Template,
  Whereabouts,
  select,
  writePost,
  writePosts,
} from '@rpgsim/chronicle';
import { fnv1a64Hex } from '@rpgsim/shared';
import { readArchiveManifest, readEventDay } from '@rpgsim/sim-core';
import { loadScoring, loadSelection, loadTemplates } from '../src/data.ts';
import { main } from '../src/index.ts';

/**
 * Thirty real days of posts.
 *
 * `packages/chronicle/test/post.test.ts` asks whether the assembly is right on
 * days small enough to check by hand. This asks the two questions that can only
 * be asked of real days.
 *
 * **Is the honesty rule actually held?** Every line of every post of every day,
 * not a sample — because the failure this guards against is not a systematic
 * one. A presence test that was broken in general would fail the unit tests in
 * a second. What would get past them is a rare shape of day: a waypoint touched
 * for one tick, a walk interrupted, two people in the same cottage at different
 * hours. Thirty days is fourteen thousand journeys, and sampling them is
 * choosing not to look at exactly the ones that matter.
 *
 * **Is any of the shipped wording dead?** A misspelt placeholder, a `when`
 * clause naming a value the simulation never produces, a phrase written for an
 * event shape that changed — all of those read as silence rather than as an
 * error, and silence is invisible. So every wording in the file has to be shown
 * to fit something a real day produced.
 *
 * Thirty days costs about two seconds to simulate, so it is generated once and
 * shared. Nothing here touches the repository's own archive or record.
 */

const DAYS = 30;
const SEED = 'world-zero';
/** An ordinary day. Not the founding, which is the one day unlike all the rest. */
const ORDINARY = '1200-04-02';

const scoring = loadScoring();
const selection = loadSelection();
const templates = loadTemplates();

interface Written {
  readonly day: ChronicleDay;
  readonly whereabouts: Whereabouts;
  readonly posts: readonly Post[];
}

interface Village {
  readonly store: AnnalsStore;
  readonly days: readonly Written[];
}

let directory: string;
let store: AnnalsStore;
let written: readonly Written[];

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'sim-posts-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    const village = build(directory);
    store = village.store;
    written = village.days;
  } finally {
    log.mockRestore();
  }
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/**
 * Run a village, distil it, and write every day's posts in order.
 *
 * Returns its own record rather than writing to the shared one, so that the
 * second village built by the rebuild test cannot leave the first village's
 * tests reading somebody else's annals.
 */
function build(root: string): Village {
  const archive = join(root, 'archive');
  const annals = join(root, 'annals');
  expect(
    main(['run', '--seed', SEED, '--days', String(DAYS), '--every', '0', '--archive', archive]),
  ).toBe(0);
  expect(main(['annals', '--archive', archive, '--annals', annals])).toBe(0);

  const record = new AnnalsStore({ root: annals });
  const manifest = readArchiveManifest(archive);
  expect(manifest?.days).toHaveLength(DAYS);

  const published: PublishedDay[] = [];
  const all: Written[] = [];
  for (const entry of manifest?.days ?? []) {
    const day = new ChronicleDay({
      key: entry.key,
      events: readEventDay(archive, entry.key),
      people: record.people,
      places: record.places,
    });
    const whereabouts = new Whereabouts(day);
    const edition = select({ day, scoring, selection, published });
    const posts = writePosts(edition.posters, {
      day,
      whereabouts,
      scoring,
      templates,
      worldSeed: SEED,
    });
    published.push({ key: day.key, posters: edition.posters.map((c) => c.person.slug) });
    all.push({ day, whereabouts, posts });
  }
  return { store: record, days: all };
}

const dayOf = (key: string): Written => {
  const found = written.find((one) => one.day.key === key);
  expect(found).toBeDefined();
  return found as Written;
};

/** A day's posts as one string: author, then every line with its ids. */
const printed = (posts: readonly Post[]): string =>
  posts
    .map(
      (post) =>
        `${post.author.slug}\n` +
        post.lines.map((line) => `  ${line.text} [${line.sources.join(',')}]`).join('\n'),
    )
    .join('\n');

describe('thirty days of posts', () => {
  it('never lets anybody write about something they were not there for', () => {
    // The honesty rule, checked on every line of every post. Not a spot check:
    // see the header.
    let lines = 0;
    for (const { day, whereabouts, posts } of written) {
      for (const post of posts) {
        for (const line of post.lines) {
          expect(line.sources.length).toBeGreaterThan(0);
          for (const id of line.sources) {
            const event = day.require(id);
            expect(whereabouts.saw(post.author.id, event)).toBe(true);
          }
          lines++;
        }
      }
    }
    // A count, so that a change which quietly stops writing posts at all fails
    // here instead of passing an empty loop.
    expect(lines).toBeGreaterThan(DAYS * 2);
  });

  it('cites only events of the day the post belongs to', () => {
    for (const { day, posts } of written) {
      for (const post of posts) {
        expect(post.day).toBe(day.key);
        // `require` throws on an id this day does not hold, so a post built
        // from yesterday's archive cannot pass quietly.
        for (const id of post.sources) expect(() => day.require(id)).not.toThrow();
      }
    }
  });

  it('never prints a name the record cannot vouch for', () => {
    // Every place and person named in a post exists in the annals, and no
    // sentence contains an entity id. `location:7` reaching a reader is the
    // single most embarrassing thing this module could do.
    for (const { posts } of written) {
      for (const post of posts) {
        for (const line of post.lines) {
          expect(line.text).not.toMatch(/[a-z][a-z-]*:\d+/);
          expect(line.text).not.toContain('undefined');
          expect(line.text.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('writes nothing, rather than an empty post, for a villager with nothing to say', () => {
    // Asked of every one of the eighty-six villagers on an ordinary day, not
    // just the five the rota picked. The claim is two-sided: nobody gets a post
    // they have no material for, and nobody with material is refused one. A
    // `writePost` that returned an empty post instead of nothing would pass the
    // first half and fail the second, which is the point of checking both.
    const { day, whereabouts } = dayOf(ORDINARY);
    let wrote = 0;
    let silent = 0;

    for (const person of store.people.records()) {
      const post = writePost({ day, whereabouts, scoring, templates, worldSeed: SEED, author: person });
      const material = day.events.some(
        (event) =>
          templates.wording[event.type] !== undefined && whereabouts.saw(person.id, event),
      );

      if (post === undefined) {
        expect(material).toBe(false);
        silent++;
      } else {
        expect(post.lines.length).toBeGreaterThan(0);
        wrote++;
      }
    }

    // Everybody wakes and everybody sleeps, so on this village nobody is
    // silent. Worth asserting, because a `writePost` that had quietly stopped
    // working would also make the loop above agree with itself.
    expect(wrote).toBe(store.people.size);
    expect(silent).toBe(0);

    // And the other branch, which this village is too talkative to reach on
    // its own: given a book with wording for nothing anybody did, every single
    // villager writes nothing. Not a post with no lines -- nothing. That is
    // the no-padding rule, and it needs the case where padding would be
    // tempting to be reached at all.
    for (const person of store.people.records()) {
      const post = writePost({
        day,
        whereabouts,
        scoring,
        templates: { maxLines: 3, wording: {} },
        worldSeed: SEED,
        author: person,
      });
      expect(post).toBeUndefined();
    }
  });

  it('runs no post longer than the book allows', () => {
    for (const { posts } of written) {
      for (const post of posts) {
        expect(post.lines.length).toBeGreaterThan(0);
        expect(post.lines.length).toBeLessThanOrEqual(templates.maxLines);
      }
    }
  });

  it('writes at most one line per kind of moment', () => {
    for (const { day, posts } of written) {
      for (const post of posts) {
        const kinds = post.sources.map((id) => day.require(id).type);
        expect(new Set(kinds).size).toBe(kinds.length);
      }
    }
  });

  it('tells each day in the order it happened', () => {
    for (const { day, posts } of written) {
      for (const post of posts) {
        const ticks = post.sources.map((id) => day.require(id).tick);
        expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
      }
    }
  });
});

describe('the shipped wording, against real days', () => {
  it('has nothing in it that no real event can reach', () => {
    // Every variant is offered one real event of its own type at a time and
    // has to fit at least one of them. A wording that fits nothing is either a
    // typo or a phrase for a simulation that no longer exists, and either way
    // it will never be seen -- which is why a test has to look.
    const reached = new Set<Template>();
    const all: Template[] = [];
    for (const variants of Object.values(templates.wording)) all.push(...variants);

    for (const { day, whereabouts } of written) {
      for (const event of day.events) {
        const variants = templates.wording[event.type];
        if (variants === undefined) continue;
        for (const actor of event.actors) {
          const person = store.people.find(actor);
          if (person === undefined) continue;
          for (const variant of variants) {
            if (reached.has(variant)) continue;
            const one = writePost({
              day,
              whereabouts,
              scoring,
              templates: { maxLines: 1, wording: { [event.type]: [variant] } },
              worldSeed: SEED,
              author: person,
            });
            if (one !== undefined) reached.add(variant);
          }
        }
      }
    }

    const dead = all.filter((variant) => !reached.has(variant)).map((variant) => variant.text);
    expect(dead).toEqual([]);
    expect(reached.size).toBe(all.length);
  });

  it('has wording for the things that actually happen', () => {
    // The other direction, and a softer claim: on an ordinary day, the village
    // is not silent. If a change to the simulation renamed every event type,
    // the test above would still pass on an empty village and this would not.
    expect(dayOf(ORDINARY).posts.length).toBeGreaterThanOrEqual(selection.posters);
  });
});

describe('the same world, written twice', () => {
  it('produces the same posts from a second village built from the same seed', () => {
    // Two separate runs into two separate directories, which is the claim the
    // site rests on: delete everything, rebuild, and last month's posts come
    // back word for word.
    const other = mkdtempSync(join(tmpdir(), 'sim-posts-b-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const again = build(other).days;
      expect(again.map((one) => printed(one.posts))).toEqual(
        written.map((one) => printed(one.posts)),
      );
    } finally {
      log.mockRestore();
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('writes the day the golden hash was pinned on', () => {
    // A hash over one ordinary day's posts, wording and event ids together. It
    // is meant to break: any change to the templates, the scoring, the rota or
    // worldgen moves it, and the change is either intended -- in which case
    // re-pin it here in the same commit and say why -- or it is a wording
    // change nobody asked for.
    //
    // Last pinned when slice 5 first shipped.
    const posts = dayOf(ORDINARY).posts;
    expect(posts.length).toBeGreaterThan(0);
    expect(fnv1a64Hex(printed(posts))).toBe('99601c43c270104f');
  });
});
