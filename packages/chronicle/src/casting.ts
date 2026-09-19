import { assert } from '@rpgsim/shared';
import { z } from 'zod';
import { type PersonRecord, yearsBetween } from './people.ts';
import { type PortraitCatalog, type PortraitSex, PORTRAIT_ID } from './portraits.ts';
import { type AgeBand, AgeBandRuleSchema, LifeStages } from './stages.ts';

/**
 * Who wears which face.
 *
 * Casting is keyed by **slug**, not by entity id. The slug is what the annals
 * and the blog call somebody — `jocelin-netherby` — and it is a pure function of
 * their name, so it survives the archive being deleted and rebuilt. Entity ids
 * are an artefact of the order worldgen happened to run in; keying on one would
 * mean that regenerating the world, or inserting a system that allocates an id
 * earlier, silently handed every villager a stranger's face.
 *
 * A casting, once made, is a promise to the reader. Somebody who has been
 * looking at Winifred Barrow for a month knows that face; changing it makes her
 * a different woman. So this file is checked in, it is edited deliberately, and
 * nothing in the code reshuffles it — the proposal helper only ever fills
 * blanks, and never touches a slug that already has an answer.
 *
 * The one thing that legitimately changes a face is **time**. A child cast in
 * 1200 is not a child in 1212. So an entry is a list of takes, each dated from
 * the day it applies; a bare string is shorthand for the common case, "this
 * face, from the beginning". Allowing the list now costs one union in the
 * schema and means the first villager to grow up is an edit to one line rather
 * than a migration of the whole file.
 */

export const CastingTakeSchema = z.object({
  /** `1212-01-01`. The first day this face is the right one. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  portrait: z.string().regex(PORTRAIT_ID),
});

export type CastingTake = z.infer<typeof CastingTakeSchema>;

const CastingEntrySchema = z.union([
  z.string().regex(PORTRAIT_ID),
  z.array(CastingTakeSchema).min(1),
]);

export const CastingSchema = z.object({
  /** Ascending, starting at zero, so every age falls in exactly one band. */
  bands: z.array(AgeBandRuleSchema).min(1),
  cast: z.record(z.string().min(1), CastingEntrySchema),
});

export type CastingConfig = z.infer<typeof CastingSchema>;

/** A person who has no face yet, and what kind of face would fit them. */
export interface UncastPerson {
  readonly slug: string;
  readonly name: string;
  readonly sex: PortraitSex;
  readonly band: string;
}

/** A face that was cast onto somebody it does not look like. */
export interface CastingMismatch {
  readonly slug: string;
  readonly portrait: string;
  readonly wanted: string;
  readonly got: string;
}

/** More people of one kind than there are faces for them. */
export interface CastingShortage {
  readonly band: string;
  readonly sex: PortraitSex;
  readonly needed: number;
  readonly available: number;
}

export interface CastingReport {
  readonly cast: number;
  readonly uncast: readonly UncastPerson[];
  readonly unused: readonly string[];
  readonly mismatched: readonly CastingMismatch[];
  readonly shortages: readonly CastingShortage[];
}

/**
 * The casting file, in memory.
 *
 * Holds no people and no portraits: it is the join between two things that are
 * each meaningful without it, which is why it can be rebuilt by hand from a
 * text editor if it is ever lost.
 */
export class Casting {
  private readonly takes = new Map<string, readonly CastingTake[]>();
  /**
   * The life stages this casting sorts faces into.
   *
   * Public because a face is not the only thing a stage decides. The wording
   * books band on the same stages, and the press reads them off here so that
   * the boundaries are set once, in the casting file, for both.
   */
  readonly stages: LifeStages;

  constructor(config: CastingConfig) {
    this.stages = new LifeStages(config.bands);
    // Stored in file order; `slugs()` is what promises an order to callers.
    for (const [slug, raw] of Object.entries(config.cast)) {
      const entry = raw as string | CastingTake[];
      const takes = typeof entry === 'string' ? [{ from: '0000-00-00', portrait: entry }] : entry;
      assertAscending(slug, takes);
      this.takes.set(slug, takes);
    }
  }

  get size(): number {
    return this.takes.size;
  }

  /** Everybody who has been cast, in slug order. */
  slugs(): readonly string[] {
    return [...this.takes.keys()].sort();
  }

  /**
   * The face this person wears on a given day.
   *
   * The latest take dated at or before the day, because a take says "from
   * here onward" and the newest such statement wins. An uncast slug gets
   * `undefined` rather than a throw: a village acquires people faster than
   * somebody can draw them, and a newborn with no portrait yet should read as
   * a missing picture on the page, not a crash in the publisher.
   */
  portraitFor(slug: string, on: string): string | undefined {
    const takes = this.takes.get(slug);
    if (takes === undefined) return undefined;
    let chosen: string | undefined;
    for (const take of takes) {
      if (take.from > on) break;
      chosen = take.portrait;
    }
    return chosen;
  }

  /** Every portrait id this file points at, whatever the date. */
  portraitsUsed(): readonly string[] {
    const used = new Set<string>();
    for (const takes of this.takes.values()) for (const take of takes) used.add(take.portrait);
    return [...used].sort();
  }

  /** Which life stage an age in whole years falls in. */
  bandFor(age: number): AgeBand {
    return this.stages.bandFor(age);
  }

  /**
   * What is cast, what is not, what is spare, and what is simply missing.
   *
   * This is the question the whole layer exists to answer, and it is answered
   * against the people file rather than against a live world — the record is
   * the thing that survives, and a coverage check that needed a running
   * simulation could not be run by whoever is drawing the next sheet.
   */
  report(people: readonly PersonRecord[], catalog: PortraitCatalog, on: string): CastingReport {
    const uncast: UncastPerson[] = [];
    const mismatched: CastingMismatch[] = [];
    const wantedCounts = new Map<string, number>();
    let cast = 0;

    for (const person of [...people].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))) {
      const sex = portraitSexOf(person.sex);
      const band = this.bandFor(yearsBetween(person.born, on));
      const id = this.portraitFor(person.slug, on);
      if (id === undefined) {
        uncast.push({ slug: person.slug, name: person.name, sex, band });
        const key = `${band}/${sex}`;
        wantedCounts.set(key, (wantedCounts.get(key) ?? 0) + 1);
        continue;
      }
      cast++;
      const portrait = catalog.require(id);
      if (portrait.sex !== sex || portrait.band !== band) {
        mismatched.push({
          slug: person.slug,
          portrait: id,
          wanted: `${band}/${sex}`,
          got: `${portrait.band}/${portrait.sex}`,
        });
      }
    }

    const used = new Set(this.portraitsUsed());
    const unused = catalog
      .all()
      .filter((portrait) => !used.has(portrait.id))
      .map((portrait) => portrait.id);

    // A shortage counts only *free* faces. Twenty child portraits with nineteen
    // already worn leave one, not twenty, and reporting the gross figure would
    // cheerfully claim there is room for twenty more children.
    const free = new Map<string, number>();
    for (const id of unused) {
      const portrait = catalog.require(id);
      const key = `${portrait.band}/${portrait.sex}`;
      free.set(key, (free.get(key) ?? 0) + 1);
    }
    const shortages: CastingShortage[] = [];
    for (const key of [...wantedCounts.keys()].sort()) {
      const needed = wantedCounts.get(key) as number;
      const available = free.get(key) ?? 0;
      if (available >= needed) continue;
      const [band, sex] = key.split('/') as [string, PortraitSex];
      shortages.push({ band, sex, needed, available });
    }

    return { cast, uncast, unused, mismatched, shortages };
  }

  /**
   * Fill the blanks, and only the blanks.
   *
   * Hands each uncast person the first free portrait that matches their sex and
   * life stage, taking people in slug order and portraits in sheet order so the
   * answer depends on nothing but the inputs. Anybody already cast is left
   * exactly as they are, and anybody with no matching face left is skipped and
   * shows up in the report instead of being given a wrong one.
   */
  propose(
    people: readonly PersonRecord[],
    catalog: PortraitCatalog,
    on: string,
  ): ReadonlyMap<string, string> {
    const taken = new Set(this.portraitsUsed());
    const proposals = new Map<string, string>();
    for (const person of [...people].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))) {
      if (this.portraitFor(person.slug, on) !== undefined) continue;
      const sex = portraitSexOf(person.sex);
      const band = this.bandFor(yearsBetween(person.born, on));
      const free = catalog.matching(sex, band).find((portrait) => !taken.has(portrait.id));
      if (free === undefined) continue;
      taken.add(free.id);
      proposals.set(person.slug, free.id);
    }
    return proposals;
  }
}

/**
 * The people file says `male` and `female`; a sheet of drawings says `m` and
 * `f`. Translate at the seam, and refuse anything else.
 *
 * Refusing matters more than it looks. Guessing — treating an unrecognised
 * value as male, say — would cast somebody wrong and the only symptom would be
 * a face on a page that nobody thought to check against the record.
 */
export function portraitSexOf(sex: string): PortraitSex {
  const value = sex.trim().toLowerCase();
  if (value === 'm' || value === 'male') return 'm';
  if (value === 'f' || value === 'female') return 'f';
  assert(false, 'the casting layer does not know that sex', { sex });
}

function assertAscending(slug: string, takes: readonly CastingTake[]): void {
  for (let index = 1; index < takes.length; index++) {
    assert(
      (takes[index] as CastingTake).from > (takes[index - 1] as CastingTake).from,
      'a casting entry lists its takes out of order',
      { slug },
    );
  }
}
