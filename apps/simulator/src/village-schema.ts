import { RoutineBandSchema, TraitDistributionSchema } from '@rpgsim/npc';
import { HouseholdTemplateSchema } from '@rpgsim/society';
import { z } from 'zod';

/**
 * The shape of `data/world/village.json`.
 *
 * The balance numbers Phase 1 has been carrying as code defaults live here: the
 * trait distribution, the household templates, the routine bands, the role
 * shifts. CLAUDE.md directive 10 asks for that, and the reason it matters is
 * narrower than "configuration is nice" -- these are the numbers somebody will
 * want to change while watching a village run badly, and a number you have to
 * recompile to change is a number nobody tunes.
 *
 * **The tables that already have a schema are imported, not restated.** The
 * first draft of this file wrote its own `AgeBandSchema` and its own household
 * template, and both were wrong within an hour of being written: the age band
 * lost `minAge`, and the template grew a `spouseChance` where the real one has
 * a `spouse` boolean. A restated schema is a second definition of the same
 * thing that nothing checks against the first, so it drifts silently and the
 * data file it validates is then valid and useless. Where a package owns a
 * table, that package owns its schema and this file imports it.
 *
 * Two further rules govern everything below.
 *
 * **Places are named by slug, never by entity id.** `"mill-lane"`, not
 * `location:7`. Ids are allocated by `sim.newId` in worldgen's own order, so an
 * id written into data would make editing this file capable of renumbering an
 * existing world. Worldgen keeps a slug table for the length of its own run and
 * throws it away; no slug reaches a save.
 *
 * **Every collection is an array.** Not an object keyed by slug. Determinism
 * rule 5 forbids feeding state or a hash from an iteration order that is not
 * itself deterministic, and JSON object key order is exactly that.
 */

const Slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'a slug is lower-case words joined by hyphens');

/** An inclusive integer range, low first. Used for conditions and counts. */
const Range = z
  .object({ min: z.number().int(), max: z.number().int() })
  .strict()
  .refine((r) => r.min <= r.max, { message: 'a range runs from min to max' });

const NonNegative = z.number().int().min(0);
const Positive = z.number().int().min(1);

// --- terrain ---------------------------------------------------------------

const PlaceSchema = z
  .object({
    slug: Slug,
    name: z.string().min(1),
    type: z.string().min(1),
    coordinate: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
    /** How many people fit inside. Absent means unbounded. */
    capacity: Positive.optional(),
    access: z.enum(['public', 'private']).optional(),
  })
  .strict();

const RoadSchema = z
  .object({
    from: Slug,
    to: Slug,
    /** Travel cost in **seconds**, which is what a tick is. */
    cost: Positive,
  })
  .strict();

const StructureSchema = z
  .object({
    slug: Slug,
    name: z.string().min(1),
    type: z.string().min(1),
    /** The interior: a place from the list above. */
    place: Slug,
    condition: NonNegative.max(100).optional(),
  })
  .strict();

/**
 * The cottages, described as a count rather than written out.
 *
 * Worldgen deals them round-robin along `lanes` in the order given, so the
 * layout is a function of this file and nothing else. Naming them is deferred
 * until the family that lives there exists -- a cottage is called `Hale
 * Cottage` because the Hales are in it, which is both how villages actually
 * name houses and what makes the event log readable.
 */
const DwellingsSchema = z
  .object({
    count: Positive,
    lanes: z.array(Slug).min(1),
    type: z.string().min(1),
    /** Ticks from the lane to the front door. */
    walkFromLane: Positive,
    capacity: Positive,
    condition: Range,
    /** Metres offset from the lane, so two cottages are not at one point. */
    spacing: Positive,
  })
  .strict();

// --- people ----------------------------------------------------------------

const RoleShiftSchema = z.object({ role: z.string().min(1), shift: z.number().int() }).strict();

/**
 * Everything that decides who lives here.
 *
 * Three tables that the first draft of this file carried are deliberately not
 * here, and the reason is the same for all three: **nothing would read them.**
 *
 * `ageBands` is consulted only when a villager's age is *not* already fixed,
 * and every founding villager's age is fixed by the household plan they belong
 * to. `culture` is already stated once, at the top of `names.json`, and a
 * second statement of it is a second thing to keep in step. `minParentAgeGap`
 * is enforced by an invariant as well as used by the generator, so making it
 * data would mean the rule and the check could disagree.
 *
 * A knob in a data file that changes nothing is worse than a constant in code,
 * because it looks live. Each of these moves here on the day something reads
 * it -- `ageBands` when people are born into the world rather than generated
 * into it, in Phase 2.
 */
const PopulationSchema = z
  .object({
    /** How many households to generate. The head count follows from them. */
    households: Positive,
    /**
     * One bell curve for all twelve traits, expanded per trait at load.
     *
     * Per-trait distributions are supported by the generator and not by this
     * file: a village where everybody is unusually stubborn is a knob worth
     * having, and twelve separate curves is a modelling decision nobody has
     * made yet.
     */
    traits: TraitDistributionSchema,
    templates: z.array(HouseholdTemplateSchema).min(1),
    routineBands: z.array(RoutineBandSchema).min(1),
    roleShifts: z.array(RoleShiftSchema),
    /** Where everybody goes when they wake, until Phase 1 has work to do. */
    dayDestinations: z.array(Slug).min(1),
  })
  .strict();

export const VillageSchema = z
  .object({
    /**
     * The settlement's name. Deliberately generic for now: naming the place is
     * a decision to make once it has some character, and keeping the name in
     * exactly one field is what keeps that decision cheap.
     */
    name: z.string().min(1),
    /** Free-text note for whoever edits the file. Ignored by the simulation. */
    note: z.string().optional(),
    /** Which day the world opens on. */
    start: z
      .object({ year: z.number().int(), month: Positive.max(12), day: Positive.max(31) })
      .strict(),
    places: z.array(PlaceSchema).min(1),
    roads: z.array(RoadSchema).min(1),
    structures: z.array(StructureSchema),
    dwellings: DwellingsSchema,
    population: PopulationSchema,
  })
  .strict();

export type VillageConfig = z.infer<typeof VillageSchema>;
export type VillagePlace = VillageConfig['places'][number];
export type VillageRoad = VillageConfig['roads'][number];
export type VillageStructure = VillageConfig['structures'][number];
export type VillageDwellings = VillageConfig['dwellings'];
export type VillagePopulation = VillageConfig['population'];
