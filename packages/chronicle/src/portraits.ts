import { assert } from '@rpgsim/shared';
import { z } from 'zod';
import { AGE_BANDS, type AgeBand } from './stages.ts';

/**
 * The faces the village is drawn with.
 *
 * Portraits arrive as sheets: forty cells to a sheet, eight lettered rows by
 * five numbered columns, and each cell carries the label that is printed on the
 * sheet itself. So a portrait's id is `P04-C3` — the sheet it came on and the
 * square it sits in — and anybody holding the image can find the one the data
 * is talking about by eye, without a lookup table or a filename convention.
 *
 * That choice is what makes the collection additive. One file per sheet, named
 * for the sheet; a new sheet is a new file and is never a change to an existing
 * one. Numbering the portraits 1..240 instead would have been tidier to read
 * and catastrophic to grow: inserting a sheet would renumber everything after
 * it, and every id already written into a casting file would then point at
 * somebody else's face. Sheet-plus-cell ids cannot collide and cannot shift.
 *
 * What a cell records is what can be seen in it — apparent sex, apparent age,
 * the look, the mood, what they are holding, where they are standing. It is
 * deliberately *not* a person. A portrait is an unclaimed face until a casting
 * file claims it, and the same sheet serves whatever village needs it.
 */

/** `P04-C3`: a sheet, a lettered row, a numbered column. */
export const PORTRAIT_ID = /^(P\d{2})-([A-H])([1-5])$/;

/** As drawn, not as recorded. A portrait can only be sorted by what it shows. */
export const PORTRAIT_SEXES = ['m', 'f'] as const;
export type PortraitSex = (typeof PORTRAIT_SEXES)[number];

export const PortraitCellSchema = z.object({
  sex: z.enum(PORTRAIT_SEXES),
  band: z.enum(AGE_BANDS),
  /** The face in one line, for a caption and for choosing between two of them. */
  look: z.string().min(1),
  /** The expression they were caught wearing. */
  mood: z.string().min(1),
  /** Anything held or accompanying: a goat, a spindle, a crab. */
  props: z.array(z.string().min(1)).default([]),
  /** Where they appear to be standing: forge, riverside, orchard, indoors. */
  setting: z.string().min(1),
});

export type PortraitCell = z.infer<typeof PortraitCellSchema>;

export const PortraitAtlasSchema = z.object({
  /** `P04`. Must match the cell ids this sheet yields and, by habit, the filename. */
  atlas: z.string().regex(/^P\d{2}$/),
  /** A note to whoever opens the file wondering what it is. */
  source: z.string().min(1),
  cells: z.record(z.string().regex(/^[A-H][1-5]$/), PortraitCellSchema),
});

export type PortraitAtlas = z.infer<typeof PortraitAtlasSchema>;

/** A cell with its full id attached, which is how everything downstream wants it. */
export interface Portrait extends PortraitCell {
  readonly id: string;
  readonly atlas: string;
}

/**
 * Every sheet, merged, and the only thing that answers "what does `P04-C3` look
 * like".
 *
 * Built from parsed atlases rather than from paths: determinism rule 4 keeps
 * file reads out of everything downstream of the app, and the same rule that
 * makes the chronicle take its significance weights as an argument applies here.
 */
export class PortraitCatalog {
  private readonly byId = new Map<string, Portrait>();
  private readonly order: Portrait[] = [];

  constructor(atlases: readonly PortraitAtlas[]) {
    // Sheets are merged in the order given and the order is then frozen into
    // `order`, which every listing and every proposal iterates. Determinism
    // rule 5 forbids leaning on a Map's insertion order for anything that feeds
    // a result, so callers hand these over sorted and this keeps them that way.
    for (const atlas of atlases) {
      for (const cell of Object.keys(atlas.cells).sort()) {
        const id = `${atlas.atlas}-${cell}`;
        assert(!this.byId.has(id), 'two atlases claim the same portrait', { id });
        const portrait: Portrait = {
          ...(atlas.cells[cell] as PortraitCell),
          id,
          atlas: atlas.atlas,
        };
        this.byId.set(id, portrait);
        this.order.push(portrait);
      }
    }
  }

  get size(): number {
    return this.order.length;
  }

  /** Every portrait, sheet by sheet, cell by cell. */
  all(): readonly Portrait[] {
    return this.order;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  find(id: string): Portrait | undefined {
    return this.byId.get(id);
  }

  /**
   * The portrait with this id, or an error naming it.
   *
   * Throws rather than returning a blank face. A casting file pointing at a
   * sheet nobody has added yet is a typo or a missing file, and both are worth
   * hearing about at load time instead of discovering as a hole on the page.
   */
  require(id: string): Portrait {
    const portrait = this.byId.get(id);
    assert(portrait !== undefined, 'no portrait has that id', { id });
    return portrait as Portrait;
  }

  /** Everyone on the sheets who could pass for this sex and life stage. */
  matching(sex: PortraitSex, band: AgeBand): readonly Portrait[] {
    return this.order.filter((portrait) => portrait.sex === sex && portrait.band === band);
  }

  /** How many faces exist per sex and life stage — the supply side of casting. */
  tally(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const portrait of this.order) {
      const key = `${portrait.band}/${portrait.sex}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }
}

/** Split `P04-C3` into its sheet and cell, or fail saying what was wrong. */
export function parsePortraitId(id: string): { atlas: string; cell: string } {
  const match = PORTRAIT_ID.exec(id);
  assert(match !== null, 'not a portrait id, expected something like P04-C3', { id });
  const [, atlas, row, column] = match as RegExpExecArray;
  return { atlas: atlas as string, cell: `${row as string}${column as string}` };
}
