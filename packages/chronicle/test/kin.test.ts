import { describe, expect, it } from 'vitest';
import { ChronicleDay, Kinfolk, PeopleRegister, PlaceRegister } from '@rpgsim/chronicle';
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
 * Who belongs to whom, read back off the record.
 *
 * The index itself is four lines of bookkeeping. What is worth testing is the
 * shape of its ignorance: it must not know a parentage the archive did not
 * record, must not know one the archive recorded as absent, and must not know
 * one from a day it has not been given yet. Every one of those, if it went the
 * other way, would put a sentence on the site about a child the writer has no
 * standing to speak for — which is directive 5 with a family tree in front of
 * it.
 */

const DAWN = 90 * TICKS_PER_DAY;
const KEY = dayKeyOf(DAWN, DEFAULT_CALENDAR);

const npc = (index: number): EntityId => makeEntityId(EntityKind.Npc, index);

const MOTHER = npc(0);
const FATHER = npc(1);
const CHILD = npc(2);
const SECOND = npc(3);

let nextId = 1;

const event = (type: string, data: Record<string, unknown>, actors: readonly EntityId[] = []): SimEvent => ({
  id: nextId++,
  tick: DAWN,
  type,
  actors,
  data: data as SimEvent['data'],
  causes: [],
});

/** What the simulation writes when a birth is set down. */
const parentage = (
  child: EntityId,
  mother: EntityId | null,
  father: EntityId | null,
): SimEvent =>
  event(
    'society.parentage-recorded',
    {
      child,
      mother,
      motherAbsent: mother === null ? 'unknown' : null,
      father,
      fatherAbsent: father === null ? 'unknown' : null,
    },
    [child],
  );

const day = (events: readonly SimEvent[], key = KEY): ChronicleDay =>
  new ChronicleDay({ key, events, people: new PeopleRegister(), places: new PlaceRegister() });

const learned = (...events: readonly SimEvent[]): Kinfolk => {
  const kin = new Kinfolk();
  kin.learn(day(events));
  return kin;
};

describe('reading parentage off the record', () => {
  it('gives a child to both of the parents the record names', () => {
    const kin = learned(parentage(CHILD, MOTHER, FATHER));
    expect(kin.childrenOf(MOTHER)).toEqual([CHILD]);
    expect(kin.childrenOf(FATHER)).toEqual([CHILD]);
    expect(kin.size).toBe(2);
  });

  it('keeps a parent’s children in the order they were recorded', () => {
    const kin = learned(parentage(CHILD, MOTHER, null), parentage(SECOND, MOTHER, null));
    expect(kin.childrenOf(MOTHER)).toEqual([CHILD, SECOND]);
  });

  it('knows nobody about a villager who has no children', () => {
    const kin = learned(parentage(CHILD, MOTHER, FATHER));
    expect(kin.childrenOf(SECOND)).toEqual([]);
  });
});

describe('what the record does not say', () => {
  it('skips an absent parent rather than inventing one', () => {
    // `motherAbsent: 'unknown'` is the world saying it has a reason for not
    // naming her. None of those reasons is somebody who can write a post.
    const kin = learned(parentage(CHILD, null, FATHER));
    expect(kin.size).toBe(1);
    expect(kin.childrenOf(FATHER)).toEqual([CHILD]);
  });

  it('skips a record with no child in it', () => {
    const kin = learned(event('society.parentage-recorded', { child: null, mother: MOTHER }));
    expect(kin.size).toBe(0);
  });

  it('skips a record whose payload is not a record at all', () => {
    // An archive is a file, and a file can be anything. A payload that is a
    // bare string has to be stepped over rather than indexed into.
    const bare = event('society.parentage-recorded', {});
    const kin = learned({ ...bare, data: 'nonsense' as unknown as SimEvent['data'] });
    expect(kin.size).toBe(0);
  });

  it('ignores every other kind of event, including one that names a parent', () => {
    // A household names its members and is not a statement about descent. If
    // this ever passed for parentage, siblings would start speaking for each
    // other.
    const kin = learned(
      event('society.household-founded', { mother: MOTHER, child: CHILD }, [MOTHER, CHILD]),
      event('npc.woke', { child: CHILD, mother: MOTHER }, [CHILD]),
    );
    expect(kin.size).toBe(0);
  });

  it('refuses a record that makes somebody their own parent', () => {
    expect(() => learned(parentage(CHILD, CHILD, null))).toThrow();
  });
});

describe('learning forwards', () => {
  it('does not know a birth it has not been shown yet', () => {
    // The press reads the archive a day at a time for exactly this reason. A
    // post written on the first of the month must not rest on a child born on
    // the fourth, and the only thing standing between those two is that the
    // index has not been told yet.
    const kin = new Kinfolk();
    kin.learn(day([], KEY));
    expect(kin.childrenOf(MOTHER)).toEqual([]);

    kin.learn(day([parentage(CHILD, MOTHER, null)]));
    expect(kin.childrenOf(MOTHER)).toEqual([CHILD]);
  });

  it('adds nobody twice when the same day is read again', () => {
    // Nothing in the press re-reads a day today. It costs one Set to make that
    // a property of the index rather than a property of its one caller, and a
    // parent with the same daughter listed twice would double her odds of being
    // the one mentioned, quietly and only on the days she had a sibling.
    const kin = new Kinfolk();
    const born = parentage(CHILD, MOTHER, FATHER);
    kin.learn(day([born]));
    kin.learn(day([born]));
    expect(kin.childrenOf(MOTHER)).toEqual([CHILD]);
    expect(kin.childrenOf(FATHER)).toEqual([CHILD]);
  });
});
