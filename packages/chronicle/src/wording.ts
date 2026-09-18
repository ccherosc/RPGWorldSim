import { z } from 'zod';
import { assert } from '@rpgsim/shared';
import type { EntityId, SimEvent } from '@rpgsim/sim-core';
import type { ChronicleDay } from './day.ts';

/**
 * Turning an event into a sentence, without inventing anything.
 *
 * Two things read the record out loud — the villagers' posts (`post.ts`) and the
 * paper (`paper.ts`) — and they say different things about the same events: one
 * in the first person to somebody who was there, one in the third to everybody.
 * What they must not differ on is *what may be said at all*, so the rule lives
 * here and both of them borrow it.
 *
 * **A wording is offered or it is passed over. It is never partly filled.** If a
 * template asks for something the event has not got, the template does not fit
 * and another is used. There is no default, no "somewhere", no empty string
 * standing in for a fact nobody established, and no rendering of a value that
 * has no English — a boolean, a list, a nested object, or an entity id the
 * record cannot name. The last of those is the one that would actually reach a
 * reader: `household:3` in the middle of a sentence is the most embarrassing
 * thing this package could print, and the guard against it is one line.
 *
 * Failing to fit is the *safe* failure, and that is why it is silent. The unsafe
 * failure is a sentence containing something nobody wrote, so the fallback is
 * always "say less". The cost is that a misspelt placeholder reads as silence
 * rather than as an error, which nobody would ever notice — so both callers owe
 * a test that every shipped wording can be reached by a real event, and both
 * have one.
 *
 * Vocabulary is the caller's business. A post knows who is writing it and can
 * resolve `{me}`; the paper does not and can resolve `{who}`. Everything neither
 * of them claims comes straight out of the event's own payload, which is what
 * lets a new event type get wording without a code change.
 */

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/** `npc:7`, `household:3`. The shape of a thing that must never reach a reader. */
const ENTITY_ID = /^[a-z][a-z-]*:\d+$/;

export const TemplateSchema = z.object({
  /** The wording, with `{placeholders}`. Resolved against the event and the record. */
  text: z.string().min(1),
  /**
   * Payload values this wording is for: `{ "reason": ["full"] }`.
   *
   * Without it every refusal would have to be phrased the same way, because a
   * placeholder can tell whether an event *has* a reason and not what the reason
   * was — and `reason` printed raw puts `no-route` in the middle of a sentence.
   * This keeps the specific phrasing in the data file where wording belongs, and
   * keeps it honest: a wording is only ever offered for events that actually
   * carry the value it was written for.
   */
  when: z.record(z.array(z.union([z.string(), z.number(), z.boolean()])).min(1)).optional(),
});

export type Template = z.infer<typeof TemplateSchema>;

/**
 * What a wording may draw on: the record, plus whatever words the caller claims.
 *
 * `words` is asked first and wins, so a caller can override a payload key it has
 * a better answer for. Returning `undefined` means "not mine", not "empty", and
 * the payload is tried next.
 */
export interface WordingContext {
  readonly day: ChronicleDay;
  readonly words: (key: string, event: SimEvent) => string | undefined;
}

/**
 * The wordings that fit this event, in the order the file lists them.
 *
 * "Fit" means every placeholder resolves and every `when` clause matches. A
 * wording that mentions who else was there is simply not offered for an event
 * nobody else was at — which is how a file gets to hold rich phrasing without
 * any of it risking a sentence about a person who was not present.
 */
export function eligible(
  variants: readonly Template[],
  event: SimEvent,
  context: WordingContext,
): readonly Template[] {
  return variants.filter(
    (variant) =>
      matches(variant, event) &&
      placeholdersOf(variant.text).every((key) => resolve(key, event, context) !== undefined),
  );
}

/** `A cottage on Bridge Row`, `The mill`. A name that opens with an article. */
const ARTICLE = /^(?:A|An|The) /;

/** Nothing before it, or a finished sentence. Anything else is mid-sentence. */
const OPENS_A_SENTENCE = /(?:^|[.!?]\s+)$/;

/**
 * A name set into a sentence, in the case that sentence needs.
 *
 * Places are named on the record as whole noun phrases -- `A cottage on Bridge
 * Row`, `The mill` -- because that is what a heading and a table row want, and
 * it is what the record itself calls them. Dropped into a wording they arrive
 * with the capital they were stored with, and the site published eighty-five
 * sentences reading `Abed at A cottage on Bridge Row.` and `Heading back to A
 * cottage on Bridge Row.` Every one of them was a true sentence about a real
 * event, which is why nothing caught it: the fault is entirely in the seam.
 *
 * So the article is lowered -- only the article, and only where the name is not
 * opening a sentence. `{place}. Warm enough.` keeps its capital, because there
 * the name *is* the sentence. Names that do not start with an article, which is
 * every person in the record, are handed back untouched.
 *
 * The lowering half is exported because anything checking what the paper said
 * against what the record holds has to know a name has two spellings. A guard
 * that knew only the record's would find no `A cottage on Mill Lane` inside
 * `Abed at a cottage on Mill Lane`, go on to match the shorter `Mill Lane` that
 * is sitting inside it, and report a place the paper never mentioned.
 */
export function midSentence(name: string): string {
  return ARTICLE.test(name) ? `${name.charAt(0).toLowerCase()}${name.slice(1)}` : name;
}

function inSentence(value: string, before: string): string {
  return OPENS_A_SENTENCE.test(before) ? value : midSentence(value);
}

export function render(text: string, event: SimEvent, context: WordingContext): string {
  return text.replace(PLACEHOLDER, (_whole, key: string, at: number) => {
    const value = resolve(key, event, context);
    // Unreachable through `eligible`, and worth a loud death anyway: the one way
    // a reader ever sees `{place}` in print is if this returns when it should not.
    assert(value !== undefined, 'a template asked for something the event has not got', {
      event: event.id,
      placeholder: key,
    });
    return inSentence(value as string, text.slice(0, at));
  });
}

/** `Alditha`, `Alditha and Godric`, `Alditha, Godric and Winifred`. */
export function listOf(names: readonly string[]): string {
  if (names.length === 1) return names[0] as string;
  const last = names[names.length - 1] as string;
  return `${names.slice(0, -1).join(', ')} and ${last}`;
}

/** Everybody in this list the record can name, in the order given. */
export function namesOf(ids: readonly EntityId[], day: ChronicleDay): readonly string[] {
  return ids.map((id) => day.people.find(id)?.name).filter(isNamed);
}

/** The name of wherever this happened, or `undefined` for nowhere in particular. */
export function placeOf(event: SimEvent, day: ChronicleDay): string | undefined {
  return event.location === undefined ? undefined : day.places.find(event.location)?.name;
}

function matches(variant: Template, event: SimEvent): boolean {
  if (variant.when === undefined) return true;
  const data = event.data as Record<string, unknown>;
  for (const [key, allowed] of Object.entries(variant.when)) {
    if (!allowed.some((value) => data[key] === value)) return false;
  }
  return true;
}

function placeholdersOf(text: string): readonly string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}

function resolve(key: string, event: SimEvent, context: WordingContext): string | undefined {
  return context.words(key, event) ?? fromPayload(key, event, context.day);
}

function fromPayload(key: string, event: SimEvent, day: ChronicleDay): string | undefined {
  const value = (event.data as Record<string, unknown>)[key];
  if (typeof value === 'string') {
    const name = day.places.find(value as EntityId)?.name ?? day.people.find(value as EntityId)?.name;
    if (name !== undefined) return name;
    // An id the record cannot name is not printable. Households have ids and no
    // register yet, and `npc.household-changed` carries one; without this the
    // wording `{to}` would put `household:3` in the middle of a sentence.
    // Falling through to "no wording fits" is the right failure: a reader never
    // sees plumbing, and the coverage tests notice the wording going dark.
    return ENTITY_ID.test(value) ? undefined : value;
  }
  if (typeof value === 'number') return String(value);
  // Booleans, nulls, lists and nested objects have no rendering that reads as
  // English, and guessing one ("true") is how a page starts saying things nobody
  // wrote. The wording simply does not fit.
  return undefined;
}

function isNamed(name: string | undefined): name is string {
  return name !== undefined;
}
