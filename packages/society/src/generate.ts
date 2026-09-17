import { assert } from '@rpgsim/shared';
import type { Rng } from '@rpgsim/sim-core';
import { type NameBook, Sex, type SexName } from '@rpgsim/npc';
import { z } from 'zod';
import { HouseholdRole, type HouseholdRoleName } from './household.ts';
import { MIN_PARENT_AGE_GAP, ParentAbsence, type ParentAbsenceName } from './kinship.ts';

/**
 * Rolling a family.
 *
 * Produces a *plan*, not people: a list of roles, sexes, ages and surnames,
 * with parents referred to by their position in the same list. Nothing here
 * allocates an id, touches a `Simulation` or creates a villager.
 *
 * That separation is the point. A plan is a value, so the composition rules can
 * be tested directly -- is a mother ever younger than her daughter, does a
 * widow's household ever contain a living husband -- without standing up a
 * world. `HouseholdSystem.generate` is what turns a plan into people.
 *
 * **The draw order is part of the world**, exactly as it is in
 * `@rpgsim/npc`'s `generatePerson`. It is written out explicitly below rather
 * than falling out of the shape of the code.
 */

export const AgeRangeSchema = z
  .object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  })
  .strict();

export type AgeRange = z.infer<typeof AgeRangeSchema>;

export const HouseholdTemplateSchema = z
  .object({
    name: z.string().min(1),
    weight: z.number().nonnegative(),
    /** The age of whoever answers for the house. */
    headAge: AgeRangeSchema,
    /** Whether a living husband or wife lives here. */
    spouse: z.boolean(),
    /** How many sons and daughters are still under this roof. */
    children: AgeRangeSchema,
    /** Chance that a widowed parent of the head lives in. */
    residentParentChance: z.number().min(0).max(1),
    /** Chance that somebody else's child is housed here under indenture. */
    apprenticeChance: z.number().min(0).max(1),
  })
  .strict();

export type HouseholdTemplate = z.infer<typeof HouseholdTemplateSchema>;

/**
 * The founding distribution of household shapes.
 *
 * Aimed at [WORLD_ZERO_SPEC.md](../../../docs/WORLD_ZERO_SPEC.md)'s list:
 * parents, children, married couples, widows and widowers, single adults,
 * apprentices, elderly dependents. Weighted so that roughly 25-30 households
 * come out at 80-120 people, with most of the village in a family and enough
 * exceptions that "a household" does not mean one thing.
 *
 * These are balance values, so directive 10 says they belong in data. Slice 6
 * reads them from `data/world/village.json`; this constant is the default for
 * tests and for a world built without one, on the pattern of
 * `DEFAULT_AGE_BANDS` and `DEFAULT_CALENDAR`.
 */
export const DEFAULT_HOUSEHOLD_TEMPLATES: readonly HouseholdTemplate[] = Object.freeze([
  Object.freeze({
    name: 'family',
    weight: 36,
    headAge: { min: 25, max: 52 },
    spouse: true,
    children: { min: 1, max: 5 },
    residentParentChance: 0.18,
    apprenticeChance: 0.18,
  }),
  Object.freeze({
    name: 'young-couple',
    weight: 10,
    headAge: { min: 18, max: 27 },
    spouse: true,
    children: { min: 0, max: 1 },
    residentParentChance: 0.1,
    apprenticeChance: 0.04,
  }),
  Object.freeze({
    name: 'widowed-parent',
    weight: 14,
    headAge: { min: 30, max: 58 },
    spouse: false,
    children: { min: 1, max: 4 },
    residentParentChance: 0.08,
    apprenticeChance: 0.1,
  }),
  Object.freeze({
    name: 'single-adult',
    weight: 16,
    headAge: { min: 18, max: 45 },
    spouse: false,
    children: { min: 0, max: 0 },
    residentParentChance: 0.08,
    apprenticeChance: 0.02,
  }),
  Object.freeze({
    name: 'elder-couple',
    weight: 11,
    headAge: { min: 55, max: 76 },
    spouse: true,
    children: { min: 0, max: 1 },
    residentParentChance: 0,
    apprenticeChance: 0.08,
  }),
  Object.freeze({
    name: 'elder-alone',
    weight: 7,
    headAge: { min: 58, max: 82 },
    spouse: false,
    children: { min: 0, max: 0 },
    residentParentChance: 0,
    apprenticeChance: 0.04,
  }),
]) as readonly HouseholdTemplate[];

/** The oldest a son or daughter can be and still be counted of the house. */
export const MAX_RESIDENT_CHILD_AGE = 25;

/** The oldest anybody gets at founding. Ageing and death are Phase 2. */
export const MAX_FOUNDING_AGE = 88;

/**
 * How much older than the head a live-in parent of theirs is.
 *
 * Named rather than inline because `validateHouseholdTemplates` has to know it:
 * a template whose head can be old enough that `headAge.max + min` exceeds
 * `MAX_FOUNDING_AGE` would produce a "parent" clamped down to within
 * `MIN_PARENT_AGE_GAP` of their own child, and the descent invariant would fire
 * on a village the generator built. The table is refused instead.
 */
export const RESIDENT_PARENT_AGE_GAP: AgeRange = Object.freeze({
  min: MIN_PARENT_AGE_GAP + 3,
  max: MIN_PARENT_AGE_GAP + 26,
});

/** An apprentice is old enough to work and too young to have a house. */
export const APPRENTICE_AGE: AgeRange = Object.freeze({ min: 12, max: 22 });

/**
 * A parent, referred to by position in the same plan.
 *
 * Positions rather than ids, because a plan exists before anybody has one.
 * Mirrors `ParentRef` in `kinship.ts`, including the rule that "absent" always
 * carries a stated reason.
 */
export type PlannedParent =
  | { readonly kind: 'member'; readonly index: number }
  | { readonly kind: 'absent'; readonly reason: ParentAbsenceName };

export interface PlannedMember {
  readonly role: HouseholdRoleName;
  readonly sex: SexName;
  readonly age: number;
  readonly familyName: string;
  /** The parents this plan knows of. Unset where the house has no view on it. */
  readonly mother?: PlannedParent;
  readonly father?: PlannedParent;
}

export interface HouseholdPlan {
  /** The template that produced it, so a test or the Chronicle can say which. */
  readonly template: string;
  /** The name the house is known by: its head's. */
  readonly name: string;
  readonly members: readonly PlannedMember[];
}

export function validateHouseholdTemplates(
  templates: readonly HouseholdTemplate[],
): readonly HouseholdTemplate[] {
  assert(templates.length > 0, 'household templates must not be empty');
  let totalWeight = 0;
  for (const template of templates) {
    assert(template.headAge.max >= template.headAge.min, 'a head age range ends before it starts', {
      template: template.name,
    });
    assert(
      template.headAge.min >= MIN_PARENT_AGE_GAP,
      'a head this young could be handed a child older than the rules allow',
      { template: template.name, minAge: template.headAge.min },
    );
    assert(template.children.max >= template.children.min, 'a child count ends before it starts', {
      template: template.name,
    });
    assert(
      template.residentParentChance === 0 ||
        template.headAge.max + RESIDENT_PARENT_AGE_GAP.min <= MAX_FOUNDING_AGE,
      'a live-in parent of a head this old would have to be older than anybody gets',
      {
        template: template.name,
        headAgeMax: template.headAge.max,
        ceiling: MAX_FOUNDING_AGE,
      },
    );
    totalWeight += template.weight;
  }
  assert(totalWeight > 0, 'household templates must have at least one positive weight');
  return templates;
}

export interface GenerateHouseholdPlanOptions {
  readonly names: NameBook;
  readonly templates?: readonly HouseholdTemplate[];
  /** Force one shape, skipping the template draw. Worldgen and tests use this. */
  readonly template?: HouseholdTemplate;
}

/**
 * Roll one household's composition.
 *
 * Ages are rolled under one rule that the invariants then enforce
 * independently: every parent is at least `MIN_PARENT_AGE_GAP` years older than
 * every child of theirs. That is not belt and braces. A generator is the one
 * thing that can produce a whole village of impossible families at once, so the
 * check that catches it deliberately does not share code with the thing it
 * checks.
 */
export function generateHouseholdPlan(
  rng: Rng,
  options: GenerateHouseholdPlanOptions,
): HouseholdPlan {
  // A forced template is validated like any other. Skipping the check because a
  // caller named the shape would let worldgen hand in the one table the weighted
  // draw could never have produced.
  const templates = validateHouseholdTemplates(
    options.template !== undefined
      ? [options.template]
      : (options.templates ?? DEFAULT_HOUSEHOLD_TEMPLATES),
  );
  const names = options.names;

  // Draw order. Do not reorder: it is part of what a seed means.
  const template = options.template ?? rng.pickWeighted(templates, (candidate) => candidate.weight);
  const familyName = rng.pick(names.family);
  const headSex: SexName = rng.chance(0.5) ? Sex.Male : Sex.Female;
  const headAge = rng.nextIntInclusive(template.headAge.min, template.headAge.max);

  const members: PlannedMember[] = [
    { role: HouseholdRole.Head, sex: headSex, age: headAge, familyName },
  ];
  const headIndex = 0;

  // A spouse is the other sex and roughly the same age. The offset is skewed so
  // that the wife is more often the younger, which is what makes a village of
  // this period look like one rather than a modern one.
  let spouseIndex: number | undefined;
  if (template.spouse) {
    const offset = rng.nextIntInclusive(-4, 9);
    const spouseAge = clampAge(
      headSex === Sex.Male ? headAge - offset : headAge + offset,
      template.headAge.min,
    );
    spouseIndex = members.length;
    members.push({
      role: HouseholdRole.Spouse,
      sex: headSex === Sex.Male ? Sex.Female : Sex.Male,
      age: spouseAge,
      familyName,
    });
  }

  // Children can be no older than the younger parent allows. `oldestChild` is
  // never negative: `validateHouseholdTemplates` refuses a table whose head
  // could be younger than `MIN_PARENT_AGE_GAP`, and a spouse is floored at the
  // head's own minimum, so the youngest possible parent is exactly old enough
  // for a newborn.
  const youngestParentAge =
    spouseIndex === undefined
      ? headAge
      : Math.min(headAge, members[spouseIndex]?.age ?? headAge);
  const oldestChild = Math.min(MAX_RESIDENT_CHILD_AGE, youngestParentAge - MIN_PARENT_AGE_GAP);
  const childCount = rng.nextIntInclusive(template.children.min, template.children.max);

  const mother = parentOfSex(members, headIndex, spouseIndex, Sex.Female);
  const father = parentOfSex(members, headIndex, spouseIndex, Sex.Male);

  for (let i = 0; i < childCount; i++) {
    const childSex: SexName = rng.chance(0.5) ? Sex.Male : Sex.Female;
    const childAge = rng.nextIntInclusive(0, oldestChild);
    members.push({
      role: HouseholdRole.Child,
      sex: childSex,
      age: childAge,
      familyName,
      mother,
      father,
    });
  }

  // A widowed parent of the head, old enough to be one -- and recorded as the
  // head's parent, not merely as an old person in the house. It is what makes
  // descent in a founding village two generations deep, which is what
  // `society.descent-has-no-cycles` is there to walk.
  if (rng.chance(template.residentParentChance)) {
    const elderSex: SexName = rng.chance(0.5) ? Sex.Male : Sex.Female;
    const elderAge = clampAge(
      headAge + rng.nextIntInclusive(RESIDENT_PARENT_AGE_GAP.min, RESIDENT_PARENT_AGE_GAP.max),
      0,
    );
    const elderIndex = members.length;
    members.push({
      role: HouseholdRole.Parent,
      sex: elderSex,
      age: elderAge,
      familyName,
    });

    const head = members[headIndex] as PlannedMember;
    const elderIsMother = elderSex === Sex.Female;
    members[headIndex] = {
      ...head,
      mother: elderIsMother
        ? { kind: 'member', index: elderIndex }
        : { kind: 'absent', reason: ParentAbsence.Dead },
      father: elderIsMother
        ? { kind: 'absent', reason: ParentAbsence.Dead }
        : { kind: 'member', index: elderIndex },
    };
  }

  // An apprentice: somebody else's child, under this roof for a trade. Their own
  // surname, because they did not come from this house.
  if (rng.chance(template.apprenticeChance)) {
    const apprenticeSex: SexName = rng.chance(0.5) ? Sex.Male : Sex.Female;
    const apprenticeAge = rng.nextIntInclusive(APPRENTICE_AGE.min, APPRENTICE_AGE.max);
    const apprenticeName = rng.pick(names.family);
    members.push({
      role: HouseholdRole.Apprentice,
      sex: apprenticeSex,
      age: apprenticeAge,
      familyName: apprenticeName,
    });
  }

  return Object.freeze({
    template: template.name,
    name: familyName,
    members: Object.freeze(members.map((member) => Object.freeze(member))),
  }) as HouseholdPlan;
}

/**
 * Which planned member is the mother (or father), and if neither, why not.
 *
 * A household with one parent has lost the other, and the reason is stated:
 * `dead` is the honest default for a medieval village, and a stated reason is
 * what `society.children-have-recorded-parents` requires.
 */
function parentOfSex(
  members: readonly PlannedMember[],
  headIndex: number,
  spouseIndex: number | undefined,
  sex: SexName,
): PlannedParent {
  if (members[headIndex]?.sex === sex) return { kind: 'member', index: headIndex };
  if (spouseIndex !== undefined && members[spouseIndex]?.sex === sex) {
    return { kind: 'member', index: spouseIndex };
  }
  return { kind: 'absent', reason: ParentAbsence.Dead };
}

/** Keep a rolled age inside the range a founding villager can occupy. */
function clampAge(age: number, floor: number): number {
  const low = floor < 0 ? 0 : floor;
  if (age < low) return low;
  return age > MAX_FOUNDING_AGE ? MAX_FOUNDING_AGE : age;
}
