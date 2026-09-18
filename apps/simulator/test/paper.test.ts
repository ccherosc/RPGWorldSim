import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AnnalsStore,
  ChronicleDay,
  type Glance,
  type Paper,
  type PublishedDay,
  type Template,
  glanceOf,
  reviewOf,
  scoreOf,
  select,
  writePaper,
} from '@rpgsim/chronicle';
import { type EntityId, type SimEvent, readArchiveManifest, readEventDay } from '@rpgsim/sim-core';
import { loadPaper, loadScoring, loadSelection } from '../src/data.ts';
import { main } from '../src/index.ts';

/**
 * Thirty real days of the Towne Publication.
 *
 * `packages/chronicle/test/paper.test.ts` asks whether the page is assembled
 * right on days small enough to check by hand. This asks the three things only
 * real days can answer.
 *
 * **Is every number on the page true?** Each of the six is recomputed here by a
 * deliberately different route — a second implementation, not a second call —
 * and the two have to agree on all thirty days. A test that called `glanceOf`
 * and compared the answer to itself would pass whatever `glanceOf` did.
 *
 * **Is the page honest about who was there?** Every person and place named in
 * every story, checked against the event the story cites. A sentence may only
 * name somebody the event it rests on actually involves. The paper has no
 * author and so has no presence rule of its own (see `paper.ts`), which makes
 * this the only thing standing between it and a sentence about the wrong person.
 *
 * **Is any of the shipped wording dead?** A misspelt placeholder or a `when`
 * clause naming a value the simulation never produces reads as silence rather
 * than as an error. Every variant in `paper.json` has to be shown to fit
 * something a real day produced.
 *
 * Thirty days costs about two seconds to simulate, so it is generated once and
 * shared. Nothing here touches the repository's own archive or record.
 */

const DAYS = 30;
const SEED = 'world-zero';
const VILLAGE = 'Wodenshill';
/** An ordinary day. Not the founding, which is the one day unlike all the rest. */
const ORDINARY = '1200-04-02';
const FOUNDING = '1200-04-01';

const scoring = loadScoring();
const selection = loadSelection();
const book = loadPaper();

interface Issue {
  readonly day: ChronicleDay;
  readonly headlines: readonly ReturnType<typeof scoreOf>[];
  readonly paper: Paper;
}

let directory: string;
let store: AnnalsStore;
let issues: readonly Issue[];

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'sim-paper-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    const village = build(directory);
    store = village.store;
    issues = village.issues;
  } finally {
    log.mockRestore();
  }
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Run a village, distil it, and write every day's paper in order. */
function build(root: string): { store: AnnalsStore; issues: readonly Issue[] } {
  const archive = join(root, 'archive');
  const annals = join(root, 'annals');
  expect(
    main(['run', '--seed', SEED, '--days', String(DAYS), '--every', '0', '--archive', archive]),
  ).toBe(0);
  expect(main(['annals', '--archive', archive, '--annals', annals])).toBe(0);

  const record = new AnnalsStore({ root: annals });
  const manifest = readArchiveManifest(archive);
  expect(manifest?.days).toHaveLength(DAYS);

  // The posting rota is carried along even though the paper does not use it,
  // because `select` will not answer the headline question without it and the
  // whole point of passing headlines in is that the paper and the blog agree
  // about what mattered. Building the edition the same way both do keeps that
  // true instead of merely intended.
  const published: PublishedDay[] = [];
  const all: Issue[] = [];
  for (const entry of manifest?.days ?? []) {
    const day = new ChronicleDay({
      key: entry.key,
      events: readEventDay(archive, entry.key),
      people: record.people,
      places: record.places,
    });
    const edition = select({ day, scoring, selection, published });
    published.push({ key: day.key, posters: edition.posters.map((one) => one.person.slug) });
    all.push({
      day,
      headlines: edition.headlines,
      paper: writePaper({
        day,
        headlines: edition.headlines,
        book,
        village: VILLAGE,
        worldSeed: SEED,
      }),
    });
  }
  return { store: record, issues: all };
}

const issueOf = (key: string): Issue => {
  const found = issues.find((one) => one.day.key === key);
  expect(found).toBeDefined();
  return found as Issue;
};

const dataOf = (event: SimEvent): Record<string, unknown> =>
  event.data as Record<string, unknown>;

/**
 * Every name the record can print, and everything that answers to it.
 *
 * A list per name, not an id per name, because a name in Wodenshill does not
 * identify one thing: twenty-four cottages are called "A cottage on Church
 * Lane". Longest first, because a name can also hide inside another one — the
 * street `Church Lane` is a substring of the cottages that stand on it, so a
 * reader looking for names in a sentence has to take the cottage before the
 * street or find a street that was never mentioned.
 */
function knownNames(): readonly (readonly [string, readonly EntityId[]])[] {
  const byName = new Map<string, EntityId[]>();
  const add = (name: string, id: EntityId): void => {
    const held = byName.get(name);
    if (held === undefined) byName.set(name, [id]);
    else held.push(id);
  };
  for (const person of store.people.records()) add(person.name, person.id);
  for (const place of store.places.records()) add(place.name, place.id);
  return [...byName].sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
}

/**
 * Every number in "at a glance", worked out again a different way.
 *
 * Not a second call to `glanceOf`. `journeys` is counted by asking whether an
 * arrival happened at the place its own payload calls the destination, rather
 * than by trusting the `final` flag — two fields that must agree and would not
 * if travel ever announced a leg as a completed walk. `abed` is a sweep through
 * the day in tick order flipping a switch per person, rather than a comparison
 * of last ticks. The cumulative three are counted off the registers by hand.
 */
function recompute(day: ChronicleDay): Glance {
  const families = new Set<string>();
  let souls = 0;
  for (const person of store.people.records()) {
    souls++;
    if (person.family !== null && person.family !== '') families.add(person.family);
  }

  let places = 0;
  for (const _place of store.places.records()) places++;

  let journeys = 0;
  let refused = 0;
  for (const event of day.events) {
    if (event.type === 'travel.arrived' && dataOf(event)['destination'] === event.location) {
      journeys++;
    }
    if (event.type === 'travel.blocked') refused++;
  }

  const asleep = new Map<EntityId, boolean>();
  for (const event of [...day.events].sort((a, b) => a.tick - b.tick || a.id - b.id)) {
    if (event.type === 'npc.went-to-bed') for (const who of event.actors) asleep.set(who, true);
    if (event.type === 'npc.woke') for (const who of event.actors) asleep.set(who, false);
  }
  let abed = 0;
  for (const [, down] of asleep) if (down) abed++;

  return { souls, families: families.size, places, abed, journeys, refused };
}

describe('every number on the page', () => {
  it('agrees with the same number worked out a different way, on all thirty days', () => {
    for (const { day, paper } of issues) {
      expect(paper.glance).toEqual(recompute(day));
    }
  });

  it('is not the same on a day the village did nothing', () => {
    // A guard against the test above passing because both routes return zero.
    // Thirty days of real travel produce real counts, and a `glanceOf` that had
    // quietly stopped counting would agree with nothing.
    const glance = issueOf(ORDINARY).paper.glance;
    expect(glance.souls).toBe(store.people.size);
    expect(glance.places).toBe(store.places.size);
    expect(glance.journeys).toBeGreaterThan(0);
    expect(glance.refused).toBeGreaterThan(0);
    expect(glance.abed).toBeGreaterThan(0);
    expect(glance.families).toBeGreaterThan(1);
  });

  it('puts the whole village to bed by the end of an ordinary day', () => {
    // Everybody in Wodenshill sleeps at night, so `abed` is the population.
    // Worth pinning: it is the one glance number computed from a gap between
    // two events rather than from a count of them, and the shape of its bug is
    // an off-by-a-few that no aggregate would show.
    expect(issueOf(ORDINARY).paper.glance.abed).toBe(store.people.size);
  });

  it('counts fewer journeys than arrivals, because a walk has legs', () => {
    // If these were equal, `journeys` would be counting waypoints and the paper
    // would report three times the travel the village did.
    const { day, paper } = issueOf(ORDINARY);
    expect(paper.glance.journeys).toBeLessThan(day.countOf('travel.arrived'));
    expect(paper.glance.journeys).toBeGreaterThan(0);
  });
});

describe('the cumulative counts, and the day they stop being true', () => {
  it('is not yet possible for anybody or anywhere to appear after the founding', () => {
    // A tripwire, not a test of this code. `souls`, `families` and `places` are
    // read off a register that holds the village as of the last day distilled
    // into it, so a page rebuilt years later would credit the founding day with
    // everybody born since. That is harmless only while nothing is created
    // after day one, which is a fact about the simulation and not a property of
    // the paper. The first birth turns this red, and that is the day the glance
    // needs a register scoped to the day. See `Glance` in `paper.ts`.
    for (const { day } of issues) {
      const born = day.countOf('npc.created') + day.countOf('place.created');
      if (day.key === FOUNDING) expect(born).toBeGreaterThan(0);
      else expect(born).toBe(0);
    }
  });

  it('credits the founding day with exactly what the founding day created', () => {
    // The one day on which the cumulative numbers can be checked against events
    // rather than against the register, which is the plan's original demand.
    const { day, paper } = issueOf(FOUNDING);
    expect(paper.glance.souls).toBe(day.countOf('npc.created'));
    expect(paper.glance.places).toBe(day.countOf('place.created'));
  });
});

describe('what the page says, and about whom', () => {
  it('never names a person or a place the event it cites did not involve', () => {
    // The strong form. Not "is the name real" -- every name the paper prints
    // comes out of the register, so they are all real -- but "was this person
    // anywhere near the thing being reported". A story may name somebody the
    // event lists as an actor, or somebody its payload points at. Nobody else.
    let checked = 0;
    const names = knownNames();
    for (const { day, paper } of issues) {
      for (const story of paper.review ?? []) {
        expect(story.sources).toHaveLength(1);
        const event = day.require(story.sources[0] as number);
        const involved = new Set<EntityId>(event.actors);
        if (event.location !== undefined) involved.add(event.location);
        for (const value of Object.values(dataOf(event))) {
          if (typeof value === 'string') involved.add(value as EntityId);
        }

        // Asked of names rather than of records, and of each name only once:
        // see `knownNames`. A matched name is struck out of the working copy so
        // that the longest reading of a sentence is the one checked.
        let rest = story.text;
        for (const [name, ids] of names) {
          if (!rest.includes(name)) continue;
          rest = rest.split(name).join(' ');
          expect(ids.some((id) => involved.has(id))).toBe(true);
          checked++;
        }
      }
    }
    // A count, so that a change which stopped writing stories at all fails here
    // rather than passing an empty loop.
    expect(checked).toBeGreaterThan(DAYS);
  });

  it('prints no entity id and no undefined anywhere on any page', () => {
    for (const { paper } of issues) {
      const page = [
        paper.day,
        paper.village,
        paper.dateline,
        ...(paper.review ?? []).map((story) => story.text),
        ...(paper.colophon ?? []),
      ].join('\n');
      expect(page).not.toMatch(/[a-z][a-z-]*:\d+/);
      expect(page).not.toContain('undefined');
      expect(page).not.toMatch(/\{[a-zA-Z]/);
    }
  });

  it('counts the others of a kind correctly, against the day itself', () => {
    for (const { day, paper } of issues) {
      for (const story of paper.review ?? []) {
        expect(story.alsoToday).toBe(day.countOf(story.type) - 1);
        expect(story.alsoToday).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('writes one story per kind and no more', () => {
    for (const { paper } of issues) {
      const kinds = (paper.review ?? []).map((story) => story.type);
      expect(new Set(kinds).size).toBe(kinds.length);
      expect(kinds.length).toBeLessThanOrEqual(book.maxStories);
    }
  });

  it('never prints a kind it has promised to refuse', () => {
    const refused = new Set(book.neverPrint);
    for (const { paper } of issues) {
      for (const story of paper.review ?? []) expect(refused.has(story.type)).toBe(false);
    }
  });

  it('datelines every day with its own date', () => {
    const seen = new Set<string>();
    for (const { day, paper } of issues) {
      expect(paper.dateline.startsWith(`${VILLAGE}, `)).toBe(true);
      expect(paper.day).toBe(day.key);
      seen.add(paper.dateline);
    }
    expect(seen.size).toBe(DAYS);
  });

  it('leaves out the review rather than printing an empty heading', () => {
    // The plan's rule, asked of a real day. Wodenshill is never actually silent
    // -- somebody is turned away from the smithy every single day -- so the
    // silence has to be arranged: the same real day, offered a book with words
    // for nothing. The section is absent, not empty, and the rest of the page
    // still stands.
    const { day, headlines } = issueOf(ORDINARY);
    const quiet = writePaper({
      day,
      headlines,
      book: { ...book, wording: {} },
      village: VILLAGE,
      worldSeed: SEED,
    });
    expect(quiet.review).toBeUndefined();
    expect('review' in quiet).toBe(false);
    expect(quiet.dateline).toBe(issueOf(ORDINARY).paper.dateline);
    expect(quiet.glance).toEqual(issueOf(ORDINARY).paper.glance);
    expect(quiet.colophon?.length).toBe(book.colophon.length);
  });

  it('has something to say on every one of the thirty days', () => {
    // The other direction. A paper that had quietly stopped reporting would
    // pass every honesty test above, because an empty page tells no lies.
    for (const { paper } of issues) {
      expect(paper.review?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('the shipped paper wording, against real days', () => {
  it('has nothing in it that no real event can reach', () => {
    const reached = new Set<Template>();
    const all: Template[] = [];
    for (const variants of Object.values(book.wording)) all.push(...variants);

    for (const { day } of issues) {
      for (const event of day.events) {
        const variants = book.wording[event.type];
        if (variants === undefined) continue;
        for (const variant of variants) {
          if (reached.has(variant)) continue;
          const written = reviewOf({
            day,
            headlines: [scoreOf(scoring, day, event)],
            book: { ...book, wording: { [event.type]: [variant] } },
            village: VILLAGE,
            worldSeed: SEED,
          });
          if (written.length > 0) reached.add(variant);
        }
      }
    }

    const dead = all.filter((variant) => !reached.has(variant)).map((variant) => variant.text);
    expect(dead).toEqual([]);
    expect(reached.size).toBe(all.length);
  });

  it('covers the things that actually lead a day', () => {
    // The softer claim in the other direction: of everything that cleared the
    // newsworthiness floor across thirty days, the paper had words for it or
    // had promised not to print it. Anything else is a headline the page
    // silently dropped, which is the failure the reachability test cannot see.
    const refused = new Set(book.neverPrint);
    const mute = new Set<string>();
    for (const { headlines } of issues) {
      for (const { event } of headlines) {
        if (refused.has(event.type)) continue;
        if (book.wording[event.type] === undefined) mute.add(event.type);
      }
    }
    expect([...mute].sort()).toEqual([]);
  });
});

describe('the same world, printed twice', () => {
  it('produces the same papers from a second village built from the same seed', () => {
    // The claim the site rests on: delete everything, rebuild from the seed, and
    // last month's front pages come back word for word. Two separate runs into
    // two separate directories, because a rebuild that reused the first run's
    // archive would prove only that reading a file twice gives the same bytes.
    const second = mkdtempSync(join(tmpdir(), 'sim-paper-again-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const rebuilt = build(second);
      expect(rebuilt.issues).toHaveLength(issues.length);
      for (const [index, one] of rebuilt.issues.entries()) {
        expect(one.paper).toEqual(issues[index]?.paper);
      }
    } finally {
      log.mockRestore();
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('does not print the same phrasing every day of the month', () => {
    // The stream is named for the day, so each issue draws from its own place
    // in the seed. Name it for the paper alone and every day of the archive
    // picks the same variant out of a list of two -- a month of front pages
    // worded identically, which no honesty test would ever notice.
    //
    // Which variant produced a story is recovered by re-writing the day with
    // one variant at a time and seeing which rendering matches, rather than by
    // looking for a phrase: a test that searched for words would have to be
    // edited every time somebody improved one.
    //
    // The founding day is left out, and that exclusion is the test. It runs
    // three stories where every other day runs one, so it draws from the stream
    // three times and lands somewhere different however the stream is named --
    // enough, on its own, to make a month of identical pages look varied. The
    // claim only bites when it is made about days of the same shape.
    const many = Object.entries(book.wording).filter(([, variants]) => variants.length > 1);
    expect(many.length).toBeGreaterThan(0);

    let varied = 0;
    for (const [type, variants] of many) {
      const chosen = new Set<number>();
      for (const { day, headlines, paper } of issues) {
        if (day.key === FOUNDING) continue;
        const story = (paper.review ?? []).find((one) => one.type === type);
        if (story === undefined) continue;
        variants.forEach((variant, index) => {
          const alone = reviewOf({
            day,
            headlines,
            book: { ...book, wording: { ...book.wording, [type]: [variant] } },
            village: VILLAGE,
            worldSeed: SEED,
          }).find((one) => one.type === type);
          if (alone?.text === story.text) chosen.add(index);
        });
      }
      // A type that only ever leads one day cannot show variety, and demanding
      // it would make this test a hostage to the shape of the month.
      if (chosen.size > 1) varied++;
    }
    expect(varied).toBeGreaterThan(0);
  });

  it('chooses its wording from the seed, not from the order it was asked', () => {
    // Writing the same day twice in one process must not advance anything.
    const { day, headlines } = issueOf(ORDINARY);
    const once = writePaper({ day, headlines, book, village: VILLAGE, worldSeed: SEED });
    const twice = writePaper({ day, headlines, book, village: VILLAGE, worldSeed: SEED });
    expect(twice).toEqual(once);
    // And a different seed is allowed to read differently, which is what shows
    // the seed is doing anything at all.
    const other = writePaper({ day, headlines, book, village: VILLAGE, worldSeed: 'somewhere-else' });
    expect(other.glance).toEqual(once.glance);
  });
});

describe('the glance against the review', () => {
  it('counts more refusals than it prints stories about', () => {
    // The two halves of the page have to be consistent with each other: the
    // review says one villager was turned away and fourteen others were, and
    // the glance says sixteen refusals happened. Those numbers come from
    // different code and describe the same day.
    for (const { paper } of issues) {
      const story = (paper.review ?? []).find((one) => one.type === 'travel.blocked');
      if (story === undefined) continue;
      expect(paper.glance.refused).toBe(story.alsoToday + 1);
    }
  });

  it('never reports a glance the paper did not compute for that day', () => {
    for (const { day, paper } of issues) {
      expect(paper.glance).toEqual(glanceOf(day));
    }
  });
});
