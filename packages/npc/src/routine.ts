import { assert, divFloor, mod } from '@rpgsim/shared';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type Rng, type Tick, hours, minutes } from '@rpgsim/sim-core';
import { z } from 'zod';

/**
 * The daily habit: when somebody gets up, and when they turn in.
 *
 * Habit rather than decision, deliberately. Phase 4 replaces this with utility
 * scoring, and the shape here is arranged to be replaced: a `Routine` is a
 * value with no simulation attached, so the thing that eventually decides *why*
 * a villager rises early can be swapped in without touching the machinery that
 * makes rising happen at all.
 *
 * Times are **ticks into the day**, not ticks. A tick is an absolute instant
 * that has a year in it; a routine is a time of day that recurs, and storing it
 * as an absolute tick would mean rewriting every villager's habit at midnight.
 * `nextTickOfDay` is what turns one into the other.
 *
 * **A day runs rise -> bed -> midnight.** The waking window is contiguous
 * inside one calendar day and sleep is what spans midnight. Nobody in World
 * Zero works a night watch, and saying so as a constraint is worth more than
 * the generality: it makes "are they meant to be awake right now?" a single
 * comparison instead of a case analysis, and `validateRoutineBands` can prove
 * no jitter ever turns a habit inside out.
 */

/** A span of times of day, in ticks into the day. Both ends inclusive. */
export const TickRangeSchema = z
  .object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  })
  .strict();

export type TickRange = z.infer<typeof TickRangeSchema>;

export const RoutineSchema = z
  .object({
    /** Ticks into the day they rise. */
    rise: z.number().int().nonnegative().max(TICKS_PER_DAY - 1),
    /** Ticks into the day they turn in. Always later in the day than `rise`. */
    bed: z.number().int().nonnegative().max(TICKS_PER_DAY - 1),
  })
  .strict();

export type Routine = z.infer<typeof RoutineSchema>;

/** `at(5, 30)` is half past five in the morning, in ticks into the day. */
export function at(hour: number, minute = 0): number {
  return hour * TICKS_PER_HOUR + minutes(minute);
}

/** How far a day's rise and bed may drift from the habit, in either direction. */
export const ROUTINE_JITTER = minutes(20);

/**
 * The least time anybody is awake for, after every shift and jitter.
 *
 * Not a comfort rule — a coherence one. It is the margin
 * `validateRoutineBands` checks against, so a band table that could produce a
 * villager who wakes after their own bedtime is refused at validation rather
 * than generating a person the invariants then fire on (sim-core rule 10).
 */
export const MIN_WAKING_TICKS = hours(8);

export interface RoutineBand {
  readonly name: string;
  /** Inclusive upper age for this band. The last band must catch everybody. */
  readonly maxAge: number;
  readonly rise: TickRange;
  readonly bed: TickRange;
}

/**
 * Rise and bed by age.
 *
 * Medieval hours, not modern ones: the working day starts at first light and
 * the expensive thing is candles, so everybody is earlier than a reader expects
 * and the elderly are earliest of all. Children get the most sleep and youths
 * the latest nights.
 *
 * Balance values, so directive 10 says they belong in data. Slice 6 reads them
 * from `data/world/village.json`; this constant is the default for tests and
 * for a world built without one, on the pattern of `DEFAULT_AGE_BANDS`.
 */
export const DEFAULT_ROUTINE_BANDS: readonly RoutineBand[] = Object.freeze([
  Object.freeze({
    name: 'child',
    maxAge: 13,
    rise: Object.freeze({ min: at(5, 30), max: at(7, 0) }),
    bed: Object.freeze({ min: at(20, 0), max: at(21, 0) }),
  }),
  Object.freeze({
    name: 'youth',
    maxAge: 24,
    rise: Object.freeze({ min: at(4, 45), max: at(6, 0) }),
    bed: Object.freeze({ min: at(21, 0), max: at(22, 30) }),
  }),
  Object.freeze({
    name: 'adult',
    maxAge: 59,
    rise: Object.freeze({ min: at(4, 30), max: at(5, 45) }),
    bed: Object.freeze({ min: at(20, 30), max: at(22, 0) }),
  }),
  Object.freeze({
    name: 'elder',
    maxAge: Number.MAX_SAFE_INTEGER,
    rise: Object.freeze({ min: at(4, 0), max: at(5, 30) }),
    bed: Object.freeze({ min: at(19, 30), max: at(21, 0) }),
  }),
]) as readonly RoutineBand[];

/**
 * How much earlier a position in the household gets you up. Negative is earlier.
 *
 * Keyed by plain string rather than by `HouseholdRoleName`, and that is not
 * laziness: `@rpgsim/society` already depends on `@rpgsim/npc`, so importing
 * the role vocabulary here would close a cycle. This package knows that *some*
 * duties get a person up early; which duties those are is society's word, and
 * it arrives as a string. A role nobody here recognizes shifts nothing, which
 * is the right answer for a role invented in a later phase.
 *
 * Only `rise` shifts. A house rises to whoever has to be up first and goes to
 * bed when the light does, so applying the shift to both ends would give the
 * apprentice less sleep than anybody in the village rather than an earlier
 * start.
 */
export const ROUTINE_ROLE_SHIFTS: Readonly<Record<string, number>> = Object.freeze({
  /** Up first to lay the fire. It is what the indenture is for. */
  apprentice: -minutes(30),
  /** Answers for the house, so the house waits on them. */
  head: -minutes(15),
  spouse: -minutes(15),
  child: 0,
  /** A widowed parent living in. Their age band already makes them early. */
  parent: 0,
  /** Housed without a claim: nothing is expected of them at first light. */
  dependent: minutes(15),
});

/** The largest shift in each direction, which is what validation must survive. */
function shiftBounds(shifts: Readonly<Record<string, number>>): TickRange {
  const values = Object.values(shifts);
  return { min: Math.min(0, ...values), max: Math.max(0, ...values) };
}

/**
 * Refuse a band table that could produce an incoherent day.
 *
 * The bands, the role shifts and the jitter are three independent knobs and
 * they interact: a bed time pulled twenty minutes earlier and a rise pushed
 * forty-five minutes later is a villager whose day is shorter than either knob
 * suggests. This checks the worst case of all three at once, so tuning one of
 * them cannot quietly produce somebody who goes to bed before getting up.
 */
export function validateRoutineBands(
  bands: readonly RoutineBand[],
  shifts: Readonly<Record<string, number>> = ROUTINE_ROLE_SHIFTS,
  jitter: number = ROUTINE_JITTER,
): readonly RoutineBand[] {
  assert(bands.length > 0, 'routine bands must not be empty');
  assert(Number.isSafeInteger(jitter) && jitter >= 0, 'jitter must be a non-negative whole number', {
    jitter,
  });

  const shift = shiftBounds(shifts);
  let previousMaxAge = -1;

  for (const band of bands) {
    assert(band.name.length > 0, 'a routine band needs a name');
    assert(
      Number.isSafeInteger(band.maxAge) && band.maxAge > previousMaxAge,
      'routine bands must be in ascending age order and must not overlap',
      { band: band.name, maxAge: band.maxAge, previousMaxAge },
    );
    previousMaxAge = band.maxAge;

    for (const [what, range] of [
      ['rise', band.rise],
      ['bed', band.bed],
    ] as const) {
      assert(range.max >= range.min, `a ${what} range ends before it starts`, { band: band.name });
      assert(
        Number.isSafeInteger(range.min) && Number.isSafeInteger(range.max),
        `a ${what} range must be whole ticks`,
        { band: band.name, range },
      );
    }

    // The earliest anybody in this band can possibly rise, and the latest
    // anybody can possibly turn in. Both must stay inside one day: a rise
    // before midnight or a bed after it would wrap, and the whole model rests
    // on the waking window not wrapping.
    const earliestRise = band.rise.min + shift.min - jitter;
    const latestBed = band.bed.max + jitter;
    assert(earliestRise >= 0, 'a band lets somebody rise before midnight', {
      band: band.name,
      earliestRise,
    });
    assert(latestBed < TICKS_PER_DAY, 'a band lets somebody turn in after midnight', {
      band: band.name,
      latestBed,
    });

    // The worst case that matters: rise pushed as late as it goes, bed pulled
    // as early as it goes.
    const latestRise = band.rise.max + shift.max + jitter;
    const earliestBed = band.bed.min - jitter;
    assert(
      earliestBed - latestRise >= MIN_WAKING_TICKS,
      'a band could leave somebody awake for less than the minimum',
      {
        band: band.name,
        latestRise,
        earliestBed,
        waking: earliestBed - latestRise,
        minimum: MIN_WAKING_TICKS,
      },
    );
  }

  assert(
    (bands[bands.length - 1] as RoutineBand).maxAge >= Number.MAX_SAFE_INTEGER,
    'the last routine band must catch every age',
    { maxAge: (bands[bands.length - 1] as RoutineBand).maxAge },
  );
  return bands;
}

/** The band an age falls in. Total, because the last band catches everybody. */
export function routineBandFor(
  age: number,
  bands: readonly RoutineBand[] = DEFAULT_ROUTINE_BANDS,
): RoutineBand {
  const band = bands.find((candidate) => age <= candidate.maxAge);
  assert(band !== undefined, 'no routine band covers this age', { age });
  return band;
}

export interface GenerateRoutineOptions {
  readonly age: number;
  /** Their position in the household, in society's vocabulary. */
  readonly role?: string;
  readonly bands?: readonly RoutineBand[];
  readonly shifts?: Readonly<Record<string, number>>;
}

/**
 * Roll one villager's habit. Two draws: rise, then bed.
 *
 * The draw order is part of what a seed means, exactly as it is in
 * `generatePerson`, and `test/golden.test.ts` pins it. The role shift is
 * arithmetic on the result rather than a third draw, so giving somebody a role
 * changes their hours without shifting anybody generated after them.
 */
export function generateRoutine(rng: Rng, options: GenerateRoutineOptions): Routine {
  const bands = validateRoutineBands(
    options.bands ?? DEFAULT_ROUTINE_BANDS,
    options.shifts ?? ROUTINE_ROLE_SHIFTS,
  );
  const band = routineBandFor(options.age, bands);
  const shifts = options.shifts ?? ROUTINE_ROLE_SHIFTS;

  const rise = rng.nextIntInclusive(band.rise.min, band.rise.max);
  const bed = rng.nextIntInclusive(band.bed.min, band.bed.max);
  const shift = options.role === undefined ? 0 : (shifts[options.role] ?? 0);

  return makeRoutine({ rise: rise + shift, bed });
}

/** Build a routine, refusing a day that runs backwards. */
export function makeRoutine(routine: Routine): Routine {
  assert(
    Number.isSafeInteger(routine.rise) && routine.rise >= 0 && routine.rise < TICKS_PER_DAY,
    'a rise time must be a time of day',
    { routine },
  );
  assert(
    Number.isSafeInteger(routine.bed) && routine.bed >= 0 && routine.bed < TICKS_PER_DAY,
    'a bed time must be a time of day',
    { routine },
  );
  assert(routine.bed > routine.rise, 'nobody turns in before they get up', { routine });
  return Object.freeze({ rise: routine.rise, bed: routine.bed });
}

/**
 * Today's version of a habitual time: the habit, nudged.
 *
 * One draw from the caller's stream. Clamped to the day rather than allowed to
 * wrap, because a bed time that slid past midnight would turn the waking window
 * inside out; the clamp is the documented behaviour that sim-core rule 10 asks
 * for, and `validateRoutineBands` is what keeps it from ever being reached with
 * the shipped table.
 */
export function jitter(rng: Rng, timeOfDay: number, amount: number = ROUTINE_JITTER): number {
  const drifted = timeOfDay + rng.nextIntInclusive(-amount, amount);
  return Math.min(TICKS_PER_DAY - 1, Math.max(0, drifted));
}

/**
 * The next absolute tick at which a given time of day comes round.
 *
 * Strictly after `fromTick`, never equal to it. An event scheduled for the tick
 * it was scheduled on would fire inside the same tick, and a rise that fired
 * the instant somebody went to bed is a villager who never sleeps.
 */
export function nextTickOfDay(fromTick: Tick, timeOfDay: number): Tick {
  assert(
    Number.isSafeInteger(timeOfDay) && timeOfDay >= 0 && timeOfDay < TICKS_PER_DAY,
    'not a time of day',
    { timeOfDay },
  );
  const dayStart = divFloor(fromTick, TICKS_PER_DAY) * TICKS_PER_DAY;
  const candidate = dayStart + timeOfDay;
  return candidate > fromTick ? candidate : candidate + TICKS_PER_DAY;
}

/**
 * The same time of day, on the day after the one `fromTick` falls in.
 *
 * Not the same thing as `nextTickOfDay`, and the difference is a bug this file
 * shipped once. "The next time the bed hour comes round" is a day away only if
 * the hour has already gone by. Bedtime drifts by up to twenty minutes, so a
 * villager whose bed fired early and who then asks for the next bed hour gets
 * one *later the same evening* — and is sent home again while still walking
 * home. Where the intent is "tomorrow night", say tomorrow night.
 */
export function tickOfDayTomorrow(fromTick: Tick, timeOfDay: number): Tick {
  assert(
    Number.isSafeInteger(timeOfDay) && timeOfDay >= 0 && timeOfDay < TICKS_PER_DAY,
    'not a time of day',
    { timeOfDay },
  );
  return divFloor(fromTick, TICKS_PER_DAY) * TICKS_PER_DAY + TICKS_PER_DAY + timeOfDay;
}

/** Is this an hour they would normally be up? */
export function isWakingTime(routine: Routine, tick: Tick): boolean {
  const timeOfDay = mod(tick, TICKS_PER_DAY);
  return timeOfDay >= routine.rise && timeOfDay < routine.bed;
}
