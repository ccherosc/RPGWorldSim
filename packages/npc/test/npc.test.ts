import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALENDAR,
  EntityKind,
  RngStream,
  Simulation,
  dateTimeToTick,
  makeEntityId,
  tickToDateTime,
} from '@rpgsim/sim-core';
import { DEFAULT_AGE_BANDS, birthYearForAge, generateTraits } from '../src/generate.ts';
import { makeNameBook } from '../src/names.ts';
import { type GenerateVillagerOptions, NpcEvent, NpcOrigin } from '../src/people.ts';
import { Sex, ageInYears, fullName, isBirthday, makePerson } from '../src/person.ts';
import { Population } from '../src/population.ts';
import { NPC_SAVE_MODULE_ID, installPeople } from '../src/save.ts';
import { TRAIT_MAX, TRAIT_MIN, TRAIT_NAMES, Trait, makeTraits } from '../src/traits.ts';

/**
 * Identity, adversarially.
 *
 * A person is mostly a bag of constants, which makes it tempting to test
 * shallowly. Three things can actually go wrong. An age that disagrees with a
 * birth date -- an off-by-one nobody notices until a villager ages twice in a
 * year. A generator whose draw order shifts -- every seed silently produces a
 * different village. A save that loses a field -- a world that reloads with
 * everybody's personality reset to the mean and still hashes fine, because the
 * hash is computed from the save.
 *
 * The tests are aimed at those, in that order.
 */

const npc = (n: number) => makeEntityId(EntityKind.Npc, n);
const loc = (n: number) => makeEntityId(EntityKind.Location, n);

const NAMES = makeNameBook(
  JSON.parse(readFileSync(join(process.cwd(), 'data', 'world', 'names.json'), 'utf8')),
);

/** Midsummer of the epoch year, so "before" and "after" a birthday both exist. */
const MIDYEAR = dateTimeToTick({ year: 1200, month: 7, day: 15 });

function world(seed = 'world-zero', startTick = MIDYEAR) {
  const sim = new Simulation({ seed, startTick });
  const people = installPeople(sim);
  return { sim, people, population: people.population };
}

function someone(overrides: Partial<Parameters<typeof makePerson>[0]> = {}) {
  return makePerson({
    id: npc(0),
    givenName: 'Edric',
    familyName: 'Hale',
    sex: Sex.Male,
    birth: { year: 1157, month: 3, day: 4 },
    culture: 'valefolk',
    ...overrides,
  });
}

/**
 * A person who could not have been built.
 *
 * `makePerson` refuses everything the invariants look for, and freezes what it
 * returns, so the only way to reach the states those checks exist to catch is to
 * assemble the record by hand. That is not an artificial scenario: it is what an
 * older save, or a future system editing a villager in place, amounts to.
 */
function broken(overrides: Record<string, unknown> = {}) {
  return { ...(someone() as unknown as Record<string, unknown>), ...overrides };
}

/** Put a record straight into the register, past `add` and past validation. */
function smuggle(population: Population, key: unknown, person: unknown): void {
  (population as unknown as { people: Map<unknown, unknown> }).people.set(key, person);
}

describe('a person', () => {
  it('is built with every trait present, defaulting to the middle of the scale', () => {
    const person = someone();
    expect(Object.keys(person.traits).sort()).toEqual([...TRAIT_NAMES]);
    expect(person.traits[Trait.Honesty]).toBe(50);
  });

  it('keeps the traits it was given', () => {
    const person = someone({ traits: { [Trait.Courage]: 91, [Trait.Honesty]: 12 } });
    expect(person.traits[Trait.Courage]).toBe(91);
    expect(person.traits[Trait.Honesty]).toBe(12);
    expect(person.traits[Trait.Empathy]).toBe(50);
  });

  it('refuses a trait outside the scale rather than clamping it', () => {
    expect(() => makeTraits({ [Trait.Courage]: TRAIT_MAX + 1 })).toThrow(/outside its range/);
    expect(() => makeTraits({ [Trait.Courage]: TRAIT_MIN - 1 })).toThrow(/outside its range/);
  });

  it('refuses a non-integer trait', () => {
    expect(() => makeTraits({ [Trait.Courage]: 61.5 })).toThrow();
  });

  it('refuses a birth date the calendar does not have', () => {
    expect(() => someone({ birth: { year: 1157, month: 3, day: 31 } })).toThrow(/calendar/);
    expect(() => someone({ birth: { year: 1157, month: 13, day: 1 } })).toThrow(/calendar/);
    expect(() => someone({ birth: { year: 1157, month: 0, day: 1 } })).toThrow(/calendar/);
  });

  it('refuses an id that does not name an npc', () => {
    expect(() => someone({ id: makeEntityId(EntityKind.Household, 3) })).toThrow(/npc id/);
  });

  it('refuses a person with no name', () => {
    expect(() => someone({ givenName: '' })).toThrow(/given name/);
    expect(() => someone({ familyName: '' })).toThrow(/family name/);
  });

  it('reads back as a name', () => {
    expect(fullName(someone())).toBe('Edric Hale');
  });

  it('is frozen, so nobody edits a villager in place', () => {
    const person = someone();
    expect(Object.isFrozen(person)).toBe(true);
    expect(Object.isFrozen(person.traits)).toBe(true);
  });
});

describe('age', () => {
  const on = (month: number, day: number) =>
    tickToDateTime(dateTimeToTick({ year: 1200, month, day }));

  it('counts whole years once the birthday has passed', () => {
    // Born Seedtide 4 (month 3). On Haymoon 15 that birthday is behind us.
    expect(ageInYears({ year: 1157, month: 3, day: 4 }, on(7, 15))).toBe(43);
  });

  it('is a year less before the birthday comes round', () => {
    // The same person, two months before their birthday: still 42.
    expect(ageInYears({ year: 1157, month: 3, day: 4 }, on(1, 20))).toBe(42);
  });

  it('turns over on the birthday itself, not the day after', () => {
    expect(ageInYears({ year: 1157, month: 3, day: 4 }, on(3, 3))).toBe(42);
    expect(ageInYears({ year: 1157, month: 3, day: 4 }, on(3, 4))).toBe(43);
    expect(ageInYears({ year: 1157, month: 3, day: 4 }, on(3, 5))).toBe(43);
  });

  it('is zero for somebody born earlier the same year', () => {
    expect(ageInYears({ year: 1200, month: 3, day: 4 }, on(7, 15))).toBe(0);
  });

  it('goes negative for a birth date in the future rather than clamping to zero', () => {
    expect(ageInYears({ year: 1201, month: 3, day: 4 }, on(7, 15))).toBe(-1);
  });

  it('knows a birthday when it sees one', () => {
    const person = someone();
    expect(isBirthday(person, on(3, 4))).toBe(true);
    expect(isBirthday(person, on(3, 5))).toBe(false);
  });
});

describe('birthYearForAge', () => {
  const now = tickToDateTime(MIDYEAR);

  it('is the exact inverse of ageInYears, for every day of the year', () => {
    // The off-by-one only shows up on one side of the birthday, so sweep the
    // whole calendar rather than spot-checking two dates.
    for (let month = 1; month <= DEFAULT_CALENDAR.months.length; month++) {
      for (let day = 1; day <= 30; day++) {
        for (const age of [0, 1, 17, 43, 84]) {
          const year = birthYearForAge(age, { month, day }, now);
          expect(ageInYears({ year, month, day }, now)).toBe(age);
        }
      }
    }
  });
});

describe('the name book', () => {
  it('accepts the shipped village names', () => {
    expect(NAMES.culture).toBe('valefolk');
    expect(NAMES.given.male.length).toBeGreaterThan(20);
    expect(NAMES.given.female.length).toBeGreaterThan(20);
    expect(NAMES.family.length).toBeGreaterThan(20);
  });

  it('refuses a duplicate name rather than quietly doubling its odds', () => {
    expect(() =>
      makeNameBook({
        culture: 'valefolk',
        given: { male: ['Edric', 'Edric'], female: ['Agnes'] },
        family: ['Hale'],
      }),
    ).toThrow(/duplicate/);
  });

  it('refuses an empty list, because generation would have nothing to pick', () => {
    expect(() =>
      makeNameBook({
        culture: 'valefolk',
        given: { male: [], female: ['Agnes'] },
        family: ['Hale'],
      }),
    ).toThrow();
  });

  it('refuses an unknown key, so a typo in the data file is not silently ignored', () => {
    expect(() =>
      makeNameBook({
        culture: 'valefolk',
        given: { male: ['Edric'], female: ['Agnes'] },
        famly: ['Hale'],
      }),
    ).toThrow();
  });
});

describe('generation', () => {
  it('produces the same person from the same seed', () => {
    const one = world('alpha').people.generate({ names: NAMES });
    const two = world('alpha').people.generate({ names: NAMES });
    expect(one).toEqual(two);
  });

  it('produces a different person from a different seed', () => {
    const a = world('alpha').people.generate({ names: NAMES });
    const b = world('beta').people.generate({ names: NAMES });
    expect({ ...a, id: null }).not.toEqual({ ...b, id: null });
  });

  it('draws from the npc generation stream and no other', () => {
    const { sim, people } = world();
    const before = sim.random(RngStream.NpcDecisions).save().draws;
    people.generate({ names: NAMES });
    expect(sim.random(RngStream.NpcGeneration).save().draws).toBeGreaterThan(0);
    expect(sim.random(RngStream.NpcDecisions).save().draws).toBe(before);
  });

  it('gives everybody a name from the book, appropriate to their sex', () => {
    const { people } = world();
    for (let i = 0; i < 60; i++) {
      const person = people.generate({ names: NAMES });
      const pool = person.sex === Sex.Male ? NAMES.given.male : NAMES.given.female;
      expect(pool).toContain(person.givenName);
      expect(NAMES.family).toContain(person.familyName);
      expect(person.culture).toBe('valefolk');
    }
  });

  it('produces both sexes over a village-sized population', () => {
    const { people } = world();
    const sexes = new Set<string>();
    for (let i = 0; i < 100; i++) sexes.add(people.generate({ names: NAMES }).sex);
    expect([...sexes].sort()).toEqual([Sex.Female, Sex.Male]);
  });

  it('spreads ages across the bands instead of producing a hundred adults', () => {
    const { sim, people } = world();
    const now = sim.now();
    const ages: number[] = [];
    for (let i = 0; i < 200; i++) {
      ages.push(ageInYears(people.generate({ names: NAMES }).birth, now));
    }
    const oldest = DEFAULT_AGE_BANDS[DEFAULT_AGE_BANDS.length - 1];
    expect(Math.min(...ages)).toBeLessThan(14);
    expect(Math.max(...ages)).toBeGreaterThan(59);
    expect(Math.max(...ages)).toBeLessThanOrEqual(oldest?.maxAge ?? 0);
    expect(ages.filter((age) => age < 14).length).toBeGreaterThan(30);
  });

  it('honours a fixed age exactly, whatever the birthday lands on', () => {
    const { sim, people } = world();
    const now = sim.now();
    for (let i = 0; i < 50; i++) {
      expect(ageInYears(people.generate({ names: NAMES, age: 7 }).birth, now)).toBe(7);
    }
  });

  it('honours a fixed sex and family name, which is how a household is built', () => {
    const { people } = world();
    const person = people.generate({ names: NAMES, sex: Sex.Female, familyName: 'Webb' });
    expect(person.sex).toBe(Sex.Female);
    expect(person.familyName).toBe('Webb');
    expect(NAMES.given.female).toContain(person.givenName);
  });

  it('skips the draw for a field the caller fixed instead of drawing and discarding', () => {
    // The contract that makes a household affordable. Giving four siblings one
    // surname must not consume four surname draws, or fixing a field would
    // silently shift every villager generated after it.
    const drawsFor = (options: Partial<GenerateVillagerOptions>) => {
      const { sim, people } = world('draw-count');
      const stream = sim.random(RngStream.NpcGeneration);
      const before = stream.draws;
      people.generate({ names: NAMES, ...options });
      return stream.draws - before;
    };

    const full = drawsFor({});
    expect(full).toBe(150);
    expect(drawsFor({ sex: Sex.Female })).toBe(full - 1);
    expect(drawsFor({ familyName: 'Webb' })).toBe(full - 1);
    // An age costs two: the band, then the year inside it.
    expect(drawsFor({ age: 30 })).toBe(full - 2);
    expect(drawsFor({ sex: Sex.Female, familyName: 'Webb', age: 30 })).toBe(full - 4);
  });

  it('spreads birthdays over the whole year rather than bunching in one month', () => {
    const { people } = world();
    const months = new Set<number>();
    for (let i = 0; i < 200; i++) months.add(people.generate({ names: NAMES }).birth.month);
    expect(months.size).toBe(DEFAULT_CALENDAR.months.length);
  });

  it('rolls traits inside the scale, varied, and not all at the mean', () => {
    const rng = world().sim.random(RngStream.NpcGeneration);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const traits = generateTraits(rng);
      for (const name of TRAIT_NAMES) {
        const value = traits[name];
        expect(Number.isSafeInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(TRAIT_MIN);
        expect(value).toBeLessThanOrEqual(TRAIT_MAX);
        seen.add(value);
      }
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it('honours a per-trait distribution, so a data file can skew a village', () => {
    const rng = world().sim.random(RngStream.NpcGeneration);
    let pious = 0;
    let honest = 0;
    for (let i = 0; i < 100; i++) {
      const traits = generateTraits(rng, { [Trait.Religiosity]: { mean: 90, stdDev: 4 } });
      pious += traits[Trait.Religiosity];
      honest += traits[Trait.Honesty];
    }
    expect(pious / 100).toBeGreaterThan(80);
    expect(honest / 100).toBeLessThan(65);
  });

  it('gives each villager a fresh id', () => {
    const { people } = world();
    const first = people.generate({ names: NAMES }).id;
    const second = people.generate({ names: NAMES }).id;
    expect(first).not.toBe(second);
  });
});

describe('the population register', () => {
  it('lists people in numeric id order, not the order they were added', () => {
    const population = new Population();
    for (const n of [10, 2, 0]) population.add(someone({ id: npc(n) }));
    expect(population.ids()).toEqual([npc(0), npc(2), npc(10)]);
  });

  it('refuses a duplicate id rather than overwriting somebody', () => {
    const population = new Population();
    population.add(someone());
    expect(() => population.add(someone({ givenName: 'Agnes' }))).toThrow(/already exists/);
  });

  it('refuses to look up somebody who is not there', () => {
    expect(() => new Population().require(npc(0))).toThrow(/no such person/);
  });

  it('refuses to replace somebody who is not there', () => {
    expect(() => new Population().replace(someone())).toThrow(/not here/);
  });

  it('groups by household and by home, in id order', () => {
    const population = new Population();
    const house = makeEntityId(EntityKind.Household, 0);
    for (const n of [3, 1, 2]) population.add(someone({ id: npc(n) }));
    population.setHousehold(npc(3), house);
    population.setHousehold(npc(1), house);
    population.setHome(npc(1), loc(4));
    expect(population.membersOf(house).map((p) => p.id)).toEqual([npc(1), npc(3)]);
    expect(population.residentsOf(loc(4)).map((p) => p.id)).toEqual([npc(1)]);
  });

  it('replaces the record rather than mutating it, so nothing holds a stale person', () => {
    const population = new Population();
    const before = population.add(someone());
    const after = population.setHome(npc(0), loc(4));
    expect(before.home).toBeNull();
    expect(after.home).toBe(loc(4));
    expect(population.require(npc(0)).home).toBe(loc(4));
  });
});

describe('events', () => {
  it('announces a new villager with enough detail to write a line about them', () => {
    const { sim, people } = world();
    const person = people.generate({ names: NAMES, age: 31 });
    const created = sim.log.byType(NpcEvent.Created, 10);
    expect(created).toHaveLength(1);
    expect(created[0]?.actors).toEqual([person.id]);
    expect(created[0]?.data).toMatchObject({
      npc: person.id,
      name: fullName(person),
      age: 31,
      origin: NpcOrigin.Founding,
    });
  });

  it('announces a move into a household and into a home', () => {
    const { sim, people } = world();
    const person = people.generate({ names: NAMES });
    const house = makeEntityId(EntityKind.Household, 0);
    people.setHousehold(person.id, house);
    people.setHome(person.id, loc(4));
    expect(sim.log.byType(NpcEvent.HouseholdChanged, 10)[0]?.data).toMatchObject({
      npc: person.id,
      from: null,
      to: house,
    });
    const homed = sim.log.byType(NpcEvent.HomeChanged, 10)[0];
    expect(homed?.data).toMatchObject({ npc: person.id, from: null, to: loc(4) });
    expect(homed?.location).toBe(loc(4));
  });

  it('says nothing when a set changes nothing', () => {
    const { sim, people } = world();
    const person = people.generate({ names: NAMES });
    people.setHome(person.id, loc(4));
    people.setHome(person.id, loc(4));
    expect(sim.log.byType(NpcEvent.HomeChanged, 10)).toHaveLength(1);
  });

  it('will not remove somebody without a stated reason', () => {
    const { people } = world();
    const person = people.generate({ names: NAMES });
    expect(() => people.remove(person.id, '')).toThrow(/reason/);
    people.remove(person.id, 'left the valley');
    expect(people.population.has(person.id)).toBe(false);
  });
});

describe('persistence', () => {
  it('round-trips a village through a save without losing anybody or anything', () => {
    const { sim, people } = world();
    for (let i = 0; i < 20; i++) people.generate({ names: NAMES });
    people.setHousehold(npc(3), makeEntityId(EntityKind.Household, 1));
    people.setHome(npc(3), loc(9));

    const reloaded = new Simulation({ seed: 'world-zero', startTick: MIDYEAR });
    const reloadedPeople = installPeople(reloaded);
    reloaded.load(sim.save());

    expect(reloaded.hash()).toBe(sim.hash());
    expect(reloadedPeople.population.all()).toEqual(people.population.all());
    expect(reloadedPeople.population.require(npc(3)).home).toBe(loc(9));
  });

  it('writes every field, so a dropped one is not hidden by a matching hash', () => {
    // The hash is computed *from* the save, so a field that never gets written
    // is invisible to a hash comparison. Read the block instead.
    const { sim, people } = world();
    const person = people.generate({ names: NAMES });
    const block = sim.save().modules[NPC_SAVE_MODULE_ID];
    const saved = (block?.data as { people: Record<string, unknown>[] }).people[0];
    expect(Object.keys(saved ?? {}).sort()).toEqual([
      'birth',
      'birthplace',
      'culture',
      'familyName',
      'givenName',
      'home',
      'household',
      'id',
      'sex',
      'traits',
    ]);
    expect(saved?.['traits']).toEqual({ ...person.traits });
  });

  it('refuses a save whose birth date the calendar does not have', () => {
    const { sim, people } = world();
    people.generate({ names: NAMES });
    const envelope = sim.save();
    const block = envelope.modules[NPC_SAVE_MODULE_ID] as unknown as { data: { people: unknown[] } };
    (block.data.people[0] as { birth: unknown }).birth = { year: 1180, month: 2, day: 44 };

    const reloaded = new Simulation({ seed: 'world-zero', startTick: MIDYEAR });
    installPeople(reloaded);
    expect(() => reloaded.load(envelope)).toThrow();
  });

  it('refuses a save with a trait outside the scale', () => {
    const { sim, people } = world();
    people.generate({ names: NAMES });
    const envelope = sim.save();
    const block = envelope.modules[NPC_SAVE_MODULE_ID] as unknown as { data: { people: unknown[] } };
    (block.data.people[0] as { traits: Record<string, number> }).traits[Trait.Courage] = 400;

    const reloaded = new Simulation({ seed: 'world-zero', startTick: MIDYEAR });
    installPeople(reloaded);
    expect(() => reloaded.load(envelope)).toThrow();
  });

  it('replaces the living population rather than merging into it', () => {
    const { sim, people } = world();
    people.generate({ names: NAMES });
    const envelope = sim.save();

    const reloaded = new Simulation({ seed: 'world-zero', startTick: MIDYEAR });
    const reloadedPeople = installPeople(reloaded);
    for (let i = 0; i < 5; i++) reloadedPeople.generate({ names: NAMES });
    reloaded.load(envelope);

    expect(reloadedPeople.population.count).toBe(1);
  });
});

describe('installPeople', () => {
  it('registers the npc save module and the npc invariants', () => {
    const { sim } = world();
    expect(sim.saves.has(NPC_SAVE_MODULE_ID)).toBe(true);
    expect(sim.invariants.ids().filter((id) => id.startsWith('npc.'))).toEqual([
      'npc.birth-date-is-in-the-past',
      'npc.identity-is-complete',
      'npc.registry-is-coherent',
      'npc.traits-within-range',
    ]);
  });
});

describe('invariants', () => {
  const idsOf = (sim: Simulation) => sim.checkInvariants().violations.map((v) => v.invariantId);

  it('holds for a freshly generated village', () => {
    const { sim, people } = world();
    for (let i = 0; i < 40; i++) people.generate({ names: NAMES });
    expect(sim.checkInvariants().violations).toEqual([]);
  });

  it('notices a villager filed under the wrong id', () => {
    const { sim, population } = world();
    population.add(someone({ id: npc(0) }));
    smuggle(population, npc(7), someone({ id: npc(0) }));
    expect(idsOf(sim)).toContain('npc.registry-is-coherent');
  });

  it('notices somebody filed under an id that is not an npc', () => {
    const { sim, population } = world();
    const id = makeEntityId(EntityKind.Household, 4);
    smuggle(population, id, broken({ id }));
    expect(idsOf(sim)).toContain('npc.registry-is-coherent');
  });

  it('notices a trait that has been edited out of range', () => {
    const { sim, population } = world();
    smuggle(population, npc(0), broken({ traits: { ...someone().traits, [Trait.Courage]: 900 } }));
    expect(idsOf(sim)).toContain('npc.traits-within-range');
  });

  it('notices a missing trait and an invented one', () => {
    const { sim, population } = world();
    const traits: Record<string, number> = { ...someone().traits, charisma: 50 };
    delete traits[Trait.Honesty];
    smuggle(population, npc(0), broken({ traits }));
    const messages = sim.checkInvariants().violations.map((v) => v.message);
    expect(messages).toContain('a person is missing a trait');
    expect(messages).toContain('a person has a trait nobody has heard of');
  });

  it('notices a villager who has not been born yet', () => {
    const { sim, population } = world();
    population.add(someone({ birth: { year: 1250, month: 1, day: 1 } }));
    const violations = sim.checkInvariants().violations;
    expect(violations.map((v) => v.invariantId)).toContain('npc.birth-date-is-in-the-past');
    expect(violations[0]?.message).toMatch(/not been born/);
  });

  it('notices a birth date the calendar does not have', () => {
    const { sim, population } = world();
    smuggle(population, npc(0), broken({ birth: { year: 1180, month: 2, day: 44 } }));
    expect(idsOf(sim)).toContain('npc.birth-date-is-in-the-past');
  });

  it('notices a nameless villager', () => {
    const { sim, population } = world();
    smuggle(population, npc(0), broken({ givenName: '' }));
    expect(idsOf(sim)).toContain('npc.identity-is-complete');
  });
});

describe('determinism', () => {
  it('generates a byte-identical village twice', () => {
    const build = () => {
      const { sim, people } = world('replay');
      for (let i = 0; i < 50; i++) people.generate({ names: NAMES });
      return sim;
    };
    expect(build().hash()).toBe(build().hash());
  });

  it('does not depend on the order people were added to the register', () => {
    const forwards = new Population();
    const backwards = new Population();
    const ids = [0, 1, 2, 3, 4, 5].map(npc);
    for (const id of ids) forwards.add(someone({ id }));
    for (const id of [...ids].reverse()) backwards.add(someone({ id }));
    expect(JSON.stringify(forwards.toJson())).toBe(JSON.stringify(backwards.toJson()));
  });
});
