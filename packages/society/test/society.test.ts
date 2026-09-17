import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalStringify } from '@rpgsim/shared';
import {
  EntityKind,
  RngStream,
  type Simulation,
  Simulation as Sim,
  dateTimeToTick,
  makeEntityId,
} from '@rpgsim/sim-core';
import { NpcEvent, type PeopleSystem, Sex, installPeople, makeNameBook } from '@rpgsim/npc';
import {
  DEFAULT_HOUSEHOLD_TEMPLATES,
  HouseholdRole,
  type HouseholdRoleName,
  type HouseholdTemplate,
  MAX_FOUNDING_AGE,
  MAX_RESIDENT_CHILD_AGE,
  MIN_PARENT_AGE_GAP,
  ParentAbsence,
  type ParentAbsenceName,
  type PlannedMember,
  RESIDENT_PARENT_AGE_GAP,
  SocietyEvent,
  SocietyRegister,
  absentParent,
  generateHouseholdPlan,
  hasLivingRecordedParent,
  headOf,
  installSociety,
  isMember,
  knownParent,
  knownParentsOf,
  makeHousehold,
  makeParentage,
  memberIds,
  membersWithRole,
  roleOf,
  withHousehold,
} from '../src/index.ts';

/**
 * Households, adversarially.
 *
 * Three things can go wrong here, and they are the three the tests are aimed at.
 *
 * A membership written on one side only -- the house says she lives there, her
 * record says she lives nowhere -- which no single call notices, because each
 * half is individually consistent.
 *
 * A generator that produces a legal village which is not a plausible one: a
 * mother thirteen years older than her daughter, an apprentice of forty, a
 * hundred people who are all somebody's child. Legality is checked by
 * invariants; plausibility has to be checked by pinning the shape of what comes
 * out.
 *
 * And descent that loops. Nobody writes that deliberately; it arrives when
 * marriage and inheritance start rewriting parents in Phase 3, and the check
 * has to exist before the system that breaks it.
 */

const npc = (n: number) => makeEntityId(EntityKind.Npc, n);
const house = (n: number) => makeEntityId(EntityKind.Household, n);
const bld = (n: number) => makeEntityId(EntityKind.Building, n);

const NAMES = makeNameBook(
  JSON.parse(readFileSync(join(process.cwd(), 'data', 'world', 'names.json'), 'utf8')),
);

/** Midsummer of the epoch year, matching the npc tests. */
const MIDYEAR = dateTimeToTick({ year: 1200, month: 7, day: 15 });

function world(seed = 'world-zero', startTick = MIDYEAR) {
  const sim = new Sim({ seed, startTick });
  const people = installPeople(sim);
  const households = installSociety(sim, people);
  return { sim, people, population: people.population, households, register: households.register };
}

/** A template by name, so a test can say which shape it wants. */
function template(name: string): HouseholdTemplate {
  const found = DEFAULT_HOUSEHOLD_TEMPLATES.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no template named ${name}`);
  return found;
}

const SOLO: HouseholdTemplate = {
  ...template('single-adult'),
  residentParentChance: 0,
  apprenticeChance: 0,
};

function someone(people: PeopleSystem, age?: number, sex?: (typeof Sex)[keyof typeof Sex]) {
  return people.generate({
    names: NAMES,
    ...(age !== undefined ? { age } : {}),
    ...(sex !== undefined ? { sex } : {}),
  });
}

/** Violations of one named check, ignoring whatever else the world is guilty of. */
function complaints(sim: Simulation, invariantId: string): string[] {
  return sim
    .checkInvariants()
    .violations.filter((v) => v.invariantId === invariantId)
    .map((v) => v.message);
}

/**
 * Put a record straight into the register, past `add` and past validation.
 *
 * `makeHousehold` refuses a house with two heads and `makeParentage` refuses a
 * child who is their own father, so the only way to reach the states the
 * invariants exist to catch is to assemble them by hand. That is not artificial:
 * it is what a save written by an older build, or a future system editing a
 * family in place, amounts to.
 */
function smuggleHousehold(register: SocietyRegister, key: unknown, household: unknown): void {
  (register as unknown as { households: Map<unknown, unknown> }).households.set(key, household);
}

function smuggleParentage(register: SocietyRegister, child: unknown, record: unknown): void {
  (register as unknown as { parents: Map<unknown, unknown> }).parents.set(child, record);
}

/** Roll `count` households into a world and hand the whole thing back. */
function village(seed: string, count = 12) {
  const built = world(seed);
  for (let i = 0; i < count; i++) {
    built.households.generate({ dwelling: bld(i), names: NAMES });
  }
  return built;
}

// ---------------------------------------------------------------------------

describe('a household', () => {
  const members = [
    { npc: npc(5), role: HouseholdRole.Child },
    { npc: npc(1), role: HouseholdRole.Head },
    { npc: npc(3), role: HouseholdRole.Spouse },
  ];
  const built = () =>
    makeHousehold({ id: house(0), name: 'Hale', dwelling: bld(2), members, founded: 40 });

  it('stores its members in id order, whatever order they arrived in', () => {
    // Serialized order is hashed order. If it depended on how the house
    // happened to be assembled, two identical villages would hash differently.
    expect(memberIds(built())).toEqual([npc(1), npc(3), npc(5)]);
  });

  it('answers who is in it and what they are to it', () => {
    const household = built();
    expect(headOf(household)).toBe(npc(1));
    expect(roleOf(household, npc(5))).toBe(HouseholdRole.Child);
    expect(roleOf(household, npc(9))).toBeUndefined();
    expect(isMember(household, npc(3))).toBe(true);
    expect(isMember(household, npc(9))).toBe(false);
    expect(membersWithRole(household, HouseholdRole.Child)).toEqual([npc(5)]);
    expect(membersWithRole(household, HouseholdRole.Apprentice)).toEqual([]);
  });

  it('is frozen, members and all', () => {
    const household = built();
    expect(Object.isFrozen(household)).toBe(true);
    expect(Object.isFrozen(household.members)).toBe(true);
    expect(Object.isFrozen(household.members[0])).toBe(true);
  });

  it('refuses every shape a household cannot have', () => {
    const base = { id: house(0), name: 'Hale', dwelling: bld(2), founded: 0 };
    const head = { npc: npc(1), role: HouseholdRole.Head };

    expect(() => makeHousehold({ ...base, id: npc(1), members: [head] })).toThrow(/household id/);
    expect(() => makeHousehold({ ...base, name: '', members: [head] })).toThrow(/needs a name/);
    expect(() => makeHousehold({ ...base, members: [] })).toThrow(/at least one member/);
    expect(() => makeHousehold({ ...base, founded: -1, members: [head] })).toThrow(
      /founded must be a tick/,
    );
    expect(() =>
      makeHousehold({ ...base, members: [head, { npc: house(4), role: HouseholdRole.Child }] }),
    ).toThrow(/must be an npc/);
    expect(() =>
      makeHousehold({ ...base, members: [head, { npc: npc(1), role: HouseholdRole.Child }] }),
    ).toThrow(/same household twice/);
    expect(() =>
      makeHousehold({
        ...base,
        members: [head, { npc: npc(2), role: 'cousin' as HouseholdRoleName }],
      }),
    ).toThrow(/unknown household role/);
    expect(() =>
      makeHousehold({ ...base, members: [head, { npc: npc(2), role: HouseholdRole.Head }] }),
    ).toThrow(/exactly one head/);
    expect(() =>
      makeHousehold({ ...base, members: [{ npc: npc(2), role: HouseholdRole.Child }] }),
    ).toThrow(/exactly one head/);
  });

  it('is changed by building a new one, and the new one is checked too', () => {
    const household = built();
    const moved = withHousehold(household, { dwelling: bld(9) });
    expect(moved).not.toBe(household);
    expect(moved.dwelling).toBe(bld(9));
    expect(household.dwelling).toBe(bld(2));
    expect(moved.id).toBe(household.id);
    expect(() =>
      withHousehold(household, { members: [{ npc: npc(1), role: HouseholdRole.Child }] }),
    ).toThrow(/exactly one head/);
  });
});

describe('descent', () => {
  it('refuses a parent who is not a person', () => {
    expect(() => knownParent(house(1))).toThrow(/must be an npc/);
    expect(() => absentParent('bored' as ParentAbsenceName)).toThrow(/stated reason/);
  });

  it('refuses a record that could not describe anybody', () => {
    const dead = absentParent(ParentAbsence.Dead);
    expect(() => makeParentage(npc(1), knownParent(npc(1)), dead)).toThrow(/own mother/);
    expect(() => makeParentage(npc(1), dead, knownParent(npc(1)))).toThrow(/own father/);
    expect(() => makeParentage(npc(1), knownParent(npc(2)), knownParent(npc(2)))).toThrow(
      /both parents/,
    );
    expect(() => makeParentage(house(1), dead, dead)).toThrow(/child must be an npc/);
  });

  it('lists the parents who exist, mother first, and says when there are none', () => {
    const unknown = absentParent(ParentAbsence.Unknown);
    const both = makeParentage(npc(1), knownParent(npc(2)), knownParent(npc(3)));
    expect(knownParentsOf(both)).toEqual([npc(2), npc(3)]);
    expect(hasLivingRecordedParent(both)).toBe(true);

    const fatherOnly = makeParentage(npc(1), unknown, knownParent(npc(3)));
    expect(knownParentsOf(fatherOnly)).toEqual([npc(3)]);

    const foundling = makeParentage(npc(1), unknown, unknown);
    expect(knownParentsOf(foundling)).toEqual([]);
    expect(hasLivingRecordedParent(foundling)).toBe(false);
  });
});

describe('the register', () => {
  const some = (id: number, member = npc(id)) =>
    makeHousehold({
      id: house(id),
      name: `House ${id}`,
      dwelling: bld(id),
      members: [{ npc: member, role: HouseholdRole.Head }],
      founded: 0,
    });

  it('files households and refuses to file one twice', () => {
    const register = new SocietyRegister();
    register.add(some(0));
    expect(register.householdCount).toBe(1);
    expect(register.has(house(0))).toBe(true);
    expect(() => register.add(some(0))).toThrow(/already exists/);
    expect(register.get(house(7))).toBeUndefined();
    expect(() => register.require(house(7))).toThrow(/no such household/);
  });

  it('iterates in id order, not insertion order, and counts numerically', () => {
    const register = new SocietyRegister();
    for (const n of [12, 2, 7]) register.add(some(n));
    // Lexicographic order would put 12 before 2. Entity ids sort by index.
    expect(register.ids()).toEqual([house(2), house(7), house(12)]);
    expect(register.all().map((h) => h.id)).toEqual([house(2), house(7), house(12)]);
    expect(register.entries().map(([key]) => key)).toEqual([house(2), house(7), house(12)]);
  });

  it('finds a household by member and by roof', () => {
    const register = new SocietyRegister();
    register.add(some(0));
    register.add(some(1));
    expect(register.householdOf(npc(1))?.id).toBe(house(1));
    expect(register.householdOf(npc(9))).toBeUndefined();
    expect(register.householdsAt(bld(1)).map((h) => h.id)).toEqual([house(1)]);
    expect(register.householdsAt(bld(9))).toEqual([]);
    expect(register.filter((h) => h.dwelling === bld(0)).map((h) => h.id)).toEqual([house(0)]);
  });

  it('adds a member, changes a role without duplicating them, and moves a roof', () => {
    const register = new SocietyRegister();
    register.add(some(0));
    register.setMember(house(0), npc(4), HouseholdRole.Child);
    expect(memberIds(register.require(house(0)))).toEqual([npc(0), npc(4)]);

    register.setMember(house(0), npc(4), HouseholdRole.Apprentice);
    expect(register.require(house(0)).members).toHaveLength(2);
    expect(roleOf(register.require(house(0)), npc(4))).toBe(HouseholdRole.Apprentice);

    register.setDwelling(house(0), bld(6));
    expect(register.require(house(0)).dwelling).toBe(bld(6));
  });

  it('will not quietly empty a house', () => {
    const register = new SocietyRegister();
    register.add(some(0));
    expect(() => register.removeMember(house(0), npc(9))).toThrow(/not in that household/);
    expect(() => register.removeMember(house(0), npc(0))).toThrow(/dissolve it instead/);

    register.setMember(house(0), npc(4), HouseholdRole.Child);
    register.removeMember(house(0), npc(4));
    expect(memberIds(register.require(house(0)))).toEqual([npc(0)]);
    expect(register.remove(house(0))).toBe(true);
    expect(register.remove(house(0))).toBe(false);
  });

  it('records descent, overwrites it when more becomes known, and forgets it', () => {
    const register = new SocietyRegister();
    const unknown = absentParent(ParentAbsence.Unknown);
    register.setParentage(npc(1), unknown, unknown);
    expect(register.parentageCount).toBe(1);
    expect(register.parentageOf(npc(1))?.mother).toEqual({
      kind: 'absent',
      reason: ParentAbsence.Unknown,
    });

    // A foundling's mother can become known later.
    register.setParentage(npc(1), knownParent(npc(2)), unknown);
    expect(register.parentageCount).toBe(1);
    expect(register.parentageOf(npc(1))?.mother).toEqual({ kind: 'known', npc: npc(2) });

    expect(register.forgetParentage(npc(1))).toBe(true);
    expect(register.forgetParentage(npc(1))).toBe(false);
    expect(register.parentageOf(npc(1))).toBeUndefined();
  });

  it('finds somebody’s children through either parent, in id order', () => {
    const register = new SocietyRegister();
    const dead = absentParent(ParentAbsence.Dead);
    register.setParentage(npc(12), knownParent(npc(1)), dead);
    register.setParentage(npc(2), dead, knownParent(npc(1)));
    register.setParentage(npc(5), knownParent(npc(9)), knownParent(npc(8)));

    expect(register.childrenOf(npc(1))).toEqual([npc(2), npc(12)]);
    expect(register.childrenOf(npc(8))).toEqual([npc(5)]);
    expect(register.childrenOf(npc(3))).toEqual([]);
    expect(register.allParentage().map((r) => r.child)).toEqual([npc(2), npc(5), npc(12)]);
  });
});

describe('a village', () => {
  it('writes both sides of a membership when a house is founded', () => {
    const { people, population, households, register } = world();
    const father = someone(people, 40, Sex.Male);
    const son = someone(people, 8, Sex.Male);
    const household = households.found({
      name: 'Slade',
      dwelling: bld(3),
      members: [
        { npc: father.id, role: HouseholdRole.Head },
        { npc: son.id, role: HouseholdRole.Child },
      ],
    });

    expect(register.householdOf(son.id)?.id).toBe(household.id);
    for (const id of [father.id, son.id]) {
      expect(population.get(id)?.household).toBe(household.id);
      expect(population.get(id)?.home).toBe(bld(3));
    }
    expect(household.founded).toBe(MIDYEAR);
  });

  it('refuses to put somebody in two houses at once', () => {
    const { people, households } = world();
    const person = someone(people, 30);
    const other = someone(people, 30);
    households.found({
      name: 'Slade',
      dwelling: bld(0),
      members: [{ npc: person.id, role: HouseholdRole.Head }],
    });
    expect(() =>
      households.found({
        name: 'Hale',
        dwelling: bld(1),
        members: [
          { npc: other.id, role: HouseholdRole.Head },
          { npc: person.id, role: HouseholdRole.Dependent },
        ],
      }),
    ).toThrow(/already in a household/);
  });

  it('announces the people before it announces the house they founded', () => {
    // The order a reader of the Chronicle expects: a house is founded by people
    // who were already there a moment before.
    const { sim, households } = world();
    const household = households.generate({ dwelling: bld(0), names: NAMES, template: SOLO });
    const types = sim.log.recent().map((event) => event.type);
    expect(types.filter((type) => type === NpcEvent.Created)).toHaveLength(
      household.members.length,
    );
    expect(types.indexOf(SocietyEvent.HouseholdFounded)).toBeGreaterThan(
      types.lastIndexOf(NpcEvent.Created),
    );

    const founded = sim.log.byType(SocietyEvent.HouseholdFounded)[0];
    expect(founded?.data).toMatchObject({
      household: household.id,
      dwelling: bld(0),
      head: headOf(household),
      size: household.members.length,
      origin: 'founding',
    });
    expect(founded?.actors).toEqual(memberIds(household));
  });

  it('draws the shape of a family and the people in it from different streams', () => {
    // Adding a household template must not shift everybody's personality, and
    // adding a trait must not reshape every family (determinism rule 6). The
    // draw counts make that claim checkable. A lone adult with no chance of an
    // elder or an apprentice costs four draws from Households -- family name,
    // sex, age, child count -- because `chance(0)` is decided without one. Each
    // villager costs 146 from NpcGeneration: the full 150 less the sex, family
    // name and two age draws the plan has already fixed.
    const { sim, households } = world();
    const household = households.generate({ dwelling: bld(0), names: NAMES, template: SOLO });
    expect(household.members).toHaveLength(1);
    expect(sim.random(RngStream.Households).draws).toBe(4);
    expect(sim.random(RngStream.NpcGeneration).draws).toBe(146);

    households.generate({ dwelling: bld(1), names: NAMES, template: SOLO });
    expect(sim.random(RngStream.Households).draws).toBe(8);
    expect(sim.random(RngStream.NpcGeneration).draws).toBe(292);

    // The same shape with a possible elder and apprentice costs two more: the
    // rolls that SOLO's zeroes decide for free.
    const { sim: sim2, households: h2 } = world();
    h2.generate({ dwelling: bld(0), names: NAMES, template: template('single-adult') });
    expect(sim2.random(RngStream.Households).draws).toBe(6);
  });

  it('never gives two people under one roof the same given name', () => {
    // Drawn independently, a house of five turns up with a mother and three
    // living daughters all called Sabina: legal, deterministic, and unreadable
    // to anybody following the village through the villagers' own posts.
    const { population, register } = village('names', 30);
    let checked = 0;
    for (const household of register.all()) {
      const given = memberIds(household).map((id) => population.require(id).givenName);
      expect(new Set(given).size).toBe(given.length);
      checked += given.length;
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('announces somebody moving in, then changing what they are to the house', () => {
    const { sim, population, people, households } = world();
    const head = someone(people, 40);
    const household = households.found({
      name: 'Slade',
      dwelling: bld(0),
      members: [{ npc: head.id, role: HouseholdRole.Head }],
    });
    const lodger = someone(people, 16);

    households.setMember(household.id, lodger.id, HouseholdRole.Apprentice);
    expect(population.get(lodger.id)?.household).toBe(household.id);
    expect(population.get(lodger.id)?.home).toBe(bld(0));
    expect(sim.log.byType(SocietyEvent.MemberJoined)[0]?.data).toMatchObject({
      household: household.id,
      npc: lodger.id,
      role: HouseholdRole.Apprentice,
    });

    households.setMember(household.id, lodger.id, HouseholdRole.Child);
    expect(sim.log.byType(SocietyEvent.RoleChanged)[0]?.data).toMatchObject({
      npc: lodger.id,
      from: HouseholdRole.Apprentice,
      role: HouseholdRole.Child,
    });

    // Setting the role it already holds is not news.
    households.setMember(household.id, lodger.id, HouseholdRole.Child);
    expect(sim.log.byType(SocietyEvent.RoleChanged)).toHaveLength(1);
    expect(sim.log.byType(SocietyEvent.MemberJoined)).toHaveLength(1);
  });

  it('refuses to move somebody into a second house', () => {
    const { people, households } = world();
    const a = households.found({
      name: 'A',
      dwelling: bld(0),
      members: [{ npc: someone(people, 40).id, role: HouseholdRole.Head }],
    });
    const b = households.found({
      name: 'B',
      dwelling: bld(1),
      members: [{ npc: someone(people, 40).id, role: HouseholdRole.Head }],
    });
    expect(() => households.setMember(b.id, headOf(a), HouseholdRole.Dependent)).toThrow(
      /already in a household/,
    );
  });

  it('will not let somebody leave home without a stated reason', () => {
    const { sim, population, people, households } = world();
    const head = someone(people, 40);
    const child = someone(people, 12);
    const household = households.found({
      name: 'Slade',
      dwelling: bld(0),
      members: [
        { npc: head.id, role: HouseholdRole.Head },
        { npc: child.id, role: HouseholdRole.Child },
      ],
    });

    expect(() => households.removeMember(household.id, child.id, '')).toThrow(/reason/);
    households.removeMember(household.id, child.id, 'went for a soldier');
    expect(population.get(child.id)?.household).toBeNull();
    expect(population.get(child.id)?.home).toBeNull();
    expect(sim.log.byType(SocietyEvent.MemberLeft)[0]?.data).toMatchObject({
      npc: child.id,
      reason: 'went for a soldier',
    });
  });

  it('turns everybody out when a house ends, and says why', () => {
    const { sim, population, people, households, register } = world();
    const head = someone(people, 40);
    const child = someone(people, 12);
    const household = households.found({
      name: 'Slade',
      dwelling: bld(0),
      members: [
        { npc: head.id, role: HouseholdRole.Head },
        { npc: child.id, role: HouseholdRole.Child },
      ],
    });

    expect(() => households.dissolve(household.id, '')).toThrow(/reason/);
    households.dissolve(household.id, 'the fever took them');
    expect(register.has(household.id)).toBe(false);
    for (const id of [head.id, child.id]) {
      expect(population.get(id)?.household).toBeNull();
      expect(population.get(id)?.home).toBeNull();
    }
    const event = sim.log.byType(SocietyEvent.HouseholdDissolved)[0];
    expect(event?.data).toMatchObject({ household: household.id, reason: 'the fever took them' });
    expect(event?.data).toHaveProperty('members', [head.id, child.id]);
  });

  it('moves every bed in the house when the house moves', () => {
    const { sim, population, people, households } = world();
    const head = someone(people, 40);
    const child = someone(people, 12);
    const household = households.found({
      name: 'Slade',
      dwelling: bld(0),
      members: [
        { npc: head.id, role: HouseholdRole.Head },
        { npc: child.id, role: HouseholdRole.Child },
      ],
    });

    households.setDwelling(household.id, bld(4));
    for (const id of [head.id, child.id]) expect(population.get(id)?.home).toBe(bld(4));
    expect(sim.log.byType(SocietyEvent.DwellingChanged)[0]?.data).toMatchObject({
      from: bld(0),
      to: bld(4),
    });

    // Moving to where it already is is not news.
    households.setDwelling(household.id, bld(4));
    expect(sim.log.byType(SocietyEvent.DwellingChanged)).toHaveLength(1);
  });

  it('records descent with absent parents named rather than left blank', () => {
    const { sim, people, households, register } = world();
    const mother = someone(people, 40, Sex.Female);
    const child = someone(people, 10);
    households.recordParentage(
      child.id,
      knownParent(mother.id),
      absentParent(ParentAbsence.Departed),
    );

    expect(register.parentageOf(child.id)?.father).toEqual({
      kind: 'absent',
      reason: ParentAbsence.Departed,
    });
    expect(sim.log.byType(SocietyEvent.ParentageRecorded)[0]?.data).toMatchObject({
      child: child.id,
      mother: mother.id,
      motherAbsent: null,
      father: null,
      fatherAbsent: ParentAbsence.Departed,
    });
  });
});

describe('rolling a family', () => {
  const plan = (seed: string, options: Parameters<typeof generateHouseholdPlan>[1] = { names: NAMES }) =>
    generateHouseholdPlan(new Sim({ seed }).random(RngStream.Households), options);

  /** Every plan a seed produces, so a rule can be checked against hundreds. */
  function manyPlans(seed: string, count: number, forced?: HouseholdTemplate) {
    const rng = new Sim({ seed }).random(RngStream.Households);
    return Array.from({ length: count }, () =>
      generateHouseholdPlan(rng, {
        names: NAMES,
        ...(forced !== undefined ? { template: forced } : {}),
      }),
    );
  }

  it('gives the same family for the same seed', () => {
    expect(canonicalStringify(plan('a') as never)).toBe(canonicalStringify(plan('a') as never));
    expect(canonicalStringify(plan('a') as never)).not.toBe(
      canonicalStringify(plan('b') as never),
    );
  });

  it('refuses a template table that could not produce a coherent family', () => {
    const family = template('family');
    expect(() => plan('a', { names: NAMES, templates: [] })).toThrow(/must not be empty/);
    expect(() =>
      plan('a', { names: NAMES, templates: [{ ...family, weight: 0 }] }),
    ).toThrow(/at least one positive weight/);
    expect(() =>
      plan('a', { names: NAMES, templates: [{ ...family, headAge: { min: 40, max: 20 } }] }),
    ).toThrow(/head age range ends before it starts/);
    expect(() =>
      plan('a', { names: NAMES, templates: [{ ...family, children: { min: 4, max: 1 } }] }),
    ).toThrow(/child count ends before it starts/);
    expect(() =>
      plan('a', { names: NAMES, templates: [{ ...family, headAge: { min: 8, max: 40 } }] }),
    ).toThrow(/handed a child older than the rules allow/);
  });

  it('refuses a house whose live-in parent would have to be older than anybody gets', () => {
    // The trap this closes: clamping the elder down to MAX_FOUNDING_AGE would
    // hand a village a "parent" twelve years older than their own child, and the
    // descent invariant would fire on a family the generator built itself.
    const elderly = { ...template('elder-couple'), residentParentChance: 0.5 };
    expect(elderly.headAge.max + RESIDENT_PARENT_AGE_GAP.min).toBeGreaterThan(MAX_FOUNDING_AGE);
    expect(() => plan('a', { names: NAMES, templates: [elderly] })).toThrow(
      /older than anybody gets/,
    );
  });

  it('checks a forced template as closely as one it drew itself', () => {
    // Naming the shape must not be a way past validation: worldgen forces a
    // template, and a table the weighted draw could never have produced would
    // otherwise go straight through.
    expect(() =>
      plan('a', { names: NAMES, template: { ...template('family'), headAge: { min: 8, max: 40 } } }),
    ).toThrow(/handed a child older than the rules allow/);
  });

  it('always has exactly one head, and the house takes their name', () => {
    for (const rolled of manyPlans('heads', 300)) {
      const heads = rolled.members.filter((m) => m.role === HouseholdRole.Head);
      expect(heads).toHaveLength(1);
      expect(rolled.name).toBe(heads[0]?.familyName);
      expect(rolled.members.length).toBeGreaterThan(0);
    }
  });

  it('never gives a spouse to a template that has none, nor a child to one with none', () => {
    for (const rolled of manyPlans('widow', 120, template('widowed-parent'))) {
      expect(rolled.members.filter((m) => m.role === HouseholdRole.Spouse)).toHaveLength(0);
      expect(rolled.members.filter((m) => m.role === HouseholdRole.Child).length).toBeGreaterThan(
        0,
      );
    }
    for (const rolled of manyPlans('alone', 120, template('single-adult'))) {
      expect(rolled.members.filter((m) => m.role === HouseholdRole.Child)).toHaveLength(0);
      expect(rolled.members.filter((m) => m.role === HouseholdRole.Spouse)).toHaveLength(0);
    }
    for (const rolled of manyPlans('married', 120, template('family'))) {
      const spouses = rolled.members.filter((m) => m.role === HouseholdRole.Spouse);
      expect(spouses).toHaveLength(1);
      // A married couple is a man and a woman in this phase.
      expect(spouses[0]?.sex).not.toBe(rolled.members[0]?.sex);
    }
  });

  it('keeps every age inside the range a founding villager can occupy', () => {
    for (const rolled of manyPlans('ages', 400)) {
      for (const member of rolled.members) {
        expect(member.age).toBeGreaterThanOrEqual(0);
        expect(member.age).toBeLessThanOrEqual(MAX_FOUNDING_AGE);
        if (member.role === HouseholdRole.Child) {
          expect(member.age).toBeLessThanOrEqual(MAX_RESIDENT_CHILD_AGE);
        }
        if (member.role === HouseholdRole.Apprentice) {
          expect(member.age).toBeGreaterThanOrEqual(12);
          expect(member.age).toBeLessThanOrEqual(22);
        }
      }
    }
  });

  it('never plans a parent too young to be one', () => {
    // Checked against the plan directly rather than through the invariant, so
    // that a generator and its check cannot be wrong in the same way.
    let checked = 0;
    for (const rolled of manyPlans('descent', 400)) {
      for (const member of rolled.members) {
        for (const parent of [member.mother, member.father]) {
          if (parent === undefined || parent.kind !== 'member') continue;
          const older = rolled.members[parent.index] as PlannedMember;
          expect(older.age - member.age).toBeGreaterThanOrEqual(MIN_PARENT_AGE_GAP);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('accounts for both parents of every child of the house', () => {
    for (const rolled of manyPlans('parents', 300)) {
      for (const member of rolled.members) {
        if (member.role !== HouseholdRole.Child) continue;
        expect(member.mother).toBeDefined();
        expect(member.father).toBeDefined();
      }
    }
  });

  it('records a live-in elder as the head’s own parent, not merely as an old person', () => {
    // What makes descent in a founding village two generations deep, which is
    // what society.descent-has-no-cycles exists to walk.
    const withElder = manyPlans('elders', 400).filter((rolled) =>
      rolled.members.some((m) => m.role === HouseholdRole.Parent),
    );
    expect(withElder.length).toBeGreaterThan(10);

    for (const rolled of withElder) {
      const head = rolled.members[0] as PlannedMember;
      const elderIndex = rolled.members.findIndex((m) => m.role === HouseholdRole.Parent);
      const elder = rolled.members[elderIndex] as PlannedMember;
      const claimed = elder.sex === Sex.Female ? head.mother : head.father;
      expect(claimed).toEqual({ kind: 'member', index: elderIndex });
      const other = elder.sex === Sex.Female ? head.father : head.mother;
      expect(other).toEqual({ kind: 'absent', reason: ParentAbsence.Dead });
      expect(elder.age - head.age).toBeGreaterThanOrEqual(MIN_PARENT_AGE_GAP);
    }
  });

  it('houses an apprentice as somebody else’s child, with no parents of this house', () => {
    const apprentices = manyPlans('trade', 400).flatMap((rolled) =>
      rolled.members.filter((m) => m.role === HouseholdRole.Apprentice),
    );
    expect(apprentices.length).toBeGreaterThan(10);
    for (const apprentice of apprentices) {
      expect(apprentice.mother).toBeUndefined();
      expect(apprentice.father).toBeUndefined();
    }
  });

  it('produces a village of the size the spec asks for', () => {
    // 20-35 households over 80-120 people, per docs/PHASE_1.md. A generator
    // that drifted to families of eight would still be legal, and still wrong.
    const rolled = manyPlans('size', 28);
    const people = rolled.reduce((sum, r) => sum + r.members.length, 0);
    expect(people).toBeGreaterThanOrEqual(80);
    expect(people).toBeLessThanOrEqual(120);
  });
});

describe('the rules a village obeys', () => {
  it('finds nothing wrong with a village it generated', () => {
    for (const seed of ['alpha', 'beta', 'gamma']) {
      const { sim, population } = village(seed, 26);
      expect(population.count).toBeGreaterThan(70);
      const report = sim.checkInvariants();
      expect(report.violations).toEqual([]);
      expect(report.checked).toBeGreaterThan(6);
    }
  });

  it('catches a household filed under the wrong id, or with the wrong kind of id', () => {
    const { sim, register } = village('coherent', 2);
    const real = register.all()[0];
    smuggleHousehold(register, house(99), real);
    expect(complaints(sim, 'society.household-is-coherent')).toContain(
      'a household is filed under another id',
    );

    const { sim: sim2, register: reg2 } = world();
    smuggleHousehold(reg2, npc(4), {
      id: npc(4),
      name: 'Nowhere',
      dwelling: bld(0),
      members: [{ npc: npc(1), role: HouseholdRole.Head }],
      founded: 0,
    });
    expect(complaints(sim2, 'society.household-is-coherent')).toContain(
      'a household lacks a household id',
    );
  });

  it('catches a house with no head, two heads, nobody, or a member who is not a person', () => {
    const { sim, register } = world();
    const shell = (members: unknown[]) => ({
      id: house(0),
      name: 'Nowhere',
      dwelling: bld(0),
      members,
      founded: 0,
    });

    smuggleHousehold(register, house(0), shell([]));
    let found = complaints(sim, 'society.household-is-coherent');
    expect(found).toContain('a household has nobody in it');
    expect(found).toContain('a household does not have one head');

    smuggleHousehold(
      register,
      house(0),
      shell([
        { npc: npc(1), role: HouseholdRole.Head },
        { npc: npc(2), role: HouseholdRole.Head },
      ]),
    );
    found = complaints(sim, 'society.household-is-coherent');
    expect(found).toContain('a household does not have one head');
    expect(found).toContain('a household member does not exist');
  });

  it('catches a membership written on one side only', () => {
    const { sim, people, households, register } = world();
    const head = someone(people, 40);
    const stray = someone(people, 30);
    const household = households.found({
      name: 'Slade',
      dwelling: bld(0),
      members: [{ npc: head.id, role: HouseholdRole.Head }],
    });

    // The person's side says a house that does not claim them.
    people.setHousehold(stray.id, household.id);
    expect(complaints(sim, 'society.membership-is-symmetric')).toContain(
      'somebody claims a household that does not claim them',
    );

    // The house's side claims somebody whose record says otherwise.
    const { sim: sim2, people: people2, households: h2, register: reg2 } = world();
    const head2 = someone(people2, 40);
    const other = someone(people2, 30);
    const built = h2.found({
      name: 'Hale',
      dwelling: bld(0),
      members: [{ npc: head2.id, role: HouseholdRole.Head }],
    });
    reg2.setMember(built.id, other.id, HouseholdRole.Dependent);
    expect(complaints(sim2, 'society.membership-is-symmetric')).toContain(
      'a household claims somebody who does not claim it',
    );
    expect(register.householdCount).toBe(1);
  });

  it('catches somebody living in two houses, and in a house that is not there', () => {
    const { sim, people, households, register } = world();
    const head = someone(people, 40);
    const household = households.found({
      name: 'Slade',
      dwelling: bld(0),
      members: [{ npc: head.id, role: HouseholdRole.Head }],
    });
    smuggleHousehold(register, house(50), {
      ...household,
      id: house(50),
      members: [{ npc: head.id, role: HouseholdRole.Head }],
    });
    expect(complaints(sim, 'society.membership-is-symmetric')).toContain(
      'somebody is in two households',
    );

    const { sim: sim2, people: people2 } = world();
    const orphan = someone(people2, 30);
    people2.setHousehold(orphan.id, house(77));
    expect(complaints(sim2, 'society.membership-is-symmetric')).toContain(
      'somebody belongs to a household that does not exist',
    );
  });

  it('catches somebody with no household, or sleeping away from the one they have', () => {
    // The check Phase 1 wanted in slice 3 and could not have, because there
    // were no households yet to check anybody against.
    const { sim, people } = world();
    someone(people, 30);
    expect(complaints(sim, 'society.everybody-is-housed')).toContain(
      'somebody belongs to no household',
    );

    const { sim: sim2, people: people2, households } = world();
    const head = someone(people2, 40);
    households.found({
      name: 'Slade',
      dwelling: bld(0),
      members: [{ npc: head.id, role: HouseholdRole.Head }],
    });
    people2.setHome(head.id, bld(9));
    expect(complaints(sim2, 'society.everybody-is-housed')).toContain(
      'somebody sleeps outside their household',
    );
  });

  it('catches descent that loops', () => {
    const { sim, people, register } = world();
    const a = someone(people, 40);
    const b = someone(people, 20);
    const dead = absentParent(ParentAbsence.Dead);
    register.setParentage(a.id, knownParent(b.id), dead);
    register.setParentage(b.id, knownParent(a.id), dead);
    expect(complaints(sim, 'society.descent-has-no-cycles')).toContain(
      'somebody descends from themselves',
    );

    // And the shortest loop of all, which only a save could contain.
    const { sim: sim2, people: people2, register: reg2 } = world();
    const self = someone(people2, 40);
    smuggleParentage(reg2, self.id, {
      child: self.id,
      mother: { kind: 'known', npc: self.id },
      father: { kind: 'absent', reason: ParentAbsence.Dead },
    });
    expect(complaints(sim2, 'society.descent-has-no-cycles')).toContain(
      'somebody descends from themselves',
    );
  });

  it('catches a parent too young to be one', () => {
    const { sim, people, register } = world();
    const child = someone(people, 18);
    const tooYoung = someone(people, 18 + MIN_PARENT_AGE_GAP - 1);
    register.setParentage(child.id, knownParent(tooYoung.id), absentParent(ParentAbsence.Dead));
    expect(complaints(sim, 'society.parents-are-older-than-their-children')).toContain(
      'a parent is too young to be one',
    );

    // Exactly the gap is allowed; it is a floor, not a margin.
    const { sim: sim2, people: people2, register: reg2 } = world();
    const younger = someone(people2, 18);
    const older = someone(people2, 18 + MIN_PARENT_AGE_GAP);
    reg2.setParentage(younger.id, knownParent(older.id), absentParent(ParentAbsence.Dead));
    expect(complaints(sim2, 'society.parents-are-older-than-their-children')).toEqual([]);
  });

  it('catches a child of the house whose parents nobody recorded', () => {
    const { sim, people, households } = world();
    const head = someone(people, 40);
    const child = someone(people, 10);
    households.found({
      name: 'Slade',
      dwelling: bld(0),
      members: [
        { npc: head.id, role: HouseholdRole.Head },
        { npc: child.id, role: HouseholdRole.Child },
      ],
    });
    expect(complaints(sim, 'society.children-have-recorded-parents')).toContain(
      'a child of the house has no recorded parents',
    );
  });

  it('catches a recorded parent the village has never heard of', () => {
    const { sim, people, register } = world();
    const child = someone(people, 10);
    register.setParentage(child.id, knownParent(npc(4242)), absentParent(ParentAbsence.Dead));
    expect(complaints(sim, 'society.children-have-recorded-parents')).toContain(
      'a recorded parent does not exist',
    );
  });
});

describe('saving a village', () => {
  it('reloads into the same world, and actually carries the households', () => {
    const { sim } = village('save', 14);
    const envelope = sim.save();

    const reloaded = new Sim({ seed: 'save', startTick: MIDYEAR });
    const people = installPeople(reloaded);
    const households = installSociety(reloaded, people);
    reloaded.load(envelope);

    // Hash equality alone would pass if both sides dropped the same field, so
    // check that something came back before trusting it.
    expect(households.register.householdCount).toBeGreaterThan(10);
    expect(households.register.parentageCount).toBeGreaterThan(10);
    expect(reloaded.hash()).toBe(sim.hash());
    expect(reloaded.checkInvariants().violations).toEqual([]);
    const block = envelope.modules.society as { version: number; data: unknown };
    expect(block.version).toBe(1);
    expect(canonicalStringify(households.register.toJson())).toBe(
      canonicalStringify(block.data as never),
    );
  });

  it('clears what was there before restoring', () => {
    const { register } = village('first', 6);
    const { register: source } = village('second', 3);
    register.restore(source.save());
    expect(register.householdCount).toBe(3);
    expect(register.ids()).toEqual(source.ids());
  });

  it('refuses a save that describes a village nobody could live in', () => {
    const good = {
      households: [
        {
          id: house(0),
          name: 'Slade',
          dwelling: bld(0),
          members: [{ npc: npc(0), role: HouseholdRole.Head }],
          founded: 0,
        },
      ],
      parentage: [],
    };
    expect(() => SocietyRegister.fromJson(good as never)).not.toThrow();

    const twoHeads = structuredClone(good);
    twoHeads.households[0]!.members.push({ npc: npc(1), role: HouseholdRole.Head });
    expect(() => SocietyRegister.fromJson(twoHeads as never)).toThrow(/exactly one head/);

    const noRole = structuredClone(good) as unknown as {
      households: { members: { npc: string; role: string }[] }[];
    };
    noRole.households[0]!.members[0]!.role = 'cousin';
    expect(() => SocietyRegister.fromJson(noRole as never)).toThrow(/failed validation/);

    const ownFather = {
      households: good.households,
      parentage: [
        {
          child: npc(0),
          mother: { kind: 'absent', reason: ParentAbsence.Dead },
          father: { kind: 'known', npc: npc(0) },
        },
      ],
    };
    expect(() => SocietyRegister.fromJson(ownFather as never)).toThrow(/own father/);

    const noReason = {
      households: good.households,
      parentage: [
        {
          child: npc(0),
          mother: { kind: 'absent' },
          father: { kind: 'absent', reason: ParentAbsence.Dead },
        },
      ],
    };
    expect(() => SocietyRegister.fromJson(noReason as never)).toThrow(/failed validation/);
  });

  it('is its own save module, so a change to families does not disturb npc', () => {
    const { sim } = village('modules', 3);
    const envelope = sim.save();
    expect(Object.keys(envelope.modules).sort()).toEqual(['core', 'npc', 'society']);
    expect(sim.saves.has('society')).toBe(true);
  });
});

describe('the same village twice', () => {
  it('builds identically from one seed, and differently from another', () => {
    const a = village('repeat', 20);
    const b = village('repeat', 20);
    expect(b.sim.hash()).toBe(a.sim.hash());
    expect(canonicalStringify(b.register.toJson())).toBe(canonicalStringify(a.register.toJson()));

    const c = village('other', 20);
    expect(c.sim.hash()).not.toBe(a.sim.hash());
  });

  it('gives everybody a household, a bed, and somewhere they came from', () => {
    const { population, register } = village('whole', 28);
    expect(population.count).toBeGreaterThanOrEqual(80);
    expect(population.count).toBeLessThanOrEqual(120);
    for (const person of population.all()) {
      expect(person.household).not.toBeNull();
      expect(person.home).not.toBeNull();
      expect(register.householdOf(person.id)?.id).toBe(person.household);
    }
  });

  it('goes two generations deep, so descent is something to walk', () => {
    // Across three villages rather than one: a live-in elder is a per-household
    // roll, and a single unlucky seed can produce twenty-eight houses without
    // one. What must not happen is a *generator* that never produces any, which
    // is why the check is over villages rather than over one.
    const elders = ['whole', 'alpha', 'beta'].flatMap((seed) => {
      const { register } = village(seed, 28);
      return register.all().map(headOf).filter((id) => register.parentageOf(id) !== undefined);
    });
    expect(elders.length).toBeGreaterThan(0);
  });
});
