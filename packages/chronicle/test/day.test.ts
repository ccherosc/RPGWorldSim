import { describe, expect, it } from 'vitest';
import { ChronicleDay, PeopleRegister, PlaceRegister } from '@rpgsim/chronicle';
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
 * The read model, tested against events built by hand.
 *
 * Hand-built because these tests are about the *shape* the day is turned into,
 * and a real village day would bury a five-event question under twelve hundred
 * events nobody chose. The whole-village checks live in
 * `apps/simulator/test/edition.test.ts`.
 */

const DAY = 90;
const KEY = dayKeyOf(DAY * TICKS_PER_DAY, DEFAULT_CALENDAR);

const npc = (index: number): EntityId => makeEntityId(EntityKind.Npc, index);
const place = (index: number): EntityId => makeEntityId(EntityKind.Location, index);

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
    tick: DAY * TICKS_PER_DAY,
    type,
    actors: options.actors ?? [],
    ...(options.location !== undefined ? { location: options.location } : {}),
    data: (options.data ?? {}) as SimEvent['data'],
    causes: options.causes ?? [],
  };
}

function village(): { people: PeopleRegister; places: PlaceRegister } {
  nextId = 1;
  const people = new PeopleRegister();
  const places = new PlaceRegister();
  for (const [index, name] of ['Agnes Hargrave', 'Walter Barrow', 'Nesta Plowright'].entries()) {
    people.add({ id: npc(index), name, sex: 'female', born: '1170-03-02', family: null });
  }
  places.add({ id: place(0), name: 'The Green', type: 'square', access: 'public' });
  places.add({ id: place(1), name: 'A cottage on Mill Lane', type: 'dwelling', access: 'private' });
  return { people, places };
}

function day(events: readonly SimEvent[]): ChronicleDay {
  const { people, places } = village();
  return new ChronicleDay({ key: KEY, events, people, places });
}

describe('a day, indexed', () => {
  it('finds everything one person took part in, in archive order', () => {
    nextId = 1;
    const first = event('npc.woke', { actors: [npc(0)] });
    const other = event('npc.woke', { actors: [npc(1)] });
    const second = event('npc.turning-in', { actors: [npc(0)] });
    const chronicle = day([first, other, second]);

    expect(chronicle.byActor(npc(0))).toEqual([first, second]);
    expect(chronicle.byActor(npc(1))).toEqual([other]);
    expect(chronicle.byActor(npc(2))).toEqual([]);
  });

  it('counts an event once per actor but holds it once', () => {
    nextId = 1;
    const together = event('society.household-founded', { actors: [npc(0), npc(1)] });
    const chronicle = day([together]);

    expect(chronicle.byActor(npc(0))).toEqual([together]);
    expect(chronicle.byActor(npc(1))).toEqual([together]);
    expect(chronicle.size).toBe(1);
  });

  it('finds everything that happened somewhere', () => {
    nextId = 1;
    const onGreen = event('travel.arrived', { actors: [npc(0)], location: place(0) });
    const indoors = event('npc.went-to-bed', { actors: [npc(0)], location: place(1) });
    const nowhere = event('npc.turning-in', { actors: [npc(0)] });
    const chronicle = day([onGreen, indoors, nowhere]);

    expect(chronicle.byPlace(place(0))).toEqual([onGreen]);
    expect(chronicle.byPlace(place(1))).toEqual([indoors]);
    // An event with no location belongs to no place, rather than to all of them.
    expect(chronicle.byPlace(place(2))).toEqual([]);
  });

  it('counts each kind of thing that happened', () => {
    nextId = 1;
    const chronicle = day([
      event('travel.arrived', { actors: [npc(0)] }),
      event('travel.arrived', { actors: [npc(1)] }),
      event('travel.blocked', { actors: [npc(0)] }),
    ]);

    expect(chronicle.countOf('travel.arrived')).toBe(2);
    expect(chronicle.countOf('travel.blocked')).toBe(1);
    expect(chronicle.countOf('npc.removed')).toBe(0);
    expect(chronicle.byType('travel.arrived')).toHaveLength(2);
    expect(chronicle.byType('npc.removed')).toEqual([]);
  });

  it('lists kinds and actors in the order each first appeared', () => {
    nextId = 1;
    const chronicle = day([
      event('travel.arrived', { actors: [npc(2)] }),
      event('npc.woke', { actors: [npc(0)] }),
      event('travel.arrived', { actors: [npc(1)] }),
    ]);

    expect(chronicle.types()).toEqual(['travel.arrived', 'npc.woke']);
    expect(chronicle.actors()).toEqual([npc(2), npc(0), npc(1)]);
  });

  it('finds an event by its id, and throws on one it does not hold', () => {
    nextId = 1;
    const only = event('npc.woke', { actors: [npc(0)] });
    const chronicle = day([only]);

    expect(chronicle.require(only.id)).toBe(only);
    expect(chronicle.find(only.id)).toBe(only);
    expect(chronicle.find(999)).toBeUndefined();
    expect(() => chronicle.require(999)).toThrow(/no such event/);
  });

  it('refuses a day that holds one event id twice', () => {
    nextId = 1;
    const once = event('npc.woke', { actors: [npc(0)] });
    expect(() => day([once, once])).toThrow(/share an id/);
  });
});

describe('where somebody was', () => {
  it('credits a person with everywhere an event named them and a place', () => {
    nextId = 1;
    const chronicle = day([
      event('npc.woke', { actors: [npc(0)], location: place(1) }),
      event('travel.arrived', { actors: [npc(0)], location: place(0) }),
    ]);

    expect([...chronicle.presenceOf(npc(0))]).toEqual([place(1), place(0)]);
  });

  it('credits nobody with somewhere they were not an actor', () => {
    nextId = 1;
    const chronicle = day([event('travel.arrived', { actors: [npc(0)], location: place(0) })]);

    expect(chronicle.presenceOf(npc(1)).size).toBe(0);
    expect(chronicle.presenceOf(npc(0)).has(place(0))).toBe(true);
  });

  it('credits nobody with a place the event did not name', () => {
    nextId = 1;
    const chronicle = day([event('npc.turning-in', { actors: [npc(0)] })]);
    expect(chronicle.presenceOf(npc(0)).size).toBe(0);
  });

  it('credits the doorstep somebody was turned back on, never the room', () => {
    nextId = 1;
    // `travel.blocked` says where they wanted to go in its data and where they
    // actually stood in its location. Slice 5 lets a villager write about what
    // they saw, so crediting the room they never entered would be a lie with a
    // schema.
    const chronicle = day([
      event('travel.blocked', {
        actors: [npc(0)],
        location: place(0),
        data: { to: place(1), reason: 'full' },
      }),
    ]);

    expect(chronicle.presenceOf(npc(0)).has(place(0))).toBe(true);
    expect(chronicle.presenceOf(npc(0)).has(place(1))).toBe(false);
  });

  it('records somewhere once however often somebody went back', () => {
    nextId = 1;
    const chronicle = day([
      event('travel.arrived', { actors: [npc(0)], location: place(0) }),
      event('travel.departed', { actors: [npc(0)], location: place(0) }),
      event('travel.arrived', { actors: [npc(0)], location: place(0) }),
    ]);

    expect(chronicle.presenceOf(npc(0)).size).toBe(1);
  });

  it('does not let a caller who was nowhere teach the day otherwise', () => {
    nextId = 1;
    const chronicle = day([event('npc.woke', { actors: [npc(0)] })]);

    // `Object.freeze` does not close a `Set`, so the guarantee cannot be that
    // this throws. It is that whatever a caller does to what they were handed,
    // the day still says what it said -- and that the next caller is not told
    // a story the first one invented.
    (chronicle.presenceOf(npc(0)) as Set<EntityId>).add(place(0));
    expect(chronicle.presenceOf(npc(0)).size).toBe(0);
    expect(chronicle.presenceOf(npc(1)).size).toBe(0);
  });

  it('does not let a caller lengthen what somebody did', () => {
    nextId = 1;
    const chronicle = day([event('npc.woke', { actors: [npc(0)] })]);
    const nothing = chronicle.byActor(npc(1));
    expect(() => (nothing as SimEvent[]).push(event('npc.woke'))).toThrow();
    expect(chronicle.byActor(npc(2))).toHaveLength(0);
  });
});

describe('whether anybody could have seen it', () => {
  it('knows a public place from a private one', () => {
    nextId = 1;
    const chronicle = day([]);
    expect(chronicle.isPublic(place(0))).toBe(true);
    expect(chronicle.isPublic(place(1))).toBe(false);
  });

  it('treats nowhere, and nowhere it has heard of, as unwitnessed', () => {
    nextId = 1;
    const chronicle = day([]);
    expect(chronicle.isPublic(undefined)).toBe(false);
    expect(chronicle.isPublic(place(9))).toBe(false);
  });
});
