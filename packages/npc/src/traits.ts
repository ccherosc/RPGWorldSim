import { assert, assertInt } from '@rpgsim/shared';
import { z } from 'zod';

/**
 * Personality: the slow layer.
 *
 * NPC_MODEL.md asks for 40-60 psychological traits eventually and warns against
 * encoding behaviour directly -- no `propensityToSteal`. The twelve here are a
 * deliberate first slice, chosen on one rule: a trait earns its place in Phase 1
 * only if some Phase 1 or Phase 2 behaviour will visibly read it. A trait nobody
 * consults is a number that can drift, be saved wrong, and never be noticed.
 *
 * The rest of the catalogue arrives with the systems that need it: the social
 * axes with relationships (Phase 5), the economic ones with work and money
 * (Phase 3). Adding a trait later costs one entry here plus a save migration,
 * which is cheap. Carrying fifty unused numbers through every save from now on
 * is not.
 */
export const Trait = {
  /** Whether they tell the truth when a lie would serve. */
  Honesty: 'honesty',
  /** Whether another person's distress registers as their problem. */
  Empathy: 'empathy',
  /** Whether a plan survives contact with a nicer alternative. */
  Conscientiousness: 'conscientiousness',
  /** Whether company is restful or tiring. Decides where evenings are spent. */
  Sociability: 'sociability',
  /** Whether the first idea gets acted on. */
  Impulsiveness: 'impulsiveness',
  /** Whether an unexplained thing is worth walking over to look at. */
  Curiosity: 'curiosity',
  /** Whether work is done because it is there. */
  WorkEthic: 'workEthic',
  /** Whether the bell is worth answering. */
  Religiosity: 'religiosity',
  /** Whether fear stops them. */
  Courage: 'courage',
  /** Whether what they have is shared. */
  Generosity: 'generosity',
  /** Whether a position, once taken, is given up. */
  Stubbornness: 'stubbornness',
  /** Whether their present station is acceptable. */
  Ambition: 'ambition',
} as const;

export type TraitName = (typeof Trait)[keyof typeof Trait];

/**
 * Every trait, in one fixed order.
 *
 * Sorted, and sorted *once*, because this array is the iteration order for both
 * generation and serialization. Generation draws one number per trait in this
 * order, so re-sorting it would change every person in every world built from an
 * existing seed. Determinism rule 5: never iterate a collection whose order is
 * not itself deterministic.
 */
export const TRAIT_NAMES: readonly TraitName[] = Object.freeze(
  (Object.values(Trait) as TraitName[]).sort(),
);

/** The scale every trait shares: an integer 0-100, where 50 is unremarkable. */
export const TRAIT_MIN = 0;
export const TRAIT_MAX = 100;

/**
 * A complete personality. Every trait, always -- there is no such thing as an
 * NPC whose honesty is unknown.
 */
export type Traits = Readonly<Record<TraitName, number>>;

const TraitValueSchema = z.number().int().min(TRAIT_MIN).max(TRAIT_MAX);

/**
 * Exactly the known traits, no more and no fewer.
 *
 * `strict()` matters: an unknown key is a trait that some older or newer build
 * believes in and this one does not, and silently dropping it would lose state
 * across a save/load round trip without anything going red.
 */
export const TraitsSchema = z
  .object(
    Object.fromEntries(TRAIT_NAMES.map((name) => [name, TraitValueSchema])) as Record<
      TraitName,
      typeof TraitValueSchema
    >,
  )
  .strict();

export function isTraitName(value: string): value is TraitName {
  return (TRAIT_NAMES as readonly string[]).includes(value);
}

/**
 * How a trait is rolled when a person is generated.
 *
 * Normal around a mean, clamped to the scale. `stdDev` 18 puts roughly two
 * thirds of a village within 32-68 and makes a value below 15 or above 85 rare
 * enough to be worth remarking on, which is what makes a trait legible in a
 * biography rather than noise.
 */
export interface TraitDistribution {
  readonly mean: number;
  readonly stdDev: number;
}

/** The same shape, validated, so a data file can carry it. */
export const TraitDistributionSchema = z
  .object({ mean: z.number(), stdDev: z.number().positive() })
  .strict();

export const DEFAULT_TRAIT_MEAN = 50;
export const DEFAULT_TRAIT_STD_DEV = 18;

/**
 * The default roll, used for every trait unless a caller overrides it.
 *
 * Per-trait skews (a pious village, a stubborn one) are balance, and directive
 * 10 puts balance in data. Since slice 6 `data/world/village.json` carries the
 * curve and worldgen passes it in as an override map; it currently states one
 * curve for all twelve traits, which is the same shape as this default and not
 * the same thing as inheriting it. A village that skews a trait states that
 * trait's own curve there, not here.
 */
export const DEFAULT_TRAIT_DISTRIBUTION: TraitDistribution = Object.freeze({
  mean: DEFAULT_TRAIT_MEAN,
  stdDev: DEFAULT_TRAIT_STD_DEV,
});

/**
 * Build a `Traits` from a partial map, defaulting anything unstated to 50.
 *
 * Refuses an out-of-range value rather than clamping it. A caller who passes 140
 * has a bug in the arithmetic that produced 140, and quietly storing 100 would
 * hide it, which sim-core rule 10 forbids. `clampTrait` exists for the other
 * case, where drift is expected and clamping is the intended behaviour.
 */
export function makeTraits(values: Partial<Record<TraitName, number>> = {}): Traits {
  const traits: Record<string, number> = {};
  for (const name of TRAIT_NAMES) {
    const value = values[name] ?? DEFAULT_TRAIT_MEAN;
    assertInt(value, `trait ${name} must be an integer`);
    assert(value >= TRAIT_MIN && value <= TRAIT_MAX, `trait ${name} is outside its range`, {
      trait: name,
      value,
    });
    traits[name] = value;
  }
  return Object.freeze(traits) as Traits;
}

/**
 * Clamp a *computed* trait value to the scale.
 *
 * For generation, and for trait change (ageing, trauma, habit), where landing
 * outside the range is a normal consequence of the arithmetic rather than a bug.
 * Clamping in one place is what keeps "every trait is in range" true by
 * construction rather than by hope.
 */
export function clampTrait(value: number): number {
  return value < TRAIT_MIN ? TRAIT_MIN : value > TRAIT_MAX ? TRAIT_MAX : value;
}
