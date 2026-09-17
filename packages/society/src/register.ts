import { type JsonValue, assert } from '@rpgsim/shared';
import { type EntityId, compareEntityIds } from '@rpgsim/sim-core';
import { z } from 'zod';
import {
  type Household,
  type HouseholdRoleName,
  HouseholdSchema,
  isMember,
  makeHousehold,
  withHousehold,
} from './household.ts';
import { type Parentage, ParentageSchema, type ParentRef, makeParentage } from './kinship.ts';

/**
 * Every household, and everyone's descent.
 *
 * Pure state, like `Population` and `WorldMap`: no clock, no RNG, no event bus.
 * `HouseholdSystem` is the layer that announces things.
 *
 * Two registers rather than one, because they have different lifetimes. A
 * household dissolves when the last member leaves; a parentage record is true
 * forever and outlives every house its people ever lived in.
 *
 * Iteration is always by sorted id (determinism rule 5).
 */
export interface SocietySnapshot {
  readonly households: readonly Household[];
  readonly parentage: readonly Parentage[];
}

export const SocietySnapshotShape = z
  .object({
    households: z.array(HouseholdSchema),
    parentage: z.array(ParentageSchema),
  })
  .strict();

export class SocietyRegister {
  private readonly households = new Map<EntityId, Household>();
  private readonly parents = new Map<EntityId, Parentage>();

  get householdCount(): number {
    return this.households.size;
  }

  get parentageCount(): number {
    return this.parents.size;
  }

  has(id: EntityId): boolean {
    return this.households.has(id);
  }

  get(id: EntityId): Household | undefined {
    return this.households.get(id);
  }

  require(id: EntityId): Household {
    const household = this.households.get(id);
    assert(household !== undefined, 'no such household', { id });
    return household;
  }

  /** File a household. Refuses a duplicate id, as `Population.add` does. */
  add(household: Household): Household {
    assert(!this.households.has(household.id), 'a household with this id already exists', {
      id: household.id,
    });
    this.households.set(household.id, household);
    return household;
  }

  remove(id: EntityId): boolean {
    return this.households.delete(id);
  }

  replace(household: Household): Household {
    assert(this.households.has(household.id), 'cannot replace a household that is not here', {
      id: household.id,
    });
    this.households.set(household.id, household);
    return household;
  }

  ids(): EntityId[] {
    return [...this.households.keys()].sort(compareEntityIds);
  }

  all(): Household[] {
    return this.ids().map((id) => this.households.get(id) as Household);
  }

  /** Key/record pairs, so an invariant can check the filing as well as the file. */
  entries(): [EntityId, Household][] {
    return this.ids().map((id) => [id, this.households.get(id) as Household]);
  }

  filter(predicate: (household: Household) => boolean): Household[] {
    return this.all().filter(predicate);
  }

  /** The household somebody belongs to, according to the households themselves. */
  householdOf(npc: EntityId): Household | undefined {
    return this.all().find((household) => isMember(household, npc));
  }

  /** Whichever households claim this dwelling. More than one is a violation. */
  householdsAt(dwelling: EntityId): Household[] {
    return this.filter((household) => household.dwelling === dwelling);
  }

  /** Add somebody to a house, or change the role they hold in it. */
  setMember(id: EntityId, npc: EntityId, role: HouseholdRoleName): Household {
    const household = this.require(id);
    const members = household.members.filter((member) => member.npc !== npc);
    return this.replace(withHousehold(household, { members: [...members, { npc, role }] }));
  }

  /**
   * Take somebody out of a house.
   *
   * Refuses to empty the last member out: a household with nobody in it is not
   * a household, it is a record that should have been dissolved.
   * `HouseholdSystem.dissolve` is the way to end one, and it says so in an event.
   */
  removeMember(id: EntityId, npc: EntityId): Household {
    const household = this.require(id);
    assert(isMember(household, npc), 'that person is not in that household', { id, npc });
    assert(
      household.members.length > 1,
      'removing the last member would leave an empty household; dissolve it instead',
      { id, npc },
    );
    return this.replace(
      withHousehold(household, {
        members: household.members.filter((member) => member.npc !== npc),
      }),
    );
  }

  setDwelling(id: EntityId, dwelling: EntityId): Household {
    return this.replace(withHousehold(this.require(id), { dwelling }));
  }

  // --- descent -------------------------------------------------------------

  parentageOf(child: EntityId): Parentage | undefined {
    return this.parents.get(child);
  }

  /**
   * Record who somebody's parents were.
   *
   * Overwrites, deliberately. Descent is discovered as well as created -- a
   * foundling's mother can become known later -- and the alternative is a
   * caller that has to remember whether it already knows.
   */
  setParentage(child: EntityId, mother: ParentRef, father: ParentRef): Parentage {
    const parentage = makeParentage(child, mother, father);
    this.parents.set(child, parentage);
    return parentage;
  }

  forgetParentage(child: EntityId): boolean {
    return this.parents.delete(child);
  }

  /** Every recorded descent, in a canonical order by child id. */
  allParentage(): Parentage[] {
    return [...this.parents.keys()]
      .sort(compareEntityIds)
      .map((child) => this.parents.get(child) as Parentage);
  }

  /**
   * Somebody's children, in a canonical order.
   *
   * Scans rather than keeping a reverse index. A village is a hundred people
   * and this is not on a hot path, and an index is a second copy of the truth
   * that can drift from the first -- which is the bug class this whole package
   * is built to make visible, not to introduce.
   */
  childrenOf(parent: EntityId): EntityId[] {
    return this.allParentage()
      .filter(
        (record) =>
          (record.mother.kind === 'known' && record.mother.npc === parent) ||
          (record.father.kind === 'known' && record.father.npc === parent),
      )
      .map((record) => record.child);
  }

  // --- persistence ---------------------------------------------------------

  save(): SocietySnapshot {
    return { households: this.all(), parentage: this.allParentage() };
  }

  /** Replace everything. Clears first, for the reason `Population.restore` does. */
  restore(snapshot: SocietySnapshot): void {
    this.households.clear();
    this.parents.clear();
    for (const household of snapshot.households) this.add(household);
    for (const record of snapshot.parentage) {
      this.parents.set(record.child, record);
    }
  }

  toJson(): JsonValue {
    return {
      households: this.all().map(householdToJson),
      parentage: this.allParentage().map(parentageToJson),
    } as unknown as JsonValue;
  }

  /**
   * Validate and rebuild a saved society.
   *
   * Every record goes back through its constructor, so a save carrying a
   * household with two heads or a child who is their own father is refused at
   * load rather than becoming a village nobody can explain (sim-core rule 10).
   */
  static fromJson(value: JsonValue): SocietySnapshot {
    const result = SocietySnapshotShape.safeParse(value);
    assert(result.success, 'society save block failed validation', {
      issues: result.success
        ? []
        : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return {
      households: result.data.households.map((raw) =>
        makeHousehold({
          id: raw.id as EntityId,
          name: raw.name,
          dwelling: raw.dwelling as EntityId,
          members: raw.members.map((member) => ({
            npc: member.npc as EntityId,
            role: member.role,
          })),
          founded: raw.founded,
        }),
      ),
      parentage: result.data.parentage.map((raw) =>
        makeParentage(raw.child as EntityId, raw.mother, raw.father),
      ),
    };
  }
}

/**
 * Serialize a household with every key written explicitly, so that a new field
 * is a compile error here rather than a field that quietly fails to persist.
 */
function householdToJson(household: Household): JsonValue {
  return {
    id: household.id,
    name: household.name,
    dwelling: household.dwelling,
    members: household.members.map((member) => ({ npc: member.npc, role: member.role })),
    founded: household.founded,
  } as unknown as JsonValue;
}

function parentRefToJson(ref: ParentRef): JsonValue {
  return (
    ref.kind === 'known' ? { kind: ref.kind, npc: ref.npc } : { kind: ref.kind, reason: ref.reason }
  ) as unknown as JsonValue;
}

function parentageToJson(parentage: Parentage): JsonValue {
  return {
    child: parentage.child,
    mother: parentRefToJson(parentage.mother),
    father: parentRefToJson(parentage.father),
  } as unknown as JsonValue;
}
