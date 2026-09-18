import { z } from 'zod';
import { assert } from '@rpgsim/shared';
import {
  type CalendarConfig,
  DEFAULT_CALENDAR,
  type EntityId,
  Rng,
  type SimEvent,
  type SimEventId,
  type Tick,
  dateTimeToTick,
  tickToDateTime,
} from '@rpgsim/sim-core';
import type { ChronicleDay } from './day.ts';
import type { Newsworthiness } from './score.ts';
import {
  TemplateSchema,
  type WordingContext,
  eligible,
  listOf,
  namesOf,
  placeOf,
  render,
} from './wording.ts';

/**
 * The Towne Publication: one page a day, in the third person.
 *
 * The blog is depth — five villagers, each of whom may only speak about what
 * they personally lived through. This is breadth: what the whole village would
 * know by evening, read off the same events, with no first person anywhere in
 * it. Four sections, each omitted when it has nothing to say, because an empty
 * heading is a newspaper pretending.
 *
 * **Who writes it.** Nobody, yet, and that is stated in the colophon rather than
 * papered over with a byline. This matters for directive 5. A post has an author
 * and therefore has to pass the presence test in `witness.ts`; the paper has no
 * author, so there is no person whose knowledge it could exceed — it is the
 * record speaking, in the way a parish register speaks. The day Pennycroft
 * contains somebody who can read and write, the paper acquires an author and
 * inherits the presence rule with them, and that is a slice of its own.
 *
 * **What it may print, and the axis that turned out to be wrong.** The plan said
 * "the highest-scoring *public* events", meaning events at a location anybody
 * may walk into. Measured against thirty real days, that filter keeps exactly
 * one kind of story — somebody turned back from a full door — and throws away
 * the two most consequential things the world has ever produced: the village
 * being founded, and twenty-four households taking their cottages, both of which
 * happen indoors. Location access is the wrong axis. A household founding is a
 * public fact that happens in a private room; somebody crossing the green is a
 * private nothing that happens in the open.
 *
 * So the rule is the one the blog already uses, plus an explicit refusal.
 * Something is printable if the wording file has words for its type — editorial
 * judgement, in the place where editorial judgement can be read and changed
 * (directive 10) — and the score decides the order. On top of that,
 * `neverPrint` names the types the paper will not carry **whatever** their
 * score: waking, turning in, going to bed, failing to rest. Those happen inside
 * one person's house and concern nobody else, and the difference between "we
 * have not written words for it" and "we refuse to print it" is worth having in
 * writing. It is enforced twice on purpose — the schema rejects a book that has
 * wording for a listed type, and `writePaper` skips the type even if a caller
 * hands it one anyway — because the first is a promise about the file and the
 * second is a promise about the page.
 */

export const PaperBookSchema = z
  .object({
    /**
     * The most stories one issue may run to.
     *
     * A cap, not a target. The paper is allowed to be a paragraph long on a day
     * when a paragraph is all that happened.
     */
    maxStories: z.number().int().min(1),
    /** Types the paper refuses whatever their score. See the header. */
    neverPrint: z.array(z.string().min(1)),
    /** Wording variants, by event type. A type absent here is a type the paper cannot report. */
    wording: z.record(z.array(TemplateSchema).min(1)),
    /**
     * What the paper cannot yet tell you, and what would have to exist first.
     *
     * Prose, in a data file, for directive 10's reason and for one more: this is
     * the paper admitting its own limits, and a limit that is admitted in a
     * string in a data file is one somebody can correct without a build.
     */
    colophon: z.array(z.string().min(1)),
  })
  .superRefine((book, ctx) => {
    for (const type of book.neverPrint) {
      if (book.wording[type] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `the paper refuses to print ${type}, so it may not carry wording for it`,
          path: ['wording', type],
        });
      }
    }
  });

export type PaperBook = z.infer<typeof PaperBookSchema>;

/** One thing that happened, and how many more of its kind did. */
export interface Story {
  readonly type: string;
  readonly text: string;
  /**
   * The events the sentence is answerable to. One, today.
   *
   * One and not "every event of this kind that led the day", which is what this
   * held first and was wrong: the sentence names a person, and it is a sentence
   * about *that* refusal at *that* door. Citing a second event underneath it
   * claims support the wording does not have. The field stays plural because a
   * story that genuinely summarises several is a thing a later slice may write,
   * and a citation list that can only ever hold one is a citation list that will
   * be widened under pressure.
   */
  readonly sources: readonly SimEventId[];
  /**
   * Others of the same kind today that this one stands in for.
   *
   * A number rather than something folded into the sentence, so the page can say
   * "and fifteen more like it" without the wording having to know how to count,
   * and so a test can check the arithmetic against the day.
   */
  readonly alsoToday: number;
}

/**
 * The village in numbers, every one of them counted from something.
 *
 * Three are cumulative and counted from the record; three are counted from the
 * day's own events. Nothing here is an estimate, a running total kept in a file,
 * or a number the paper was told — which is why a test can recompute all six
 * independently and demand they agree.
 *
 * **Where the plan's letter is not kept, and the tripwire that keeps it honest.**
 * The plan said every number here must be derivable from *the day's events*.
 * Three of them are not, and cannot be: the wood exists on a day nobody walks
 * into it, so `places` has to be read off the register. The register is
 * append-only and holds the village as of the last day distilled into it — so a
 * page written the day it happens is exactly right, and a page *rebuilt* years
 * later would credit the founding day with everybody born since. Today the two
 * agree, because worldgen creates all eighty-six people and all thirty-eight
 * places on the founding day and nothing has been created since. That is a fact
 * about the simulation, not a property of this code, so a test asserts it
 * directly: no person and no place comes into existence after day one. The first
 * birth turns that test red, which is the day this needs a register scoped to
 * the day rather than a comment apologising for one that is not.
 */
export interface Glance {
  /** People the record holds. Everybody who has ever existed; nobody dies yet. */
  readonly souls: number;
  /**
   * Distinct family names among them.
   *
   * Families, not households: the record keeps the family whose roof somebody
   * was created under, and two Barrow houses both read `barrow`. See
   * `PersonRecord.family`. The plan asked for households; the record cannot
   * honestly supply that number until households are identified things, so the
   * paper prints the one it can prove and the colophon says which it is.
   */
  readonly families: number;
  readonly places: number;
  /** In bed when the day ended. */
  readonly abed: number;
  /** Journeys completed — arrivals at the place the traveller actually set out for. */
  readonly journeys: number;
  /** Journeys refused: a full room, a locked door, no road. */
  readonly refused: number;
}

export interface Paper {
  /** `1200-04-02`. */
  readonly day: string;
  readonly village: string;
  /** `Pennycroft, Blossom 2, 1200 (Midweek)`. */
  readonly dateline: string;
  /** Absent, not empty, on a day with nothing to report. */
  readonly review?: readonly Story[];
  readonly glance: Glance;
  /** Absent, not empty, if the book carries no colophon. */
  readonly colophon?: readonly string[];
}

export interface PaperOptions {
  readonly day: ChronicleDay;
  /**
   * The day's leading events, from `select`.
   *
   * Passed in rather than computed here so that there is one selection policy in
   * the project and the paper cannot come to a different view of what mattered
   * than the blog did. It also keeps `writePaper` a pure function of what it is
   * handed, with no second copy of the scoring config to drift.
   */
  readonly headlines: readonly Newsworthiness[];
  readonly book: PaperBook;
  readonly village: string;
  /** Makes the choice of wording reproducible. */
  readonly worldSeed: string;
  readonly calendar?: CalendarConfig;
}

/**
 * One day's paper.
 *
 * The review is grouped by kind before it is worded, which is not decoration: on
 * an ordinary day in Pennycroft the two leading events are both somebody turned
 * back from the same full smithy, and ungrouped that is the same sentence
 * printed twice. Grouping turns it into one story that knows how many.
 */
export function writePaper(options: PaperOptions): Paper {
  const { book, day, village } = options;
  const review = reviewOf(options);
  const colophon = book.colophon;

  return {
    day: day.key,
    village,
    dateline: datelineOf(village, day.key, options.calendar ?? DEFAULT_CALENDAR),
    ...(review.length > 0 ? { review } : {}),
    glance: glanceOf(day),
    ...(colophon.length > 0 ? { colophon } : {}),
  };
}

/**
 * The day in review: the leading events, grouped by kind, in merit order.
 *
 * Merit order rather than chronological, unlike a post — a front page leads with
 * what mattered, and the day's shape is what the blog is for.
 */
export function reviewOf(options: PaperOptions): readonly Story[] {
  const { book, day, headlines } = options;
  const refused = new Set(book.neverPrint);
  const context = thirdPerson(day);
  const rng = Rng.forStream(options.worldSeed, `paper:${day.key}`);

  // Grouped in the order the types first lead, which is merit order, because
  // `headlines` arrives sorted and a Map keeps its insertion order.
  const grouped = new Map<string, SimEvent[]>();
  for (const headline of headlines) {
    const { event } = headline;
    if (refused.has(event.type)) continue;
    const held = grouped.get(event.type);
    if (held === undefined) grouped.set(event.type, [event]);
    else held.push(event);
  }

  const stories: Story[] = [];
  for (const [type, leads] of grouped) {
    if (stories.length >= book.maxStories) break;
    const lead = leads[0] as SimEvent;
    const variants = eligible(book.wording[type] ?? [], lead, context);
    // No words for it is not a failure, it is the filter working: a type the
    // file has nothing to say about is a type the paper does not report.
    if (variants.length === 0) continue;
    stories.push({
      type,
      text: render(rng.pick(variants).text, lead, context),
      sources: [lead.id],
      alsoToday: Math.max(0, day.countOf(type) - 1),
    });
  }
  return stories;
}

/** Every number in "the village at a glance", counted rather than remembered. */
export function glanceOf(day: ChronicleDay): Glance {
  const families = new Set<string>();
  for (const person of day.people.records()) {
    if (person.family !== null) families.add(person.family);
  }

  return {
    souls: day.people.size,
    families: families.size,
    places: day.places.size,
    abed: abedAtEndOf(day),
    journeys: day.byType(ARRIVED).filter((event) => dataOf(event)['final'] === true).length,
    refused: day.countOf(BLOCKED),
  };
}

const ARRIVED = 'travel.arrived';
const BLOCKED = 'travel.blocked';
const WOKE = 'npc.woke';
const ABED = 'npc.went-to-bed';

/**
 * How many were in bed when the day ended.
 *
 * Their last going-to-bed against their last waking, which is the only honest
 * way to ask it: the state is not in any event, it is in the gap between two of
 * them. Somebody who never woke today and went to bed is abed; somebody who woke
 * after their last bedtime is up, whatever hour it is.
 */
function abedAtEndOf(day: ChronicleDay): number {
  const lastUp = new Map<EntityId, Tick>();
  for (const event of day.byType(WOKE)) {
    for (const actor of event.actors) lastUp.set(actor, event.tick);
  }

  const down = new Map<EntityId, Tick>();
  for (const event of day.byType(ABED)) {
    for (const actor of event.actors) down.set(actor, event.tick);
  }

  let abed = 0;
  for (const [actor, tick] of down) {
    const up = lastUp.get(actor);
    if (up === undefined || up < tick) abed++;
  }
  return abed;
}

/**
 * The words the paper can supply that a post cannot, and the one it will not.
 *
 * `who` is everybody the event names, which is exactly what a post's `others`
 * refuses to be — a post is written by one of them and must not list its own
 * author, a paper is written by nobody and lists them all. There is no `me`
 * and no `first`, so a first-person wording cannot be filled in here even by
 * accident: it simply never fits, and the coverage test notices.
 */
function thirdPerson(day: ChronicleDay): WordingContext {
  return {
    day,
    words: (key, event) => {
      switch (key) {
        case 'place':
          return placeOf(event, day);
        case 'who': {
          const named = namesOf(event.actors, day);
          return named.length === 0 ? undefined : listOf(named);
        }
        default:
          return undefined;
      }
    },
  };
}

/** `Pennycroft, Blossom 2, 1200 (Midweek)` — the village and the date, nothing else. */
function datelineOf(village: string, key: string, calendar: CalendarConfig): string {
  const when = tickToDateTime(dateTimeToTick(partsOf(key), calendar), calendar);
  return `${village}, ${when.monthName} ${when.day}, ${when.year} (${when.weekday})`;
}

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function partsOf(key: string): { year: number; month: number; day: number } {
  const match = KEY.exec(key);
  assert(match !== null, 'that is not a day key', { key });
  const [, year, month, day] = match as RegExpExecArray;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

function dataOf(event: SimEvent): Record<string, unknown> {
  return event.data as Record<string, unknown>;
}
