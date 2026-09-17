import { assert } from '@rpgsim/shared';
import { type EntityId, EntityKind, entityKindOf, isEntityId } from '@rpgsim/sim-core';
import { z } from 'zod';

/**
 * Descent: who came from whom.
 *
 * Separate from `household.ts` on purpose. A household is who sleeps here; this
 * is who your parents were, which stays true after you leave, after they die,
 * and after the house burns down. Inheritance (Phase 3) and marriage rules
 * (Phase 5) read this, not the membership list.
 *
 * Kinship lives in `@rpgsim/society` rather than on `Person` so that
 * `@rpgsim/npc` stays about identity. A person is still a person with no
 * recorded parents; a village where nobody knows who anyone's mother was is a
 * worse village, not a broken one.
 */

/**
 * Why a parent is not in the world.
 *
 * Phase 1 asks that every child have at least one parent present or absent for
 * a *stated* reason. A null parent with no reason is the thing this exists to
 * prevent: it reads as "unrecorded" and "nobody" at the same time, and the
 * Chronicle would have to invent which.
 */
export const ParentAbsence = {
  /** Died. The commonest reason in a medieval village, by a distance. */
  Dead: 'dead',
  /** Nobody in the village knows. Foundlings, and children of passing trade. */
  Unknown: 'unknown',
  /** Alive somewhere else. Left, was driven out, or never stayed. */
  Departed: 'departed',
} as const;

export type ParentAbsenceName = (typeof ParentAbsence)[keyof typeof ParentAbsence];

export const PARENT_ABSENCES: readonly ParentAbsenceName[] = Object.freeze(
  (Object.values(ParentAbsence) as ParentAbsenceName[]).sort(),
);

const EntityIdSchema = z.string().refine((value): value is EntityId => isEntityId(value), {
  message: 'not an entity id',
});

/**
 * A parent slot: somebody, or a stated reason there is nobody.
 *
 * A union rather than `EntityId | null`, so "unaccounted parent" cannot be
 * written down at all. The invariant that every child's parents are accounted
 * for is then a fact about the type, and the check in `invariants.ts` only has
 * to catch records that predate this build or were smuggled past the API.
 */
export const ParentRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('known'), npc: EntityIdSchema }).strict(),
  z
    .object({
      kind: z.literal('absent'),
      reason: z.enum(PARENT_ABSENCES as [ParentAbsenceName, ...ParentAbsenceName[]]),
    })
    .strict(),
]);

export type ParentRef = z.infer<typeof ParentRefSchema>;

export const ParentageSchema = z
  .object({
    child: EntityIdSchema,
    mother: ParentRefSchema,
    father: ParentRefSchema,
  })
  .strict();

export type Parentage = z.infer<typeof ParentageSchema>;

export function knownParent(npc: EntityId): ParentRef {
  assert(entityKindOf(npc) === EntityKind.Npc, 'a parent must be an npc', { npc });
  return Object.freeze({ kind: 'known', npc }) as ParentRef;
}

export function absentParent(reason: ParentAbsenceName): ParentRef {
  assert(
    (PARENT_ABSENCES as readonly string[]).includes(reason),
    'a parent is absent for a stated reason',
    { reason },
  );
  return Object.freeze({ kind: 'absent', reason }) as ParentRef;
}

export function makeParentage(child: EntityId, mother: ParentRef, father: ParentRef): Parentage {
  assert(entityKindOf(child) === EntityKind.Npc, 'a child must be an npc', { child });
  if (mother.kind === 'known') {
    assert(mother.npc !== child, 'nobody is their own mother', { child });
  }
  if (father.kind === 'known') {
    assert(father.npc !== child, 'nobody is their own father', { child });
  }
  if (mother.kind === 'known' && father.kind === 'known') {
    assert(mother.npc !== father.npc, 'one person cannot be both parents', { child });
  }
  return Object.freeze({ child, mother, father }) as Parentage;
}

/** The parents who actually exist, in a fixed order: mother, then father. */
export function knownParentsOf(parentage: Parentage): readonly EntityId[] {
  const parents: EntityId[] = [];
  if (parentage.mother.kind === 'known') parents.push(parentage.mother.npc);
  if (parentage.father.kind === 'known') parents.push(parentage.father.npc);
  return parents;
}

/** True when at least one parent is a person rather than a stated absence. */
export function hasLivingRecordedParent(parentage: Parentage): boolean {
  return knownParentsOf(parentage).length > 0;
}

/**
 * The youngest a person can be and still have a child.
 *
 * Not a moral claim, a coherence one: without a floor, generation is free to
 * produce a mother eleven years older than nobody and a father younger than his
 * son. It is enforced as an invariant, so a generator that drifts is caught
 * rather than trusted. Balance, so slice 6 moves it to
 * `data/world/village.json`.
 */
export const MIN_PARENT_AGE_GAP = 14;
