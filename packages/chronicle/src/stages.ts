import { z } from 'zod';
import { assert } from '@rpgsim/shared';

/**
 * The stages of a life, and where each one begins.
 *
 * One vocabulary, shared, because three different parts of the site had started
 * to need the same answer and there is only one right one. Casting asks it to
 * pick a face: nobody can tell thirty-one from thirty-four in a drawing, so the
 * portraits are sorted into stages rather than years. Wording asks it to pick a
 * voice: a villager of sixty-eight and a villager of nineteen do not wake up
 * with the same thought in their heads, and a blog where they say the same
 * things is a blog with one person in it wearing eighty-six faces.
 *
 * Those two must agree. A reader looking at a grey-haired portrait over a post
 * about being late for everything and hungry has been told two different things
 * about the same person, and the picture is the one they will believe. So the
 * stages live here and both sides import them, rather than each keeping its own
 * list that drifts a year at a time.
 *
 * Coarse on purpose, and the boundaries are a judgement rather than a fact --
 * whether a fourteen-year-old reads as a youth or a child is an opinion about
 * drawings and about what fourteen-year-olds say. So the vocabulary is fixed
 * here and the numbers live in the casting file (directive 10).
 */
export const AGE_BANDS = ['infant', 'child', 'youth', 'young', 'adult', 'older', 'elder'] as const;

export type AgeBand = (typeof AGE_BANDS)[number];

/**
 * Where one life stage begins, in whole years.
 *
 * `name` is checked against the vocabulary rather than left as free text. It
 * used to be a bare string, which meant the casting file could name a stage no
 * portrait could be sorted into and the only symptom would be a villager who
 * never got a face -- and now that wording bands on the same names, it would
 * also be a villager who never got a voice. A typo should fail on load.
 */
export const AgeBandRuleSchema = z.object({
  name: z.enum(AGE_BANDS),
  from: z.number().int().min(0),
});

export type AgeBandRule = z.infer<typeof AgeBandRuleSchema>;

/**
 * Which stage of life an age falls in.
 *
 * Holds the rules so that nothing else has to walk them, and validates them
 * once at construction: ascending, and starting at zero. Those two together are
 * what make `bandFor` total — every age from nought upwards lands in exactly one
 * stage, so there is no "unknown" band for the rest of the code to handle and no
 * gap for somebody's twelfth year to fall down.
 */
export class LifeStages {
  constructor(private readonly rules: readonly AgeBandRule[]) {
    assert(rules[0]?.from === 0, 'the first age band must start at zero', { rules });
    for (let index = 1; index < rules.length; index++) {
      assert(
        (rules[index] as AgeBandRule).from > (rules[index - 1] as AgeBandRule).from,
        'age bands must ascend, so that every age falls in exactly one',
        { at: index },
      );
    }
  }

  /** The stages in order, youngest first. */
  get names(): readonly AgeBand[] {
    return this.rules.map((rule) => rule.name);
  }

  /** Which life stage an age in whole years falls in. */
  bandFor(age: number): AgeBand {
    let name = this.rules[0]?.name as AgeBand;
    for (const rule of this.rules) {
      if (rule.from > age) break;
      name = rule.name;
    }
    return name;
  }
}
