import { z } from 'zod';
import type { EntityId } from '@rpgsim/sim-core';
import type { ChronicleDay } from './day.ts';
import { type PersonRecord, yearsBetween } from './people.ts';
import {
  type Newsworthiness,
  type ScoringConfig,
  compareNewsworthiness,
  rank,
  scoreOf,
} from './score.ts';

/**
 * What goes on the page, and who writes it.
 *
 * `score.ts` says how interesting each of a thousand things is. That is not yet
 * an edition: a page of the five most interesting events is often the same
 * event five times, and a village where the same three people post every day is
 * a village with three people in it.
 *
 * So there are two picks here, and they are separate on purpose. Headlines are
 * chosen by merit alone — the day's best events, with a cap per kind so one
 * busy system cannot own the front page. Posting villagers are chosen by merit
 * *minus a rotation penalty*, because a blog is a rota and a front page is not.
 *
 * **The penalty is derived, never stored.** It is computed by reading the days
 * already published and seeing who wrote them. The alternative — a
 * `last-posted.json` counter advanced each day — is a second source of truth
 * that can disagree with the first, and it makes the site unrebuildable: delete
 * it and every villager looks equally overdue. Reading the published days back
 * means a rebuild from an empty directory reproduces the same rota, in the same
 * order, every time.
 */

export const SelectionSchema = z.object({
  /** How many events lead the edition. */
  headlines: z.number().int().min(0),
  /** The most headlines any one event type may take. */
  perType: z.number().int().min(1),
  /** An event scoring below this is not news, however short the page is. */
  floor: z.number().int().min(0),
  /** How many villagers post on an ordinary day. */
  posters: z.number().int().min(0),
  /**
   * The age from which somebody writes their own posts.
   *
   * Ten, and it is the one rule here that is not about how the page reads. A
   * quarter of the village is under ten, they are out of doors all day, and the
   * scoring cheerfully ranked a five-month-old the most interesting person in
   * Pennycroft -- so Walter Webb, who cannot hold his own head up, had six posts
   * on the site. The About page says in plain words that nobody here can read or
   * write yet, which makes every one of them a small lie printed next to a
   * photograph of a baby.
   *
   * Ten rather than a literacy flag because there is no literacy in the
   * simulation to read, and inventing one in the press would be the press making
   * up world state. An age is a birth fact the record already holds.
   *
   * It is not a silence. What a young child did still reaches the page, through
   * `mentionsChild` below and their parent's voice, which is how it would have
   * reached anybody in a village where nothing was written down.
   */
  writingAge: z.number().int().min(0),
  /**
   * The chance in a hundred that a parent's post ends with a line about a child
   * too young to write.
   *
   * A chance and not a rule, because a parent who reported every one of their
   * children's days every time would stop being a person and become a feed.
   *
   * Measured rather than guessed. At fifty, across thirty days of `world-zero`:
   * a hundred and fifty posts, of which fifty-three were written by a parent
   * with a young child who had done something, of which thirty ended with a line
   * about that child. So the dial does what it says on the posts it applies to,
   * and a fifth of the blog carries a child's day -- sixteen of the thirty days
   * have at least one, and none of them is all nursery.
   *
   * Zero turns the whole thing off and is a legitimate setting: a village with
   * no wording for it published exactly what it published before.
   */
  mentionsChild: z.number().int().min(0).max(100),
  /**
   * How many published days back the rota looks.
   *
   * Finite so the penalty forgets: somebody who posted once and then went quiet
   * for a season should be as eligible as anybody, and an infinite memory would
   * hold their one post against them forever.
   */
  memory: z.number().int().min(0),
  /**
   * Divided by how many published days ago somebody last posted.
   *
   * So yesterday's poster carries the whole weight of it, the day before half,
   * a week ago a seventh. Division rather than a flat ban because a ban is a
   * rule and this is a preference: if Winifred is the only person the day
   * happened to, she should lead again, and the numbers should have to admit it
   * rather than the code forbidding it.
   *
   * The cost of that choice, measured rather than guessed: somebody whose score
   * beats the village's by more than `cooling` posts nearly every day, because
   * once everybody carries a penalty their margin outlasts it. On real village
   * days nobody is that far ahead — thirty days of `world-zero` put the busiest
   * villager on a fifth of them — but the failure mode is real, and the answer
   * to it is a village where more kinds of thing happen, not a bigger number
   * here. A bigger number would only move the threshold somebody has to clear
   * before the same thing happens again.
   */
  cooling: z.number().int().min(0),
});

export type SelectionConfig = z.infer<typeof SelectionSchema>;

/** A day already on the site: who wrote it. The only thing the rota reads. */
export interface PublishedDay {
  readonly key: string;
  /** The slugs of the villagers who posted that day. */
  readonly posters: readonly string[];
}

/** A villager considered for the day's posts, and why they placed where they did. */
export interface Candidate {
  readonly person: PersonRecord;
  /** Their most newsworthy moment today. */
  readonly best: Newsworthiness;
  /** Published days since they last posted, or `null` for not within memory. */
  readonly since: number | null;
  readonly penalty: number;
  /** `best.total - penalty`. The sort key, and it may be negative. */
  readonly merit: number;
}

export interface Edition {
  readonly key: string;
  readonly headlines: readonly Newsworthiness[];
  readonly posters: readonly Candidate[];
}

export interface SelectOptions {
  readonly day: ChronicleDay;
  readonly scoring: ScoringConfig;
  readonly selection: SelectionConfig;
  /** Every day already published, in any order. Read from the site itself. */
  readonly published: readonly PublishedDay[];
}

export function select(options: SelectOptions): Edition {
  return {
    key: options.day.key,
    headlines: selectHeadlines(options),
    posters: selectPosters(options),
  };
}

/**
 * The day's leading events.
 *
 * Merit order, with two rules on top. Nothing below the floor runs, because a
 * quiet day should produce a short edition rather than a padded one — "nothing
 * much happened" is a true sentence and a village that never says it is not
 * being reported on. And no kind of event may take more than `perType` slots,
 * because the ranking is by score and sixteen people turned back from full
 * cottages all score identically: without the cap the front page is one story
 * printed five times, which is how a filter looks when it is working perfectly
 * and reading terribly.
 */
export function selectHeadlines(options: SelectOptions): readonly Newsworthiness[] {
  const { selection } = options;
  const taken = new Map<string, number>();
  const chosen: Newsworthiness[] = [];

  for (const scored of rank(options.scoring, options.day)) {
    if (chosen.length >= selection.headlines) break;
    if (scored.total < selection.floor) break;
    const already = taken.get(scored.event.type) ?? 0;
    if (already >= selection.perType) continue;
    taken.set(scored.event.type, already + 1);
    chosen.push(scored);
  }
  return chosen;
}

/**
 * The villagers who post today.
 *
 * Everybody old enough to write who did anything is a candidate, represented by
 * their single most newsworthy moment rather than by a sum: a person who arrived
 * somewhere four hundred times had a dull day, and summing would make them the
 * most interesting person in the village. A day is remembered for its high point.
 */
export function selectPosters(options: SelectOptions): readonly Candidate[] {
  return rankCandidates(options).slice(0, options.selection.posters);
}

/** Every candidate, in the order the rota would pick them. Exposed for `WHY?`. */
export function rankCandidates(options: SelectOptions): readonly Candidate[] {
  const { day, scoring, selection } = options;
  const recent = lastPostedWithin(options.published, day.key, selection.memory);
  const candidates: Candidate[] = [];

  for (const actor of day.actors()) {
    const person = day.people.find(actor);
    // Actors that are not people -- a household founding names its household --
    // are not candidates to write a blog post, and are not an error either.
    if (person === undefined) continue;
    // Nor is a child. Dropped here rather than after the sort, so that a day
    // whose most newsworthy hour belonged to a six-year-old still fills all
    // five places from the people who can write: filtering a finished list
    // would publish four posts and leave a hole where the child had been.
    if (yearsBetween(person.born, day.key) < selection.writingAge) continue;

    const best = bestOf(scoring, day, actor);
    if (best === undefined) continue;

    const since = recent.get(person.slug) ?? null;
    const penalty = since === null ? 0 : Math.floor(selection.cooling / since);
    candidates.push({ person, best, since, penalty, merit: best.total - penalty });
  }

  // Merit, then the earlier of two equal moments, then the slug. Three keys
  // because two are not enough to be total: several villagers can tie on merit
  // with the same best score, and the last key has to be something unique. The
  // slug is that, and it is stable across a rebuild in a way an entity id is
  // not.
  return candidates.sort((a, b) => {
    if (a.merit !== b.merit) return b.merit - a.merit;
    const byEvent = compareNewsworthiness(a.best, b.best);
    if (byEvent !== 0) return byEvent;
    return a.person.slug < b.person.slug ? -1 : a.person.slug > b.person.slug ? 1 : 0;
  });
}

function bestOf(
  scoring: ScoringConfig,
  day: ChronicleDay,
  actor: EntityId,
): Newsworthiness | undefined {
  let best: Newsworthiness | undefined;
  for (const event of day.byActor(actor)) {
    const scored = scoreOf(scoring, day, event);
    if (best === undefined || compareNewsworthiness(scored, best) < 0) best = scored;
  }
  return best;
}

/**
 * How many published days ago each villager last posted.
 *
 * Counted in *published days*, not calendar days: a site that skipped a week
 * has not thereby rested anybody. Days at or after the one being built are
 * ignored, so rebuilding an old edition sees only what was published before it
 * — which is what makes a rebuild from scratch reproduce the original rota
 * instead of a new one informed by the future.
 */
export function lastPostedWithin(
  published: readonly PublishedDay[],
  before: string,
  memory: number,
): ReadonlyMap<string, number> {
  const earlier = published.filter((day) => day.key < before).sort(byKeyDescending);
  const since = new Map<string, number>();

  for (let index = 0; index < earlier.length && index < memory; index++) {
    const day = earlier[index] as PublishedDay;
    for (const slug of day.posters) {
      // The first time a slug is seen walking backwards is the most recent, and
      // `index + 1` makes yesterday a distance of one rather than zero -- which
      // matters, because the penalty divides by it.
      if (!since.has(slug)) since.set(slug, index + 1);
    }
  }
  return since;
}

function byKeyDescending(a: PublishedDay, b: PublishedDay): number {
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}
