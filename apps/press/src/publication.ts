import { z } from 'zod';
import { type CalendarConfig, DEFAULT_CALENDAR, daysPerYear } from '@rpgsim/sim-core';
import { assert } from '@rpgsim/shared';
import { capitalised, inWords } from './numbers.ts';

/**
 * Everything the site says in its own voice.
 *
 * Directive 10: a page should be improvable by somebody who has never opened a
 * TypeScript file, so every paragraph that explains the village to a reader
 * lives in `data/chronicle/publication.json`. What the generator writes itself
 * is limited to furniture -- a column heading, a link's words, a line that
 * states a count or a date it has just worked out. Nothing that could be wrong
 * about the village is written in code, because a sentence in code is a
 * sentence only a programmer can correct.
 *
 * The schema is strict about shape and silent about content. It will not accept
 * an empty heading or a section with no paragraphs, because either one renders
 * as a hole in the page that nothing else would notice; it has no opinion at
 * all about what the paragraphs say.
 */

const line = z.string().min(1);

/** A prose key the file may carry for a human reader. Stripped, never rendered. */
const NOTE = { note: z.string().optional() };

export const SiteImageSchema = z
  .object({
    /** Matches the stem of the file in `assets/site/images`, without extension. */
    name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'an image name is lowercase letters and dashes'),
    alt: line,
    caption: line,
    /**
     * The file's own pixel dimensions, printed on the `<img>`.
     *
     * Not a layout instruction -- the stylesheet decides how wide a plate is
     * drawn. These two numbers let the browser work out the picture's shape
     * before the file arrives and leave a hole of the right height for it,
     * which is the difference between a page that settles and a page where
     * every paragraph jumps down as each illustration loads.
     *
     * They are declared here rather than measured at build time so the press
     * stays a pure function of the archive and this file, and
     * `test/illustrations.test.ts` reads the real files and fails if either
     * number drifts from the image it describes.
     */
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    ...NOTE,
  })
  .strip();

export type SiteImage = z.infer<typeof SiteImageSchema>;

export const SectionSchema = z
  .object({
    heading: line,
    body: z.array(line).min(1),
    /** An illustration to set beside the section. Must name one of `images`. */
    image: z.string().optional(),
    ...NOTE,
  })
  .strip();

export type Section = z.infer<typeof SectionSchema>;

export const PageSchema = z
  .object({
    title: line,
    lead: line,
    sections: z.array(SectionSchema).default([]),
    ...NOTE,
  })
  .strip();

export type Page = z.infer<typeof PageSchema>;

export const PublicationSchema = z
  .object({
    masthead: line,
    tagline: line,
    /** The village's own first day. Everything before it does not exist. */
    firstVillageDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /**
     * The real-world date the site first went up.
     *
     * Printed on the about page, and the anchor the publishing schedule counts
     * from -- see `schedule.ts`. Moving it moves the whole archive, so it is
     * written once and left alone.
     */
    firstPublished: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /**
     * How many village days the archive held on `firstPublished`.
     *
     * The village was a month old before anybody could read about it. Without
     * this number the publisher would have to assume the site went up on the
     * village's first morning, and every rebuild would print a shorter history
     * than the last one.
     */
    daysAtFirstPublished: z.number().int().positive(),
    /**
     * The last village day the site is allowed to publish, or null for all of
     * them. A held-back archive is how a day gets read before it is shipped.
     */
    frozenThrough: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    images: z.array(SiteImageSchema).min(1),
    pages: z.object({
      home: PageSchema,
      towne: PageSchema,
      people: PageSchema,
      paper: PageSchema,
      blog: PageSchema,
      about: PageSchema,
    }),
    footer: z.array(line).min(1),
    ...NOTE,
  })
  .strip();

export type PublicationConfig = z.infer<typeof PublicationSchema>;

/**
 * The prose, indexed the way the pages ask for it.
 *
 * Wraps the plain config so a missing illustration fails where it is written
 * rather than rendering an `<img>` with no file behind it. Every `image:` key in
 * the file is checked against `images` at construction, once, for all pages --
 * a typo in a section that only appears on the about page still fails the
 * build of the home page, which is the only way a rarely-read page stays right.
 */
export class Publication {
  private readonly byName: ReadonlyMap<string, SiteImage>;

  constructor(readonly config: PublicationConfig) {
    const byName = new Map<string, SiteImage>();
    for (const image of config.images) {
      assert(!byName.has(image.name), 'two illustrations share a name', { name: image.name });
      byName.set(image.name, image);
    }
    this.byName = byName;

    for (const [key, page] of Object.entries(config.pages)) {
      for (const section of page.sections) {
        if (section.image === undefined) continue;
        assert(byName.has(section.image), 'a section names an illustration that is not listed', {
          page: key,
          heading: section.heading,
          image: section.image,
        });
      }
    }
  }

  get masthead(): string {
    return this.config.masthead;
  }

  get tagline(): string {
    return this.config.tagline;
  }

  get footer(): readonly string[] {
    return this.config.footer;
  }

  page(name: keyof PublicationConfig['pages']): Page {
    return this.config.pages[name];
  }

  image(name: string): SiteImage {
    const found = this.byName.get(name);
    assert(found !== undefined, 'no such illustration', { name });
    return found as SiteImage;
  }

  /** The last village day the site may publish, or null for all of them. */
  get frozenThrough(): string | null {
    return this.config.frozenThrough;
  }

  /** Whether a day key is inside the published window. */
  publishes(key: string): boolean {
    const frozen = this.config.frozenThrough;
    if (frozen === null) return true;
    return key <= frozen;
  }

  /**
   * The same prose with the village's own counts written into it.
   *
   * Called once, before any page renders, so that every sentence on the site
   * gets its numbers from the same place on the same day. The alternative --
   * filling them in at each of the nine places a page prints a paragraph -- is
   * the same substitution written nine times, and the one that gets forgotten
   * is a page that quietly goes on stating last year's village.
   *
   * Every placeholder must be one this knows, and none may survive. A typo of
   * `{household}` for `{households}` is otherwise a word in curly brackets
   * printed in the middle of a caption, which is exactly the kind of fault a
   * build should refuse rather than ship.
   */
  counting(tally: VillageTally): Publication {
    const words: ReadonlyMap<string, string> = new Map([
      ['people', inWords(tally.people)],
      ['households', inWords(tally.households)],
      ['families', inWords(tally.families)],
    ]);

    const filled = fill(this.config, (key) => {
      const found = words.get(key.toLowerCase());
      assert(found !== undefined, 'the copy asks for a count nothing can supply', { key });
      // `{People}` opens a sentence; `{people}` sits inside one. One dial, so
      // that copy can be recased without the code having to learn a new name.
      return key[0] === key[0]?.toUpperCase() ? capitalised(found as string) : (found as string);
    }) as PublicationConfig;

    return new Publication(filled);
  }
}

/** What the record can count, for the copy that wants to say it. */
export interface VillageTally {
  /** Everybody the record holds. */
  readonly people: number;
  /** Roofs standing. Not the same number as `families`, and the site says so. */
  readonly households: number;
  /** Distinct family names among the people. */
  readonly families: number;
}

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

/**
 * Every string in a value, rewritten. Objects and arrays are walked into.
 *
 * Generic over the whole config rather than aimed at the four fields that hold
 * prose today, because a fifth field of prose is a thing somebody adds without
 * thinking to come back here, and a placeholder that silently does not resolve
 * is worse than one that fails loudly.
 */
function fill(value: unknown, resolve: (key: string) => string): unknown {
  if (typeof value === 'string') {
    const done = value.replace(PLACEHOLDER, (_, key: string) => resolve(key));
    assert(!/\{[^}]*\}/.test(done), 'a placeholder survived the count', { text: done });
    return done;
  }
  if (Array.isArray(value)) return value.map((one) => fill(one, resolve));
  if (value !== null && typeof value === 'object') {
    // Sorted, per determinism rule 5, and sorting is free here: everything in
    // this config whose order a reader can see is an array -- sections, body,
    // images, footer -- and arrays keep their order through `map` above. The
    // objects are fixed named fields, so their key order reaches no page.
    const fields = Object.keys(value as Record<string, unknown>).sort();
    const walked: Record<string, unknown> = {};
    for (const key of fields) walked[key] = fill((value as Record<string, unknown>)[key], resolve);
    return walked;
  }
  return value;
}

/** A village day key broken into the parts the calendar understands. */
const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function partsOf(key: string): { year: number; month: number; day: number } {
  const match = KEY.exec(key);
  assert(match !== null, 'that is not a day key', { key });
  const [, year, month, day] = match as RegExpExecArray;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

export interface VillageDate {
  /** `1200-04-30`, the key the archive and the annals both use. */
  readonly key: string;
  readonly year: number;
  readonly monthName: string;
  readonly day: number;
  readonly weekday: string;
  /** `Blossom 30, in the year of our Lord 1200` */
  readonly long: string;
  /** `Blossom 30, 1200` */
  readonly short: string;
  /** `Restday, Blossom 30, in the year of our Lord 1200` */
  readonly full: string;
  /** `spring`. What the calendar calls the time of year. */
  readonly season: string;
}

/**
 * A day key as the village would say it out loud.
 *
 * Goes through the calendar's own month list rather than formatting the key, so
 * a month renamed in `data/world/calendar.json` is renamed on every page of the
 * site at once and a key the calendar cannot place fails instead of printing
 * `04`.
 *
 * The day index is worked out here instead of by `dateTimeToTick`, which
 * refuses any year before the calendar epoch. That refusal is right for the
 * simulation -- a tick before the world began is a bug -- and wrong for the
 * site, because the village opened with people in their seventies and their
 * birthdays are forty years the other side of the epoch. So the arithmetic is
 * repeated, with the epoch check dropped and a floored modulo for the weekday
 * so a negative index still lands on a real day of the week.
 */
export function villageDate(key: string, calendar: CalendarConfig = DEFAULT_CALENDAR): VillageDate {
  const parts = partsOf(key);
  assert(parts.month >= 1 && parts.month <= calendar.months.length, 'month is outside the calendar', {
    key,
    months: calendar.months.length,
  });
  const month = calendar.months[parts.month - 1] as CalendarConfig['months'][number];
  assert(parts.day >= 1 && parts.day <= month.days, 'day is outside the month', {
    key,
    monthName: month.name,
    days: month.days,
  });

  let dayIndex = (parts.year - calendar.epochYear) * daysPerYear(calendar) + parts.day - 1;
  for (let at = 0; at < parts.month - 1; at += 1) {
    dayIndex += (calendar.months[at] as CalendarConfig['months'][number]).days;
  }

  const week = calendar.weekdayNames.length;
  const weekday = calendar.weekdayNames[((dayIndex % week) + week) % week] as string;

  const short = `${month.name} ${parts.day}, ${parts.year}`;
  const long = `${month.name} ${parts.day}, in the year of our Lord ${parts.year}`;
  return {
    key,
    year: parts.year,
    monthName: month.name,
    day: parts.day,
    weekday,
    season: month.season,
    short,
    long,
    full: `${weekday}, ${long}`,
  };
}
