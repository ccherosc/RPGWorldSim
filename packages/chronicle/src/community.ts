import { assert } from '@rpgsim/shared';
import { z } from 'zod';

/**
 * What the families are to each other.
 *
 * Twenty surnames hold eighty-six people, and worldgen drew those names from a
 * name book without meaning anything by them. Read them together, though, and
 * they fall into two halves: Brewer, Dyer, Tanner, Miller, Webb, Cooper,
 * Salter, Carter, Wheeler, Plowright, Clay and Pike are *trades*, and Netherby,
 * Underhill, Milburn, Marsh, Barrow, Hollis, Larkin and Vane are *places*. That
 * is the ordinary shape of an English village: the people who make things and
 * the people who hold land, living in one place and not quite the same kind of
 * people. Naming that split is not inventing anything — it is reading what the
 * generator already produced.
 *
 * A tie is the other half. Households are islands in Phase 1: the simulation
 * knows who lives under a roof and nothing about who owes whom. Until it does,
 * the connections between houses are written down here — declared, dated, and
 * visible — so the paper can lean on them without pretending the simulation
 * asserted them. Two rules keep that honest:
 *
 * 1. A tie may never contradict the record. Joan Clay really is in the Barrow
 *    household as an apprentice; that is worldgen's doing, and the tie only
 *    names it. Nothing here may claim a marriage or a parentage the people file
 *    does not already carry.
 * 2. A tie is scenery, not state. It gives a villager something to post about.
 *    It never moves a person, a coin or an object, because directive 13 says no
 *    feature may bypass the economy or the spatial model, and a debt that the
 *    economy has never heard of is exactly that.
 *
 * When Phase 2 gives the simulation relationships of its own, the ties it
 * emits become events, and this file shrinks to whatever the simulation still
 * does not model.
 */

/** A family that works at something, or a family that is from somewhere. */
export const FAMILY_KINDS = ['trade', 'land'] as const;

export const FamilySchema = z.object({
  /** The surname as the record spells it, lowercased: the people file's family column. */
  family: z.string().min(1),
  /** How the name reads: `trade` for Brewer and Dyer, `land` for Netherby and Marsh. */
  kind: z.enum(FAMILY_KINDS),
  /** The work the name implies, where it implies one. Not simulated until Phase 3. */
  trade: z.string().min(1).nullable().default(null),
  /** Where they sit in the village, in one line. */
  standing: z.string().min(1),
  /**
   * What the family is known for.
   *
   * Written from the traits its members actually rolled, not from the surname.
   * The Barrows are two houses with opposite reputations because Walter Barrow
   * scored seventeen for honesty and Winifred Barrow eighty-five for
   * sociability, and a reputation that ignored that would be contradicted by
   * the first thing either of them did.
   */
  reputation: z.string().min(1),
});

export type Family = z.infer<typeof FamilySchema>;

/**
 * The kinds of connection between two people.
 *
 * `kin` and `marriage` may only restate what the record already holds.
 * The rest are village texture: who drinks with whom, who is not speaking.
 */
export const TIE_KINDS = [
  'kin',
  'marriage',
  'apprentice',
  'friendship',
  'rivalry',
  'courtship',
  'debt',
  'grudge',
] as const;

export type TieKind = (typeof TIE_KINDS)[number];

export const TieSchema = z.object({
  kind: z.enum(TIE_KINDS),
  /** Two slugs. Order is meaningful only where the kind makes it so. */
  between: z.tuple([z.string().min(1), z.string().min(1)]),
  /** One line a reader could be told without further explanation. */
  note: z.string().min(1),
});

export type Tie = z.infer<typeof TieSchema>;

export const CommunitySchema = z.object({
  village: z.string().min(1),
  families: z.array(FamilySchema).min(1),
  ties: z.array(TieSchema),
});

export type CommunityConfig = z.infer<typeof CommunitySchema>;

/** The families and the ties, indexed for the two questions anybody asks of them. */
export class Community {
  private readonly byFamily = new Map<string, Family>();
  private readonly bySlug = new Map<string, Tie[]>();
  private readonly order: readonly Tie[];

  constructor(config: CommunityConfig) {
    for (const family of config.families) {
      assert(!this.byFamily.has(family.family), 'that family is listed twice', {
        family: family.family,
      });
      this.byFamily.set(family.family, family);
    }
    this.order = config.ties;
    for (const tie of config.ties) {
      const [one, other] = tie.between;
      assert(one !== other, 'a tie joins two different people', { tie: tie.note });
      for (const slug of [one, other]) {
        const held = this.bySlug.get(slug);
        if (held === undefined) this.bySlug.set(slug, [tie]);
        else held.push(tie);
      }
    }
  }

  get familyCount(): number {
    return this.byFamily.size;
  }

  get tieCount(): number {
    return this.order.length;
  }

  families(): readonly Family[] {
    return [...this.byFamily.keys()].sort().map((name) => this.byFamily.get(name) as Family);
  }

  findFamily(family: string): Family | undefined {
    return this.byFamily.get(family);
  }

  /** Everything this person is tied by, in the order the file lists them. */
  tiesFor(slug: string): readonly Tie[] {
    return this.bySlug.get(slug) ?? [];
  }

  /** Every slug any tie names, so it can be checked against the people file. */
  slugsNamed(): readonly string[] {
    return [...this.bySlug.keys()].sort();
  }

  /**
   * Ties pointing at somebody who does not exist.
   *
   * A tie to a misspelled slug is invisible at a glance and silently halves a
   * relationship — the one end that spells it right still shows it. Checking at
   * load is the only place it is cheap to catch.
   */
  strayFor(slugs: readonly string[]): readonly string[] {
    const known = new Set(slugs);
    return this.slugsNamed().filter((slug) => !known.has(slug));
  }
}
