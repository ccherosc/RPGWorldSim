import { type JsonObject, type JsonValue, assert, isJsonObject } from '@rpgsim/shared';
import type { SimEvent, SimEventId } from './events.ts';
import type { EntityId } from './ids.ts';

/**
 * Destination for the complete, unbounded event stream.
 *
 * The in-memory log keeps only a recent window (see `EventLog`), so anything
 * that needs full history - persistence, an observer feed, a file dump -
 * attaches a sink. Sinks must be pure consumers: writing to one must never feed
 * back into simulation state, or replay would depend on whether a sink was
 * attached.
 */
export interface EventSink {
  readonly id: string;
  write(event: SimEvent): void;
  flush?(): void;
  close?(): void;
}

export interface EventLogOptions {
  /**
   * How many recent events to keep in memory.
   *
   * CLAUDE.md's first objective calls out unbounded event growth as a failure
   * mode: a year of 100 NPCs produces millions of events, and keeping them all
   * resident would exhaust memory long before the year finished. The window is
   * for observation and short-range causal tracing; durable history is a sink's
   * job.
   */
  readonly retain?: number;
}

const DEFAULT_RETAIN = 2000;

export interface EventLogSnapshot {
  readonly nextEventId: number;
  readonly retained: readonly SimEvent[];
}

/** One step of a causal chain, annotated with how far back it sits. */
export interface CausalStep {
  readonly event: SimEvent;
  /** 0 for the event asked about, 1 for its direct causes, and so on. */
  readonly depth: number;
}

/**
 * Bounded in-memory event history plus fan-out to sinks.
 *
 * The retained window is a ring buffer over a plain array. Events are appended
 * in emission order, so the array is always sorted by id and can be searched
 * without extra indexes.
 */
export class EventLog {
  private readonly retain: number;
  private readonly sinks: EventSink[] = [];
  private buffer: SimEvent[] = [];
  private nextEventId = 1;
  private totalCount = 0;

  constructor(options: EventLogOptions = {}) {
    this.retain = options.retain ?? DEFAULT_RETAIN;
    assert(this.retain > 0, 'event log retention must be positive', { retain: this.retain });
  }

  /** Allocate the next event id. Only the kernel should call this. */
  allocateId(): SimEventId {
    return this.nextEventId++;
  }

  /** Record an event: fan out to sinks, then add to the retained window. */
  record(event: SimEvent): void {
    for (const sink of this.sinks) sink.write(event);
    this.buffer.push(event);
    this.totalCount++;
    if (this.buffer.length > this.retain) {
      this.buffer = this.buffer.slice(this.buffer.length - this.retain);
    }
  }

  /** Total events ever recorded, including those dropped from the window. */
  get count(): number {
    return this.totalCount;
  }

  /** Events currently held in memory, oldest first. */
  recent(limit = this.retain): readonly SimEvent[] {
    if (limit >= this.buffer.length) return this.buffer;
    return this.buffer.slice(this.buffer.length - limit);
  }

  /** Retained events matching a type or `prefix.` namespace, oldest first. */
  byType(typeFilter: string, limit = this.retain): SimEvent[] {
    const wildcard = typeFilter.endsWith('.');
    const matches = this.buffer.filter((event) =>
      wildcard ? event.type.startsWith(typeFilter) : event.type === typeFilter,
    );
    return matches.length > limit ? matches.slice(matches.length - limit) : matches;
  }

  /** Retained events involving an entity, oldest first. */
  byActor(actor: EntityId, limit = this.retain): SimEvent[] {
    const matches = this.buffer.filter((event) => event.actors.includes(actor));
    return matches.length > limit ? matches.slice(matches.length - limit) : matches;
  }

  /** Look up a retained event. Returns undefined once it falls out of the window. */
  find(id: SimEventId): SimEvent | undefined {
    // The buffer is sorted by id, so binary search.
    let low = 0;
    let high = this.buffer.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const candidate = this.buffer[mid] as SimEvent;
      if (candidate.id === id) return candidate;
      if (candidate.id < id) low = mid + 1;
      else high = mid - 1;
    }
    return undefined;
  }

  /**
   * Walk `causes` backwards from an event, breadth-first.
   *
   * This is the machinery behind "why did this happen?" in the observer. It
   * stops at `maxDepth` and silently skips causes that have aged out of the
   * retained window, so a chain may be shorter than the true history - callers
   * that need complete chains should query a sink instead.
   */
  trace(id: SimEventId, maxDepth = 8): CausalStep[] {
    const root = this.find(id);
    if (root === undefined) return [];

    const steps: CausalStep[] = [];
    const seen = new Set<SimEventId>([id]);
    let frontier: SimEvent[] = [root];
    let depth = 0;

    while (frontier.length > 0 && depth <= maxDepth) {
      for (const event of frontier) steps.push({ event, depth });
      if (depth === maxDepth) break;

      const next: SimEvent[] = [];
      for (const event of frontier) {
        for (const causeId of event.causes) {
          if (seen.has(causeId)) continue;
          seen.add(causeId);
          const cause = this.find(causeId);
          if (cause !== undefined) next.push(cause);
        }
      }
      frontier = next;
      depth++;
    }
    return steps;
  }

  addSink(sink: EventSink): void {
    assert(
      !this.sinks.some((existing) => existing.id === sink.id),
      'an event sink with this id is already attached',
      { id: sink.id },
    );
    this.sinks.push(sink);
  }

  removeSink(id: string): boolean {
    const index = this.sinks.findIndex((sink) => sink.id === id);
    if (index < 0) return false;
    const [sink] = this.sinks.splice(index, 1);
    sink?.close?.();
    return true;
  }

  flush(): void {
    for (const sink of this.sinks) sink.flush?.();
  }

  close(): void {
    for (const sink of this.sinks) {
      sink.flush?.();
      sink.close?.();
    }
    this.sinks.length = 0;
  }

  /**
   * Snapshot for saving.
   *
   * The retained window is included so a loaded world can still show a recent
   * event feed and trace short causal chains. `totalCount` is intentionally not
   * restored as a separate field; it is derived on load from `nextEventId`,
   * which is the authoritative counter.
   */
  save(): EventLogSnapshot {
    return { nextEventId: this.nextEventId, retained: [...this.buffer] };
  }

  restore(snapshot: EventLogSnapshot): void {
    this.nextEventId = snapshot.nextEventId;
    this.buffer = [...snapshot.retained];
    if (this.buffer.length > this.retain) {
      this.buffer = this.buffer.slice(this.buffer.length - this.retain);
    }
    this.totalCount = snapshot.nextEventId - 1;
  }

  toJson(): JsonObject {
    return {
      nextEventId: this.nextEventId,
      retained: this.buffer.map(eventToJson),
    };
  }

  static fromJson(value: JsonValue): EventLogSnapshot {
    assert(isJsonObject(value), 'event log snapshot must be an object');
    const nextEventId = value['nextEventId'];
    const retained = value['retained'];
    assert(typeof nextEventId === 'number', 'event log snapshot is missing nextEventId');
    assert(Array.isArray(retained), 'event log snapshot is missing retained');
    return { nextEventId, retained: retained.map(eventFromJson) };
  }
}

export function eventToJson(event: SimEvent): JsonObject {
  const json: JsonObject = {
    id: event.id,
    tick: event.tick,
    type: event.type,
    actors: [...event.actors],
    data: event.data,
    causes: [...event.causes],
  };
  // Omitted rather than written as null so the canonical form stays compact.
  if (event.location !== undefined) json['location'] = event.location;
  return json;
}

export function eventFromJson(value: JsonValue): SimEvent {
  assert(isJsonObject(value), 'event must be an object');
  const id = value['id'];
  const tick = value['tick'];
  const type = value['type'];
  const actors = value['actors'];
  const causes = value['causes'];
  assert(typeof id === 'number', 'event is missing id');
  assert(typeof tick === 'number', 'event is missing tick');
  assert(typeof type === 'string', 'event is missing type');
  assert(Array.isArray(actors), 'event is missing actors');
  assert(Array.isArray(causes), 'event is missing causes');

  const location = value['location'];
  return {
    id,
    tick,
    type,
    actors: actors as EntityId[],
    ...(typeof location === 'string' ? { location: location as EntityId } : {}),
    data: value['data'] ?? null,
    causes: causes as number[],
  };
}
