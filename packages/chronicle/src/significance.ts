import { z } from 'zod';

/**
 * What the village bothers to remember.
 *
 * A Phase 1 day is about 1,250 events for 86 villagers, and nearly all of them
 * are mechanics: woke, set out, arrived, went to bed. Keeping every one forever
 * is roughly 80 MB of JSONL a simulated year, which is not a memory — it is a
 * transcript nobody will ever read.
 *
 * So the annals keep a filtered line and the filter is a number per event type,
 * in `data/chronicle/significance.json`, because CLAUDE.md directive 10 puts
 * balance values in data. The alternative is a `switch` in the chronicle that
 * grows a case every time somebody has an opinion about what is interesting,
 * and opinions about what is interesting change far more often than code should.
 *
 * The weights are deliberately coarse. They are not a newsworthiness score —
 * that is slice 4's job and it reads the event, not just its type. This is the
 * cheaper question asked first: is this the kind of thing a village would still
 * be talking about next year?
 */
export const SignificanceSchema = z.object({
  /** A weight at or above this is written to the annals. Below it is forgotten. */
  threshold: z.number().int().min(0),
  /**
   * The weight of an event type the file does not mention.
   *
   * Zero on purpose: a new event type is forgotten until somebody decides it
   * matters. The opposite default would mean every system added in Phase 2
   * silently started filling the permanent record with its own internals.
   */
  default: z.number().int().min(0),
  weights: z.record(z.string(), z.number().int().min(0)),
});

export type SignificanceConfig = z.infer<typeof SignificanceSchema>;

export function weightOf(config: SignificanceConfig, type: string): number {
  const weight = config.weights[type];
  return weight === undefined ? config.default : weight;
}

/** Does an event of this type earn a line in the annals? */
export function isNotable(config: SignificanceConfig, type: string): boolean {
  return weightOf(config, type) >= config.threshold;
}
