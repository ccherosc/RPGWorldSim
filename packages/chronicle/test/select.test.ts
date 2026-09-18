import { describe, expect, it } from 'vitest';
import {
  type Candidate,
  ChronicleDay,
  PeopleRegister,
  PlaceRegister,
  type PublishedDay,
  type ScoringConfig,
  type SelectionConfig,
  SelectionSchema,
  lastPostedWithin,
  rankCandidates,
  select,
  selectHeadlines,
  selectPosters,
} from '@rpgsim/chronicle';
import {
  DEFAULT_CALENDAR,
  type EntityId,
  EntityKind,
  type SimEvent,
  TICKS_PER_DAY,
  dayKeyOf,
  makeEntityId,
} from '@rpgsim/sim-core';

/**
 * What runs, and who writes it.
 *
 * The rotation tests build their thirty days by hand rather than simulating
 * them. A real thirty-day run takes minutes and is the integration test's job
 * (`apps/simulator/test/edition.test.ts`); what is being asked here is narrower
 * and sharper — *given a village where everybody is equally interesting, does
 * the rota still share the page out* — and a synthetic village is the only way
 * to ask that, because a real one never is.
 */

const FIRST_DAY = 90;
const keyOf = (day: number): string => dayKeyOf(day * TICKS_PER_DAY, DEFAULT_CALENDAR);
const KEY = keyOf(FIRST_DAY);

const npc = (index: number): EntityId => makeEntityId(EntityKind.Npc, index);
const place = (index: number): EntityId => makeEntityId(EntityKind.Location, index);
const household = (index: number): EntityId => makeEntityId(EntityKind.Household, index);

const SCORING: ScoringConfig = {
  rarity: 120,
  refusals: ['travel.blocked', 'npc.could-not-rest'],
  refusal: 40,
  crowd: 8,
  crowdCap: 40,
  stage: 12,
  consequence: 10,
  consequenceCap: 30,
};

const SELECTION: SelectionConfig = {
  headlines: 6,
  perType: 2,
  floor: 30,
  posters: 5,
  memory: 30,
  cooling: 200,
};

let nextId = 1;

function event(
  type: string,
  options: {
    actors?: readonly EntityId[];
    location?: EntityId;
    causes?: readonly number[];
    data?: Record<string, unknown>;
  } = {},
): SimEvent {
  return {
    id: nextId++,
    tick: FIRST_DAY * TICKS_PER_DAY,
    type,
    actors: options.actors ?? [],
    ...(options.location !== undefined ? { location: options.location } : {}),
    data: (options.data ?? {}) as SimEvent['data'],
    causes: options.causes ?? [],
  };
}

/** A village of `souls` people, two places, one public and one not. */
function village(souls: number): { people: PeopleRegister; places: PlaceRegister } {
  const people = new PeopleRegister();
  const places = new PlaceRegister();
  for (let index = 0; index < souls; index++) {
    people.add({
      id: npc(index),
      // Distinct surnames so the slugs are distinct and ordered predictably:
      // the rota's last tie-break is the slug, and a test that could not tell
      // two candidates apart would not be testing the tie-break.
      name: `Villager Number${String(index).padStart(2, '0')}`,
      sex: index % 2 === 0 ? 'female' : 'male',
      born: '1170-03-02',
      family: null,
    });
  }
  places.add({ id: place(0), name: 'The Green', type: 'square', access: 'public' });
  places.add({ id: place(1), name: 'A cottage on Mill Lane', type: 'dwelling', access: 'private' });
  return { people, places };
}

function day(events: readonly SimEvent[], souls = 8, key = KEY): ChronicleDay {
  const { people, places } = village(souls);
  return new ChronicleDay({ key, events, people, places });
}

const slugsOf = (posters: readonly Candidate[]): readonly string[] =>
  posters.map((c) => c.person.slug);

describe('the config', () => {
  it('is what ships in data/chronicle/selection.json', () => {
    expect(() => SelectionSchema.parse(SELECTION)).not.toThrow();
  });

  it('refuses a page that can hold no kind of event at all', () => {
    // `perType: 0` would silently empty every edition; the schema says so
    // rather than letting a reader find out.
    expect(() => SelectionSchema.parse({ ...SELECTION, perType: 0 })).toThrow();
    expect(() => SelectionSchema.parse({ ...SELECTION, headlines: -1 })).toThrow();
    expect(() => SelectionSchema.parse({ ...SELECTION, cooling: 1.5 })).toThrow();
  });
});

describe('the front page', () => {
  it('leads with the day’s most newsworthy event', () => {
    nextId = 1;
    const dull = event('npc.woke', { actors: [npc(0)] });
    const loud = event('travel.blocked', { actors: [npc(1)], location: place(0) });
    const headlines = selectHeadlines({
      day: day([dull, loud]),
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });

    expect(headlines[0]?.event.id).toBe(loud.id);
  });

  it('runs nothing below the floor, however short the page is', () => {
    nextId = 1;
    // Twenty of a kind: rarity 120/20 = 6, plus nothing. Well under the floor.
    const dull = Array.from({ length: 20 }, (_, index) =>
      event('travel.arrived', { actors: [npc(index % 8)] }),
    );
    const headlines = selectHeadlines({
      day: day(dull),
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });

    // A quiet day gets a short edition rather than a padded one.
    expect(headlines).toEqual([]);
  });

  it('will not let one kind of event own the page', () => {
    nextId = 1;
    // Six identical refusals, all scoring the same and all above the floor.
    const blocked = Array.from({ length: 6 }, (_, index) =>
      event('travel.blocked', { actors: [npc(index)], location: place(0) }),
    );
    const headlines = selectHeadlines({
      day: day(blocked),
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });

    expect(headlines).toHaveLength(SELECTION.perType);
    expect(headlines.every((h) => h.event.type === 'travel.blocked')).toBe(true);
  });

  it('fills the slots the cap freed with the next kind down', () => {
    nextId = 1;
    const blocked = Array.from({ length: 4 }, (_, index) =>
      event('travel.blocked', { actors: [npc(index)], location: place(0) }),
    );
    const founded = event('society.household-founded', {
      actors: [npc(5), npc(6)],
      location: place(0),
    });
    const headlines = selectHeadlines({
      day: day([...blocked, founded]),
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });

    // Four refusals split one rarity budget four ways and score 82 each; the
    // lone founding takes the whole of it and leads. The cap then trims the
    // refusals to two, and the page ends three long instead of five.
    expect(headlines.map((h) => h.event.type)).toEqual([
      'society.household-founded',
      'travel.blocked',
      'travel.blocked',
    ]);
  });

  it('runs no more than the edition holds', () => {
    nextId = 1;
    // Eight distinct kinds, each the only one of its kind, so each scores 120.
    const events = [
      'npc.removed',
      'npc.could-not-rest',
      'society.household-founded',
      'society.parentage-recorded',
      'npc.home-changed',
      'npc.household-changed',
      'world.generated',
      'place.created',
    ].map((type, index) => event(type, { actors: [npc(index % 8)], location: place(0) }));

    const headlines = selectHeadlines({
      day: day(events),
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });
    expect(headlines).toHaveLength(SELECTION.headlines);
  });

  it('does not care who has been posting', () => {
    nextId = 1;
    const loud = event('travel.blocked', { actors: [npc(0)], location: place(0) });
    const chronicle = day([loud]);
    const rested = selectHeadlines({
      day: chronicle,
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });
    const tired = selectHeadlines({
      day: chronicle,
      scoring: SCORING,
      selection: SELECTION,
      published: Array.from({ length: 10 }, (_, index) => ({
        key: keyOf(FIRST_DAY - 10 + index),
        posters: ['villager-number00'],
      })),
    });

    // The rota is about whose voice we have heard lately. It is not a reason to
    // suppress the news itself.
    expect(tired).toEqual(rested);
  });
});

describe('who posts', () => {
  it('considers everybody the day happened to', () => {
    nextId = 1;
    const chronicle = day([
      event('npc.woke', { actors: [npc(0)] }),
      event('npc.woke', { actors: [npc(1)] }),
      event('npc.woke', { actors: [npc(2)] }),
    ]);
    const ranked = rankCandidates({
      day: chronicle,
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });

    expect(ranked).toHaveLength(3);
    expect(ranked.every((c) => c.penalty === 0 && c.since === null)).toBe(true);
  });

  it('leaves out somebody the day did not happen to', () => {
    nextId = 1;
    const chronicle = day([event('npc.woke', { actors: [npc(0)] })]);
    const ranked = rankCandidates({
      day: chronicle,
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });

    expect(slugsOf(ranked)).toEqual(['villager-number00']);
  });

  it('does not ask a household to write a blog post', () => {
    nextId = 1;
    // `society.household-founded` names the household among its actors. It is
    // an actor, it is not a person, and it is not an error either.
    const chronicle = day([
      event('society.household-founded', { actors: [npc(0), household(3)], location: place(0) }),
    ]);
    const ranked = rankCandidates({
      day: chronicle,
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });

    expect(slugsOf(ranked)).toEqual(['villager-number00']);
  });

  it('judges a person by their best moment, not by how busy they were', () => {
    nextId = 1;
    // Four hundred arrivals is a dull day. One refusal is a story.
    const busy = Array.from({ length: 12 }, () =>
      event('travel.arrived', { actors: [npc(0)], location: place(0) }),
    );
    const quiet = event('travel.blocked', { actors: [npc(1)], location: place(0) });
    const ranked = rankCandidates({
      day: day([...busy, quiet]),
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });

    expect(slugsOf(ranked)).toEqual(['villager-number01', 'villager-number00']);
    // Summing would have made the busy one the most interesting person alive.
    expect(ranked[0]?.best.event.id).toBe(quiet.id);
  });

  it('remembers the high point of a mixed day, not the low one', () => {
    nextId = 1;
    // The previous test cannot tell "best" from "worst": villager 00's twelve
    // arrivals all score the same. This one gives one person both a dull moment
    // and a loud one, which is the only shape that can.
    const dull = event('travel.arrived', { actors: [npc(0)], location: place(0) });
    const loud = event('travel.blocked', { actors: [npc(0)], location: place(0) });
    const ranked = rankCandidates({
      day: day([dull, loud]),
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });

    expect(ranked[0]?.best.event.id).toBe(loud.id);
    expect(ranked[0]?.best.total).toBe(172); // 120 + 40 refusal + 12 stage
    expect(ranked[0]?.merit).toBe(172);
  });

  it('posts only as many as the day has room for', () => {
    nextId = 1;
    const events = Array.from({ length: 8 }, (_, index) =>
      event('npc.woke', { actors: [npc(index)] }),
    );
    const posters = selectPosters({
      day: day(events),
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });

    expect(posters).toHaveLength(SELECTION.posters);
  });

  it('breaks a dead tie by slug, so two runs agree', () => {
    nextId = 1;
    // One event, everybody in it: identical merit, identical best moment.
    const together = event('npc.woke', { actors: [npc(3), npc(1), npc(2), npc(0)] });
    const ranked = rankCandidates({
      day: day([together]),
      scoring: SCORING,
      selection: SELECTION,
      published: [],
    });

    expect(slugsOf(ranked)).toEqual([
      'villager-number00',
      'villager-number01',
      'villager-number02',
      'villager-number03',
    ]);
  });
});

describe('how long ago somebody last posted', () => {
  const published = (...days: readonly (readonly string[])[]): PublishedDay[] =>
    days.map((posters, index) => ({ key: keyOf(FIRST_DAY - days.length + index), posters }));

  it('counts yesterday as one, so the penalty has something to divide by', () => {
    const since = lastPostedWithin(published(['agnes'], ['walter']), KEY, 30);
    expect(since.get('walter')).toBe(1);
    expect(since.get('agnes')).toBe(2);
  });

  it('remembers the most recent time, not the first', () => {
    const since = lastPostedWithin(published(['agnes'], ['walter'], ['agnes']), KEY, 30);
    expect(since.get('agnes')).toBe(1);
  });

  it('has never heard of somebody who has not posted', () => {
    const since = lastPostedWithin(published(['agnes']), KEY, 30);
    expect(since.get('nesta')).toBeUndefined();
  });

  it('forgets past the edge of its memory', () => {
    const since = lastPostedWithin(published(['agnes'], ['walter'], ['nesta']), KEY, 2);
    expect(since.get('nesta')).toBe(1);
    expect(since.get('walter')).toBe(2);
    expect(since.get('agnes')).toBeUndefined();
  });

  it('ignores the day being built and everything after it', () => {
    // This is what makes rebuilding an old edition reproduce the original rota
    // rather than a new one informed by days that had not happened yet.
    const days: PublishedDay[] = [
      { key: keyOf(FIRST_DAY - 1), posters: ['agnes'] },
      { key: KEY, posters: ['walter'] },
      { key: keyOf(FIRST_DAY + 1), posters: ['nesta'] },
    ];

    const since = lastPostedWithin(days, KEY, 30);
    expect(since.get('agnes')).toBe(1);
    expect(since.get('walter')).toBeUndefined();
    expect(since.get('nesta')).toBeUndefined();
  });

  it('counts published days, not calendar days', () => {
    // A site that skipped a season has not thereby rested anybody: Agnes is
    // still the most recent voice the readers heard.
    const days: PublishedDay[] = [
      { key: '1200-01-01', posters: ['walter'] },
      { key: '1200-02-01', posters: ['agnes'] },
    ];

    const since = lastPostedWithin(days, KEY, 30);
    expect(since.get('agnes')).toBe(1);
    expect(since.get('walter')).toBe(2);
  });

  it('does not mind what order the published days arrive in', () => {
    const forwards: PublishedDay[] = [
      { key: keyOf(FIRST_DAY - 2), posters: ['agnes'] },
      { key: keyOf(FIRST_DAY - 1), posters: ['walter'] },
    ];
    expect(lastPostedWithin([...forwards].reverse(), KEY, 30)).toEqual(
      lastPostedWithin(forwards, KEY, 30),
    );
  });
});

describe('the rota, over thirty days', () => {
  const DAYS = 30;
  const SOULS = 20;

  function run(selection: SelectionConfig): PublishedDay[] {
    const published: PublishedDay[] = [];
    for (let dayNumber = 0; dayNumber < DAYS; dayNumber++) {
      nextId = 1;
      const { people, places } = village(SOULS);
      const events = Array.from({ length: SOULS }, (_, index) =>
        event('npc.woke', { actors: [npc(index)], location: place(0) }),
      );
      const key = keyOf(FIRST_DAY + dayNumber);
      const chronicle = new ChronicleDay({ key, events, people, places });
      const edition = select({ day: chronicle, scoring: SCORING, selection, published });
      published.push({ key, posters: slugsOf(edition.posters) });
    }
    return published;
  }

  const tally = (published: readonly PublishedDay[]): Map<string, number> => {
    const times = new Map<string, number>();
    for (const day of published) {
      for (const slug of day.posters) times.set(slug, (times.get(slug) ?? 0) + 1);
    }
    return times;
  };

  it('gives nearly everybody a turn', () => {
    const times = tally(run(SELECTION));
    expect(times.size).toBe(SOULS);
  });

  it('lets nobody post on more than a third of the days', () => {
    const times = tally(run(SELECTION));
    const busiest = Math.max(...times.values());
    expect(busiest / DAYS).toBeLessThanOrEqual(1 / 3);
  });

  it('never runs the same villager two days running', () => {
    const published = run(SELECTION);
    for (let index = 1; index < published.length; index++) {
      const today = new Set((published[index] as PublishedDay).posters);
      for (const slug of (published[index - 1] as PublishedDay).posters) {
        expect(today.has(slug)).toBe(false);
      }
    }
  });

  it('produces the same thirty days on a second run', () => {
    // The whole reason the penalty is derived from the published days rather
    // than stored: a rebuild from an empty site reproduces the rota exactly.
    expect(run(SELECTION)).toEqual(run(SELECTION));
  });

  it('would run the same five people every day without the penalty', () => {
    // The teeth of the three tests above. Turn the cooling off and the very
    // same village hands the page to the same five villagers thirty times.
    const published = run({ ...SELECTION, cooling: 0 });
    const times = tally(published);

    expect(times.size).toBe(SELECTION.posters);
    expect(Math.max(...times.values())).toBe(DAYS);
  });

  it('lets somebody genuinely newsworthy come back, without locking anybody out', () => {
    const published: PublishedDay[] = [];
    for (let dayNumber = 0; dayNumber < DAYS; dayNumber++) {
      nextId = 1;
      const { people, places } = village(SOULS);
      // Villager 00 is turned back from a full cottage every single day; the
      // other nineteen simply wake up.
      const events: SimEvent[] = [
        event('travel.blocked', { actors: [npc(0)], location: place(0) }),
        ...Array.from({ length: SOULS - 1 }, (_, index) =>
          event('npc.woke', { actors: [npc(index + 1)], location: place(0) }),
        ),
      ];
      const key = keyOf(FIRST_DAY + dayNumber);
      const chronicle = new ChronicleDay({ key, events, people, places });
      const edition = select({
        day: chronicle,
        scoring: SCORING,
        selection: SELECTION,
        published,
      });
      published.push({ key, posters: slugsOf(edition.posters) });
    }

    const times = tally(published);
    const loudest = times.get('villager-number00') ?? 0;
    const others = [...times].filter(([slug]) => slug !== 'villager-number00');

    // She earns her way back on far sooner than an even share would give her.
    // Measured, this is most days: her refusal scores 172 against everybody
    // else's 18, and once the whole village carries a penalty her 172 minus a
    // full 200 still beats their 18 minus a partial one. That is the rule
    // working as written -- a preference the numbers may overcome rather than a
    // ban -- and it is the honest report of a village where exactly one thing
    // ever happens. It is not asserted as a *good* outcome, and if a real run
    // ever produces a villager like this the answer is more kinds of day, not a
    // harder cooling number.
    expect(loudest).toBeGreaterThan((DAYS * SELECTION.posters) / SOULS);

    // What must hold even then: nobody is locked out of the page, and the four
    // seats she is not sitting in keep going round.
    expect(times.size).toBe(SOULS);
    for (const [, posts] of others) expect(posts / DAYS).toBeLessThanOrEqual(1 / 3);
  });
});

describe('an edition', () => {
  it('is the day’s headlines, posters and key', () => {
    nextId = 1;
    const chronicle = day([
      event('travel.blocked', { actors: [npc(0)], location: place(0) }),
      event('npc.woke', { actors: [npc(1)] }),
    ]);
    const options = { day: chronicle, scoring: SCORING, selection: SELECTION, published: [] };
    const edition = select(options);

    expect(edition.key).toBe(KEY);
    expect(edition.headlines).toEqual(selectHeadlines(options));
    expect(edition.posters).toEqual(selectPosters(options));
  });

  it('throws on an id the record has never heard of rather than rendering it', () => {
    nextId = 1;
    const chronicle = day([event('npc.woke', { actors: [npc(0)] })]);

    expect(() => chronicle.require(999)).toThrow(/no such event/);
    expect(() => chronicle.people.require(npc(99))).toThrow();
    expect(() => chronicle.places.require(place(99))).toThrow(/no record of this place/);
  });
});
