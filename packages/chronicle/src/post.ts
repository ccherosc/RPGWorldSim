import { z } from 'zod';
import { assert } from '@rpgsim/shared';
import { type EntityId, Rng, type SimEventId } from '@rpgsim/sim-core';
import type { ChronicleDay } from './day.ts';
import type { Kinfolk } from './kin.ts';
import { type PersonRecord, yearsBetween } from './people.ts';
import { type Newsworthiness, type ScoringConfig, compareNewsworthiness, scoreOf } from './score.ts';
import type { Candidate, SelectionConfig } from './select.ts';
import type { LifeStages } from './stages.ts';
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
 * There is exactly one relaxation, and it is written into the line rather than
 * into the rule: a parent may end a post with something one of their young
 * children did, and that line carries the child's id in `about`, so what is
 * checked is the child's presence. Nothing else in the village may speak for
 * anybody else. See `mentionOf`.
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
   * The most lines one post may run to, counting only the writer's own day.
   *
   * A cap rather than a target: a villager whose day held one thing writes one
   * line about it. Low because a post is a status update and not a diary, and
   * because the day's second-best moment is usually its best moment again.
   *
   * A line about a child is over and above it, so a post runs to `maxLines + 1`
   * at the very most. Counting the two together would mean a parent bought a
   * sentence about their daughter by dropping one about themselves, which is a
   * strange trade to make on the reader's behalf and puts the cap in charge of
   * something it was never written to decide.
   */
  maxLines: z.number().int().min(1),
  /** Wording variants, by event type. A type absent here is a type nobody posts about. */
  wording: z.record(z.array(TemplateSchema).min(1)),
  /**
   * Wording for a parent speaking of a child too young to write. Third person.
   *
   * A second book rather than a section of the first, for the reason the paper's
   * wording is a separate file: these are different voices and neither should be
   * able to borrow the other's by accident. `Abed at {place}.` is true of a
   * four-year-old and would be offered for one, and it would read as the
   * four-year-old writing it. Keeping the books apart means a first-person
   * phrase can never be reached from a line about somebody else, and the
   * coverage test says so of every wording in both.
   */
  family: z.record(z.array(TemplateSchema).min(1)).default({}),
});

export type TemplateBook = z.infer<typeof TemplateBookSchema>;

/** One sentence, and the event it is answerable to. */
export interface PostLine {
  readonly text: string;
  /** The events this line is built from. One, today; the shape allows more. */
  readonly sources: readonly SimEventId[];
  /**
   * Whose moment this is, when it is not the writer's own.
   *
   * Absent on nearly every line, and load-bearing on the few that carry it. The
   * honesty rule is that nobody writes about something they were not there for,
   * and it is checked by asking `Whereabouts` whether the author saw the event.
   * A parent writing about their daughter's afternoon was, by construction, not
   * there -- so a line like that has to say whose presence answers for it, or
   * the check has to be softened for every line to let one through.
   */
  readonly about?: EntityId;
}

export interface Post {
  /** `1200-04-02`. */
  readonly day: string;
  readonly author: PersonRecord;
  readonly lines: readonly PostLine[];
  /** Every id the post rests on, in the order the lines cite them. The `WHY?` chain. */
  readonly sources: readonly SimEventId[];
}

/**
 * What a parent needs in order to speak for a child, or nothing.
 *
 * One object rather than three loose options because the three are meaningless
 * apart: kin with no age is a rule with no edge, an age with no chance is a
 * rule nothing consults, and a chance with no kin has nobody to apply to. Absent
 * altogether means the blog has no household voice, which is what every test
 * that is about something else wants and is what the site published before this
 * existed.
 */
export interface HouseholdVoice {
  /** Who belongs to whom, as far as the record has been read. */
  readonly kin: Kinfolk;
  /** Children below this age may be spoken for. At or above it they speak for themselves. */
  readonly writingAge: number;
  /** The chance in a hundred of a mention, rolled once per post. */
  readonly chance: number;
}

/**
 * The household voice a config asks for.
 *
 * Four lines that exist only so that nobody writes them twice. The press builds
 * one of these and so does the test that checks thirty real days, and when both
 * of them assembled the object by hand a press that swapped the two numbers --
 * an age of fifty and a one-in-ten chance -- ran green: the rota reads
 * `writingAge` from the config directly and never noticed, and no test looked at
 * the other end. Written once, it is a mistake with nowhere left to happen.
 */
export const householdVoice = (kin: Kinfolk, selection: SelectionConfig): HouseholdVoice => ({
  kin,
  writingAge: selection.writingAge,
  chance: selection.mentionsChild,
});

export interface PostOptions {
  readonly day: ChronicleDay;
  readonly whereabouts: Whereabouts;
  readonly scoring: ScoringConfig;
  readonly templates: TemplateBook;
  /** The seed the world was generated from. Makes the wording reproducible. */
  readonly worldSeed: string;
  readonly author: PersonRecord;
  /**
   * Where the boundaries between life stages fall.
   *
   * Required rather than optional, though a book with no banded wording would
   * not miss it. Optional would mean a caller could leave it out and get a
   * village where every banded wording is silently unreachable -- a post that
   * still reads perfectly well, for a village that has quietly lost two thirds
   * of its voice, with nothing anywhere saying so.
   */
  readonly stages: LifeStages;
  /** Absent for a blog where nobody speaks for anybody else. */
  readonly household?: HouseholdVoice;
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

  const mention = mentionOf(options);
  if (mention !== undefined) lines.push(mention);

  return { day: day.key, author, lines, sources: lines.flatMap((line) => line.sources) };
}

/**
 * The last line of a parent's post: what one of the little ones did.
 *
 * Only ever an addition. A villager with nothing of their own to say does not
 * post, and is not given one by having a child who had a day -- a page of
 * parents reporting other people's afternoons is not the village blog, and the
 * rota picked them for their own day in the first place.
 *
 * **The roll comes out of a stream of its own**, named for this feature rather
 * than for the post. Two hazards, one answer. Drawing from the post's own
 * generator would interleave the two questions, so that every wording after the
 * roll shifted and a village that gained a child rewrote a stranger's post.
 * Re-seeding under the *post's* stream name would be subtler and no better: the
 * roll would land on the same number that chose the writer's opening line, and
 * whether a mother mentioned her daughter would be settled by how she happened
 * to phrase getting out of bed.
 *
 * **The moment is chosen before the roll.** Backwards, for a cheap question and
 * an expensive one -- and deliberate. The stream is per-post, so a roll taken
 * unconditionally would also be taken for the childless, come out the same for
 * everybody it was wasted on, and never show up as a bug. It would just quietly
 * mean something narrower than what the config says.
 */
function mentionOf(options: PostOptions): PostLine | undefined {
  const { author, day, household, templates, worldSeed } = options;
  if (household === undefined) return undefined;

  const found = bestOfTheChildren(options, household);
  if (found === undefined) return undefined;

  const rng = Rng.forStream(worldSeed, `kin:${day.key}:${author.slug}`);
  if (!rng.chance(household.chance / 100)) return undefined;

  const context = aboutChild(day, found.child, options.stages);
  const variants = eligible(templates.family[found.moment.event.type] ?? [], found.moment.event, context);
  assert(variants.length > 0, 'a chosen mention lost its wording', {
    day: day.key,
    event: found.moment.event.id,
  });
  return {
    text: render(rng.pick(variants).text, found.moment.event, context),
    sources: [found.moment.event.id],
    about: found.child.id,
  };
}

interface Mention {
  readonly child: PersonRecord;
  readonly moment: Newsworthiness;
}

/**
 * The most newsworthy thing any of the writer's young children did today.
 *
 * **Young** is the whole of the rule. A child at or above the writing age has
 * their own turn on the rota and their own voice, and a parent summarising the
 * day of a son who posted it himself is a village talking over its own people.
 * Below it, nobody else can say what happened, so the parent is the only way it
 * is said at all.
 *
 * What is claimed here, and what has to stay true: the *child* was present for
 * the event. The parent was not, and is reporting it -- which is what a parent
 * does, and is a real relaxation of the honesty rule rather than a loophole in
 * it. The relaxation is exactly one relation wide, it is written on the line
 * itself as `about`, and the tests check the child's presence as strictly as
 * they check anybody's.
 */
function bestOfTheChildren(options: PostOptions, household: HouseholdVoice): Mention | undefined {
  const { author, day, scoring, templates } = options;
  let best: Mention | undefined;

  for (const id of household.kin.childrenOf(author.id)) {
    const child = day.people.find(id);
    if (child === undefined) continue;
    if (yearsBetween(child.born, day.key) >= household.writingAge) continue;

    const context = aboutChild(day, child, options.stages);
    // `byActor` is indexed off `event.actors`, and taking part is the first
    // thing `Whereabouts.saw` accepts, so every event in this loop is one the
    // child was present for. Asking `saw` again here would read as a check and
    // never be one; the presence claim is made good instead by the line
    // carrying `about`, which the site's honesty test puts through `saw` for
    // real, against a real day.
    for (const event of day.byActor(child.id)) {
      const variants = templates.family[event.type];
      if (variants === undefined) continue;
      if (eligible(variants, event, context).length === 0) continue;

      const scored = scoreOf(scoring, day, event);
      if (best === undefined || compareNewsworthiness(scored, best.moment) < 0) {
        best = { child, moment: scored };
      }
    }
  }
  return best;
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
 *
 * The stage is the writer's own, taken on the day they are writing rather than
 * once for the whole archive. A villager who has a birthday in Blossom sounds
 * nineteen in the posts before it and twenty in the posts after, and an old post
 * rebuilt next year still sounds the age its author was when they wrote it.
 */
function firstPerson(options: PostOptions): WordingContext {
  const { author, day, stages } = options;
  return {
    day,
    band: stages.bandFor(yearsBetween(author.born, day.key)),
    words: (key, event) => {
      switch (key) {
        case 'me':
          return author.name;
        case 'first':
          return firstNameOf(author);
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
 * The words a parent has for a child's moment.
 *
 * `{me}` and `{first}` are deliberately not answered. The writer is not the
 * subject of this line, and leaving their name unresolvable means a first-person
 * wording -- `Abed at {place}` is true of a four-year-old, and `{first} is
 * awake` doubly so -- cannot be reached from here even if somebody pastes it
 * into the wrong book. The two books are then kept apart by the code and not
 * only by the file they are typed into.
 *
 * There is no `{others}` here, though a first-person post has one. Nothing a
 * small child does in this village names a second person -- waking, walking and
 * going to bed are all recorded with one actor -- so a vocabulary for company
 * would be a word no wording could use and no test could reach. It belongs here
 * on the day the simulation gives two children something to do together.
 */
function aboutChild(day: ChronicleDay, child: PersonRecord, stages: LifeStages): WordingContext {
  return {
    day,
    band: stages.bandFor(yearsBetween(child.born, day.key)),
    words: (key, event) => {
      switch (key) {
        case 'child':
          return child.name;
        case 'childFirst':
          return firstNameOf(child);
        case 'place':
          return placeOf(event, day);
        default:
          return undefined;
      }
    },
  };
}

/** `Winifred`, from `Winifred Hargrave`. The whole name, for anybody with one word. */
const firstNameOf = (person: PersonRecord): string => person.name.split(' ')[0] ?? person.name;

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
