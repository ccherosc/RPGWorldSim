import { assert } from '@rpgsim/shared';
import {
  type EntityId,
  EntityKind,
  RngStream,
  type SimEvent,
  type Simulation,
} from '@rpgsim/sim-core';
import type { NameBook, PeopleSystem } from '@rpgsim/npc';
import {
  type HouseholdTemplate,
  type PlannedParent,
  generateHouseholdPlan,
} from './generate.ts';
import {
  type Household,
  type HouseholdMember,
  type HouseholdRoleName,
  headOf,
  isMember,
  makeHousehold,
  memberIds,
  roleOf,
} from './household.ts';
import { type ParentRef, absentParent, knownParent } from './kinship.ts';
import { SocietyRegister } from './register.ts';

/**
 * The layer that announces things.
 *
 * `SocietyRegister` holds households; this holds a `Simulation` and emits an
 * event for every change to one. Mirrors `PeopleSystem` and `TravelSystem`, and
 * for the same reason: the Chronicle reads the event stream and nothing else,
 * so a family that forms without an event is a family the village never hears
 * about.
 *
 * It also holds a `PeopleSystem`, because a household and a person each record
 * the other and the two must never disagree. Every membership change goes
 * through here and writes both sides, which is what makes
 * `society.membership-is-symmetric` a check on old saves rather than a check on
 * this code's discipline.
 */
export const SocietyEvent = {
  /** A new household exists: worldgen, marriage, or a son setting up alone. */
  HouseholdFounded: 'society.household-founded',
  /** The last member left, or the house ended for a stated reason. */
  HouseholdDissolved: 'society.household-dissolved',
  MemberJoined: 'society.household-member-joined',
  MemberLeft: 'society.household-member-left',
  /** Same house, different position: a child who is now the head. */
  RoleChanged: 'society.household-role-changed',
  DwellingChanged: 'society.household-dwelling-changed',
  /** Who somebody's parents were, recorded or discovered. */
  ParentageRecorded: 'society.parentage-recorded',
} as const;

export type SocietyEventName = (typeof SocietyEvent)[keyof typeof SocietyEvent];

/** Where a household came from. Marriage and inheritance are later phases. */
export const HouseholdOrigin = {
  /** Built by worldgen. It did not form, it was always there. */
  Founding: 'founding',
  Marriage: 'marriage',
  /** Somebody struck out on their own. */
  Split: 'split',
} as const;

export type HouseholdOriginName = (typeof HouseholdOrigin)[keyof typeof HouseholdOrigin];

export interface GenerateHouseholdOptions {
  /** The roof they live under. Worldgen owns which building that is. */
  readonly dwelling: EntityId;
  readonly names: NameBook;
  readonly templates?: readonly HouseholdTemplate[];
  /** Force one shape, skipping the template draw. */
  readonly template?: HouseholdTemplate;
  readonly causes?: readonly SimEvent['id'][];
}

export interface FoundHouseholdOptions {
  readonly name: string;
  readonly dwelling: EntityId;
  readonly members: readonly HouseholdMember[];
  readonly origin?: HouseholdOriginName;
  readonly causes?: readonly SimEvent['id'][];
}

export class HouseholdSystem {
  constructor(
    private readonly sim: Simulation,
    private readonly people: PeopleSystem,
    readonly register: SocietyRegister = new SocietyRegister(),
  ) {}

  /**
   * Bring a household into being, and move its people into it.
   *
   * Writes both sides of every membership in one call: the household's list,
   * and each person's `household` and `home`. Nothing else in the package is
   * allowed to write one without the other.
   */
  found(options: FoundHouseholdOptions): Household {
    for (const member of options.members) {
      const existing = this.register.householdOf(member.npc);
      assert(existing === undefined, 'that person is already in a household', {
        npc: member.npc,
        household: existing?.id,
      });
    }

    const household = makeHousehold({
      id: this.sim.newId(EntityKind.Household),
      name: options.name,
      dwelling: options.dwelling,
      members: options.members,
      founded: this.sim.tick,
    });
    this.register.add(household);

    for (const npc of memberIds(household)) {
      this.people.setHousehold(npc, household.id);
      this.people.setHome(npc, household.dwelling);
    }

    this.sim.emit({
      type: SocietyEvent.HouseholdFounded,
      actors: memberIds(household),
      location: household.dwelling,
      data: {
        household: household.id,
        name: household.name,
        dwelling: household.dwelling,
        head: headOf(household),
        size: household.members.length,
        origin: options.origin ?? HouseholdOrigin.Founding,
      },
      causes: options.causes ?? [],
    });
    return household;
  }

  /**
   * Roll a whole household into being: its shape, its people, and its record.
   *
   * Two streams, deliberately. Composition draws from `RngStream.Households`
   * and the people themselves from `RngStream.NpcGeneration` (inside
   * `PeopleSystem.generate`), so adding a household template does not shift
   * everybody's personality, and adding a trait does not reshape every family
   * (determinism rule 6).
   *
   * The people exist before the household does, so `npc.created` precedes
   * `society.household-founded` in the stream. That is the order a reader of
   * the Chronicle would expect: a house is founded by people who were already
   * there a moment before.
   */
  generate(options: GenerateHouseholdOptions): Household {
    const plan = generateHouseholdPlan(this.sim.random(RngStream.Households), {
      names: options.names,
      ...(options.templates !== undefined ? { templates: options.templates } : {}),
      ...(options.template !== undefined ? { template: options.template } : {}),
    });

    // One at a time, rather than a map, because each villager has to know the
    // given names already under this roof: without that, a house of five turns
    // up with a mother and three daughters all called Sabina.
    const ids: EntityId[] = [];
    const spoken: string[] = [];
    for (const member of plan.members) {
      const person = this.people.generate({
        names: options.names,
        sex: member.sex,
        age: member.age,
        familyName: member.familyName,
        avoidGivenNames: spoken,
      });
      ids.push(person.id);
      spoken.push(person.givenName);
    }

    const household = this.found({
      name: plan.name,
      dwelling: options.dwelling,
      members: plan.members.map((member, index) => ({
        npc: ids[index] as EntityId,
        role: member.role,
      })),
      ...(options.causes !== undefined ? { causes: options.causes } : {}),
    });

    for (const [index, member] of plan.members.entries()) {
      if (member.mother === undefined || member.father === undefined) continue;
      this.recordParentage(
        ids[index] as EntityId,
        resolveParent(member.mother, ids),
        resolveParent(member.father, ids),
      );
    }

    return household;
  }

  /** Move somebody in, or change the position they hold in a house. */
  setMember(id: EntityId, npc: EntityId, role: HouseholdRoleName): Household {
    const before = this.register.require(id);
    const wasMember = isMember(before, npc);
    if (!wasMember) {
      const existing = this.register.householdOf(npc);
      assert(existing === undefined, 'that person is already in a household', {
        npc,
        household: existing?.id,
      });
    }
    const previousRole = roleOf(before, npc);
    if (wasMember && previousRole === role) return before;

    const household = this.register.setMember(id, npc, role);
    this.people.setHousehold(npc, household.id);
    this.people.setHome(npc, household.dwelling);

    this.sim.emit({
      type: wasMember ? SocietyEvent.RoleChanged : SocietyEvent.MemberJoined,
      actors: [npc],
      location: household.dwelling,
      data: {
        household: household.id,
        npc,
        ...(wasMember ? { from: previousRole ?? null } : {}),
        role,
      },
    });
    return household;
  }

  /**
   * Move somebody out.
   *
   * `reason` is required, as it is for removing a person: somebody leaving home
   * without a stated cause is exactly what the Chronicle would have to invent an
   * explanation for. They lose the house and the bed at once -- Phase 1 has no
   * concept of lodging somewhere you do not belong.
   */
  removeMember(id: EntityId, npc: EntityId, reason: string): Household {
    assert(reason.length > 0, 'leaving a household requires a stated reason', { id, npc });
    const household = this.register.removeMember(id, npc);
    this.people.setHousehold(npc, null);
    this.people.setHome(npc, null);

    this.sim.emit({
      type: SocietyEvent.MemberLeft,
      actors: [npc],
      location: household.dwelling,
      data: { household: household.id, npc, reason },
    });
    return household;
  }

  /** End a household, turning whoever remains out of it. */
  dissolve(id: EntityId, reason: string): void {
    assert(reason.length > 0, 'dissolving a household requires a stated reason', { id });
    const household = this.register.require(id);
    const members = memberIds(household);
    for (const npc of members) {
      this.people.setHousehold(npc, null);
      this.people.setHome(npc, null);
    }
    this.register.remove(id);

    this.sim.emit({
      type: SocietyEvent.HouseholdDissolved,
      actors: members,
      location: household.dwelling,
      data: { household: id, name: household.name, members: [...members], reason },
    });
  }

  /** Move a household to another roof. Everybody's bed moves with it. */
  setDwelling(id: EntityId, dwelling: EntityId): Household {
    const before = this.register.require(id).dwelling;
    if (before === dwelling) return this.register.require(id);
    const household = this.register.setDwelling(id, dwelling);
    for (const npc of memberIds(household)) this.people.setHome(npc, dwelling);

    this.sim.emit({
      type: SocietyEvent.DwellingChanged,
      actors: memberIds(household),
      location: dwelling,
      data: { household: id, from: before, to: dwelling },
    });
    return household;
  }

  /** Record who somebody's parents were. */
  recordParentage(child: EntityId, mother: ParentRef, father: ParentRef): void {
    const parentage = this.register.setParentage(child, mother, father);
    this.sim.emit({
      type: SocietyEvent.ParentageRecorded,
      actors: [child],
      data: {
        child,
        mother: parentage.mother.kind === 'known' ? parentage.mother.npc : null,
        motherAbsent: parentage.mother.kind === 'absent' ? parentage.mother.reason : null,
        father: parentage.father.kind === 'known' ? parentage.father.npc : null,
        fatherAbsent: parentage.father.kind === 'absent' ? parentage.father.reason : null,
      },
    });
  }
}

/** Turn a plan's positional parent into a real one, now that ids exist. */
function resolveParent(parent: PlannedParent, ids: readonly EntityId[]): ParentRef {
  if (parent.kind === 'absent') return absentParent(parent.reason);
  const npc = ids[parent.index];
  assert(npc !== undefined, 'a plan referred to a member that was never created', {
    index: parent.index,
  });
  return knownParent(npc);
}
