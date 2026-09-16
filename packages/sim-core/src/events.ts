import { type JsonValue, assert } from '@rpgsim/shared';
import type { Tick } from './calendar.ts';
import type { EntityId } from './ids.ts';

/** Monotonic identifier for a recorded event. Never reused within a world. */
export type SimEventId = number;

/**
 * A structured record of something that has already happened.
 *
 * Simulation rule 8 / prime directive 8: every meaningful state change emits
 * one of these. They serve five jobs at once, which is why the shape is fixed:
 *   - the observer's event feed,
 *   - the raw material NPC perception turns into memories,
 *   - statistics and the Chronicler,
 *   - causal inspection (`causes` chains back to why this happened),
 *   - debugging a divergent replay.
 *
 * Events are immutable facts. Anything that might still be cancelled or
 * reconsidered is a `ScheduledEvent` instead.
 */
export interface SimEvent<T extends JsonValue = JsonValue> {
  readonly id: SimEventId;
  readonly tick: Tick;
  /** Dotted type, e.g. `npc.woke`, `market.sale`, `household.birth`. */
  readonly type: string;
  /** Entities that participated, in a stable order (usually actor first). */
  readonly actors: readonly EntityId[];
  /** Where it happened, when that is meaningful. */
  readonly location?: EntityId;
  /** Type-specific detail. Must be JSON; it is persisted verbatim. */
  readonly data: T;
  /** Ids of earlier events that caused this one. Powers `WHY?` chains. */
  readonly causes: readonly SimEventId[];
}

/** What a caller supplies; id and tick are filled in by the kernel. */
export interface SimEventDraft<T extends JsonValue = JsonValue> {
  readonly type: string;
  readonly actors?: readonly EntityId[];
  readonly location?: EntityId;
  readonly data?: T;
  readonly causes?: readonly SimEventId[];
}

export type EventListener = (event: SimEvent) => void;

/** Returned by `subscribe`; call it to stop listening. */
export type Unsubscribe = () => void;

interface Subscription {
  readonly id: number;
  readonly typeFilter: string | undefined;
  readonly listener: EventListener;
  active: boolean;
}

/**
 * Synchronous, deterministic publish/subscribe for recorded events.
 *
 * Two properties matter for replay:
 *
 * 1. **Dispatch order is registration order.** Listeners are invoked in the
 *    order they subscribed, never in `Map` or `Set` iteration order that could
 *    shift under refactoring.
 *
 * 2. **Emission during dispatch is queued, not re-entrant.** A listener that
 *    forms a memory and emits `npc.remembered` does not interleave itself into
 *    the middle of the current event's listener list. The new event is appended
 *    and dispatched once the current one finishes, giving a breadth-first,
 *    stack-safe, obviously-ordered cascade.
 */
export class EventBus {
  private readonly subscriptions: Subscription[] = [];
  private readonly queue: SimEvent[] = [];
  private nextSubscriptionId = 1;
  private dispatching = false;
  private compactPending = false;

  /** Listen to every event. */
  subscribe(listener: EventListener): Unsubscribe;
  /** Listen to one exact event type, or a `prefix.` wildcard like `npc.`. */
  subscribe(typeFilter: string, listener: EventListener): Unsubscribe;
  subscribe(a: string | EventListener, b?: EventListener): Unsubscribe {
    const typeFilter = typeof a === 'string' ? a : undefined;
    const listener = typeof a === 'string' ? (b as EventListener) : a;
    assert(typeof listener === 'function', 'event listener must be a function');

    const subscription: Subscription = {
      id: this.nextSubscriptionId++,
      typeFilter,
      listener,
      active: true,
    };
    this.subscriptions.push(subscription);

    return () => {
      if (!subscription.active) return;
      subscription.active = false;
      // Removing mid-dispatch would shift the array under the loop, so defer.
      if (this.dispatching) this.compactPending = true;
      else this.removeSubscription(subscription.id);
    };
  }

  /** Publish an already-built event. The kernel is the normal caller. */
  publish(event: SimEvent): void {
    this.queue.push(event);
    if (this.dispatching) return;

    this.dispatching = true;
    try {
      // Index-based so events appended by listeners are picked up in this pass.
      for (let i = 0; i < this.queue.length; i++) {
        this.dispatch(this.queue[i] as SimEvent);
      }
    } finally {
      this.queue.length = 0;
      this.dispatching = false;
      if (this.compactPending) {
        this.compactPending = false;
        this.compact();
      }
    }
  }

  /** Number of active listeners. Used by invariant checks and tests. */
  get listenerCount(): number {
    let count = 0;
    for (const subscription of this.subscriptions) if (subscription.active) count++;
    return count;
  }

  private dispatch(event: SimEvent): void {
    for (const subscription of this.subscriptions) {
      if (!subscription.active) continue;
      if (!matchesFilter(subscription.typeFilter, event.type)) continue;
      subscription.listener(event);
    }
  }

  private removeSubscription(id: number): void {
    const index = this.subscriptions.findIndex((s) => s.id === id);
    if (index >= 0) this.subscriptions.splice(index, 1);
  }

  private compact(): void {
    for (let i = this.subscriptions.length - 1; i >= 0; i--) {
      if (!(this.subscriptions[i] as Subscription).active) this.subscriptions.splice(i, 1);
    }
  }
}

/**
 * `undefined` matches everything, a trailing `.` matches a namespace prefix
 * (`npc.` matches `npc.woke`), anything else must match exactly.
 */
function matchesFilter(filter: string | undefined, type: string): boolean {
  if (filter === undefined) return true;
  if (filter.endsWith('.')) return type.startsWith(filter);
  return filter === type;
}
