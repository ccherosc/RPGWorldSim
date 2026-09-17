import { assert } from '@rpgsim/shared';
import { z } from 'zod';

/**
 * Where names come from.
 *
 * CHRONICLE.md is the reason this is slice 3 and not polish: readers will follow
 * this village through the villagers' own posts, and nobody follows `npc:42`.
 * A name is the handle every later system hangs off — a byline, a headline, a
 * classified advertisement, a grudge remembered three years on.
 *
 * The names themselves are data (`data/world/names.json`), per directive 10, so
 * a second culture is a second file rather than a second code path. This module
 * defines the shape and validates it; it never reads the file, because
 * determinism rule 4 forbids simulation code from touching the filesystem. The
 * app loads it and passes it in.
 */
export const NameBookSchema = z
  .object({
    /** Culture tag, stored on every person generated from this book. */
    culture: z.string().min(1),
    /** Free-text note for whoever edits the file. Ignored by the simulation. */
    note: z.string().optional(),
    given: z.object({
      male: z.array(z.string().min(1)).min(1),
      female: z.array(z.string().min(1)).min(1),
    }),
    family: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type NameBook = z.infer<typeof NameBookSchema>;

/**
 * Parse and check a name book.
 *
 * Duplicates are refused rather than tolerated. A repeated name is not a
 * weighting choice anyone made on purpose — it is a paste error — and letting it
 * through would silently double that name's frequency in the village, which is
 * exactly the kind of quiet wrongness sim-core rule 10 is about. Refusing at
 * load means the file is checked once, at the edge, rather than suspected
 * forever.
 *
 * Order is *not* normalised. The list order is an input to generation, so
 * sorting it here would change every world built from an existing seed.
 */
export function makeNameBook(raw: unknown): NameBook {
  const book = NameBookSchema.parse(raw);
  requireDistinct(book.given.male, 'male given names');
  requireDistinct(book.given.female, 'female given names');
  requireDistinct(book.family, 'family names');
  return Object.freeze({
    culture: book.culture,
    ...(book.note !== undefined ? { note: book.note } : {}),
    given: Object.freeze({
      male: Object.freeze([...book.given.male]),
      female: Object.freeze([...book.given.female]),
    }),
    family: Object.freeze([...book.family]),
  }) as NameBook;
}

function requireDistinct(names: readonly string[], what: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    assert(!seen.has(name), `${what} contains a duplicate`, { duplicate: name, list: what });
    seen.add(name);
  }
}
