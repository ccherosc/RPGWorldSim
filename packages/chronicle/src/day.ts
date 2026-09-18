import { assert } from '@rpgsim/shared';
import type { EntityId, SimEvent, SimEventId } from '@rpgsim/sim-core';
import type { PeopleRegister } from './people.ts';
import { PUBLIC, type PlaceRegister } from './places.ts';

/**
 * One day of the archive, turned the way the press needs to read it.
 *
 * The archive is written the way the simulation produces it — one long stream,
 * in the order things happened — which is the right shape for replaying a day
 * and the wrong shape for writing about one. A reporter asks "what happened to
 * Winifred today", "what happened on the green", "how unusual is this"; all
 * three are scans of the whole day unless somebody indexes it once. This does,
 * at construction, and then answers in constant time.
 *
 * It is a read model and nothing else: it holds no opinion about what matters
 * (that is `score.ts`), picks nothing (that is `select.ts`) and writes no
 * prose. It also never *mutates* the events it was handed, so two passes over
 * the same day see the same day.
 *
 * Every index is built by walking the events in archive order, so every list it
 * hands back is in archive order too — no sorting, no `Set` whose order came
 * from somewhere unaccountable. Archive order is total (event ids ascend) and
 * reproducible from the seed, which makes it the only ordering here worth
 * having.
 */

export interface ChronicleDayOptions {
  /** `1200-04-02`. The day these events belong to. */
  readonly key: string;
  /** The day's events, in archive order. */
  readonly events: readonly SimEvent[];
  /** The record's people, for turning actor ids into somebody. */
  readonly people: PeopleRegister;
  /** The record's places, for turning location ids into somewhere. */
  readonly places: PlaceRegister;
}

const NONE: readonly SimEvent[] = Object.freeze([]);

export class ChronicleDay {
  readonly key: string;
  readonly events: readonly SimEvent[];
  readonly people: PeopleRegister;
  readonly places: PlaceRegister;

  private readonly byEventId = new Map<SimEventId, SimEvent>();
  private readonly perActor = new Map<EntityId, SimEvent[]>();
  private readonly perPlace = new Map<EntityId, SimEvent[]>();
  private readonly perType = new Map<string, SimEvent[]>();
  private readonly presence = new Map<EntityId, Set<EntityId>>();

  constructor(options: ChronicleDayOptions) {
    this.key = options.key;
    this.events = options.events;
    this.people = options.people;
    this.places = options.places;

    for (const event of options.events) {
      assert(!this.byEventId.has(event.id), 'two events in a day share an id', {
        day: this.key,
        event: event.id,
      });
      this.byEventId.set(event.id, event);
      push(this.perType, event.type, event);
      if (event.location !== undefined) push(this.perPlace, event.location, event);
      for (const actor of event.actors) {
        push(this.perActor, actor, event);
        if (event.location !== undefined) this.witness(actor, event.location);
      }
    }
  }

  get size(): number {
    return this.events.length;
  }

  /** The event an id names. Throws rather than hand back nothing to write about. */
  require(id: SimEventId): SimEvent {
    const event = this.byEventId.get(id);
    assert(event !== undefined, 'this day holds no such event', { day: this.key, event: id });
    return event as SimEvent;
  }

  find(id: SimEventId): SimEvent | undefined {
    return this.byEventId.get(id);
  }

  /** Everything somebody took part in today, in archive order. */
  byActor(actor: EntityId): readonly SimEvent[] {
    return this.perActor.get(actor) ?? NONE;
  }

  /** Everything that happened somewhere today, in archive order. */
  byPlace(place: EntityId): readonly SimEvent[] {
    return this.perPlace.get(place) ?? NONE;
  }

  /** Every event of a kind today, in archive order. */
  byType(type: string): readonly SimEvent[] {
    return this.perType.get(type) ?? NONE;
  }

  /**
   * How many times a kind of thing happened today.
   *
   * The score's measure of rarity, and the reason it is measured per day rather
   * than held in a config file: what counts as remarkable is a fact about the
   * day, not a constant. On an ordinary day sixteen people are turned back from
   * a full cottage and it is barely worth a line; on the day one person is, it
   * is the story. A weight written into a file cannot tell those apart.
   */
  countOf(type: string): number {
    return this.perType.get(type)?.length ?? 0;
  }

  /** Every kind of thing that happened today, in the order each first did. */
  types(): readonly string[] {
    return [...this.perType.keys()];
  }

  /** Everybody who did anything today, in the order each first did. */
  actors(): readonly EntityId[] {
    return [...this.perActor.keys()];
  }

  /**
   * Everywhere somebody was today.
   *
   * Slice 5 turns this into an honesty rule: a villager may write about what
   * happened where they were, and may not write about what happened elsewhere.
   * So it is built conservatively, from one fact only — an event names a place
   * and names them as an actor, therefore they were there. Nothing is inferred
   * from intent. `travel.blocked` says where somebody *wanted* to go, and they
   * are credited with the doorstep they were turned back on, never with the
   * room they never entered.
   */
  presenceOf(actor: EntityId): ReadonlySet<EntityId> {
    // A fresh set for somebody who was nowhere, rather than one shared empty
    // one. `Object.freeze` does not close a `Set` -- it seals the object's own
    // properties and leaves `add` working on the internal slots -- so a single
    // caller who cast the readonly type away would have quietly taught the day
    // that everybody had been wherever they put.
    return this.presence.get(actor) ?? new Set<EntityId>();
  }

  /** Was this somewhere anybody could have seen it? Unknown places are not. */
  isPublic(place: EntityId | undefined): boolean {
    if (place === undefined) return false;
    return this.places.find(place)?.access === PUBLIC;
  }

  private witness(actor: EntityId, place: EntityId): void {
    const seen = this.presence.get(actor);
    if (seen === undefined) this.presence.set(actor, new Set([place]));
    else seen.add(place);
  }
}

function push<K>(index: Map<K, SimEvent[]>, key: K, event: SimEvent): void {
  const held = index.get(key);
  if (held === undefined) index.set(key, [event]);
  else held.push(event);
}
