import { assert } from '@rpgsim/shared';
import type { EntityId, SimEvent, Tick } from '@rpgsim/sim-core';
import type { ChronicleDay } from './day.ts';

/**
 * Where everybody was, and when — the honesty rule the blog is built on.
 *
 * Prime Directive 5 says an NPC may only act on what they actually know. A
 * villager writing a post is acting on what they know, so the question "may
 * Winifred write this sentence" has to have a real answer and not a plausible
 * one. Phase 5 answers it properly, with a memory model that records what each
 * person learned and from whom. Until then this is the proxy: **a villager may
 * write about an event they took part in, or one that happened where they were
 * standing at the time.** Nothing else. There is no "I heard that…" in v1,
 * because hearsay without a knowledge model is omniscience wearing a hat.
 *
 * `ChronicleDay.presenceOf` already answers a weaker version of this — the set
 * of places somebody was at *some point today*. That is not the rule. Somebody
 * who crossed the green at dawn was not there for the argument at dusk, and a
 * day-level set cannot tell those apart; used as the honesty rule it would let
 * every villager write about everything that happened anywhere they passed
 * through. So this module reconstructs the timeline instead, and the day keeps
 * its looser index for the things it is honestly good for (counting, indexing).
 *
 * **What it is built from.** One fact only: an event names a place and names
 * somebody as an actor, therefore that person was there then. Position is held
 * forward from each such event until something moves them, because standing
 * still emits nothing — an absence of events is the ordinary case, not missing
 * information.
 *
 * **What it refuses to be built from.** `travel.departed` *ends* a stay rather
 * than holding one open: its location is where the walk began, and a step later
 * the traveller is on the road and nowhere in particular. Treating a departure
 * as a continuing presence would park somebody in the square they left for the
 * rest of the day. And `travel.blocked` is ignored for placing people
 * altogether, because it has two shapes that disagree about what its location
 * means: a refusal fires where the traveller stands, but an interruption fires
 * at `stoppingAt`, the node *ahead* of them that they have not reached yet.
 * Since one of the two would place somebody where they have never been, neither
 * is trusted — and nothing is lost, because whatever arrival put the traveller
 * on that road already opened the stay.
 *
 * The result errs towards saying "you were not there". That is the right
 * direction for this to err in: the cost of being too strict is a villager with
 * nothing to say today, and the cost of being too loose is a villager who knows
 * something they were never told.
 */

/** A departure ends a stay. The literal is here rather than imported: see the header. */
const DEPARTURE = 'travel.departed';

/** Ignored when placing people, because its location means two different things. */
const BLOCKED = 'travel.blocked';

/**
 * One unbroken spell in one place: `[from, until)`.
 *
 * Half-open so that no tick belongs to two places at once. When a stay ends
 * because something put the person somewhere else, it ends *at* that tick and
 * the new place owns it. When it ends because they walked away, it ends at
 * `tick + 1`, because they were still standing there for the departure itself.
 */
export interface Stay {
  readonly place: EntityId;
  readonly from: Tick;
  /** Exclusive. `null` means the stay was still open when the day ended. */
  readonly until: Tick | null;
}

export class Whereabouts {
  private readonly trails = new Map<EntityId, Stay[]>();

  /**
   * Walk the day once and lay down everybody's movements.
   *
   * In archive order, which is what makes the trails sorted without sorting
   * them: event ids ascend and ticks never go backwards, so each new mark
   * belongs at the end of the trail it extends.
   */
  constructor(day: ChronicleDay) {
    for (const event of day.events) {
      if (event.location === undefined) continue;
      if (event.type === BLOCKED) continue;
      for (const actor of event.actors) {
        this.mark(actor, event.location, event.tick, event.type === DEPARTURE);
      }
    }
  }

  /** How many people this day has a trail for. */
  get size(): number {
    return this.trails.size;
  }

  /** Somebody's movements through the day, earliest first. */
  trailOf(actor: EntityId): readonly Stay[] {
    return this.trails.get(actor) ?? NONE;
  }

  /**
   * Where somebody was at one moment, or `undefined` for on the road.
   *
   * Searched backwards, because a trail is short — a busy villager has a few
   * dozen stays in a day — and the moments asked about cluster near the ones
   * that put them there. A binary search would be the same answer more
   * carefully.
   */
  placeAt(actor: EntityId, tick: Tick): EntityId | undefined {
    const trail = this.trails.get(actor);
    if (trail === undefined) return undefined;
    for (let index = trail.length - 1; index >= 0; index--) {
      const stay = trail[index] as Stay;
      if (stay.from > tick) continue;
      if (stay.until !== null && tick >= stay.until) return undefined;
      return stay.place;
    }
    return undefined;
  }

  /**
   * May this person write about this event?
   *
   * The whole honesty rule, in one function, so that a test can aim at it and
   * so that there is exactly one place to change when Phase 5 replaces the
   * proxy with real memory.
   *
   * Taking part counts even when the event says nothing about where it happened
   * — a villager turning in for the night is not told which room they are in by
   * the event, and they knew anyway. Watching requires a place, and requires it
   * to be the place they were standing in at that tick.
   */
  saw(actor: EntityId, event: SimEvent): boolean {
    if (event.actors.includes(actor)) return true;
    if (event.location === undefined) return false;
    return this.placeAt(actor, event.tick) === event.location;
  }

  /** Everything somebody may write about today, in archive order. */
  witnessed(day: ChronicleDay, actor: EntityId): readonly SimEvent[] {
    return day.events.filter((event) => this.saw(actor, event));
  }

  private mark(actor: EntityId, place: EntityId, tick: Tick, leaving: boolean): void {
    const trail = this.trails.get(actor);
    if (trail === undefined) {
      this.trails.set(actor, [{ place, from: tick, until: leaving ? tick + 1 : null }]);
      return;
    }

    const open = trail[trail.length - 1] as Stay;
    assert(tick >= open.from, 'the day went backwards', { actor, tick, from: open.from });

    if (open.until === null && open.place === place) {
      // Still here. Only a departure changes anything, and it ends the stay
      // rather than starting a second one in the same spot.
      if (leaving) trail[trail.length - 1] = { ...open, until: tick + 1 };
      return;
    }

    // Somewhere new, or somewhere again after a walk. Close whatever is open --
    // at this tick, not after it, so the place they have just turned up in owns
    // the moment rather than the one they left.
    if (open.until === null) trail[trail.length - 1] = { ...open, until: tick };
    trail.push({ place, from: tick, until: leaving ? tick + 1 : null });
  }
}

const NONE: readonly Stay[] = Object.freeze([]);
