import { z } from 'zod';
import { assert } from '@rpgsim/shared';
import { type EntityId, Rng, type SimEvent, type SimEventId } from '@rpgsim/sim-core';
import type { ChronicleDay } from './day.ts';
import type { PersonRecord } from './people.ts';
import { type Newsworthiness, type ScoringConfig, compareNewsworthiness, scoreOf } from './score.ts';
import type { Candidate } from './select.ts';
import type { Whereabouts } from './witness.ts';

/**
 * The villagers, in their own words.
 *
 * Four to six short first-person posts a day, and every sentence in every one
 * of them is an event id wearing a coat. A post is not written *about* the day;
 * it is assembled *from* it, one line per event, and each line carries the id it
 * came from so that the claim "everything here is traceable" is a thing a test
 * can check rather than a thing a colophon asserts.
 *
 * Three rules hold the whole module up.
 *
 * **Nothing is said that the writer could not have seen.** Every candidate
 * event goes through `Whereabouts.saw` first. See `witness.ts` for what that
 * costs and why it is deliberately strict.
 *
 * **Nothing is invented.** Wording lives in a data file, not in code (directive
 * 10), and a line's only variables are names the record already holds and
 * values the event itself carries. A template that asks for something the event
 * has not got is not *filled in* — it is passed over, and another wording is
 * used. There is no default, no "somewhere", no empty string standing in for a
 * fact nobody established.
 *
 * **A thin day produces a thin post, or none.** If nothing the author witnessed
 * has wording, they do not post. The alternative is padding, and a village blog
 * that pads is a village blog that is lying slowly.
 *
 * The wording is picked with a seeded RNG so two builds of the same day produce
 * the same prose. The stream is named for the day and the author's **slug**
 * rather than their entity id, which is a deliberate departure from the plan's
 * letter: a slug is a pure function of a name, and an entity id is an artefact
 * of the order worldgen happened to run in. Rebuild the archive from the seed
 * and the slug survives; rebuild it after a worldgen change and the ids all
 * shift, silently rewriting every post the site has ever published.
 */

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/** `npc:7`, `household:3`. The shape of a thing that must never reach a reader. */
const ENTITY_ID = /^[a-z][a-z-]*:\d+$/;

export const TemplateSchema = z.object({
  /** The wording, with `{placeholders}`. Resolved against the event and record. */
  text: z.string().min(1),
  /**
   * Payload values this wording is for: `{ "reason": ["full"] }`.
   *
   * Without it every refusal would have to be phrased the same way, because a
   * placeholder can tell whether an event *has* a reason and not what the
   * reason was — and `reason` printed raw puts `no-route` in the middle of a
   * sentence. This keeps the specific phrasing in the data file where wording
   * belongs, and keeps it honest: a wording is only ever offered for events
   * that actually carry the value it was written for.
   */
  when: z.record(z.array(z.union([z.string(), z.number(), z.boolean()])).min(1)).optional(),
});

export const TemplateBookSchema = z.object({
  /**
   * The most lines one post may run to.
   *
   * A cap rather than a target: a villager whose day held one thing writes one
   * line about it. Low because a post is a status update and not a diary, and
   * because the day's second-best moment is usually its best moment again.
   */
  maxLines: z.number().int().min(1),
  /** Wording variants, by event type. A type absent here is a type nobody posts about. */
  wording: z.record(z.array(TemplateSchema).min(1)),
});

export type Template = z.infer<typeof TemplateSchema>;
export type TemplateBook = z.infer<typeof TemplateBookSchema>;

/** One sentence, and the event it is answerable to. */
export interface PostLine {
  readonly text: string;
  /** The events this line is built from. One, today; the shape allows more. */
  readonly sources: readonly SimEventId[];
}

export interface Post {
  /** `1200-04-02`. */
  readonly day: string;
  readonly author: PersonRecord;
  readonly lines: readonly PostLine[];
  /** Every id the post rests on, in the order the lines cite them. The `WHY?` chain. */
  readonly sources: readonly SimEventId[];
}

export interface PostOptions {
  readonly day: ChronicleDay;
  readonly whereabouts: Whereabouts;
  readonly scoring: ScoringConfig;
  readonly templates: TemplateBook;
  /** The seed the world was generated from. Makes the wording reproducible. */
  readonly worldSeed: string;
  readonly author: PersonRecord;
}

/**
 * One villager's post, or nothing if they have nothing they may say.
 *
 * The moments are chosen by score and then **re-sorted into the order they
 * happened**, because those are two different questions. Score answers "which
 * of today's moments are worth a line"; chronology answers "how does a day
 * read". Ranked order would open every post with its loudest moment and then
 * walk backwards to breakfast.
 */
export function writePost(options: PostOptions): Post | undefined {
  const { author, day, templates } = options;
  const chosen = chooseMoments(options);
  if (chosen.length === 0) return undefined;

  const rng = Rng.forStream(options.worldSeed, `post:${day.key}:${author.slug}`);
  const lines: PostLine[] = [];

  for (const moment of chosen) {
    const variants = eligible(templates.wording[moment.event.type] ?? [], moment.event, options);
    // A moment only reached this list because at least one wording fitted it,
    // and nothing between there and here can have changed that.
    assert(variants.length > 0, 'a chosen moment lost its wording', {
      day: day.key,
      event: moment.event.id,
    });
    const text = render(rng.pick(variants).text, moment.event, options);
    lines.push({ text, sources: [moment.event.id] });
  }

  return { day: day.key, author, lines, sources: lines.flatMap((line) => line.sources) };
}

/**
 * The day's posts, one per villager the rota picked.
 *
 * Villagers with nothing to say are dropped rather than replaced, so a quiet
 * day runs short. Reaching down the rota for a spare body would put somebody on
 * the page *because* the day was dull, which is the opposite of what the rota
 * is for.
 */
export function writePosts(
  posters: readonly Candidate[],
  options: Omit<PostOptions, 'author'>,
): readonly Post[] {
  const posts: Post[] = [];
  for (const candidate of posters) {
    const post = writePost({ ...options, author: candidate.person });
    if (post !== undefined) posts.push(post);
  }
  return posts;
}

/**
 * The moments a post is built from: the best of each kind the author witnessed.
 *
 * Best *per kind* because a villager who was turned away from four full
 * cottages had one experience, not four, and four lines saying so is a bug
 * report rather than a post. Taking the highest-scoring of each kind and then
 * the best few kinds gives a post that covers its day instead of repeating its
 * loudest minute.
 */
function chooseMoments(options: PostOptions): readonly Newsworthiness[] {
  const { author, day, scoring, templates, whereabouts } = options;
  const best = new Map<string, Newsworthiness>();

  for (const event of day.events) {
    // Narrowed once and passed on, rather than looked up and then defaulted to
    // an empty list further down. Two guards that say the same thing are one
    // guard and one place for the two to drift apart.
    const variants = templates.wording[event.type];
    if (variants === undefined) continue;
    if (!whereabouts.saw(author.id, event)) continue;
    if (eligible(variants, event, options).length === 0) continue;

    const scored = scoreOf(scoring, day, event);
    const held = best.get(event.type);
    if (held === undefined || compareNewsworthiness(scored, held) < 0) best.set(event.type, scored);
  }

  // `best` is keyed by type and filled in archive order, so it is already
  // deterministic; sorting by score and then re-sorting by event id is what
  // picks the top few and then puts the day back in order.
  return [...best.values()]
    .sort(compareNewsworthiness)
    .slice(0, templates.maxLines)
    .sort((a, b) => a.event.id - b.event.id);
}

/**
 * The wordings that fit this event, in the order the file lists them.
 *
 * "Fit" means every placeholder resolves and every `when` clause matches. A
 * wording that mentions who else was there is simply not offered for an event
 * nobody else was at — which is how the file gets to hold rich phrasing without
 * any of it risking a sentence about a person who was not present.
 */
function eligible(
  variants: readonly Template[],
  event: SimEvent,
  options: PostOptions,
): readonly Template[] {
  return variants.filter(
    (variant) =>
      matches(variant, event) &&
      placeholdersOf(variant.text).every((key) => resolve(key, event, options) !== undefined),
  );
}

function matches(variant: Template, event: SimEvent): boolean {
  if (variant.when === undefined) return true;
  const data = event.data as Record<string, unknown>;
  for (const [key, allowed] of Object.entries(variant.when)) {
    if (!allowed.some((value) => data[key] === value)) return false;
  }
  return true;
}

function render(text: string, event: SimEvent, options: PostOptions): string {
  return text.replace(PLACEHOLDER, (_whole, key: string) => {
    const value = resolve(key, event, options);
    // Unreachable through `eligible`, and worth a loud death anyway: the one
    // way a reader ever sees `{place}` in print is if this returns something
    // when it should not.
    assert(value !== undefined, 'a post template asked for something the event has not got', {
      event: event.id,
      placeholder: key,
    });
    return value as string;
  });
}

function placeholdersOf(text: string): readonly string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}

/**
 * What one `{placeholder}` stands for, or `undefined` for "this event cannot say".
 *
 * Four words are fixed vocabulary; everything else is read straight out of the
 * event's own payload, so a new event type gets wording without any code
 * change. A payload value that names somewhere or somebody is rendered as their
 * name, because the alternative is a sentence containing `location:7`.
 */
function resolve(key: string, event: SimEvent, options: PostOptions): string | undefined {
  const { author, day } = options;
  switch (key) {
    case 'me':
      return author.name;
    case 'first':
      return author.name.split(' ')[0] ?? author.name;
    case 'place':
      return event.location === undefined ? undefined : day.places.find(event.location)?.name;
    case 'others': {
      const rest = event.actors.filter((actor) => actor !== author.id);
      const named = rest.map((actor) => day.people.find(actor)?.name).filter(isNamed);
      return named.length === 0 ? undefined : listOf(named);
    }
    default:
      return fromPayload(event, key, options);
  }
}

function fromPayload(event: SimEvent, key: string, options: PostOptions): string | undefined {
  const value = (event.data as Record<string, unknown>)[key];
  if (typeof value === 'string') {
    const name = named(value as EntityId, options);
    if (name !== undefined) return name;
    // An id the record cannot name is not printable. Households have ids and
    // no register yet, and `npc.household-changed` carries one; without this
    // the wording `{to}` would put `household:3` in the middle of a sentence.
    // Falling through to "no wording fits" is the right failure: a reader never
    // sees plumbing, and the coverage test notices the wording going dark.
    return ENTITY_ID.test(value) ? undefined : value;
  }
  if (typeof value === 'number') return String(value);
  // Booleans, nulls, lists and nested objects have no rendering that reads as
  // English, and guessing one ("true") is how a post starts saying things
  // nobody wrote. The wording simply does not fit.
  return undefined;
}

function named(id: EntityId, options: PostOptions): string | undefined {
  const { day } = options;
  return day.places.find(id)?.name ?? day.people.find(id)?.name;
}

function isNamed(name: string | undefined): name is string {
  return name !== undefined;
}

/** `Alditha`, `Alditha and Godric`, `Alditha, Godric and Winifred`. */
function listOf(names: readonly string[]): string {
  if (names.length === 1) return names[0] as string;
  const last = names[names.length - 1] as string;
  return `${names.slice(0, -1).join(', ')} and ${last}`;
}
