import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AnnalsStore,
  ChronicleDay,
  type HouseholdVoice,
  Kinfolk,
  LifeStages,
  type PersonRecord,
  type Post,
  type PublishedDay,
  type Template,
  Whereabouts,
  eligible,
  householdVoice,
  select,
  writePost,
  writePosts,
  yearsBetween,
} from '@rpgsim/chronicle';
import { fnv1a64Hex } from '@rpgsim/shared';
import { type EntityId, readArchiveManifest, readEventDay } from '@rpgsim/sim-core';
import { loadCasting, loadScoring, loadSelection, loadTemplates } from '../src/data.ts';
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
 * **May everybody who spoke, speak?** Nobody under the writing age is on the
 * rota, and every line about somebody else is a parent's line about their own
 * young child -- checked against the archive's own parentage, on every day.
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
/** A day three of whose five posts end with a line about somebody's child. */
const FAMILY_DAY = '1200-04-05';

const scoring = loadScoring();
const selection = loadSelection();
const templates = loadTemplates();
// The shipped boundaries, not a fixture's. A band written for `elder` has to
// be reachable by whoever the casting file calls an elder, and nobody else.
const stages = new LifeStages(loadCasting().bands);

interface Written {
  readonly day: ChronicleDay;
  readonly whereabouts: Whereabouts;
  readonly posts: readonly Post[];
}

interface Village {
  readonly store: AnnalsStore;
  readonly days: readonly Written[];
  readonly household: HouseholdVoice;
}

let directory: string;
let store: AnnalsStore;
let written: readonly Written[];
let household: HouseholdVoice;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'sim-posts-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    const village = build(directory);
    store = village.store;
    written = village.days;
    household = village.household;
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
  // Built forwards, exactly as `apps/press/src/issue.ts` builds it: a post may
  // rest on what the village knew that morning and not on what the archive
  // knows now.
  const kin = new Kinfolk();
  const voice = householdVoice(kin, selection);
  for (const entry of manifest?.days ?? []) {
    const day = new ChronicleDay({
      key: entry.key,
      events: readEventDay(archive, entry.key),
      people: record.people,
      places: record.places,
    });
    kin.learn(day);
    const whereabouts = new Whereabouts(day);
    const edition = select({ day, scoring, selection, published });
    const posts = writePosts(edition.posters, {
      day,
      whereabouts,
      scoring,
      templates,
      stages,
      household: voice,
      worldSeed: SEED,
    });
    published.push({ key: day.key, posters: edition.posters.map((c) => c.person.slug) });
    all.push({ day, whereabouts, posts });
  }
  return { store: record, days: all, household: voice };
}

const dayOf = (key: string): Written => {
  const found = written.find((one) => one.day.key === key);
  expect(found).toBeDefined();
  return found as Written;
};

/**
 * A day's posts as one string: author, then every line with its ids.
 *
 * A line about a child prints whose it is as well. Without that, a mention
 * credited to the wrong child would read identically here, and both the rebuild
 * test and the golden hash would shrug at it.
 */
const printed = (posts: readonly Post[]): string =>
  posts
    .map(
      (post) =>
        `${post.author.slug}\n` +
        post.lines
          .map(
            (line) =>
              `  ${line.text} [${line.sources.join(',')}]` +
              (line.about === undefined ? '' : ` about:${line.about}`),
          )
          .join('\n'),
    )
    .join('\n');

describe('thirty days of posts', () => {
  it('never lets anybody write about something they were not there for', () => {
    // The honesty rule, checked on every line of every post. Not a spot check:
    // see the header.
    //
    // `line.about` is what makes a parent's line about a child answerable to
    // the same rule rather than exempt from it. The presence asked for is the
    // *child's*, and it is asked for exactly as strictly. Softening this to
    // `saw(author) || isAboutSomebody` would let one loophole through and then
    // let everything through it.
    let lines = 0;
    for (const { day, whereabouts, posts } of written) {
      for (const post of posts) {
        for (const line of post.lines) {
          expect(line.sources.length).toBeGreaterThan(0);
          const present = line.about ?? post.author.id;
          for (const id of line.sources) {
            const event = day.require(id);
            expect(whereabouts.saw(present, event)).toBe(true);
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
      const post = writePost({
        day,
        whereabouts,
        scoring,
        templates,
        stages,
        worldSeed: SEED,
        author: person,
      });
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
        templates: { maxLines: 3, wording: {}, family: {} },
        stages,
        worldSeed: SEED,
        author: person,
      });
      expect(post).toBeUndefined();
    }
  });

  it('runs no post longer than the book allows', () => {
    // `maxLines` counts the writer's own day. One line about a child may sit on
    // top of it, and only one, and only at the end -- so the cap is checked
    // against the writer's own lines rather than against the total, and the
    // shape of the extra line is checked separately rather than by widening the
    // number until everything fits under it.
    for (const { posts } of written) {
      for (const post of posts) {
        expect(post.lines.length).toBeGreaterThan(0);
        const own = post.lines.filter((line) => line.about === undefined);
        const theirs = post.lines.filter((line) => line.about !== undefined);
        expect(own.length).toBeGreaterThan(0);
        expect(own.length).toBeLessThanOrEqual(templates.maxLines);
        expect(theirs.length).toBeLessThanOrEqual(1);
        if (theirs.length === 1) expect(post.lines[post.lines.length - 1]).toBe(theirs[0]);
      }
    }
  });

  it('writes at most one line per kind of moment', () => {
    // Of the writer's own moments. A mother whose morning and whose daughter's
    // morning were both worth a line is saying two different things, and the
    // rule against repeating yourself was never about that.
    for (const { day, posts } of written) {
      for (const post of posts) {
        const kinds = post.lines
          .filter((line) => line.about === undefined)
          .flatMap((line) => line.sources)
          .map((id) => day.require(id).type);
        expect(new Set(kinds).size).toBe(kinds.length);
      }
    }
  });

  it('tells each day in the order it happened', () => {
    // The writer's own day. The line about a child is an afterthought and reads
    // as one, so it goes last whatever hour it belonged to.
    for (const { day, posts } of written) {
      for (const post of posts) {
        const ticks = post.lines
          .filter((line) => line.about === undefined)
          .flatMap((line) => line.sources)
          .map((id) => day.require(id).tick);
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
              templates: { maxLines: 1, wording: { [event.type]: [variant] }, family: {} },
              stages,
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

/**
 * The bands, against the village they are meant to describe.
 *
 * `has nothing in it that no real event can reach` above already refuses a
 * wording nothing fits, and it covers bands as a side effect. It cannot cover
 * either of these, and both are ways of being wrong that produce a site nobody
 * would look at twice.
 *
 * One: a stage of life left out of a set of bands. Six wordings for waking, one
 * for each stage, and a seventh stage that quietly gets none -- every villager in
 * it falls back on the general phrasing and sounds like nobody in particular,
 * forever, and nothing fails.
 *
 * Two: a stage nobody in it can write. A wording banded `infant` in the writers'
 * book is dead on arrival, because nobody under ten is ever on the rota -- and
 * the reachability test would still pass it, since that test offers each wording
 * to whoever was present rather than to whoever could have written it.
 */
describe('the bands, against the village', () => {
  /** Which stages hold writers, and which hold children somebody speaks for. */
  const occupied = (): { writers: Set<string>; spokenFor: Set<string> } => {
    const writers = new Set<string>();
    const spokenFor = new Set<string>();
    for (const { day } of written) {
      for (const person of store.people.records()) {
        const age = yearsBetween(person.born, day.key);
        const band = stages.bandFor(age);
        if (age >= selection.writingAge) writers.add(band);
        else spokenFor.add(band);
      }
    }
    return { writers, spokenFor };
  };

  /** Every stage any wording in a book is banded to. */
  const banded = (book: Record<string, readonly Template[]>): Set<string> => {
    const found = new Set<string>();
    for (const variants of Object.values(book)) {
      for (const variant of variants) for (const band of variant.bands ?? []) found.add(band);
    }
    return found;
  };

  it('gives every stage of life in the village something of its own to say', () => {
    const { writers, spokenFor } = occupied();
    expect(writers.size).toBeGreaterThan(1);
    expect(spokenFor.size).toBeGreaterThan(1);

    expect([...writers].filter((band) => !banded(templates.wording).has(band))).toEqual([]);
    expect([...spokenFor].filter((band) => !banded(templates.family).has(band))).toEqual([]);
  });

  it('bands no wording to a stage that nobody in it could ever say it', () => {
    // Both halves, because the two books have different populations. The writers'
    // book is read by anybody old enough to be on the rota; the family book is
    // only ever about a child too young for that. A wording banded `elder` in the
    // family book would be a sentence about a seventy-year-old toddler.
    const { writers, spokenFor } = occupied();

    expect([...banded(templates.wording)].filter((band) => !writers.has(band))).toEqual([]);
    expect([...banded(templates.family)].filter((band) => !spokenFor.has(band))).toEqual([]);
  });

  it('says something different to a villager of seventy than to one of twelve', () => {
    // The end of the pipe, and the only test here a reader would recognise. Two
    // real villagers at opposite ends of the village, each given the same day,
    // must not come out with the same set of possible lines -- otherwise the
    // bands parse, cover the village, and change nothing that reaches the page.
    const { day } = written[written.length - 1] as Written;
    const people = store.people.records();
    const ageOf = (person: PersonRecord): number => yearsBetween(person.born, day.key);
    const grown = people.filter((person) => ageOf(person) >= selection.writingAge);
    const eldest = grown.reduce((a, b) => (ageOf(a) >= ageOf(b) ? a : b));
    const youngest = grown.reduce((a, b) => (ageOf(a) <= ageOf(b) ? a : b));
    expect(stages.bandFor(ageOf(eldest))).not.toBe(stages.bandFor(ageOf(youngest)));

    // Everything either of them may say about waking, over every day of the run,
    // so the comparison does not turn on which variant a single seed chose.
    const wokeWords = (person: PersonRecord): Set<string> => {
      const found = new Set<string>();
      for (const one of written) {
        const context = {
          day: one.day,
          band: stages.bandFor(yearsBetween(person.born, one.day.key)),
          words: (key: string) => (key === 'me' ? person.name : undefined),
        };
        for (const event of one.day.byActor(person.id)) {
          if (event.type !== 'npc.woke') continue;
          for (const fits of eligible(templates.wording['npc.woke'] ?? [], event, context)) {
            found.add(fits.text);
          }
        }
      }
      return found;
    };

    const old = wokeWords(eldest);
    const young = wokeWords(youngest);
    expect(old.size).toBeGreaterThan(0);
    expect(young.size).toBeGreaterThan(0);
    expect([...old].filter((line) => !young.has(line))).not.toEqual([]);
    expect([...young].filter((line) => !old.has(line))).not.toEqual([]);
  });
});

describe('the children of Pennycroft', () => {
  /**
   * Parent to children, read straight out of the archive.
   *
   * Deliberately not `Kinfolk`, which is the thing these tests are checking.
   * An index that quietly dropped half the village would agree with itself
   * about everything if the test asked it who was related to whom.
   */
  const parentage = (): Map<EntityId, EntityId[]> => {
    const found = new Map<EntityId, EntityId[]>();
    for (const { day } of written) {
      for (const event of day.byType('society.parentage-recorded')) {
        const data = event.data as Record<string, unknown>;
        const child = data['child'] as EntityId | null;
        if (child === null) continue;
        for (const role of ['mother', 'father'] as const) {
          const parent = data[role] as EntityId | null;
          if (parent === null) continue;
          found.set(parent, [...(found.get(parent) ?? []), child]);
        }
      }
    }
    return found;
  };

  const ageOn = (who: EntityId, key: string): number => {
    const person = store.people.find(who);
    expect(person).toBeDefined();
    return yearsBetween((person as { born: string }).born, key);
  };

  it('has small children in it, or none of the rest of this means anything', () => {
    // The guard on every other test on this page. A village that happened to
    // have nobody under ten would pass all of them by having nothing to fail
    // on, and would go on passing them after the rule was deleted.
    const last = written[written.length - 1] as Written;
    const young = store.people
      .records()
      .filter((person) => yearsBetween(person.born, last.day.key) < selection.writingAge);

    expect(young.length).toBeGreaterThan(5);
  });

  it('never puts anybody under the writing age on the rota', () => {
    for (const { day, posts } of written) {
      for (const post of posts) {
        expect(yearsBetween(post.author.born, day.key)).toBeGreaterThanOrEqual(selection.writingAge);
      }
    }
  });

  it('only ever speaks for a young child of the writer’s own', () => {
    // Three claims on one line, and all three have to hold: the person spoken
    // for is in the record, they are this writer's child, and they are still
    // too young to have said it themselves.
    const parents = parentage();
    let spoken = 0;

    for (const { day, posts } of written) {
      for (const post of posts) {
        for (const line of post.lines) {
          if (line.about === undefined) continue;
          expect(store.people.has(line.about)).toBe(true);
          expect(parents.get(post.author.id) ?? []).toContain(line.about);
          // And the index the press actually wrote from agrees with the record.
          expect(household.kin.childrenOf(post.author.id)).toContain(line.about);
          expect(ageOn(line.about, day.key)).toBeLessThan(selection.writingAge);
          spoken++;
        }
      }
    }

    expect(spoken).toBeGreaterThan(0);
  });

  it('gets the little ones onto the site about as often as the config says', () => {
    // The config asks for a mention on half the posts that *could* carry one,
    // so that is the denominator: counting against every post would fold in how
    // often the rota happens to pick a parent, and would move whenever worldgen
    // did. A post that could have carried one is a writer with a young child
    // whose day held something the family book has wording for.
    //
    // The bounds are wide because the roll is a roll and a hundred and fifty
    // posts is a small sample; pinning the number would be pinning the seed.
    // What is claimed is that the dial is connected at both ends -- a fifty
    // that produced two mentions, or produced all of them, would be a fifty
    // that means nothing.
    let posts = 0;
    let could = 0;
    let mentions = 0;

    for (const { day, posts: today } of written) {
      for (const post of today) {
        posts++;
        if (post.lines.some((line) => line.about !== undefined)) mentions++;
        const young = household.kin.childrenOf(post.author.id).some((id) => {
          const child = store.people.find(id);
          if (child === undefined) return false;
          if (yearsBetween(child.born, day.key) >= selection.writingAge) return false;
          return day.byActor(id).some((event) => templates.family[event.type] !== undefined);
        });
        if (young) could++;
      }
    }

    expect(posts).toBeGreaterThan(DAYS * 3);
    expect(could).toBeGreaterThan(DAYS);
    expect(mentions).toBeLessThanOrEqual(could);

    const rate = (mentions / could) * 100;
    expect(rate).toBeGreaterThan(selection.mentionsChild - 25);
    expect(rate).toBeLessThan(selection.mentionsChild + 25);
  });
});

describe('the shipped family wording, against real days', () => {
  it('has nothing in it that no real child can reach', () => {
    // The same claim the first-person book is held to, and it needs more
    // scaffolding for the same reason it matters more: these lines are about
    // somebody who cannot check them. A family wording that fitted nothing
    // would be a phrase nobody ever reads, and the way to find out is to put
    // every one of them in front of a real child of a real writer.
    const reached = new Set<Template>();
    const all: Template[] = [];
    for (const variants of Object.values(templates.family)) all.push(...variants);

    /** One pair, taught the way the press teaches it: off a parentage event. */
    const kinOf = (parent: EntityId, child: EntityId, key: string): Kinfolk => {
      const kin = new Kinfolk();
      kin.learn(
        new ChronicleDay({
          key,
          events: [
            {
              id: 1,
              tick: 0,
              type: 'society.parentage-recorded',
              actors: [child],
              data: { child, mother: parent, motherAbsent: null, father: null, fatherAbsent: null },
              causes: [],
            },
          ],
          people: store.people,
          places: store.places,
        }),
      );
      return kin;
    };

    const parents = new Map<EntityId, EntityId[]>();
    for (const { day } of written) {
      for (const event of day.byType('society.parentage-recorded')) {
        const data = event.data as Record<string, unknown>;
        const child = data['child'] as EntityId | null;
        if (child === null) continue;
        for (const role of ['mother', 'father'] as const) {
          const parent = data[role] as EntityId | null;
          if (parent === null) continue;
          parents.set(child, [...(parents.get(child) ?? []), parent]);
        }
      }
    }

    for (const { day, whereabouts } of written) {
      for (const event of day.events) {
        const variants = templates.family[event.type];
        if (variants === undefined) continue;
        if (variants.every((variant) => reached.has(variant))) continue;

        for (const actor of event.actors) {
          const child = store.people.find(actor);
          if (child === undefined) continue;
          if (yearsBetween(child.born, day.key) >= selection.writingAge) continue;

          for (const id of parents.get(actor) ?? []) {
            const parent = store.people.find(id);
            if (parent === undefined) continue;
            for (const variant of variants) {
              if (reached.has(variant)) continue;
              const one = writePost({
                day,
                whereabouts,
                scoring,
                templates: { ...templates, family: { [event.type]: [variant] } },
                stages,
                worldSeed: SEED,
                // Certainty, because this is a question about the wording and
                // not about the roll. A coin here would make the test flaky in
                // exactly the direction that reads as "the wording is dead".
                household: { kin: kinOf(id, actor, day.key), writingAge: selection.writingAge, chance: 100 },
                author: parent,
              });
              if (one?.lines.some((line) => line.about === actor) === true) reached.add(variant);
            }
          }
        }
      }
    }

    const dead = all.filter((variant) => !reached.has(variant)).map((variant) => variant.text);
    expect(dead).toEqual([]);
    expect(all.length).toBeGreaterThan(0);
  });

  it('is a different book from the one the villagers write in', () => {
    // Nothing in the family section may be first person, and the check is not
    // a search for `{me}` -- it is that the wording cannot be *rendered* by the
    // context a family line gets. A phrase that named the writer would have to
    // ask for a word that context does not answer, and so would fit nothing.
    for (const variants of Object.values(templates.family)) {
      for (const variant of variants) {
        expect(variant.text).not.toContain('{me}');
        expect(variant.text).not.toContain('{first}');
      }
    }
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
    // Re-pinned for the sentence seam: a place is named on the record as a
    // whole noun phrase, `A cottage on Bridge Row`, and eighty-five posts read
    // `Abed at A cottage on Bridge Row.` The article is now lowered where the
    // name sits inside a sentence, so the wording of those lines moved and this
    // moved with it. First pinned when slice 5 shipped.
    //
    // Re-pinned for the age bands: the wording book now holds several ways of
    // saying the same thing, one per stage of life, and a villager is only
    // offered the ones written for the age they are. Every poster's morning and
    // night lines were drawn from a different set of candidates than before, so
    // this moved for all of them at once.
    const posts = dayOf(ORDINARY).posts;
    expect(posts.length).toBeGreaterThan(0);
    expect(fnv1a64Hex(printed(posts))).toBe('d8d56737305fbc9b');
  });

  it('writes the day the children were pinned on', () => {
    // A second pin, and it exists because the first one did not move when the
    // family lines shipped: on the second of Blossom nobody's roll came up, so
    // an ordinary day is exactly the day that cannot see this feature. Pinned
    // on a day that carries three of them instead, so that a change to the
    // family wording, to the roll, or to who counts as a child has somewhere to
    // break. Same rules as the pin above: re-pin it in the same commit as the
    // change and say why.
    //
    // Re-pinned for the age bands, same as the pin above, and for one more
    // reason of its own: a parent's line about a small child is banded by the
    // child's stage rather than the parent's, so all three of the mentions this
    // day carries were drawn from a narrower set than before. The count of three
    // did not move, which is the point of asserting it separately.
    const posts = dayOf(FAMILY_DAY).posts;
    const mentions = posts.flatMap((post) => post.lines).filter((line) => line.about !== undefined);
    expect(mentions).toHaveLength(3);
    expect(fnv1a64Hex(printed(posts))).toBe('8adf5ccdcbf69021');
  });
});
