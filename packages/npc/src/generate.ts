import { assert } from '@rpgsim/shared';
import {
  type CalendarConfig,
  DEFAULT_CALENDAR,
  type EntityId,
  type MonthConfig,
  type Rng,
  type WorldDateTime,
  daysPerYear,
} from '@rpgsim/sim-core';
import { z } from 'zod';
import type { NameBook } from './names.ts';
import { type BirthDate, type Person, Sex, type SexName, makePerson } from './person.ts';
import {
  DEFAULT_TRAIT_DISTRIBUTION,
  TRAIT_MAX,
  TRAIT_MIN,
  TRAIT_NAMES,
  type TraitDistribution,
  type TraitName,
  type Traits,
  clampTrait,
} from './traits.ts';

/**
 * Rolling a person.
 *
 * Everything here draws from `RngStream.NpcGeneration` — the caller passes the
 * stream in, because a package that reached for a global RNG would be a package
 * that cannot be tested twice with the same numbers.
 *
 * **The draw order is part of the world.** Change the order below and every seed
 * produces a different village. It is written out explicitly in
 * `generatePerson` for that reason, rather than being an accident of how the
 * fields happen to be listed in the object literal.
 */

export const AgeBandSchema = z
  .object({
    name: z.string().min(1),
    minAge: z.number().int().nonnegative(),
    maxAge: z.number().int().nonnegative(),
    weight: z.number().nonnegative(),
  })
  .strict();

export type AgeBand = z.infer<typeof AgeBandSchema>;

/**
 * The founding age distribution.
 *
 * Roughly a pre-modern village: a third of it children, very few people past
 * sixty. It is not a demographic model — births, deaths and ageing (Phase 2)
 * will take over, and this will only ever describe day one. It exists so that
 * day one is not a hundred thirty-year-olds, which would make every later
 * demographic result unreadable.
 *
 * These are balance values, so directive 10 says they belong in data. Slice 6
 * will read them from `data/world/village.json`; this constant is the default
 * for tests and for a world built without one, on the same pattern as
 * `DEFAULT_CALENDAR`.
 */
export const DEFAULT_AGE_BANDS: readonly AgeBand[] = Object.freeze([
  Object.freeze({ name: 'child', minAge: 0, maxAge: 13, weight: 32 }),
  Object.freeze({ name: 'youth', minAge: 14, maxAge: 24, weight: 21 }),
  Object.freeze({ name: 'adult', minAge: 25, maxAge: 44, weight: 27 }),
  Object.freeze({ name: 'older', minAge: 45, maxAge: 59, weight: 13 }),
  Object.freeze({ name: 'elder', minAge: 60, maxAge: 84, weight: 7 }),
]) as readonly AgeBand[];

export function validateAgeBands(bands: readonly AgeBand[]): readonly AgeBand[] {
  assert(bands.length > 0, 'age bands must not be empty');
  let totalWeight = 0;
  for (const band of bands) {
    assert(band.maxAge >= band.minAge, 'an age band ends before it starts', { band });
    totalWeight += band.weight;
  }
  assert(totalWeight > 0, 'age bands must have at least one positive weight');
  return bands;
}

/** Roll a full personality, one draw per trait in `TRAIT_NAMES` order. */
export function generateTraits(
  rng: Rng,
  distributions: Partial<Record<TraitName, TraitDistribution>> = {},
): Traits {
  const traits: Record<string, number> = {};
  for (const name of TRAIT_NAMES) {
    const distribution = distributions[name] ?? DEFAULT_TRAIT_DISTRIBUTION;
    const rolled = rng.nextGaussianClamped(
      distribution.mean,
      distribution.stdDev,
      TRAIT_MIN,
      TRAIT_MAX,
    );
    traits[name] = clampTrait(Math.round(rolled));
  }
  return Object.freeze(traits) as Traits;
}

/** Pick an age band by weight, then an age uniformly inside it. */
export function generateAge(rng: Rng, bands: readonly AgeBand[] = DEFAULT_AGE_BANDS): number {
  validateAgeBands(bands);
  const band = rng.pickWeighted(bands, (candidate) => candidate.weight);
  return rng.nextIntInclusive(band.minAge, band.maxAge);
}

/**
 * A uniformly-chosen day of the year, as a month and a day.
 *
 * Uniform over *days*, not over months first and then days within the month.
 * With the default twelve-thirty-day calendar the two are identical, but the
 * calendar is data and a future one need not have equal months; picking a month
 * first would then quietly make people born in short months more common.
 */
export function generateBirthDayOfYear(
  rng: Rng,
  calendar: CalendarConfig = DEFAULT_CALENDAR,
): { month: number; day: number } {
  let dayOfYear = rng.nextInt(0, daysPerYear(calendar));
  for (let index = 0; index < calendar.months.length; index++) {
    const month = calendar.months[index] as MonthConfig;
    if (dayOfYear < month.days) return { month: index + 1, day: dayOfYear + 1 };
    dayOfYear -= month.days;
  }
  throw new Error('day of year fell outside the calendar');
}

/**
 * The birth year that makes someone exactly `age` years old on `now`.
 *
 * The off-by-one that matters: somebody whose birthday has not yet come round
 * this year was born a year earlier than the subtraction suggests. Getting it
 * wrong would make a village where everybody ages on the same day, which is
 * both wrong and very hard to see.
 */
export function birthYearForAge(
  age: number,
  birthday: { month: number; day: number },
  now: WorldDateTime,
): number {
  const hadBirthday =
    now.month > birthday.month || (now.month === birthday.month && now.day >= birthday.day);
  return now.year - age - (hadBirthday ? 0 : 1);
}

export interface GeneratePersonOptions {
  /** The id to give them. Allocate it from `sim.newId('npc')`. */
  readonly id: EntityId;
  /** The moment they are created — the date their age is measured against. */
  readonly now: WorldDateTime;
  readonly names: NameBook;
  readonly calendar?: CalendarConfig;
  readonly ageBands?: readonly AgeBand[];
  readonly traitDistributions?: Partial<Record<TraitName, TraitDistribution>>;
  /**
   * Fix the sex instead of rolling it. Household generation (slice 4) uses this
   * to make a married couple, and skips the draw that would otherwise happen.
   */
  readonly sex?: SexName;
  /** Fix the family name, so a household shares one. Skips that draw. */
  readonly familyName?: string;
  /** Fix the age in whole years. Skips the band and age draws. */
  readonly age?: number;
  readonly birthplace?: EntityId | null;
  readonly household?: EntityId | null;
  readonly home?: EntityId | null;
}

/**
 * Roll one villager.
 *
 * Fixing a field (`sex`, `familyName`, `age`) skips the draw that would have
 * produced it rather than drawing and discarding. Both are deterministic; this
 * way the number of draws matches the number of decisions actually left to
 * chance, so a household of four siblings does not silently consume four
 * surname draws it never used.
 */
export function generatePerson(rng: Rng, options: GeneratePersonOptions): Person {
  const calendar = options.calendar ?? DEFAULT_CALENDAR;
  const names = options.names;
  const now = options.now;

  // Draw order. Do not reorder: it is part of what a seed means.
  const sex: SexName = options.sex ?? (rng.chance(0.5) ? Sex.Male : Sex.Female);
  const givenName = rng.pick(sex === Sex.Male ? names.given.male : names.given.female);
  const familyName = options.familyName ?? rng.pick(names.family);
  const age = options.age ?? generateAge(rng, options.ageBands ?? DEFAULT_AGE_BANDS);
  const birthday = generateBirthDayOfYear(rng, calendar);
  const traits = generateTraits(rng, options.traitDistributions ?? {});

  assert(Number.isSafeInteger(age) && age >= 0, 'age must be a non-negative integer', { age });

  const birth: BirthDate = {
    year: birthYearForAge(age, birthday, now),
    month: birthday.month,
    day: birthday.day,
  };

  return makePerson(
    {
      id: options.id,
      givenName,
      familyName,
      sex,
      birth,
      birthplace: options.birthplace ?? null,
      culture: names.culture,
      traits,
      household: options.household ?? null,
      home: options.home ?? null,
    },
    calendar,
  );
}
