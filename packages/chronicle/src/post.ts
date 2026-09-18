import { z } from 'zod';
import { assert } from '@rpgsim/shared';
import { Rng, type SimEventId } from '@rpgsim/sim-core';
import type { ChronicleDay } from './day.ts';
import type { PersonRecord } from './people.ts';
import { type Newsworthiness, type ScoringConfig, compareNewsworthiness, scoreOf } from './score.ts';
import type { Candidate } from './select.ts';
import type { Whereabouts } from './witness.ts';
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
 * values the event itself carries. See `wording.ts`: a template that asks for
 * something the event has not got is not *filled in*, it is passed over.
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

  const context = firstPerson(options);
  const rng = Rng.forStream(options.worldSeed, `post:${day.key}:${author.slug}`);
  const lines: PostLine[] = [];

  for (const moment of chosen) {
    const variants = eligible(templates.wording[moment.event.type] ?? [], moment.event, context);
    // A moment only reached this list because at least one wording fitted it,
    // and nothing between there and here can have changed that.
    assert(variants.length > 0, 'a chosen moment lost its wording', {
      day: day.key,
      event: moment.event.id,
    });
    const text = render(rng.pick(variants).text, moment.event, context);
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
 * The words only the author of a post can supply.
 *
 * `others` is the interesting one: it is everybody *except* the writer, so a
 * wording about company cannot make somebody list themselves, and it resolves
 * to nothing at all when they were alone — which means a wording about company
 * is never offered for a solitary moment.
 */
function firstPerson(options: PostOptions): WordingContext {
  const { author, day } = options;
  return {
    day,
    words: (key, event) => {
      switch (key) {
        case 'me':
          return author.name;
        case 'first':
          return author.name.split(' ')[0] ?? author.name;
        case 'place':
          return placeOf(event, day);
        case 'others': {
          const rest = event.actors.filter((actor) => actor !== author.id);
          const named = namesOf(rest, day);
          return named.length === 0 ? undefined : listOf(named);
        }
        default:
          return undefined;
      }
    },
  };
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
  const context = firstPerson(options);
  const best = new Map<string, Newsworthiness>();

  for (const event of day.events) {
    // Narrowed once and passed on, rather than looked up and then defaulted to
    // an empty list further down. Two guards that say the same thing are one
    // guard and one place for the two to drift apart.
    const variants = templates.wording[event.type];
    if (variants === undefined) continue;
    if (!whereabouts.saw(author.id, event)) continue;
    if (eligible(variants, event, context).length === 0) continue;

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
