import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ChronicleDay,
  type PaperBook,
  PaperBookSchema,
  PeopleRegister,
  PlaceRegister,
  type ScoringConfig,
  glanceOf,
  rank,
  reviewOf,
  writePaper,
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
 * The Towne Publication, on days small enough to check by hand.
 *
 * The paper's risks are not the blog's. A post can be wrong about one person's
 * day; the paper is wrong about the whole village at once, and every number on
 * it is a claim. So most of what follows is aimed at the four ways it could lie:
 * a heading with nothing under it, a count that came from somewhere other than
 * the events, a sentence about somebody the record has never heard of, and the
 * page printing something it has promised not to.
 *
 * The wording here is a small book written for these tests. The shipped one is
 * checked for parsing here and for reachability in `apps/simulator/test`, where
 * there are real days to reach it with — a test that asserted on the shipped
 * prose would change meaning every time somebody improved a sentence.
 */

const FIRST_DAY = 90;
const DAWN = FIRST_DAY * TICKS_PER_DAY;
const KEY = dayKeyOf(DAWN, DEFAULT_CALENDAR);
const SEED = 'world-zero';
const VILLAGE = 'Wodenshill';

const npc = (index: number): EntityId => makeEntityId(EntityKind.Npc, index);
const place = (index: number): EntityId => makeEntityId(EntityKind.Location, index);
const household = (index: number): EntityId => makeEntityId(EntityKind.Household, index);

const GREEN = place(0);
const COTTAGE = place(1);
const MILL = place(2);

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

const BOOK: PaperBook = {
  maxStories: 4,
  neverPrint: ['npc.woke', 'npc.went-to-bed'],
  wording: {
    'travel.blocked': [
      { text: '{who} got no further than {destination}.', when: { reason: ['full'] } },
    ],
    'society.household-founded': [{ text: 'The {name} household has taken {dwelling}.' }],
    'place.created': [{ text: '{name} stands.' }],
  },
  colophon: ['This page cannot yet tell you what anybody was thinking.'],
};

let nextId = 1;

function event(
  type: string,
  at: number,
  options: {
    actors?: readonly EntityId[];
    location?: EntityId;
    data?: Record<string, unknown>;
  } = {},
): SimEvent {
  return {
    id: nextId++,
    tick: DAWN + at,
    type,
    actors: options.actors ?? [],
    ...(options.location !== undefined ? { location: options.location } : {}),
    data: (options.data ?? {}) as SimEvent['data'],
    causes: [],
  };
}

const woke = (who: EntityId, at: number): SimEvent =>
  event('npc.woke', at, { actors: [who], location: COTTAGE });

const abed = (who: EntityId, at: number): SimEvent =>
  event('npc.went-to-bed', at, { actors: [who], location: COTTAGE });

/** A completed journey: an arrival the traveller actually set out for. */
const arrived = (who: EntityId, where: EntityId, at: number): SimEvent =>
  event('travel.arrived', at, {
    actors: [who],
    location: where,
    data: { traveller: who, to: where, final: true },
  });

/** A leg of one: an arrival at a waypoint, with the journey still to finish. */
const waypoint = (who: EntityId, where: EntityId, at: number): SimEvent =>
  event('travel.arrived', at, {
    actors: [who],
    location: where,
    data: { traveller: who, to: MILL, final: false },
  });

const blocked = (who: EntityId, at: number, reason = 'full'): SimEvent =>
  event('travel.blocked', at, {
    actors: [who],
    location: GREEN,
    data: { traveller: who, destination: MILL, reason, capacity: 6, occupancy: 6 },
  });

function village(): { people: PeopleRegister; places: PlaceRegister } {
  const people = new PeopleRegister();
  const places = new PlaceRegister();
  const cast: readonly [string, string | null][] = [
    ['Winifred Hargrave', 'hargrave'],
    ['Godric Netherby', 'netherby'],
    ['Alditha Salter', 'salter'],
    ['Walter Hargrave', 'hargrave'],
    ['Joan Fletcher', null],
  ];
  cast.forEach(([name, family], index) => {
    people.add({ id: npc(index), name, sex: 'female', born: '1170-03-02', family });
  });
  places.add({ id: GREEN, name: 'The Green', type: 'square', access: 'public' });
  places.add({ id: COTTAGE, name: 'A cottage on Mill Lane', type: 'dwelling', access: 'private' });
  places.add({ id: MILL, name: 'The Mill', type: 'workshop', access: 'private' });
  return { people, places };
}

function day(events: readonly SimEvent[]): ChronicleDay {
  const { people, places } = village();
  return new ChronicleDay({ key: KEY, events, people, places });
}

/** Everything `writePaper` needs, with the day's own events scored for it. */
function issue(events: readonly SimEvent[], book: PaperBook = BOOK) {
  const chronicle = day(events);
  return {
    day: chronicle,
    headlines: rank(SCORING, chronicle),
    book,
    village: VILLAGE,
    worldSeed: SEED,
  };
}

const storiesOf = (events: readonly SimEvent[], book: PaperBook = BOOK): readonly string[] =>
  reviewOf(issue(events, book)).map((story) => story.text);

describe('the shipped paper book', () => {
  it('parses', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '..', '..', '..', 'data', 'chronicle', 'paper.json');
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    expect(() => PaperBookSchema.parse(parsed)).not.toThrow();
  });

  it('will not carry wording for a type it has promised never to print', () => {
    // The file and the page make the same promise, and this is the file half.
    // Without it, `neverPrint` and `wording` could disagree and the code would
    // quietly pick a winner -- which is a refusal that depends on reading the
    // implementation to discover.
    expect(() =>
      PaperBookSchema.parse({
        maxStories: 2,
        neverPrint: ['npc.woke'],
        wording: { 'npc.woke': [{ text: 'Somebody woke.' }] },
        colophon: [],
      }),
    ).toThrow(/refuses to print npc\.woke/);
  });

  it('refuses a type with no wording at all under it', () => {
    expect(() =>
      PaperBookSchema.parse({
        maxStories: 2,
        neverPrint: [],
        wording: { 'npc.woke': [] },
        colophon: [],
      }),
    ).toThrow();
  });

  it('refuses a paper that may run to no stories', () => {
    expect(() =>
      PaperBookSchema.parse({ maxStories: 0, neverPrint: [], wording: {}, colophon: [] }),
    ).toThrow();
  });
});

describe('the day in review', () => {
  it('writes one story per kind, naming the leading event of that kind', () => {
    const one = blocked(npc(0), 100);
    const founding = event('society.household-founded', 200, {
      actors: [npc(0), npc(3)],
      location: COTTAGE,
      data: { name: 'Hargrave', dwelling: COTTAGE, head: npc(0), household: household(0), size: 2 },
    });
    const review = reviewOf(issue([one, founding]));

    expect(review.map((story) => story.type)).toEqual([
      'travel.blocked',
      'society.household-founded',
    ]);
    expect(review[0]?.text).toBe('Winifred Hargrave got no further than The Mill.');
    expect(review[1]?.text).toBe('The Hargrave household has taken A cottage on Mill Lane.');
  });

  it('cites the one event its sentence answers for, and counts the rest', () => {
    // Three refusals, one sentence. The sentence names the person in the lead
    // event, so the lead event is the only thing it can cite: a citation list
    // holding all three would claim support for a name two of them never
    // mention. The other two are a number.
    const first = blocked(npc(0), 100);
    const second = blocked(npc(1), 200);
    const third = blocked(npc(2), 300);
    const review = reviewOf(issue([first, second, third]));

    expect(review).toHaveLength(1);
    expect(review[0]?.text).toContain('Winifred Hargrave');
    expect(review[0]?.sources).toEqual([first.id]);
    expect(review[0]?.alsoToday).toBe(2);
  });

  it('says nothing also happened when nothing also did', () => {
    expect(reviewOf(issue([blocked(npc(0), 100)]))[0]?.alsoToday).toBe(0);
  });

  it('leads with what mattered most, not with what happened first', () => {
    // A front page is not a diary. The founding comes second in the day and
    // first on the page, because it outscores a refusal.
    const one = blocked(npc(0), 60_000);
    const created = event('place.created', 100, {
      data: { name: 'The Green', place: GREEN, type: 'square', access: 'public' },
    });
    // Two more refusals, so the refusal type is not the rarest thing today.
    const review = reviewOf(issue([created, one, blocked(npc(1), 61_000), blocked(npc(2), 62_000)]));
    expect(review.map((story) => story.type)).toEqual(['place.created', 'travel.blocked']);
  });

  it('will not print a refused type however loudly it scores', () => {
    // A waking is the rarest thing on this day and would lead it. The book says
    // no, and the book wins -- enforced here as well as in the schema, because
    // the schema can only speak for books that went through it.
    const smuggled: PaperBook = {
      ...BOOK,
      wording: { ...BOOK.wording, 'npc.woke': [{ text: 'Somebody woke up.' }] },
    };
    const events = [woke(npc(0), 100), blocked(npc(1), 200), blocked(npc(2), 300)];
    expect(storiesOf(events, smuggled)).toEqual(['Godric Netherby got no further than The Mill.']);
  });

  it('passes over a kind it has no words for', () => {
    // Not a failure -- the filter working. A type the file says nothing about is
    // a type the paper does not report, and the page runs shorter.
    expect(storiesOf([event('npc.turning-in', 100, { actors: [npc(0)] })])).toEqual([]);
  });

  it('passes over a wording the event cannot fill', () => {
    // `{destination}` is there; `reason` is not `full`, so the one wording for a
    // refusal does not apply and the paper has nothing to say about this one.
    expect(storiesOf([blocked(npc(0), 100, 'no-route')])).toEqual([]);
  });

  it('runs no longer than the book allows', () => {
    const events = [
      blocked(npc(0), 100),
      event('society.household-founded', 200, {
        actors: [npc(0)],
        data: { name: 'Hargrave', dwelling: COTTAGE, head: npc(0), household: household(0), size: 2 },
      }),
      event('place.created', 300, { data: { name: 'The Mill', place: MILL, type: 'workshop' } }),
    ];
    expect(storiesOf(events)).toHaveLength(3);
    expect(storiesOf(events, { ...BOOK, maxStories: 2 })).toHaveLength(2);
    expect(storiesOf(events, { ...BOOK, maxStories: 1 })).toHaveLength(1);
  });

  it('picks the same wording twice from the same day and seed', () => {
    const events = [blocked(npc(0), 100), blocked(npc(1), 200)];
    expect(storiesOf(events)).toEqual(storiesOf(events));
  });
});

describe('the village at a glance', () => {
  it('counts souls, family names and places from the record', () => {
    // Five people, four of whom carry a family name and two of whom share one,
    // so three names. Joan Fletcher has none and is not counted as a family --
    // she is still a soul.
    const glance = glanceOf(day([]));
    expect(glance.souls).toBe(5);
    expect(glance.families).toBe(3);
    expect(glance.places).toBe(3);
  });

  it('counts a completed journey and not the legs of one', () => {
    // A walk to the mill by way of the green is one journey. Counting arrivals
    // would make it two, and the paper would report twice the travel the
    // village actually did.
    const glance = glanceOf(
      day([waypoint(npc(0), GREEN, 100), arrived(npc(0), MILL, 200), arrived(npc(1), GREEN, 300)]),
    );
    expect(glance.journeys).toBe(2);
  });

  it('counts every refusal, whatever its reason', () => {
    // Unlike the review, which only has words for a full room. A number is not
    // a sentence: the paper can honestly count a refusal it cannot phrase.
    const glance = glanceOf(
      day([blocked(npc(0), 100), blocked(npc(1), 200, 'no-route'), arrived(npc(2), GREEN, 300)]),
    );
    expect(glance.refused).toBe(2);
  });

  it('counts as abed only those who went to bed and stayed there', () => {
    // Four people, four different shapes of night. Nobody's state is in any one
    // event -- it is in the gap between two of them, which is why this is the
    // number most likely to be quietly wrong.
    const glance = glanceOf(
      day([
        // Woke, then to bed: abed.
        woke(npc(0), 100),
        abed(npc(0), 60_000),
        // To bed, then woke again in the night: up.
        abed(npc(1), 100),
        woke(npc(1), 60_000),
        // Never woke today, went to bed: abed.
        abed(npc(2), 100),
        // Woke and never went to bed: up.
        woke(npc(3), 100),
      ]),
    );
    expect(glance.abed).toBe(2);
  });

  it('counts nobody abed on a day with no bedtimes', () => {
    expect(glanceOf(day([woke(npc(0), 100)])).abed).toBe(0);
  });

  it('counts the last waking, not the first', () => {
    // Up at dawn, a nap, and up again: not abed. Reading the *first* waking
    // against the last bedtime calls this person asleep, and no day Wodenshill
    // has ever produced tells the two readings apart -- everybody here wakes
    // exactly once. So it is asked here or it is not asked.
    const glance = glanceOf(day([woke(npc(0), 100), abed(npc(0), 200), woke(npc(0), 300)]));
    expect(glance.abed).toBe(0);
  });

  it('counts the last bedtime, not the first', () => {
    // Up in the night and back down again is abed. Reading the first bedtime
    // against the last waking would call this person up.
    const glance = glanceOf(day([abed(npc(0), 100), woke(npc(0), 200), abed(npc(0), 300)]));
    expect(glance.abed).toBe(1);
  });
});

describe('one day’s paper', () => {
  it('carries the village, the day and a dateline built from the calendar', () => {
    const paper = writePaper(issue([blocked(npc(0), 100)]));
    expect(paper.day).toBe(KEY);
    expect(paper.village).toBe(VILLAGE);
    expect(paper.dateline).toBe('Wodenshill, Blossom 1, 1200 (Restday)');
  });

  it('omits the review rather than printing an empty heading', () => {
    // The plan's rule, and the one worth a test of its own: a section with
    // nothing under it is a newspaper pretending. Absent, not empty -- so a
    // renderer cannot accidentally print a bare "The day in review".
    const quiet = writePaper(issue([woke(npc(0), 100), abed(npc(0), 60_000)]));
    expect(quiet.review).toBeUndefined();
    expect('review' in quiet).toBe(false);
    // The glance is still there, because a quiet day is still a day with five
    // people and three places in it.
    expect(quiet.glance.souls).toBe(5);
  });

  it('omits the colophon rather than printing an empty one', () => {
    const paper = writePaper(issue([blocked(npc(0), 100)], { ...BOOK, colophon: [] }));
    expect(paper.colophon).toBeUndefined();
    expect('colophon' in paper).toBe(false);
  });

  it('never names anybody the record has not got', () => {
    // A stranger the register has never heard of. `{who}` resolves to the
    // people it can name and to nothing when it can name none of them, so the
    // wording does not fit and the story is not written. The alternative is a
    // sentence about `npc:41`.
    const stranger = blocked(npc(41), 100);
    expect(storiesOf([stranger])).toEqual([]);
    const paper = writePaper(issue([stranger]));
    expect(paper.review).toBeUndefined();
  });

  it('names everybody an event names, unlike a post', () => {
    // A post is written by one of the people in the room and must not list its
    // own author. The paper is written by nobody, so it lists them all.
    const founding = event('society.household-founded', 100, {
      actors: [npc(0), npc(3), npc(2)],
      data: {
        name: 'Hargrave',
        dwelling: COTTAGE,
        head: npc(0),
        household: household(0),
        size: 3,
      },
    });
    const named: PaperBook = {
      ...BOOK,
      wording: { 'society.household-founded': [{ text: 'At {dwelling}: {who}.' }] },
    };
    expect(storiesOf([founding], named)).toEqual([
      'At A cottage on Mill Lane: Winifred Hargrave, Walter Hargrave and Alditha Salter.',
    ]);
  });

  it('prefers its own word to a payload field that shares the name', () => {
    // `place.created` carries a `place` key, and the paper also claims `{place}`
    // as its word for where something happened. The claim wins. They agree on
    // every real event, which is exactly why this has to be asked with one
    // where they do not: a payload that quietly overruled the caller would be
    // invisible until the first event whose `place` field meant something else.
    const created = event('place.created', 100, {
      location: GREEN,
      data: { name: 'The Mill', place: MILL, type: 'workshop' },
    });
    const both: PaperBook = {
      ...BOOK,
      wording: { 'place.created': [{ text: '{name}, at {place}.' }] },
    };
    expect(storiesOf([created], both)).toEqual(['The Mill, at The Green.']);
  });

  it('has no first person in its vocabulary to borrow', () => {
    // The blog's wording turns on `{me}` and `{first}`, and the paper resolves
    // neither, so a phrase lifted out of `templates.json` and dropped into
    // `paper.json` goes silent instead of printing a page that claims to have
    // been somewhere. Narrow on purpose: this stops the *vocabulary* crossing
    // over, not the voice. A literal "I walked to the smithy" has no
    // placeholder in it and nothing here can catch it -- that one is caught by
    // somebody reading the file, which is why the file says which voice it is
    // in at the top.
    for (const key of ['me', 'first', 'others']) {
      const borrowed: PaperBook = {
        ...BOOK,
        wording: { 'travel.blocked': [{ text: `{${key}} got no further.` }] },
      };
      expect(storiesOf([blocked(npc(0), 100)], borrowed)).toEqual([]);
    }
  });

  it('prints no entity id anywhere on the page', () => {
    // The blanket check. Every string the paper produces, against the shape of
    // a thing that must never reach a reader.
    const events = [
      blocked(npc(0), 100),
      event('society.household-founded', 200, {
        actors: [npc(0), npc(3)],
        data: { name: 'Hargrave', dwelling: COTTAGE, head: npc(0), household: household(0), size: 2 },
      }),
    ];
    const paper = writePaper(issue(events));
    const page = [
      paper.day,
      paper.village,
      paper.dateline,
      ...(paper.review ?? []).map((story) => story.text),
      ...(paper.colophon ?? []),
    ].join('\n');
    expect(page).not.toMatch(/[a-z][a-z-]*:\d+/);
    expect(page).not.toContain('undefined');
  });
});
