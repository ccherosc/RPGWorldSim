import { z } from 'zod';
import type { SimEvent } from '@rpgsim/sim-core';
import type { ChronicleDay } from './day.ts';

/**
 * How newsworthy a thing that happened is.
 *
 * `significance.ts` already asked the cheap question — is this the *kind* of
 * thing worth remembering — and answered it from the type alone. This is the
 * expensive one, and it is a different question: of everything that happened
 * today, what goes at the top of the page? So it reads the event and the day
 * around it rather than a table of types, because the same event is the lead
 * story on one day and a footnote on another.
 *
 * Five things make news, and the score is their sum:
 *
 *   rarity       how unusual this kind of thing was *today*
 *   refusal      somebody wanted something and did not get it
 *   crowd        how many people it took
 *   stage        whether anybody could have seen it
 *   consequence  whether it followed from something
 *
 * **Every number here is an integer, and every one lives in
 * `data/chronicle/scoring.json`.** Integers because a score decides an order,
 * and an order that depends on the last bit of a float is an order that can
 * differ between two machines that agree about everything else — the archive is
 * reproducible byte for byte and the front page has to be too. Data because
 * directive 10 puts balance values in data: how interesting a thwarted journey
 * is relative to a crowd is an editorial opinion, and editorial opinions change
 * more often than code should.
 *
 * What it never reads is prose. Not a persona, not a template, not an event's
 * `data` payload. Rewording a headline must not silently reorder the page, and
 * the only way to be sure of that is for the score to have no access to the
 * words at all.
 */
export const ScoringSchema = z.object({
  /**
   * Divided by how many times the type happened today.
   *
   * So the only `travel.blocked` of the day scores the full amount, one of two
   * scores half, and one of four hundred and eighty-eight arrivals scores
   * nothing. Division rather than subtraction because the interesting gap is
   * between once and twice, not between four hundred and four hundred and one.
   */
  rarity: z.number().int().min(0),
  /** Event types that mean somebody was stopped. */
  refusals: z.array(z.string()),
  /**
   * What being stopped is worth.
   *
   * A thwarted intention is the most readable thing Phase 1 produces: it is the
   * only moment in an ordinary day where the village says no to somebody, and a
   * no is a story where a yes is a schedule.
   */
  refusal: z.number().int().min(0),
  /** Per actor beyond the first. Almost everything has exactly one. */
  crowd: z.number().int().min(0),
  /** The most a crowd can be worth, so a mass event cannot swamp the page. */
  crowdCap: z.number().int().min(0),
  /** Worth this much if it happened somewhere anybody could have watched. */
  stage: z.number().int().min(0),
  /** Per event this one followed from. */
  consequence: z.number().int().min(0),
  /** The most a chain of causes can be worth. */
  consequenceCap: z.number().int().min(0),
});

export type ScoringConfig = z.infer<typeof ScoringSchema>;

/** One event's score, with the reasons kept, so a `WHY?` can be answered. */
export interface Newsworthiness {
  readonly event: SimEvent;
  readonly total: number;
  readonly rarity: number;
  readonly refusal: number;
  readonly crowd: number;
  readonly stage: number;
  readonly consequence: number;
}

/**
 * Score one event against the day it happened on.
 *
 * A pure function of the config, the event and the day: no clock, no
 * filesystem, no randomness, no memory of having been called before. Two runs
 * over the same day produce the same numbers, which is what lets a front page
 * be rebuilt from scratch and come out identical.
 */
export function scoreOf(
  config: ScoringConfig,
  day: ChronicleDay,
  event: SimEvent,
): Newsworthiness {
  // At least one: this event is itself an occurrence of its own type, so the
  // count can only be zero if the event came from some other day -- in which
  // case dividing by it would be the least of the problems.
  const seen = Math.max(1, day.countOf(event.type));
  const rarity = Math.floor(config.rarity / seen);

  const refusal = config.refusals.includes(event.type) ? config.refusal : 0;

  // Beyond the first, because a village of solo errands would otherwise hand
  // every ordinary event the same bonus, and a bonus everyone gets is not one.
  const others = Math.max(0, event.actors.length - 1);
  const crowd = Math.min(config.crowdCap, config.crowd * others);

  const stage = day.isPublic(event.location) ? config.stage : 0;

  const consequence = Math.min(config.consequenceCap, config.consequence * event.causes.length);

  return {
    event,
    total: rarity + refusal + crowd + stage + consequence,
    rarity,
    refusal,
    crowd,
    stage,
    consequence,
  };
}

/**
 * Most newsworthy first; ties broken by event id, earliest first.
 *
 * The tie-break is not decoration. Scores are coarse integers over a thousand
 * events, so ties are the common case rather than the exception, and a sort
 * with no tie-break would leave the order to whatever the engine's sort happens
 * to do with equal keys. Event ids ascend with time and are unique within a
 * day, so "earliest" is both a total order and the one a reader expects: of two
 * equally interesting things, the one that happened first is the news.
 */
export function compareNewsworthiness(a: Newsworthiness, b: Newsworthiness): number {
  if (a.total !== b.total) return b.total - a.total;
  return a.event.id - b.event.id;
}

/** Every event of the day, scored and ordered. */
export function rank(config: ScoringConfig, day: ChronicleDay): readonly Newsworthiness[] {
  return day.events.map((event) => scoreOf(config, day, event)).sort(compareNewsworthiness);
}
