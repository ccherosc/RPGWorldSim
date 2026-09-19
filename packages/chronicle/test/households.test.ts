import { describe, expect, it } from 'vitest';
import { ChronicleDay, Households, PeopleRegister, PlaceRegister } from '@rpgsim/chronicle';
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
 * How many roofs the village lives under.
 *
 * One number, and the reason it is worth a file of its own is that the site
 * used to state it from memory. A count that comes off the record can be wrong
 * in only three interesting ways — it can double-count a day it is shown twice,
 * it can miss a house that emptied, and it can know about a house that has not
 * been founded yet — and each of those puts a false figure in a caption that
 * reads like a fact.
 */

const DAWN = 90 * TICKS_PER_DAY;
const KEY = dayKeyOf(DAWN, DEFAULT_CALENDAR);
const LATER = dayKeyOf(DAWN + TICKS_PER_DAY, DEFAULT_CALENDAR);

const house = (index: number): EntityId => makeEntityId(EntityKind.Household, index);

let nextId = 1;

const event = (type: string, data: Record<string, unknown>): SimEvent => ({
  id: nextId++,
  tick: DAWN,
  type,
  actors: [],
  data: data as SimEvent['data'],
  causes: [],
});

const founded = (id: EntityId, name = 'Netherby'): SimEvent =>
  event('society.household-founded', { household: id, name, size: 4, origin: 'founding' });

const dissolved = (id: EntityId): SimEvent =>
  event('society.household-dissolved', { household: id, reason: 'emptied' });

const day = (events: readonly SimEvent[], key = KEY): ChronicleDay =>
  new ChronicleDay({ key, events, people: new PeopleRegister(), places: new PlaceRegister() });

const counted = (...events: readonly SimEvent[]): Households => {
  const houses = new Households();
  houses.learn(day(events));
  return houses;
};

describe('counting the roofs', () => {
  it('starts at none, because a record nobody has read says nothing', () => {
    expect(new Households().count).toBe(0);
  });

  it('counts a house for every founding the record holds', () => {
    expect(counted(founded(house(0)), founded(house(1)), founded(house(2))).count).toBe(3);
  });

  it('takes a house away when it is dissolved', () => {
    expect(counted(founded(house(0)), founded(house(1)), dissolved(house(0))).count).toBe(1);
  });

  it('adds the days up as they arrive', () => {
    const houses = new Households();
    houses.learn(day([founded(house(0))]));
    expect(houses.count).toBe(1);
    houses.learn(day([founded(house(1))], LATER));
    expect(houses.count).toBe(2);
  });
});

describe('what the count refuses to do', () => {
  it('counts the same house once however often the day is read', () => {
    // The press reads the archive again on every build. A tally that went up
    // each time would make the number depend on how often the site was
    // published, which is the one thing about it nobody would ever check.
    const houses = new Households();
    const today = day([founded(house(0)), founded(house(1))]);
    houses.learn(today);
    houses.learn(today);
    houses.learn(today);
    expect(houses.count).toBe(2);
  });

  it('ignores a founding that names no household', () => {
    expect(counted(event('society.household-founded', { name: 'Netherby' })).count).toBe(0);
  });

  it('ignores a founding whose household is not an id', () => {
    expect(counted(event('society.household-founded', { household: 'the Netherbys' })).count).toBe(0);
  });

  it('ignores a payload that is not a record at all', () => {
    const odd: SimEvent = { ...founded(house(0)), data: 'nonsense' as SimEvent['data'] };
    expect(counted(odd).count).toBe(0);
  });

  it('does not count houses from a day it has not been given', () => {
    // The same rule `Kinfolk` lives by. A caption on the third of Blossom
    // reports the houses standing on the third of Blossom, so that rebuilding
    // an old page cannot quietly hand it next month's village.
    const houses = new Households();
    houses.learn(day([founded(house(0))]));
    expect(houses.count).toBe(1);
  });

  it('is not troubled by a house dissolving that it never knew about', () => {
    expect(counted(dissolved(house(9))).count).toBe(0);
  });

  it('takes no notice of any other kind of event', () => {
    expect(counted(event('npc.woke', { household: house(0) })).count).toBe(0);
  });
});
