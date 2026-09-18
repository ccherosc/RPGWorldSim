import { assert } from '@rpgsim/shared';
import { z } from 'zod';

/**
 * How a villager comes across — and why it lives here rather than in the
 * simulation.
 *
 * A person in `@rpgsim/npc` carries a name, a sex, a birth date, a culture,
 * twelve traits scored nought to a hundred, a household and a home. That is
 * all. There is no backstory field, no appearance, no habit, no turn of phrase,
 * and there should not be: those are not things the simulation reads, and every
 * value it *does* read is pinned by a golden hash. `TRAIT_NAMES` fixes the
 * order the generator draws in, so adding a thirteenth trait or nudging a
 * twelfth would rewrite every person in every world built from an existing
 * seed. The traits are the ground truth and they are not up for editing.
 *
 * So a persona is a *reading* of a person, not a replacement for one. Everything
 * in it must be derivable from what the simulation already decided: Walter
 * Barrow's honesty is seventeen, his empathy eighteen, his generosity twelve,
 * and the persona's job is to say what a man like that looks like across a
 * fence. Nothing here may contradict the numbers, because the numbers are what
 * will eventually drive behaviour — the slice after the paper — and a blog whose
 * characterisation disagreed with the simulation's own choices would read as
 * broken the first time somebody acted out of character.
 *
 * Everything here is press-side. The simulation never imports it, never reads
 * it, and runs identically whether or not the file exists.
 */

export const PersonaSchema = z.object({
  /**
   * The portrait, reconciled with the person.
   *
   * Written to be true of both the drawing and the record. This is the only
   * place the two are allowed to meet, and it is where the licence to "tweak"
   * gets spent: a face that reads older than the birth date says is explained
   * here — tanning ages a man — rather than by changing either source.
   */
  look: z.string().min(1),
  /** How they talk: length, warmth, what they will and will not say out loud. */
  voice: z.string().min(1),
  /**
   * The giveaway.
   *
   * One observable thing that betrays what they are actually feeling, so that a
   * post can show a trait instead of announcing it. A tell is the smallest
   * usable unit of character and the one a reader remembers.
   */
  tell: z.string().min(1),
  /** What they reliably do, given the chance. The propensities, in plain words. */
  habits: z.array(z.string().min(1)).min(1),
  /** What they would bother to post about. */
  cares: z.array(z.string().min(1)).min(1),
  /** Their work, where the family has one. Not simulated until Phase 3. */
  trade: z.string().min(1).nullable().default(null),
});

export type Persona = z.infer<typeof PersonaSchema>;

export const PersonaBookSchema = z.object({
  personas: z.record(z.string().min(1), PersonaSchema),
});

export type PersonaBookConfig = z.infer<typeof PersonaBookSchema>;

/**
 * The personas, keyed by slug.
 *
 * Keyed the same way the casting is, and for the same reason: the slug is what
 * the blog prints and it is a pure function of a name, so it survives a
 * rebuild. Two files keyed alike can be checked against each other, which is
 * what `missingFor` is for.
 */
export class PersonaBook {
  private readonly bySlug = new Map<string, Persona>();

  constructor(config: PersonaBookConfig) {
    // Stored in whatever order the file held them. Every read that exposes an
    // order sorts, so sorting here as well would be a second guarantee of the
    // same thing -- and a second place for it to silently stop being true.
    for (const [slug, persona] of Object.entries(config.personas)) {
      this.bySlug.set(slug, persona);
    }
  }

  get size(): number {
    return this.bySlug.size;
  }

  slugs(): readonly string[] {
    return [...this.bySlug.keys()].sort();
  }

  find(slug: string): Persona | undefined {
    return this.bySlug.get(slug);
  }

  /**
   * The persona for somebody who must have one.
   *
   * Throws, because the caller that needs a voice cannot invent one. A villager
   * with no persona should be caught by `missingFor` at load, not discovered
   * halfway through composing a post.
   */
  require(slug: string): Persona {
    const persona = this.bySlug.get(slug);
    assert(persona !== undefined, 'no persona has been written for that person', { slug });
    return persona as Persona;
  }

  /** Which of these people still have no persona, in slug order. */
  missingFor(slugs: readonly string[]): readonly string[] {
    return [...slugs].filter((slug) => !this.bySlug.has(slug)).sort();
  }

  /** Personas written for somebody the record has never heard of: a typo, usually. */
  strayFor(slugs: readonly string[]): readonly string[] {
    const known = new Set(slugs);
    return this.slugs().filter((slug) => !known.has(slug));
  }
}
