import { type JsonValue, assert, isJsonObject } from '@rpgsim/shared';
import {
  type CalendarConfig,
  DEFAULT_CALENDAR,
  type Tick,
  type WorldDateTime,
  formatDateTime,
} from './calendar.ts';
import { SimClock } from './clock.ts';
import { EventLog, type EventLogOptions } from './event-log.ts';
import {
  EventBus,
  type EventListener,
  type SimEvent,
  type SimEventDraft,
  type Unsubscribe,
} from './events.ts';
import { IdGenerator, type EntityId, type EntityKindName } from './ids.ts';
import {
  type Invariant,
  type InvariantReport,
  InvariantRegistry,
  type InvariantViolation,
  violation,
} from './invariants.ts';
import { RngStreams, type RngStreamName } from './rng-streams.ts';
import type { Rng } from './rng.ts';
import {
  Priority,
  type PriorityValue,
  Scheduler,
  type ScheduledEvent,
  type ScheduledEventId,
} from './scheduler.ts';
import {
  type SaveEnvelope,
  type SaveModule,
  SaveRegistry,
  type SaveStore,
  hashEnvelope,
} from './save.ts';

export const ENGINE_VERSION = '0.1.0-phase0';

/** Handler for one kind of scheduled event. */
export type ScheduledEventHandler<P extends JsonValue = JsonValue> = (
  sim: Simulation,
  event: ScheduledEvent<P>,
) => void;

export interface SimulationOptions {
  /** Everything random in the world derives from this. */
  readonly seed: string;
  readonly calendar?: CalendarConfig;
  readonly startTick?: Tick;
  readonly eventLog?: EventLogOptions;
  /**
   * Safety valve for runaway same-tick scheduling.
   *
   * A handler that reschedules itself at the current tick would spin forever
   * without advancing time, and the process would simply hang with no clue why.
   * This turns that into an immediate, named error.
   */
  readonly maxEventsPerRun?: number;
  readonly engineVersion?: string;
}

export interface RunResult {
  readonly eventsProcessed: number;
  readonly fromTick: Tick;
  readonly toTick: Tick;
  /** True if the run ended because the scheduler had nothing left to do. */
  readonly idle: boolean;
}

const DEFAULT_MAX_EVENTS_PER_RUN = 50_000_000;
const CORE_SAVE_MODULE_ID = 'core';
const CORE_SAVE_MODULE_VERSION = 1;

/**
 * The simulation kernel.
 *
 * Owns the five things every domain system needs and nothing medieval-specific
 * (ARCHITECTURE.md: "sim-core should contain as little medieval-specific
 * knowledge as possible"): the clock, the named RNG streams, the scheduler of
 * future events, the bus and log of recorded events, and entity id allocation.
 *
 * The execution model is a single-threaded event loop. `runUntil` repeatedly
 * pops the earliest due `ScheduledEvent`, moves the clock to that event's tick,
 * and dispatches it to the handler registered for its kind. Nothing is polled
 * per tick, so an empty night costs nothing.
 *
 * Determinism comes from four guarantees held here:
 *   - scheduler ordering is a strict total order (tick, priority, seq),
 *   - handlers are looked up by name, never by closure identity or iteration,
 *   - RNG state lives in the save and is restored exactly,
 *   - event bus dispatch is in registration order with queued re-entrancy.
 */
export class Simulation {
  readonly seed: string;
  readonly engineVersion: string;
  readonly clock: SimClock;
  readonly rng: RngStreams;
  readonly ids: IdGenerator;
  readonly scheduler: Scheduler;
  readonly bus: EventBus;
  readonly log: EventLog;
  readonly saves: SaveRegistry;
  readonly invariants: InvariantRegistry<Simulation>;

  private readonly handlers = new Map<string, ScheduledEventHandler>();
  private readonly maxEventsPerRun: number;
  private processed = 0;
  /** The scheduled event currently being dispatched, for causal attribution. */
  private activeEvent: ScheduledEvent | undefined;

  constructor(options: SimulationOptions) {
    assert(options.seed.length > 0, 'simulation seed must be a non-empty string');

    this.seed = options.seed;
    this.engineVersion = options.engineVersion ?? ENGINE_VERSION;
    this.clock = new SimClock(options.calendar ?? DEFAULT_CALENDAR, options.startTick ?? 0);
    this.rng = new RngStreams(options.seed);
    this.ids = new IdGenerator();
    this.scheduler = new Scheduler();
    this.bus = new EventBus();
    this.log = new EventLog(options.eventLog ?? {});
    this.saves = new SaveRegistry();
    this.invariants = new InvariantRegistry<Simulation>();
    this.maxEventsPerRun = options.maxEventsPerRun ?? DEFAULT_MAX_EVENTS_PER_RUN;

    this.saves.register(this.coreSaveModule());
    registerCoreInvariants(this.invariants);
  }

  // --- time -----------------------------------------------------------------

  get tick(): Tick {
    return this.clock.tick;
  }

  get calendar(): CalendarConfig {
    return this.clock.calendar;
  }

  now(): WorldDateTime {
    return this.clock.now();
  }

  /** Total scheduled events dispatched over this world's whole lifetime. */
  get eventsProcessed(): number {
    return this.processed;
  }

  // --- randomness -----------------------------------------------------------

  /** Get a named RNG stream. Prefer the `RngStream` constants over literals. */
  random(stream: RngStreamName): Rng {
    return this.rng.stream(stream);
  }

  // --- entities -------------------------------------------------------------

  newId(kind: EntityKindName): EntityId {
    return this.ids.next(kind);
  }

  // --- scheduling -----------------------------------------------------------

  /** Register the handler for a kind of scheduled event. */
  on<P extends JsonValue>(kind: string, handler: ScheduledEventHandler<P>): void {
    assert(!this.handlers.has(kind), 'a handler for this event kind is already registered', {
      kind,
    });
    this.handlers.set(kind, handler as ScheduledEventHandler);
  }

  hasHandler(kind: string): boolean {
    return this.handlers.has(kind);
  }

  /** Schedule at an absolute tick. Must not be in the past. */
  scheduleAt<P extends JsonValue>(
    tick: Tick,
    kind: string,
    payload: P,
    priority: PriorityValue = Priority.System,
  ): ScheduledEventId {
    assert(tick >= this.clock.tick, 'cannot schedule an event in the past', {
      kind,
      tick,
      now: this.clock.tick,
    });
    return this.scheduler.scheduleAt(tick, kind, payload, priority);
  }

  /** Schedule `delay` ticks from now. A delay of 0 runs later in the same tick. */
  schedule<P extends JsonValue>(
    delay: number,
    kind: string,
    payload: P,
    priority: PriorityValue = Priority.System,
  ): ScheduledEventId {
    assert(delay >= 0, 'cannot schedule an event with a negative delay', { kind, delay });
    return this.scheduleAt(this.clock.tick + delay, kind, payload, priority);
  }

  cancel(id: ScheduledEventId): boolean {
    return this.scheduler.cancel(id);
  }

  /**
   * Fail fast if any pending event has no handler.
   *
   * After loading a save this is the check that catches "the caller forgot to
   * register the systems", which would otherwise surface as a confusing error
   * hours of simulated time later.
   */
  validateHandlers(): void {
    const missing = new Set<string>();
    for (const event of this.scheduler.pendingInOrder()) {
      if (!this.handlers.has(event.kind)) missing.add(event.kind);
    }
    assert(missing.size === 0, 'pending scheduled events have no registered handler', {
      kinds: [...missing].sort(),
    });
  }

  // --- recorded events ------------------------------------------------------

  subscribe(listener: EventListener): Unsubscribe;
  subscribe(typeFilter: string, listener: EventListener): Unsubscribe;
  subscribe(a: string | EventListener, b?: EventListener): Unsubscribe {
    return typeof a === 'string'
      ? this.bus.subscribe(a, b as EventListener)
      : this.bus.subscribe(a);
  }

  /**
   * Record that something happened: assigns an id and the current tick, writes
   * it to the log and sinks, then notifies subscribers.
   */
  emit<T extends JsonValue>(draft: SimEventDraft<T>): SimEvent<T> {
    assert(draft.type.length > 0, 'event type must be non-empty');
    const event: SimEvent<T> = {
      id: this.log.allocateId(),
      tick: this.clock.tick,
      type: draft.type,
      actors: draft.actors ?? [],
      ...(draft.location !== undefined ? { location: draft.location } : {}),
      data: (draft.data ?? null) as T,
      causes: draft.causes ?? [],
    };
    this.log.record(event);
    this.bus.publish(event);
    return event;
  }

  /** The scheduled event being dispatched, if any. Useful for `WHY?` context. */
  get currentScheduledEvent(): ScheduledEvent | undefined {
    return this.activeEvent;
  }

  // --- execution ------------------------------------------------------------

  /**
   * Dispatch the single next due event, if it falls at or before `throughTick`.
   * Returns false when nothing is due.
   */
  step(throughTick: Tick = Number.MAX_SAFE_INTEGER): boolean {
    const event = this.scheduler.popDue(throughTick);
    if (event === undefined) return false;
    this.dispatch(event);
    return true;
  }

  /**
   * Run until simulated time reaches `targetTick`.
   *
   * Time only moves to the tick of an event that is actually due, then jumps to
   * `targetTick` once the queue is drained, so idle stretches are free.
   */
  runUntil(targetTick: Tick): RunResult {
    const fromTick = this.clock.tick;
    assert(targetTick >= fromTick, 'cannot run backwards', { fromTick, targetTick });

    let count = 0;
    for (;;) {
      const event = this.scheduler.popDue(targetTick);
      if (event === undefined) break;

      count++;
      assert(
        count <= this.maxEventsPerRun,
        'run exceeded the event budget; a handler is probably rescheduling itself at the same tick',
        { kind: event.kind, tick: event.tick, budget: this.maxEventsPerRun },
      );
      this.dispatch(event);
    }

    this.clock.advanceTo(targetTick);
    return {
      eventsProcessed: count,
      fromTick,
      toTick: targetTick,
      idle: this.scheduler.size === 0,
    };
  }

  /** Run for a duration. `runFor(days(7))` reads better than tick arithmetic. */
  runFor(ticks: number): RunResult {
    return this.runUntil(this.clock.tick + ticks);
  }

  // --- invariants -----------------------------------------------------------

  registerInvariant(invariant: Invariant<Simulation>): void {
    this.invariants.register(invariant);
  }

  checkInvariants(): InvariantReport {
    return this.invariants.run(this, this.clock.tick);
  }

  assertInvariants(): InvariantReport {
    return this.invariants.assert(this, this.clock.tick);
  }

  // --- persistence ----------------------------------------------------------

  registerSaveModule(module: SaveModule): void {
    this.saves.register(module);
  }

  save(createdAt?: string): SaveEnvelope {
    return this.saves.save({
      engineVersion: this.engineVersion,
      seed: this.seed,
      tick: this.clock.tick,
      ...(createdAt !== undefined ? { createdAt } : {}),
    });
  }

  saveTo(store: SaveStore, key: string): SaveEnvelope {
    const envelope = this.save();
    store.write(key, envelope);
    return envelope;
  }

  /**
   * Restore world state from a save into this instance.
   *
   * Handlers, subscribers, sinks and invariants are *not* restored - the caller
   * must have wired those up already, exactly as for a fresh world. That is
   * what keeps saves free of serialized code and portable across builds.
   */
  load(envelope: SaveEnvelope): void {
    assert(envelope.seed === this.seed, 'refusing to load a save from a different world seed', {
      expected: this.seed,
      received: envelope.seed,
    });
    this.saves.load(envelope);
    this.validateHandlers();
  }

  loadFrom(store: SaveStore, key: string): void {
    const envelope = store.read(key);
    assert(envelope !== undefined, 'save not found', { key });
    this.load(envelope);
  }

  /**
   * Fingerprint of the entire world state.
   *
   * Equal hashes at equal ticks is the operational definition of "the same
   * world history" used throughout the determinism tests.
   */
  hash(): string {
    return hashEnvelope(this.save('1970-01-01T00:00:00.000Z'));
  }

  /** `Seedtide 4, 1200 (Midweek) 06:32:10` */
  format(): string {
    return formatDateTime(this.clock.tick, this.calendar);
  }

  // --- internals ------------------------------------------------------------

  private dispatch(event: ScheduledEvent): void {
    const handler = this.handlers.get(event.kind);
    assert(handler !== undefined, 'no handler registered for scheduled event kind', {
      kind: event.kind,
      tick: event.tick,
    });

    this.clock.advanceTo(event.tick);
    this.processed++;
    this.activeEvent = event;
    try {
      handler(this, event);
    } finally {
      this.activeEvent = undefined;
    }
  }

  private coreSaveModule(): SaveModule {
    return {
      id: CORE_SAVE_MODULE_ID,
      version: CORE_SAVE_MODULE_VERSION,
      save: (): JsonValue => ({
        tick: this.clock.tick,
        eventsProcessed: this.processed,
        rng: this.rng.toJson(),
        ids: this.ids.toJson(),
        scheduler: this.scheduler.toJson(),
        eventLog: this.log.toJson(),
      }),
      load: (data: JsonValue): void => {
        assert(isJsonObject(data), 'core save block must be an object');
        const tick = data['tick'];
        const eventsProcessed = data['eventsProcessed'];
        assert(typeof tick === 'number', 'core save block is missing tick');
        assert(typeof eventsProcessed === 'number', 'core save block is missing eventsProcessed');

        this.clock.restore(tick);
        this.processed = eventsProcessed;
        this.rng.restore(RngStreams.fromJson(data['rng'] ?? null));
        this.ids.restore(IdGenerator.fromJson(data['ids'] ?? null));
        this.scheduler.restore(Scheduler.fromJson(data['scheduler'] ?? null));
        this.log.restore(EventLog.fromJson(data['eventLog'] ?? null));
      },
    };
  }
}

/** Invariants sim-core owns, covering the concepts it introduces. */
function registerCoreInvariants(registry: InvariantRegistry<Simulation>): void {
  registry.register({
    id: 'core.no-scheduled-event-in-the-past',
    description: 'Every pending scheduled event lies at or after the current tick.',
    check: (sim) => {
      const next = sim.scheduler.peek();
      if (next !== undefined && next.tick < sim.tick) {
        return [
          violation(
            'core.no-scheduled-event-in-the-past',
            'a pending event is scheduled before the current tick',
            { kind: next.kind, eventTick: next.tick, now: sim.tick },
          ),
        ];
      }
      return [];
    },
  });

  registry.register({
    id: 'core.event-log-ordering',
    description: 'Recorded events have strictly increasing ids and non-decreasing ticks.',
    check: (sim) => {
      const violations: InvariantViolation[] = [];
      const events = sim.log.recent();
      for (let i = 1; i < events.length; i++) {
        const previous = events[i - 1] as SimEvent;
        const current = events[i] as SimEvent;
        if (current.id <= previous.id) {
          violations.push(
            violation('core.event-log-ordering', 'event ids are not strictly increasing', {
              previousId: previous.id,
              currentId: current.id,
            }),
          );
        }
        if (current.tick < previous.tick) {
          violations.push(
            violation('core.event-log-ordering', 'an event was recorded before an earlier event', {
              previousTick: previous.tick,
              currentTick: current.tick,
              type: current.type,
            }),
          );
        }
      }
      return violations;
    },
  });

  registry.register({
    id: 'core.rng-state-valid',
    description: 'No RNG stream has fallen into the all-zero absorbing state.',
    check: (sim) => {
      const violations: InvariantViolation[] = [];
      const snapshot = sim.rng.save();
      for (const [name, state] of Object.entries(snapshot.streams)) {
        if ((state.s0 | state.s1 | state.s2 | state.s3) === 0) {
          violations.push(
            violation('core.rng-state-valid', 'RNG stream reached the all-zero state', { stream: name }),
          );
        }
      }
      return violations;
    },
  });
}
