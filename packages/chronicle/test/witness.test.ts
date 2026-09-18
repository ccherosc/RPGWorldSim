import { describe, expect, it } from 'vitest';
import { ChronicleDay, PeopleRegister, PlaceRegister, Whereabouts } from '@rpgsim/chronicle';
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
 * Where everybody was, and when.
 *
 * This is the honesty rule, so the tests are written as attacks on it rather
 * than as demonstrations of it. The question is never "does it find the events
 * Winifred saw" — a function that returned the whole day would pass that. It is
 * **can anybody be shown to know something they were not there for**, and every
 * test below is an attempt to make that happen: crossing a square hours before
 * the thing that happened in it, standing next door, being on the road, being
 * named by an event that points at a place ahead of them.
 *
 * The days are built by hand and are minutes long, because the interesting
 * cases are all about two ticks that are close together, and a real day buries
 * them under fourteen thousand footsteps.
 */

const FIRST_DAY = 90;
const DAWN = FIRST_DAY * TICKS_PER_DAY;
const KEY = dayKeyOf(DAWN, DEFAULT_CALENDAR);

const npc = (index: number): EntityId => makeEntityId(EntityKind.Npc, index);
const place = (index: number): EntityId => makeEntityId(EntityKind.Location, index);

const GREEN = place(0);
const COTTAGE = place(1);
const MILL = place(2);

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

/** `arrive` and `leave` in the shapes `packages/world/src/travel.ts` emits them. */
const arrive = (who: EntityId, where: EntityId, at: number): SimEvent =>
  event('travel.arrived', at, { actors: [who], location: where, data: { traveller: who, at: where } });

const leave = (who: EntityId, where: EntityId, at: number): SimEvent =>
  event('travel.departed', at, { actors: [who], location: where, data: { traveller: who, from: where } });

function day(events: readonly SimEvent[]): ChronicleDay {
  const people = new PeopleRegister();
  const places = new PlaceRegister();
  for (let index = 0; index < 4; index++) {
    people.add({
      id: npc(index),
      name: `Villager Number${index}`,
      sex: 'female',
      born: '1170-03-02',
      family: null,
    });
  }
  places.add({ id: GREEN, name: 'The Green', type: 'square', access: 'public' });
  places.add({ id: COTTAGE, name: 'A cottage on Mill Lane', type: 'dwelling', access: 'private' });
  places.add({ id: MILL, name: 'The Mill', type: 'workshop', access: 'private' });
  return new ChronicleDay({ key: KEY, events, people, places });
}

describe('tracking somebody through a day', () => {
  it('holds a position forward until something moves them', () => {
    // Standing still emits nothing. If presence had to be re-proved every tick
    // nobody would ever be anywhere.
    const events = [arrive(npc(0), GREEN, 100)];
    const where = new Whereabouts(day(events));

    expect(where.placeAt(npc(0), DAWN + 100)).toBe(GREEN);
    expect(where.placeAt(npc(0), DAWN + 50_000)).toBe(GREEN);
    expect(where.trailOf(npc(0))).toEqual([{ place: GREEN, from: DAWN + 100, until: null }]);
  });

  it('knows nothing about somebody before their first event', () => {
    const where = new Whereabouts(day([arrive(npc(0), GREEN, 100)]));
    expect(where.placeAt(npc(0), DAWN + 99)).toBeUndefined();
    expect(where.placeAt(npc(0), DAWN)).toBeUndefined();
  });

  it('knows nothing at all about somebody the day never names', () => {
    const where = new Whereabouts(day([arrive(npc(0), GREEN, 100)]));
    expect(where.placeAt(npc(3), DAWN + 100)).toBeUndefined();
    expect(where.trailOf(npc(3))).toEqual([]);
  });

  it('puts somebody on the road between leaving and arriving', () => {
    // The case a day-level presence set cannot express at all: for these two
    // hundred ticks the answer is not "the green" and not "the mill" but
    // *nowhere*, and an honest model has to be able to say so.
    const where = new Whereabouts(day([leave(npc(0), GREEN, 100), arrive(npc(0), MILL, 300)]));

    expect(where.placeAt(npc(0), DAWN + 100)).toBe(GREEN);
    expect(where.placeAt(npc(0), DAWN + 101)).toBeUndefined();
    expect(where.placeAt(npc(0), DAWN + 299)).toBeUndefined();
    expect(where.placeAt(npc(0), DAWN + 300)).toBe(MILL);
  });

  it('gives no tick to two places at once', () => {
    const events = [arrive(npc(0), GREEN, 100), event('npc.woke', 200, { actors: [npc(0)], location: COTTAGE })];
    const where = new Whereabouts(day(events));

    // The moment somebody turns up somewhere belongs to the new place, not the
    // old one. Inclusive ends would have them in two rooms on tick 200.
    expect(where.placeAt(npc(0), DAWN + 199)).toBe(GREEN);
    expect(where.placeAt(npc(0), DAWN + 200)).toBe(COTTAGE);

    // And the trail itself has to say so, not just the answer to a question
    // about one tick. `placeAt` reads backwards and would find the cottage
    // first even if the green still claimed tick 200 -- so overlapping stays
    // are a lie this module could tell without any caller noticing today, and
    // `trailOf` is public for slice 6 to read.
    expect(where.trailOf(npc(0))).toEqual([
      { place: GREEN, from: DAWN + 100, until: DAWN + 200 },
      { place: COTTAGE, from: DAWN + 200, until: null },
    ]);
  });

  it('keeps somebody in place for the departure that ends their stay', () => {
    // They were standing on the green when they set off from it. The stay is
    // half-open, so this is the one tick that has to be deliberately included.
    const where = new Whereabouts(day([arrive(npc(0), GREEN, 100), leave(npc(0), GREEN, 500)]));
    expect(where.placeAt(npc(0), DAWN + 500)).toBe(GREEN);
    expect(where.placeAt(npc(0), DAWN + 501)).toBeUndefined();
  });

  it('records passing through somewhere as the instant it was', () => {
    // A walk of several legs arrives at a waypoint and sets off again on the
    // same tick. They were there -- for one tick -- and the trail says so
    // rather than either losing it or stretching it.
    const where = new Whereabouts(day([arrive(npc(0), GREEN, 100), leave(npc(0), GREEN, 100)]));
    expect(where.trailOf(npc(0))).toEqual([{ place: GREEN, from: DAWN + 100, until: DAWN + 101 }]);
    expect(where.placeAt(npc(0), DAWN + 100)).toBe(GREEN);
    expect(where.placeAt(npc(0), DAWN + 102)).toBeUndefined();
  });

  it('closes a stay opened by a departure from somewhere new', () => {
    // A shape the village does not currently produce -- every departure today
    // leaves from wherever the walker was last seen -- but the model is not
    // allowed to be wrong about it, because the first system that moves people
    // without announcing an arrival would park them somewhere forever.
    const where = new Whereabouts(day([arrive(npc(0), GREEN, 100), leave(npc(0), MILL, 200)]));

    expect(where.trailOf(npc(0))).toEqual([
      { place: GREEN, from: DAWN + 100, until: DAWN + 200 },
      { place: MILL, from: DAWN + 200, until: DAWN + 201 },
    ]);
    expect(where.placeAt(npc(0), DAWN + 200)).toBe(MILL);
    expect(where.placeAt(npc(0), DAWN + 500)).toBeUndefined();
  });

  it('starts a fresh stay when somebody comes back to where they were', () => {
    const events = [
      arrive(npc(0), GREEN, 100),
      leave(npc(0), GREEN, 200),
      arrive(npc(0), GREEN, 900),
    ];
    const where = new Whereabouts(day(events));

    expect(where.trailOf(npc(0))).toEqual([
      { place: GREEN, from: DAWN + 100, until: DAWN + 201 },
      { place: GREEN, from: DAWN + 900, until: null },
    ]);
    // And the gap in the middle is a real gap, not an accident of storage.
    expect(where.placeAt(npc(0), DAWN + 500)).toBeUndefined();
  });

  it('refuses to be told where somebody is by an event about being turned back', () => {
    // `travel.blocked` has two shapes. A refusal fires where the traveller
    // stands; an interruption fires at the node *ahead* of them, which they
    // have not reached. Since the type cannot say which it is, neither places
    // anybody -- so a blocked walk towards the mill must not put them in it.
    const events = [
      leave(npc(0), GREEN, 100),
      event('travel.blocked', 150, {
        actors: [npc(0)],
        location: MILL,
        data: { traveller: npc(0), reason: 'bedtime', stoppingAt: MILL },
      }),
    ];
    const where = new Whereabouts(day(events));
    expect(where.placeAt(npc(0), DAWN + 150)).toBeUndefined();
    expect(where.trailOf(npc(0))).toEqual([{ place: GREEN, from: DAWN + 100, until: DAWN + 101 }]);
  });

  it('tracks everybody separately', () => {
    const events = [arrive(npc(0), GREEN, 100), arrive(npc(1), MILL, 100)];
    const where = new Whereabouts(day(events));

    expect(where.size).toBe(2);
    expect(where.placeAt(npc(0), DAWN + 500)).toBe(GREEN);
    expect(where.placeAt(npc(1), DAWN + 500)).toBe(MILL);
  });
});

describe('what somebody may write about', () => {
  it('lets them write about anything they took part in', () => {
    const woke = event('npc.woke', 100, { actors: [npc(0)] });
    const where = new Whereabouts(day([woke]));
    // No location at all, and still theirs: they were the one it happened to.
    expect(where.saw(npc(0), woke)).toBe(true);
  });

  it('lets them write about what happened where they were standing', () => {
    const events = [arrive(npc(0), GREEN, 100)];
    const scene = event('society.household-founded', 900, { actors: [npc(1)], location: GREEN });
    const where = new Whereabouts(day([...events, scene]));

    expect(where.saw(npc(0), scene)).toBe(true);
    expect(where.saw(npc(1), scene)).toBe(true);
  });

  it('does not let them write about the same place at the wrong hour', () => {
    // The whole reason this module exists. A day-level presence set says
    // villager 0 was on the green, and would hand them the evening's news.
    const events = [arrive(npc(0), GREEN, 100), leave(npc(0), GREEN, 200)];
    const scene = event('society.household-founded', 50_000, { actors: [npc(1)], location: GREEN });
    const where = new Whereabouts(day([...events, scene]));

    expect(where.saw(npc(0), scene)).toBe(false);
    expect(day([...events, scene]).presenceOf(npc(0)).has(GREEN)).toBe(true);
  });

  it('does not let them write about the room next door', () => {
    const events = [arrive(npc(0), GREEN, 100)];
    const scene = event('society.household-founded', 900, { actors: [npc(1)], location: COTTAGE });
    const where = new Whereabouts(day([...events, scene]));
    expect(where.saw(npc(0), scene)).toBe(false);
  });

  it('does not let somebody on the road write about anywhere', () => {
    const events = [leave(npc(0), GREEN, 100), arrive(npc(0), MILL, 5000)];
    const scene = event('society.household-founded', 900, { actors: [npc(1)], location: GREEN });
    const where = new Whereabouts(day([...events, scene]));
    expect(where.saw(npc(0), scene)).toBe(false);
  });

  it('does not let a placeless event be witnessed by a bystander', () => {
    // `npc.turning-in` says nothing about where it happened. That makes it the
    // actor's to write about and nobody else's -- there is no place to have
    // been standing in.
    const events = [arrive(npc(0), GREEN, 100), arrive(npc(1), GREEN, 100)];
    const scene = event('npc.turning-in', 900, { actors: [npc(1)] });
    const where = new Whereabouts(day([...events, scene]));

    expect(where.saw(npc(1), scene)).toBe(true);
    expect(where.saw(npc(0), scene)).toBe(false);
  });

  it('hands back everything one person may write about, in archive order', () => {
    const came = arrive(npc(0), GREEN, 100);
    const mine = event('npc.woke', 200, { actors: [npc(0)] });
    const here = event('society.household-founded', 900, { actors: [npc(1)], location: GREEN });
    const elsewhere = event('society.household-founded', 900, { actors: [npc(1)], location: MILL });
    const chronicle = day([came, mine, here, elsewhere]);
    const where = new Whereabouts(chronicle);

    expect(where.witnessed(chronicle, npc(0)).map((e) => e.id)).toEqual([came.id, mine.id, here.id]);
    expect(where.saw(npc(0), elsewhere)).toBe(false);
  });
});
