import {
  BinaryHeap,
  type JsonObject,
  type JsonValue,
  assert,
  assertInt,
  isJsonObject,
} from '@rpgsim/shared';
import type { Tick } from './calendar.ts';

/**
 * Ordering bands for events that fall on the same tick.
 *
 * Lower runs first. The bands are spaced by 100 so a system can nudge an event
 * slightly earlier or later within its band without colliding with a
 * neighbouring one.
 *
 * These numbers are part of the save format: an old save's pending events carry
 * their priority, so changing a constant here changes the order in which a
 * loaded world resumes. Add new bands in the gaps rather than renumbering.
 */
export const Priority = {
  /** Clock rollovers, day boundaries, maintenance. Runs before anything reacts. */
  System: 0,
  /** Weather, temperature, daylight. The physical backdrop for the tick. */
  Environment: 100,
  /** Crops, animals, natural processes. */
  Ecology: 200,
  /** Hunger, fatigue, illness progression, healing. */
  Physiology: 300,
  /** Arrival at a destination; position becomes current. */
  Movement: 400,
  /** An in-progress action reaching its end. */
  ActionComplete: 500,
  /** Perception and memory formation from what just happened. */
  Perception: 600,
  /** Utility AI choosing the next action. Runs after the world is settled. */
  Decision: 700,
  /** Production, markets, wages, price updates. */
  Economy: 800,
  /** Gossip, gatherings, relationship drift. */
  Social: 900,
  /** Statistics, invariant sweeps, archival. Runs last. */
  Bookkeeping: 1000,
} as const;

export type PriorityValue = (typeof Priority)[keyof typeof Priority] | number;

/** Handle for cancelling a scheduled event. */
export type ScheduledEventId = number;

/**
 * A pending future action.
 *
 * Note the deliberate split from `SimEvent` (see `events.ts`): a
 * `ScheduledEvent` is an *intent* that has not happened yet and may still be
 * cancelled, while a `SimEvent` is a *fact* that has already happened and is
 * immutable. Merging the two is a common mistake that makes the event log
 * untrustworthy as history.
 */
export interface ScheduledEvent<P extends JsonValue = JsonValue> {
  readonly id: ScheduledEventId;
  readonly tick: Tick;
  readonly priority: number;
  /** Insertion order, used only to break exact ties. Never reused. */
  readonly seq: number;
  /** Selects the registered handler. Handlers are never serialized. */
  readonly kind: string;
  readonly payload: P;
}

interface HeapNode {
  readonly event: ScheduledEvent;
  cancelled: boolean;
}

/**
 * Total ordering of pending events.
 *
 * `tick` then `priority` then `seq` is a total order with no ties, because
 * `seq` is unique. That matters more than it looks: a comparator with ties
 * would leave the order up to heap internals, and the same world would replay
 * differently after an unrelated refactor.
 */
function compareNodes(a: HeapNode, b: HeapNode): number {
  if (a.event.tick !== b.event.tick) return a.event.tick - b.event.tick;
  if (a.event.priority !== b.event.priority) return a.event.priority - b.event.priority;
  return a.event.seq - b.event.seq;
}

export interface SchedulerSnapshot {
  readonly nextId: number;
  readonly nextSeq: number;
  readonly pending: readonly ScheduledEvent[];
}

/**
 * Deterministic priority queue of future events.
 *
 * Cancellation is lazy: the node is flagged and skipped when it surfaces, which
 * keeps cancel O(1) and avoids an O(n) heap rebuild. `liveCount` tracks the
 * real size so callers are not misled by tombstones.
 */
export class Scheduler {
  private readonly heap = new BinaryHeap<HeapNode>(compareNodes);
  private readonly byId = new Map<ScheduledEventId, HeapNode>();
  private nextId = 1;
  private nextSeq = 1;
  private liveCount = 0;

  /** Number of pending, uncancelled events. */
  get size(): number {
    return this.liveCount;
  }

  /** Tick of the next event that will actually run, or undefined if idle. */
  peekTick(): Tick | undefined {
    const node = this.peekLive();
    return node?.event.tick;
  }

  peek(): ScheduledEvent | undefined {
    return this.peekLive()?.event;
  }

  /** Schedule an event at an absolute tick. */
  scheduleAt<P extends JsonValue>(
    tick: Tick,
    kind: string,
    payload: P,
    priority: PriorityValue = Priority.System,
  ): ScheduledEventId {
    assertInt(tick, 'scheduled tick must be an integer', { kind });
    assert(tick >= 0, 'cannot schedule an event before the epoch', { kind, tick });
    assertInt(priority, 'priority must be an integer', { kind, priority });
    assert(kind.length > 0, 'scheduled event kind must be non-empty');

    const event: ScheduledEvent<P> = {
      id: this.nextId++,
      tick,
      priority,
      seq: this.nextSeq++,
      kind,
      payload,
    };
    const node: HeapNode = { event, cancelled: false };
    this.heap.push(node);
    this.byId.set(event.id, node);
    this.liveCount++;
    return event.id;
  }

  /** Cancel a pending event. Returns false if it was unknown or already gone. */
  cancel(id: ScheduledEventId): boolean {
    const node = this.byId.get(id);
    if (node === undefined || node.cancelled) return false;
    node.cancelled = true;
    this.byId.delete(id);
    this.liveCount--;
    return true;
  }

  isPending(id: ScheduledEventId): boolean {
    const node = this.byId.get(id);
    return node !== undefined && !node.cancelled;
  }

  /**
   * Remove and return the next event if it is due at or before `throughTick`.
   * Returns undefined when nothing is due, which is how the kernel knows to
   * stop or to jump forward.
   */
  popDue(throughTick: Tick): ScheduledEvent | undefined {
    for (;;) {
      const node = this.heap.peek();
      if (node === undefined) return undefined;
      if (node.cancelled) {
        this.heap.pop();
        continue;
      }
      if (node.event.tick > throughTick) return undefined;
      this.heap.pop();
      this.byId.delete(node.event.id);
      this.liveCount--;
      return node.event;
    }
  }

  clear(): void {
    this.heap.clear();
    this.byId.clear();
    this.liveCount = 0;
  }

  /**
   * Pending events in execution order.
   *
   * Sorted rather than raw heap order: two schedulers holding the same logical
   * set of events can have different internal arrays, and an unsorted dump
   * would produce two different state hashes for one world state.
   */
  pendingInOrder(): ScheduledEvent[] {
    const live: HeapNode[] = [];
    for (const node of this.heap.toArray()) {
      if (!node.cancelled) live.push(node);
    }
    live.sort(compareNodes);
    return live.map((node) => node.event);
  }

  save(): SchedulerSnapshot {
    return {
      nextId: this.nextId,
      nextSeq: this.nextSeq,
      pending: this.pendingInOrder(),
    };
  }

  /**
   * Replace all scheduler state.
   *
   * Original `id` and `seq` values are preserved, so a loaded world resolves
   * same-tick ties exactly as the original run did and outstanding
   * `ScheduledEventId` handles held by domain state stay valid.
   */
  restore(snapshot: SchedulerSnapshot): void {
    this.clear();
    this.nextId = snapshot.nextId;
    this.nextSeq = snapshot.nextSeq;
    for (const event of snapshot.pending) {
      assert(event.id < snapshot.nextId, 'scheduled event id is ahead of the id counter', {
        id: event.id,
        nextId: snapshot.nextId,
      });
      assert(event.seq < snapshot.nextSeq, 'scheduled event seq is ahead of the seq counter', {
        seq: event.seq,
        nextSeq: snapshot.nextSeq,
      });
      assert(!this.byId.has(event.id), 'duplicate scheduled event id in snapshot', { id: event.id });
      const node: HeapNode = { event, cancelled: false };
      this.heap.push(node);
      this.byId.set(event.id, node);
      this.liveCount++;
    }
  }

  toJson(): JsonObject {
    const snapshot = this.save();
    return {
      nextId: snapshot.nextId,
      nextSeq: snapshot.nextSeq,
      pending: snapshot.pending.map((event) => ({
        id: event.id,
        tick: event.tick,
        priority: event.priority,
        seq: event.seq,
        kind: event.kind,
        payload: event.payload,
      })),
    };
  }

  static fromJson(value: JsonValue): SchedulerSnapshot {
    assert(isJsonObject(value), 'scheduler snapshot must be an object');
    const nextId = value['nextId'];
    const nextSeq = value['nextSeq'];
    const pending = value['pending'];
    assert(typeof nextId === 'number', 'scheduler snapshot is missing nextId');
    assert(typeof nextSeq === 'number', 'scheduler snapshot is missing nextSeq');
    assert(Array.isArray(pending), 'scheduler snapshot is missing pending');

    return {
      nextId,
      nextSeq,
      pending: pending.map((raw, index) => {
        assert(isJsonObject(raw), 'pending event must be an object', { index });
        const id = raw['id'];
        const tick = raw['tick'];
        const priority = raw['priority'];
        const seq = raw['seq'];
        const kind = raw['kind'];
        assert(typeof id === 'number', 'pending event is missing id', { index });
        assert(typeof tick === 'number', 'pending event is missing tick', { index });
        assert(typeof priority === 'number', 'pending event is missing priority', { index });
        assert(typeof seq === 'number', 'pending event is missing seq', { index });
        assert(typeof kind === 'string', 'pending event is missing kind', { index });
        return { id, tick, priority, seq, kind, payload: raw['payload'] ?? null };
      }),
    };
  }

  private peekLive(): HeapNode | undefined {
    for (;;) {
      const node = this.heap.peek();
      if (node === undefined) return undefined;
      if (!node.cancelled) return node;
      this.heap.pop();
    }
  }
}
