import { assert } from '@rpgsim/shared';
import { type EntityId, EntityKind, compareEntityIds, entityKindOf, isEntityId } from '@rpgsim/sim-core';
import { z } from 'zod';

/**
 * A household: who lives under one roof, and what they are to it.
 *
 * The unit that makes a hundred people a village rather than a crowd. Phase 1
 * needs only the structure -- who belongs, where they sleep, and what position
 * each holds. Affection, obligation and grievance are a multidimensional model
 * and they are Phase 5.
 *
 * A `Household` is a frozen value, like `Person` and `Location`. Changing one
 * builds a new one, so nothing can hold a stale reference that quietly updates
 * underneath it.
 */

/**
 * A member's position in the house, which is not the same as their blood.
 *
 * An apprentice is not kin and a widowed mother-in-law is kin without being a
 * dependent. Descent lives in `kinship.ts` and answers a different question;
 * conflating the two would make "who is in charge here" unanswerable for every
 * household that is not a nuclear family.
 */
export const HouseholdRole = {
  /** The one who answers for the house. Exactly one per household. */
  Head: 'head',
  /** Married to the head. */
  Spouse: 'spouse',
  /** A son or daughter of the house, of any age. */
  Child: 'child',
  /** A parent of the head or their spouse, living in. */
  Parent: 'parent',
  /** Fed and housed here without a claim of blood or contract. */
  Dependent: 'dependent',
  /** Housed under an indenture: a trade for their keep. */
  Apprentice: 'apprentice',
} as const;

export type HouseholdRoleName = (typeof HouseholdRole)[keyof typeof HouseholdRole];

export const HOUSEHOLD_ROLES: readonly HouseholdRoleName[] = Object.freeze(
  (Object.values(HouseholdRole) as HouseholdRoleName[]).sort(),
);

export function isHouseholdRole(value: string): value is HouseholdRoleName {
  return (HOUSEHOLD_ROLES as readonly string[]).includes(value);
}

const EntityIdSchema = z.string().refine((value): value is EntityId => isEntityId(value), {
  message: 'not an entity id',
});

export const HouseholdMemberSchema = z
  .object({
    npc: EntityIdSchema,
    role: z.enum(HOUSEHOLD_ROLES as [HouseholdRoleName, ...HouseholdRoleName[]]),
  })
  .strict();

export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

export const HouseholdSchema = z
  .object({
    id: EntityIdSchema,
    /** The family name the house is known by. Not necessarily every member's. */
    name: z.string().min(1),
    /** Exactly one dwelling. Not optional: a household with nowhere to sleep is
     * a bug in whatever built it, not a kind of household. */
    dwelling: EntityIdSchema,
    members: z.array(HouseholdMemberSchema).min(1),
    /** The tick it came into being, so age of the household is answerable. */
    founded: z.number().int().nonnegative(),
  })
  .strict();

export type Household = z.infer<typeof HouseholdSchema>;

export interface HouseholdInit {
  readonly id: EntityId;
  readonly name: string;
  readonly dwelling: EntityId;
  readonly members: readonly HouseholdMember[];
  readonly founded: number;
}

/**
 * Build a household, refusing anything malformed.
 *
 * Members are stored sorted by id rather than in the order they were passed,
 * for the same reason `Population.ids()` sorts: this array is serialized, and
 * an order that depended on how the house happened to be assembled would make
 * two identical households hash differently (determinism rule 5).
 *
 * Exactly one head, always. It makes `headOf` total, and it means the question
 * "who answers for this house" has an answer for a household of two orphans as
 * much as for a farmer and his wife.
 */
export function makeHousehold(init: HouseholdInit): Household {
  assert(
    entityKindOf(init.id) === EntityKind.Household,
    'a household id must be a household id',
    { id: init.id },
  );
  assert(init.name.length > 0, 'a household needs a name', { id: init.id });
  assert(init.members.length > 0, 'a household needs at least one member', { id: init.id });
  assert(Number.isSafeInteger(init.founded) && init.founded >= 0, 'founded must be a tick', {
    id: init.id,
    founded: init.founded,
  });

  const seen = new Set<EntityId>();
  let heads = 0;
  for (const member of init.members) {
    assert(entityKindOf(member.npc) === EntityKind.Npc, 'a household member must be an npc', {
      household: init.id,
      npc: member.npc,
    });
    assert(!seen.has(member.npc), 'somebody is in the same household twice', {
      household: init.id,
      npc: member.npc,
    });
    assert(isHouseholdRole(member.role), 'unknown household role', {
      household: init.id,
      role: member.role,
    });
    seen.add(member.npc);
    if (member.role === HouseholdRole.Head) heads++;
  }
  assert(heads === 1, 'a household has exactly one head', { household: init.id, heads });

  const members = [...init.members]
    .sort((a, b) => compareEntityIds(a.npc, b.npc))
    .map((member) => Object.freeze({ npc: member.npc, role: member.role }));

  return Object.freeze({
    id: init.id,
    name: init.name,
    dwelling: init.dwelling,
    members: Object.freeze(members),
    founded: init.founded,
  }) as Household;
}

/** The member who answers for the house. Total, by construction. */
export function headOf(household: Household): EntityId {
  const head = household.members.find((member) => member.role === HouseholdRole.Head);
  assert(head !== undefined, 'a household lost its head', { household: household.id });
  return head.npc;
}

export function memberIds(household: Household): readonly EntityId[] {
  return household.members.map((member) => member.npc);
}

export function roleOf(household: Household, npc: EntityId): HouseholdRoleName | undefined {
  return household.members.find((member) => member.npc === npc)?.role;
}

export function isMember(household: Household, npc: EntityId): boolean {
  return household.members.some((member) => member.npc === npc);
}

export function membersWithRole(
  household: Household,
  role: HouseholdRoleName,
): readonly EntityId[] {
  return household.members.filter((member) => member.role === role).map((member) => member.npc);
}

/** Build a new household from an old one. Values are never edited in place. */
export function withHousehold(
  household: Household,
  changes: Partial<Omit<HouseholdInit, 'id'>>,
): Household {
  return makeHousehold({ ...household, ...changes });
}
