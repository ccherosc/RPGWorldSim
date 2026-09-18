import { describe, expect, it } from 'vitest';
import {
  PeopleRegister,
  PlaceRegister,
  type SignificanceConfig,
  distil,
  formatAnnalLine,
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
import type { JsonValue } from '@rpgsim/shared';

/**
 * The distiller, tested against events built by hand.
 *
 * Hand-built rather than simulated on purpose: these tests are about the
 * judgement — what is kept, what is thrown away, what a line says — and a real
 * village day would bury that under twelve hundred events nobody chose. The
 * whole-village checks live in `apps/simulator/test/annals.test.ts`.
 */

const CALENDAR = DEFAULT_CALENDAR;
const DAY = 90; // 1200-04-01, the day World Zero opens on.
const KEY = dayKeyOf(DAY * TICKS_PER_DAY, CALENDAR);

const npc = (index: number): EntityId => makeEntityId(EntityKind.Npc, index);
const household = (index: number): EntityId => makeEntityId(EntityKind.Household, index);

let nextId = 1;

function event(
  type: string,
  data: JsonValue,
  actors: readonly EntityId[] = [],
  minute = 0,
): SimEvent {
  return {
    id: nextId++,
    tick: DAY * TICKS_PER_DAY + minute * 60,
    type,
    actors,
    data,
    causes: [],
  };
}

function created(index: number, name: string, age = 30): SimEvent {
  return event(
    'npc.created',
    { npc: npc(index), name, sex: 'female', age, born: { year: 1170, month: 3, day: 2 }, origin: 'founding' },
    [npc(index)],
  );
}

const SIGNIFICANCE: SignificanceConfig = {
  threshold: 50,
  default: 0,
  weights: {
    'npc.created': 90,
    'society.household-founded': 80,
    'society.parentage-recorded': 60,
    'npc.woke': 0,
    'travel.departed': 0,
  },
};

function fresh(): { people: PeopleRegister; places: PlaceRegister } {
  nextId = 1;
  return { people: new PeopleRegister(), places: new PlaceRegister() };
}

function day(
  events: readonly SimEvent[],
  people: PeopleRegister,
  significance = SIGNIFICANCE,
  places = new PlaceRegister(),
) {
  return distil({ key: KEY, events, calendar: CALENDAR, significance, people, places });
}

describe('what the village bothers to remember', () => {
  it('throws the mechanics away and keeps the founding', () => {
    const { people } = fresh();
    const events = [
      created(0, 'Agnes Hargrave'),
      event('npc.woke', { npc: npc(0), rise: 15114 }, [npc(0)], 5),
      event('travel.departed', { traveller: npc(0) }, [npc(0)], 6),
    ];

    const distilled = day(events, people);
    expect(distilled.lines.map((line) => line.type)).toEqual(['npc.created']);
  });

  it('changes what it keeps when the weights change, with no code change', () => {
    const { people } = fresh();
    const events = [created(0, 'Agnes Hargrave'), event('npc.woke', { npc: npc(0) }, [npc(0)], 5)];

    const quiet = day(events, people);
    expect(quiet.lines.map((line) => line.type)).toEqual(['npc.created']);

    const loud = day(events, people, {
      ...SIGNIFICANCE,
      weights: { ...SIGNIFICANCE.weights, 'npc.woke': 99 },
    });
    expect(loud.lines.map((line) => line.type)).toEqual(['npc.created', 'npc.woke']);
  });

  it('forgets an event type nobody has an opinion about yet', () => {
    // The default is zero so that a system added in Phase 2 does not silently
    // start filling the permanent record with its own internals.
    const { people } = fresh();
    const events = [created(0, 'Agnes Hargrave'), event('weather.wind-shifted', { from: 'north' })];
    expect(day(events, people).lines.map((line) => line.type)).toEqual(['npc.created']);
  });
});

describe('distilling the same day twice', () => {
  const events = () => [
    created(0, 'Agnes Hargrave'),
    created(1, 'Rob Hargrave'),
    event(
      'society.household-founded',
      { household: household(0), name: 'Hargrave', dwelling: 'location:1', head: npc(0), size: 2 },
      [npc(0), npc(1)],
    ),
  ];

  it('produces byte-identical lines', () => {
    const { people } = fresh();
    const built = events();
    const first = day(built, people).lines.map(formatAnnalLine);
    const second = day(built, people).lines.map(formatAnnalLine);
    expect(second).toEqual(first);
  });

  it('writes nobody down twice', () => {
    const { people } = fresh();
    const built = events();
    expect(day(built, people).people).toHaveLength(2);
    expect(day(built, people).people).toHaveLength(0);
    expect(people.size).toBe(2);
  });

  it('does not depend on the register it is handed being empty', () => {
    const one = fresh();
    const two = fresh();
    const builtOne = events();
    nextId = 1;
    const builtTwo = events();

    two.people.add({ id: npc(7), name: 'Old Tomlin', sex: 'male', born: '1130-01-01', family: null });
    expect(day(builtOne, one.people).lines.map(formatAnnalLine)).toEqual(
      day(builtTwo, two.people).lines.map(formatAnnalLine),
    );
  });
});

describe('the line itself', () => {
  it('traces back to the event it came from', () => {
    const { people } = fresh();
    const events = [created(0, 'Agnes Hargrave'), created(1, 'Rob Hargrave')];
    const ids = new Set(events.map((e) => e.id));

    for (const line of day(events, people).lines) {
      expect(ids.has(line.event)).toBe(true);
    }
  });

  it('names people by slug and never by entity id', () => {
    const { people } = fresh();
    const events = [
      created(0, 'Agnes Hargrave'),
      created(1, 'Rob Hargrave'),
      event(
        'society.household-founded',
        { household: household(0), name: 'Hargrave', dwelling: 'location:1', head: npc(0), size: 2 },
        [npc(0), npc(1)],
      ),
    ];

    const founding = day(events, people).lines.find(
      (line) => line.type === 'society.household-founded',
    );
    expect(founding?.who).toBe('agnes-hargrave,rob-hargrave');
    expect(founding?.detail).toBe('the Hargrave house, 2 under the roof');
  });

  it('names only the people in the actor list, not the things', () => {
    // An actor list may hold a household or a location as well as the people
    // involved. Those are participants in the event, not somebody the annals
    // can name -- and `people.require` throws on anything it has no line for,
    // so a missing filter here does not degrade quietly, it takes the whole
    // distillation down.
    const { people } = fresh();
    const events = [
      created(0, 'Agnes Hargrave'),
      event(
        'society.household-founded',
        { household: household(0), name: 'Hargrave', dwelling: 'location:1', head: npc(0), size: 1 },
        [npc(0), household(0)],
      ),
    ];

    const founding = day(events, people).lines.find(
      (line) => line.type === 'society.household-founded',
    );
    expect(founding?.who).toBe('agnes-hargrave');
  });

  it('says nobody rather than an empty column when no person was involved', () => {
    const { people } = fresh();
    const events = [event('world.generated', { village: 'Wodenshill', people: 86 })];
    const line = day(events, people, { ...SIGNIFICANCE, weights: { 'world.generated': 100 } })
      .lines[0];
    expect(line?.who).toBe('-');
  });

  it('carries the clock time to the minute', () => {
    const { people } = fresh();
    const events = [{ ...created(0, 'Agnes Hargrave'), tick: DAY * TICKS_PER_DAY + 6 * 3600 + 12 * 60 }];
    expect(day(events, people).lines[0]?.time).toBe('06:12');
  });

  it('tells a named parent from a parent the world has a reason for', () => {
    const { people } = fresh();
    const events = [
      created(0, 'Agnes Hargrave'),
      created(1, 'Rob Hargrave'),
      created(2, 'Joan Hargrave'),
      event(
        'society.parentage-recorded',
        { child: npc(2), mother: npc(0), motherAbsent: null, father: null, fatherAbsent: 'unrecorded' },
        [npc(2)],
      ),
    ];

    const line = day(events, people).lines.find((l) => l.type === 'society.parentage-recorded');
    expect(line?.detail).toBe('child of agnes-hargrave and unrecorded');
  });

  it('refuses to name somebody the record has never heard of', () => {
    // Almost always means the archive being distilled is missing the day the
    // village was founded -- and a `?` written into a permanent record is
    // permanent.
    const { people } = fresh();
    const events = [event('npc.could-not-rest', { npc: npc(4), reason: 'no-route' }, [npc(4)])];
    expect(() =>
      day(events, people, { ...SIGNIFICANCE, weights: { 'npc.could-not-rest': 60 } }),
    ).toThrow(/no record of this person/);
  });

  it('refuses a day whose events belong to another day', () => {
    const { people } = fresh();
    const stray = { ...created(0, 'Agnes Hargrave'), tick: (DAY + 1) * TICKS_PER_DAY };
    expect(() => day([stray], people)).toThrow(/does not belong to the day named/);
  });
});

describe('the family column', () => {
  it('is filled in from a house founded later the same day', () => {
    // `npc.created` carries no household: worldgen announces the person first
    // and the roof afterwards. A one-pass distiller would write every founding
    // villager down as belonging to nobody.
    const { people } = fresh();
    const events = [
      created(0, 'Agnes Hargrave'),
      event(
        'society.household-founded',
        { household: household(0), name: 'Hargrave', dwelling: 'location:1', head: npc(0), size: 1 },
        [npc(0)],
      ),
    ];

    expect(day(events, people).people[0]?.family).toBe('hargrave');
  });

  it('is left empty when no roof claims them, rather than guessed at', () => {
    const { people } = fresh();
    expect(day([created(0, 'Agnes Hargrave')], people).people[0]?.family).toBeNull();
  });

  it('follows somebody who moves into a house named the same day', () => {
    const { people } = fresh();
    const events = [
      created(0, 'Agnes Hargrave'),
      created(1, 'Rob Tomlin'),
      event(
        'society.household-founded',
        { household: household(0), name: 'Hargrave', dwelling: 'location:1', head: npc(0), size: 1 },
        [npc(0)],
      ),
      event('npc.household-changed', { npc: npc(1), from: null, to: household(0) }, [npc(1)]),
    ];

    const added = day(events, people).people;
    expect(added.map((person) => person.family)).toEqual(['hargrave', 'hargrave']);
  });
});
