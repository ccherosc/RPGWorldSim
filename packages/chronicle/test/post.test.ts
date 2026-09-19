import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type Candidate,
  ChronicleDay,
  type HouseholdVoice,
  Kinfolk,
  PeopleRegister,
  PlaceRegister,
  type Post,
  type ScoringConfig,
  type TemplateBook,
  TemplateBookSchema,
  Whereabouts,
  writePost,
  writePosts,
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
 * The villagers, in their own words.
 *
 * Two things are being tested and they pull in opposite directions. One is that
 * a post says something — a villager whose day held a refusal and a bedtime
 * gets a line about each, in the order they happened. The other is that it says
 * *nothing else*: no sentence about a place they were not in, no placeholder
 * filled with a guess, no entity id reaching a reader, no padding on a dull
 * day. The second set matters more, so most of these are attacks.
 *
 * The wording here is a small book written for the tests, not the shipped one.
 * A test that read `data/chronicle/templates.json` would change meaning every
 * time somebody improved a turn of phrase. The shipped book gets its own check
 * — that it parses, and that nothing in it is unreachable — and the reachability
 * half of that needs real days, so it lives in `apps/simulator/test`.
 */

const FIRST_DAY = 90;
const DAWN = FIRST_DAY * TICKS_PER_DAY;
const KEY = dayKeyOf(DAWN, DEFAULT_CALENDAR);
const SEED = 'world-zero';

const npc = (index: number): EntityId => makeEntityId(EntityKind.Npc, index);
const place = (index: number): EntityId => makeEntityId(EntityKind.Location, index);
const household = (index: number): EntityId => makeEntityId(EntityKind.Household, index);

const GREEN = place(0);
const COTTAGE = place(1);
const MILL = place(2);
const LANE = place(3);

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

const BOOK: TemplateBook = {
  maxLines: 3,
  wording: {
    'npc.woke': [{ text: 'Awake.' }, { text: 'Awake at {place}.' }],
    'npc.went-to-bed': [{ text: 'Bed.' }],
    'travel.blocked': [
      { text: 'No room at {destination}.', when: { reason: ['full'] } },
      { text: 'Could not get to {destination}.' },
    ],
    'society.household-founded': [{ text: 'The {name} household, with {others}.' }],
  },
  // The second voice: a parent talking about a child, never a child talking.
  family: {
    'npc.woke': [{ text: '{childFirst} was up before any of us.' }],
    'npc.went-to-bed': [{ text: '{child} is asleep at {place}.' }],
    'travel.blocked': [
      { text: '{childFirst} was turned back at {destination}.', when: { reason: ['full'] } },
    ],
  },
};

/** Old enough on `KEY` to have been writing for years. */
const GROWN = '1170-03-02';

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

const arrive = (who: EntityId, where: EntityId, at: number): SimEvent =>
  event('travel.arrived', at, { actors: [who], location: where, data: { traveller: who } });

function village(): { people: PeopleRegister; places: PlaceRegister } {
  const people = new PeopleRegister();
  const places = new PlaceRegister();
  // Winifred has two. Sibb is three and cannot hold a pen, so her days reach
  // the site through her mother or not at all; Wat is twelve and takes his own
  // turn on the rota, which is why nobody may speak for him. The gap between
  // those two is the whole of the rule being tested at the foot of this file.
  const souls: readonly (readonly [string, string])[] = [
    ['Winifred Hargrave', GROWN],
    ['Godric Netherby', GROWN],
    ['Alditha Salter', GROWN],
    ['Sibb Hargrave', '1196-05-10'],
    ['Wat Hargrave', '1188-01-09'],
  ];
  souls.forEach(([name, born], index) => {
    people.add({ id: npc(index), name, sex: 'female', born, family: null });
  });
  places.add({ id: GREEN, name: 'The Green', type: 'square', access: 'public' });
  places.add({ id: COTTAGE, name: 'A cottage on Mill Lane', type: 'dwelling', access: 'private' });
  places.add({ id: MILL, name: 'The Mill', type: 'workshop', access: 'private' });
  places.add({ id: LANE, name: 'Church Lane', type: 'lane', access: 'public' });
  return { people, places };
}

function day(events: readonly SimEvent[]): ChronicleDay {
  const { people, places } = village();
  return new ChronicleDay({ key: KEY, events, people, places });
}

/** Everything `writePost` needs except the author. */
function writing(events: readonly SimEvent[], templates: TemplateBook = BOOK) {
  const chronicle = day(events);
  return {
    day: chronicle,
    whereabouts: new Whereabouts(chronicle),
    scoring: SCORING,
    templates,
    worldSeed: SEED,
  };
}

const author = (index: number): Candidate['person'] => {
  const found = village().people.find(npc(index));
  expect(found).toBeDefined();
  return found as Candidate['person'];
};

const textOf = (events: readonly SimEvent[], index = 0, templates = BOOK): readonly string[] =>
  writePost({ ...writing(events, templates), author: author(index) })?.lines.map((l) => l.text) ?? [];

describe('the shipped wording', () => {
  it('parses', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '..', '..', '..', 'data', 'chronicle', 'templates.json');
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    expect(() => TemplateBookSchema.parse(parsed)).not.toThrow();
  });

  it('refuses a type with no wording at all under it', () => {
    // An empty list is a type that looks handled and is not. Better to leave
    // the type out, which says the same thing and says it on purpose.
    expect(() => TemplateBookSchema.parse({ maxLines: 3, wording: { 'npc.woke': [] } })).toThrow();
  });

  it('refuses a post that may run to no lines', () => {
    expect(() => TemplateBookSchema.parse({ maxLines: 0, wording: {} })).toThrow();
  });
});

describe('putting a name into a sentence', () => {
  /**
   * The record names a place as a whole noun phrase, article and all: `A
   * cottage on Mill Lane`, `The Mill`. That is right for a heading and right
   * for a table row, and it was being dropped into the middle of sentences
   * untouched, so the site published eighty-five lines reading `Abed at A
   * cottage on Bridge Row.` Each of those was a true sentence about a real
   * event, which is exactly why nothing caught it -- the fault was in the seam
   * between a name and a sentence, and it is the seam that is tested here.
   */
  const named = (text: string, location: EntityId, actors: readonly EntityId[] = [npc(0)]): string => {
    const book: TemplateBook = { maxLines: 1, wording: { 'npc.woke': [{ text }] }, family: {} };
    const woke = event('npc.woke', 100, { actors, location });
    return textOf([woke], 0, book)[0] ?? '';
  };

  it('lowers the article when the name is inside a sentence', () => {
    expect(named('Abed at {place}.', COTTAGE)).toBe('Abed at a cottage on Mill Lane.');
  });

  it('keeps the article when the name opens the line', () => {
    expect(named('{place}. Warm enough.', COTTAGE)).toBe('A cottage on Mill Lane. Warm enough.');
  });

  it('keeps it after a full stop, because that is a new sentence too', () => {
    expect(named('Another morning. {place}, same as ever.', COTTAGE)).toBe(
      'Another morning. A cottage on Mill Lane, same as ever.',
    );
  });

  it('lowers only the article, so a name keeps the capitals it earned', () => {
    // `the Mill` is right and `the mill` would be wrong: the article belongs to
    // the sentence and the rest of the name belongs to the place.
    expect(named('Abed at {place}.', MILL)).toBe('Abed at the Mill.');
  });

  it('leaves a name alone that has no article to lower', () => {
    expect(named('Abed at {place}.', LANE)).toBe('Abed at Church Lane.');
  });

  it('does not touch a person, whose name is not a noun phrase', () => {
    // The rule is about articles and knows nothing about what kind of thing it
    // is naming, so the check that it cannot mangle a person belongs here.
    expect(named('Awake, and so is {others}.', COTTAGE, [npc(0), npc(1)])).toBe(
      'Awake, and so is Godric Netherby.',
    );
  });
});

describe('what a post is made of', () => {
  it('gives one line per moment, each carrying the event it came from', () => {
    const woke = event('npc.woke', 100, { actors: [npc(0)], location: COTTAGE });
    const bed = event('npc.went-to-bed', 60_000, { actors: [npc(0)], location: COTTAGE });
    const post = writePost({ ...writing([woke, bed]), author: author(0) });

    expect(post?.lines).toHaveLength(2);
    expect(post?.lines[0]?.sources).toEqual([woke.id]);
    expect(post?.lines[1]?.sources).toEqual([bed.id]);
    // And the post's own list is every id its lines cite, in order. That is the
    // `WHY?` chain for the whole post.
    expect(post?.sources).toEqual([woke.id, bed.id]);
  });

  it('tells the day in the order it happened, not in the order of interest', () => {
    // The refusal outscores both ends of the day. A post that led with its best
    // moment would read: turned away, woke up, went to bed.
    const woke = event('npc.woke', 100, { actors: [npc(0)] });
    const blocked = event('travel.blocked', 30_000, {
      actors: [npc(0)],
      location: GREEN,
      data: { traveller: npc(0), destination: MILL, reason: 'full' },
    });
    const bed = event('npc.went-to-bed', 60_000, { actors: [npc(0)], location: COTTAGE });

    expect(textOf([woke, blocked, bed])).toEqual(['Awake.', 'No room at the Mill.', 'Bed.']);
  });

  it('says one thing per kind of thing, however often it happened', () => {
    // Four full workshops is one experience. Four lines about it is a bug
    // report. The best-scoring of the kind stands for all of them.
    const blocks = [MILL, MILL, GREEN, MILL].map((where, index) =>
      event('travel.blocked', 1000 * (index + 1), {
        actors: [npc(0)],
        location: where,
        data: { traveller: npc(0), destination: MILL, reason: 'full' },
      }),
    );
    // One line, and which of the two fitting wordings it uses is the seed's
    // business -- asserting that too would pin a coin toss.
    const lines = textOf(blocks);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('the Mill');
  });

  it('runs no longer than the book allows', () => {
    const events = [
      event('npc.woke', 100, { actors: [npc(0)] }),
      event('travel.blocked', 200, {
        actors: [npc(0)],
        data: { traveller: npc(0), destination: MILL, reason: 'full' },
      }),
      event('society.household-founded', 300, {
        actors: [npc(0), npc(1)],
        location: COTTAGE,
        data: { household: household(0), name: 'Hargrave', dwelling: COTTAGE },
      }),
      event('npc.went-to-bed', 400, { actors: [npc(0)], location: COTTAGE }),
    ];
    expect(textOf(events)).toHaveLength(3);
    expect(textOf(events, 0, { ...BOOK, maxLines: 1 })).toHaveLength(1);
  });
});

describe('what a post refuses to say', () => {
  it('is not written at all when there is nothing the author may say', () => {
    // The rule the whole module turns on: a thin day gets a thin post or none.
    // Padding is the alternative and padding is a slow lie.
    const elsewhere = event('npc.woke', 100, { actors: [npc(1)], location: MILL });
    expect(writePost({ ...writing([elsewhere]), author: author(0) })).toBeUndefined();
  });

  it('is not written from a day with no wording for anything in it', () => {
    const walking = [arrive(npc(0), GREEN, 100), arrive(npc(0), MILL, 200)];
    expect(writePost({ ...writing(walking), author: author(0) })).toBeUndefined();
  });

  it('never says a word about what the author was not there for', () => {
    // Villager 0 is on the green all morning and leaves. Villager 1 has a
    // household founded in the cottage. Nothing villager 0 writes may mention
    // it, and there is nothing else for them to write, so they do not post.
    const founding = event('society.household-founded', 50_000, {
      actors: [npc(1), npc(2)],
      location: COTTAGE,
      data: { household: household(0), name: 'Netherby', dwelling: COTTAGE },
    });
    const events = [arrive(npc(0), GREEN, 100), founding];
    expect(writePost({ ...writing(events), author: author(0) })).toBeUndefined();

    // Whereas somebody who *was* in the cottage writes about it.
    expect(textOf(events, 1)).toEqual(['The Netherby household, with Alditha Salter.']);
  });

  it('passes over a wording it cannot fill rather than filling it in', () => {
    // `Awake at {place}` is the only wording with a placeholder, and a wake
    // with no location cannot fill it. The result is the plain variant every
    // time, not `Awake at undefined` and not `Awake at somewhere`.
    const placeless = event('npc.woke', 100, { actors: [npc(0)] });
    expect(textOf([placeless])).toEqual(['Awake.']);
  });

  it('drops a kind of moment entirely when no wording fits any of it', () => {
    // The founding wording needs somebody else present. A household founded by
    // one person is real and has no wording, so it produces no line -- rather
    // than a line about company that was not there.
    const alone = event('society.household-founded', 100, {
      actors: [npc(0)],
      location: COTTAGE,
      data: { household: household(0), name: 'Hargrave', dwelling: COTTAGE },
    });
    expect(writePost({ ...writing([alone]), author: author(0) })).toBeUndefined();
  });

  it('never prints an id the record cannot name', () => {
    // `{name}` here is a household id, which no register can turn into words.
    // The wording is passed over; what must not happen is `household:0`
    // appearing in print.
    const book: TemplateBook = {
      maxLines: 3,
      wording: { 'npc.woke': [{ text: 'Woke in {bed}.' }] },
      family: {},
    };
    const woke = event('npc.woke', 100, { actors: [npc(0)], data: { bed: household(0) } });
    expect(textOf([woke], 0, book)).toEqual([]);
  });

  it('honours a `when` clause rather than phrasing every case the same', () => {
    const forbidden = event('travel.blocked', 100, {
      actors: [npc(0)],
      data: { traveller: npc(0), destination: MILL, reason: 'forbidden' },
    });
    // Only the unconditional wording fits, so the specific one cannot fire.
    expect(textOf([forbidden])).toEqual(['Could not get to the Mill.']);

    // And with the unconditional wording taken away there is nothing left to
    // hide behind. The book above offers two wordings for a refusal, so an
    // ignored `when` clause is a coin toss the seed might still call right;
    // a book holding only the specific phrasing makes the difference between
    // a wrong sentence and no sentence.
    const only: TemplateBook = {
      maxLines: 3,
      wording: { 'travel.blocked': [{ text: 'No room at {destination}.', when: { reason: ['full'] } }] },
      family: {},
    };
    expect(textOf([forbidden], 0, only)).toEqual([]);

    const full = event('travel.blocked', 200, {
      actors: [npc(0)],
      data: { traveller: npc(0), destination: MILL, reason: 'full' },
    });
    expect(textOf([full], 0, only)).toEqual(['No room at the Mill.']);
  });

  it('will not turn a yes-or-no into a sentence', () => {
    // `interrupted` is a boolean. There is no honest English for it in the
    // middle of a wording -- ‘false’ is not a thing anybody says -- so the
    // wording does not fit and no line is written. Rendering it anyway is how
    // a post starts printing the simulation's plumbing as prose.
    const book: TemplateBook = {
      maxLines: 3,
      wording: { 'npc.turning-in': [{ text: 'Turning in, interrupted: {interrupted}.' }] },
      family: {},
    };
    const turningIn = event('npc.turning-in', 100, {
      actors: [npc(0)],
      data: { npc: npc(0), home: COTTAGE, interrupted: false },
    });
    expect(textOf([turningIn], 0, book)).toEqual([]);
  });

  it('does not name the author among the others who were there', () => {
    const founding = event('society.household-founded', 100, {
      actors: [npc(0), npc(1)],
      location: COTTAGE,
      data: { household: household(0), name: 'Hargrave', dwelling: COTTAGE },
    });
    const line = textOf([founding])[0] ?? '';
    expect(line).toBe('The Hargrave household, with Godric Netherby.');
    expect(line).not.toContain('Winifred');
  });

  it('names everybody else who was there, down to the last of them', () => {
    // Three in the room means two names in the sentence, and the one at the
    // end is the one a list-builder loses. A household founding that dropped
    // its youngest member would read perfectly well and be wrong.
    const founding = event('society.household-founded', 100, {
      actors: [npc(0), npc(1), npc(2)],
      location: COTTAGE,
      data: { household: household(0), name: 'Hargrave', dwelling: COTTAGE },
    });
    expect(textOf([founding])).toEqual([
      'The Hargrave household, with Godric Netherby and Alditha Salter.',
    ]);
  });
});

describe('the same day, written twice', () => {
  const events = [
    event('npc.woke', 100, { actors: [npc(0)], location: COTTAGE }),
    event('npc.went-to-bed', 60_000, { actors: [npc(0)], location: COTTAGE }),
  ];

  it('produces the same words', () => {
    expect(textOf(events)).toEqual(textOf(events));
  });

  it('produces different words for different people on the same day', () => {
    // The stream is named for the day *and* the author, so two villagers with
    // identical days do not write identical posts. Without the author in the
    // name the whole village would speak in one voice.
    const mirrored = [
      event('npc.woke', 100, { actors: [npc(1)], location: COTTAGE }),
      event('npc.went-to-bed', 60_000, { actors: [npc(1)], location: COTTAGE }),
    ];
    const mine = writePost({ ...writing(events), author: author(0) });
    const theirs = writePost({ ...writing(mirrored), author: author(1) });
    // Two wordings for waking, so this is a coin toss that the seed decides --
    // pinned because the point is that the coin is tossed at all.
    expect(mine?.lines[0]?.text).not.toBe(theirs?.lines[0]?.text);
  });

  it('does not give a villager the same words every day of their life', () => {
    // Asserted over a fortnight rather than between two days on purpose. Two
    // days is a coin toss and half of all coin tosses come up the same; what
    // is actually claimed is that the day is part of the stream's name, and
    // the way to see that is a run of days that are not all identical.
    const chronicle = day(events);
    const openings = new Set<string>();
    for (let ahead = 0; ahead < 14; ahead++) {
      const key = dayKeyOf(DAWN + ahead * TICKS_PER_DAY, DEFAULT_CALENDAR);
      const that = new ChronicleDay({ key, events, people: chronicle.people, places: chronicle.places });
      const post = writePost({
        day: that,
        whereabouts: new Whereabouts(that),
        scoring: SCORING,
        templates: BOOK,
        worldSeed: SEED,
        author: author(0),
      });
      openings.add(post?.lines[0]?.text ?? '');
    }
    // Both wordings for waking turn up, so nobody is stuck with one voice.
    expect(openings.size).toBe(2);
  });

  it('gives a different village different words for the same day', () => {
    const other = writePost({
      ...writing(events),
      worldSeed: 'somewhere-else',
      author: author(0),
    });
    expect(other?.lines[0]?.text).not.toBe(textOf(events)[0]);
  });
});

describe('a day of posts', () => {
  it('writes one per villager the rota picked, in that order', () => {
    const events = [
      event('npc.woke', 100, { actors: [npc(0)], location: COTTAGE }),
      event('npc.woke', 200, { actors: [npc(1)], location: COTTAGE }),
    ];
    const posters = [0, 1].map((index) => ({ person: author(index) }) as Candidate);
    const posts = writePosts(posters, writing(events));

    expect(posts.map((post) => post.author.slug)).toEqual(['winifred-hargrave', 'godric-netherby']);
    expect(posts.every((post) => post.day === KEY)).toBe(true);
  });

  it('drops a villager with nothing to say rather than reaching for a spare', () => {
    // Villager 2 was nowhere and did nothing. The day runs one post short,
    // which is the honest length for it.
    const events = [event('npc.woke', 100, { actors: [npc(0)], location: COTTAGE })];
    const posters = [0, 2].map((index) => ({ person: author(index) }) as Candidate);
    const posts = writePosts(posters, writing(events));

    expect(posts).toHaveLength(1);
    expect(posts[0]?.author.slug).toBe('winifred-hargrave');
  });
});

/**
 * A parent's last line, about a child too young to write their own.
 *
 * The one place in the village where anybody speaks for anybody else, so these
 * are mostly attacks on the edges of that permission: not a child old enough to
 * post, not a child the record has never heard of, not a post the writer had
 * not already earned, and never in the writer's own voice.
 */

const SIBB = npc(3);
const WAT = npc(4);
/** In nobody's register. The press meets these when an archive outruns a record. */
const STRANGER = npc(9);

/** Learned off the record, the way the press learns it, rather than handed over. */
function kinOf(...children: readonly EntityId[]): Kinfolk {
  const kin = new Kinfolk();
  kin.learn(
    day(
      children.map((child) =>
        event('society.parentage-recorded', 1, {
          actors: [child],
          data: { child, mother: npc(0), motherAbsent: null, father: null, fatherAbsent: 'dead' },
        }),
      ),
    ),
  );
  return kin;
}

const speaking = (chance: number, ...children: readonly EntityId[]): HouseholdVoice => ({
  kin: kinOf(...children),
  writingAge: 10,
  chance,
});

/** Winifred's post, with whatever household voice the test is about. */
const postOf = (
  events: readonly SimEvent[],
  household: HouseholdVoice | undefined,
  templates = BOOK,
): Post | undefined =>
  writePost({
    ...writing(events, templates),
    ...(household === undefined ? {} : { household }),
    author: author(0),
  });

const myMorning = (): SimEvent => event('npc.woke', 100, { actors: [npc(0)], location: COTTAGE });
const herMorning = (): SimEvent => event('npc.woke', 200, { actors: [SIBB], location: COTTAGE });

describe('a parent speaking for a child', () => {
  it('ends the post with what the little one did, and says whose moment it was', () => {
    nextId = 1;
    const post = postOf([myMorning(), herMorning()], speaking(100, SIBB));

    expect(post?.lines).toHaveLength(2);
    const last = post?.lines[1];
    expect(last?.text).toBe('Sibb was up before any of us.');
    // The id is what makes the claim checkable. Without it the line says a
    // parent was somewhere she was not, and no test could tell.
    expect(last?.about).toBe(SIBB);
    expect(last?.sources).toEqual([2]);
    // Her own line still answers for itself.
    expect(post?.lines[0]?.about).toBeUndefined();
  });

  it('spends none of the writer’s own allowance on it', () => {
    // One line for herself and one for her daughter, out of a book that allows
    // one line. A cap counting both would mean Winifred bought a sentence about
    // Sibb by giving up one about her own day.
    const mine = [
      myMorning(),
      event('npc.went-to-bed', 60_000, { actors: [npc(0)], location: COTTAGE }),
    ];
    const tight: TemplateBook = { ...BOOK, maxLines: 1 };
    const alone = postOf(mine, undefined, tight);
    const together = postOf([...mine, herMorning()], speaking(100, SIBB), tight);

    expect(alone?.lines).toHaveLength(1);
    expect(together?.lines).toHaveLength(2);
    expect(together?.lines[1]?.about).toBe(SIBB);
  });

  it('says nothing at all when the chance is nothing', () => {
    const post = postOf([myMorning(), herMorning()], speaking(0, SIBB));

    expect(post?.lines).toHaveLength(1);
    expect(post?.lines.some((line) => line.about !== undefined)).toBe(false);
  });

  it('rolls for it, rather than mentioning always or never', () => {
    // Half is a coin, and a coin proves nothing in two throws. A run of days
    // from the same village is the shape that can tell a roll from a constant:
    // the day is the only thing that differs between them.
    const events = [myMorning(), herMorning()];
    const chronicle = day(events);
    const household = speaking(50, SIBB);
    let mentioned = 0;

    for (let ahead = 0; ahead < 20; ahead++) {
      const key = dayKeyOf(DAWN + ahead * TICKS_PER_DAY, DEFAULT_CALENDAR);
      const that = new ChronicleDay({
        key,
        events,
        people: chronicle.people,
        places: chronicle.places,
      });
      const post = writePost({
        day: that,
        whereabouts: new Whereabouts(that),
        scoring: SCORING,
        templates: BOOK,
        worldSeed: SEED,
        household,
        author: author(0),
      });
      if (post?.lines.some((line) => line.about === SIBB) === true) mentioned++;
    }

    expect(mentioned).toBeGreaterThan(0);
    expect(mentioned).toBeLessThan(20);
  });

  it('leaves the writer’s own words exactly as they were', () => {
    // The mention draws from a stream of its own, and this is the test that
    // says so. Sharing one would have meant that adding this feature silently
    // rewrote every post the site had ever published — on days about nobody’s
    // children, in villages with no children in them.
    const events = [myMorning(), herMorning()];
    const alone = postOf(events, undefined);
    const together = postOf(events, speaking(100, SIBB));

    expect(alone?.lines).toHaveLength(1);
    expect(together?.lines[0]?.text).toBe(alone?.lines[0]?.text);
  });

  it('writes the same mention twice for the same day', () => {
    const events = [myMorning(), herMorning()];
    expect(postOf(events, speaking(100, SIBB))).toEqual(postOf(events, speaking(100, SIBB)));
  });

  it('takes the loudest of the child’s day, not the first of it', () => {
    nextId = 1;
    const turned = event('travel.blocked', 300, {
      actors: [SIBB],
      location: GREEN,
      data: { traveller: SIBB, destination: MILL, reason: 'full' },
    });
    const post = postOf([myMorning(), herMorning(), turned], speaking(100, SIBB));

    expect(post?.lines[1]?.text).toBe('Sibb was turned back at the Mill.');
    expect(post?.lines[1]?.sources).toEqual([turned.id]);
  });
});

describe('who may be spoken for', () => {
  it('will not speak for a child old enough to speak for himself', () => {
    // Wat is twelve. He is on the rota in his own right, and a mother
    // summarising a day her son already posted is a village talking over one of
    // its own people.
    const his = event('npc.woke', 200, { actors: [WAT], location: COTTAGE });
    const post = postOf([myMorning(), his], speaking(100, WAT));

    expect(post?.lines).toHaveLength(1);
  });

  it('will not speak for somebody the record has never heard of', () => {
    const theirs = event('npc.woke', 200, { actors: [STRANGER], location: COTTAGE });
    const post = postOf([myMorning(), theirs], speaking(100, STRANGER));

    expect(post?.lines).toHaveLength(1);
  });

  it('says nothing about a child whose day held nothing worth a line', () => {
    const post = postOf([myMorning()], speaking(100, SIBB));

    expect(post?.lines).toHaveLength(1);
  });

  it('does not hand a post to a parent who had nothing of their own to say', () => {
    // Sibb had a morning and Winifred did not. A page of parents reporting
    // other people’s afternoons is not the village blog, and the rota picked
    // Winifred for her own day in the first place.
    const post = postOf([herMorning()], speaking(100, SIBB));

    expect(post).toBeUndefined();
  });

  it('cannot reach a first-person wording from a line about somebody else', () => {
    // `{me}` and `{first}` are unanswerable in a family line on purpose, so a
    // wording pasted into the wrong book fits nothing rather than printing the
    // mother’s name over the daughter’s morning.
    const wrong: TemplateBook = {
      ...BOOK,
      family: { 'npc.woke': [{ text: '{first} is awake, and {me} is not pleased.' }] },
    };
    const post = postOf([myMorning(), herMorning()], speaking(100, SIBB), wrong);

    expect(post?.lines).toHaveLength(1);
  });

  it('says nothing when the book has no family wording at all', () => {
    // What the site published before any of this existed, and what every test
    // on the rest of this page is still asking for.
    const bare: TemplateBook = { ...BOOK, family: {} };
    const post = postOf([myMorning(), herMorning()], speaking(100, SIBB), bare);

    expect(post?.lines).toHaveLength(1);
  });

  it('says nothing at all when there is no household voice', () => {
    const post = postOf([myMorning(), herMorning()], undefined);

    expect(post?.lines).toHaveLength(1);
  });
});
