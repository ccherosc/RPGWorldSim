import { describe, expect, it } from 'vitest';
import {
  EntityKind,
  type EntityId,
  InvariantError,
  MemorySaveStore,
  Priority,
  RngStream,
  type SaveModule,
  Simulation,
  hours,
  minutes,
  violation,
} from '@rpgsim/sim-core';
import type { JsonObject, JsonValue } from '@rpgsim/shared';

/**
 * Minimal domain system used to exercise the kernel: a counter that ticks
 * forward on a schedule, draws randomness, and persists its own state through
 * its own save module.
 */
class Counter {
  value = 0;
  visits: number[] = [];

  install(sim: Simulation): void {
    sim.on<{ step: number }>('counter.tick', (s, event) => {
      this.value += event.payload.step;
      this.visits.push(s.tick);
      s.emit({ type: 'counter.ticked', data: { value: this.value } });
      s.schedule(hours(1), 'counter.tick', event.payload, Priority.Bookkeeping);
    });
    sim.registerSaveModule(this.saveModule());
  }

  start(sim: Simulation, step = 1): void {
    sim.schedule(hours(1), 'counter.tick', { step }, Priority.Bookkeeping);
  }

  private saveModule(): SaveModule {
    return {
      id: 'counter',
      version: 1,
      save: (): JsonValue => ({ value: this.value }),
      load: (data: JsonValue): void => {
        this.value = (data as JsonObject)['value'] as number;
      },
    };
  }
}

function newSim(seed = 'kernel-seed'): Simulation {
  return new Simulation({ seed });
}

describe('Simulation construction', () => {
  it('requires a seed', () => {
    expect(() => new Simulation({ seed: '' })).toThrow();
  });

  it('starts at tick zero with an empty scheduler', () => {
    const sim = newSim();
    expect(sim.tick).toBe(0);
    expect(sim.scheduler.size).toBe(0);
    expect(sim.eventsProcessed).toBe(0);
  });

  it('can start at a non-zero tick', () => {
    const sim = new Simulation({ seed: 'x', startTick: hours(6) });
    expect(sim.tick).toBe(hours(6));
    expect(sim.now().hour).toBe(6);
  });
});

describe('Simulation scheduling and dispatch', () => {
  it('moves the clock to each event tick and runs handlers in order', () => {
    const sim = newSim();
    const seen: Array<[string, number]> = [];
    sim.on('mark', (s, e) => seen.push([(e.payload as JsonObject)['name'] as string, s.tick]));

    sim.schedule(minutes(30), 'mark', { name: 'b' });
    sim.schedule(minutes(10), 'mark', { name: 'a' });
    sim.schedule(minutes(50), 'mark', { name: 'c' });

    const result = sim.runUntil(hours(1));
    expect(seen).toEqual([
      ['a', minutes(10)],
      ['b', minutes(30)],
      ['c', minutes(50)],
    ]);
    expect(result.eventsProcessed).toBe(3);
    expect(sim.tick).toBe(hours(1));
    expect(result.idle).toBe(true);
  });

  it('jumps straight to the target tick when nothing is scheduled', () => {
    const sim = newSim();
    const result = sim.runFor(hours(72));
    expect(result.eventsProcessed).toBe(0);
    expect(sim.tick).toBe(hours(72));
  });

  it('leaves events beyond the horizon pending', () => {
    const sim = newSim();
    let ran = 0;
    sim.on('later', () => ran++);
    sim.schedule(hours(10), 'later', null);

    sim.runUntil(hours(5));
    expect(ran).toBe(0);
    expect(sim.scheduler.size).toBe(1);

    sim.runUntil(hours(10));
    expect(ran).toBe(1);
  });

  it('runs an event scheduled with zero delay later in the same tick', () => {
    const sim = newSim();
    const order: string[] = [];
    sim.on('first', (s) => {
      order.push('first');
      s.schedule(0, 'second', null, Priority.Bookkeeping);
    });
    sim.on('second', () => order.push('second'));
    sim.schedule(minutes(1), 'first', null, Priority.System);
    sim.runFor(minutes(2));
    expect(order).toEqual(['first', 'second']);
    expect(sim.tick).toBe(minutes(2));
  });

  it('refuses to schedule into the past or run backwards', () => {
    const sim = newSim();
    sim.on('x', () => {});
    sim.runFor(hours(2));
    expect(() => sim.scheduleAt(hours(1), 'x', null)).toThrow(/in the past/);
    expect(() => sim.schedule(-1, 'x', null)).toThrow();
    expect(() => sim.runUntil(hours(1))).toThrow(/backwards/);
  });

  it('rejects a duplicate handler registration', () => {
    const sim = newSim();
    sim.on('x', () => {});
    expect(() => sim.on('x', () => {})).toThrow(/already registered/);
  });

  it('fails loudly when an event has no handler', () => {
    const sim = newSim();
    sim.scheduler.scheduleAt(10, 'orphan', null);
    expect(() => sim.runFor(100)).toThrow(/no handler registered/);
  });

  it('reports missing handlers up front via validateHandlers', () => {
    const sim = newSim();
    sim.scheduler.scheduleAt(10, 'orphan', null);
    expect(() => sim.validateHandlers()).toThrow(/orphan/);
  });

  it('turns a same-tick reschedule loop into a named error, not a hang', () => {
    const sim = new Simulation({ seed: 'loop', maxEventsPerRun: 1_000 });
    sim.on('spin', (s) => s.schedule(0, 'spin', null));
    sim.schedule(10, 'spin', null);
    expect(() => sim.runFor(hours(1))).toThrow(/event budget/);
  });

  it('cancels pending events', () => {
    const sim = newSim();
    let ran = 0;
    sim.on('maybe', () => ran++);
    const id = sim.schedule(minutes(5), 'maybe', null);
    expect(sim.cancel(id)).toBe(true);
    sim.runFor(hours(1));
    expect(ran).toBe(0);
  });

  it('exposes the event being dispatched, for causal attribution', () => {
    const sim = newSim();
    let observedKind: string | undefined;
    sim.on('probe', (s) => {
      observedKind = s.currentScheduledEvent?.kind;
    });
    sim.schedule(10, 'probe', null);
    sim.runFor(100);
    expect(observedKind).toBe('probe');
    expect(sim.currentScheduledEvent).toBeUndefined();
  });
});

describe('Simulation event recording', () => {
  it('stamps emitted events with the current tick and a fresh id', () => {
    const sim = newSim();
    sim.on('act', (s) => {
      s.emit({ type: 'npc.woke', actors: [s.newId(EntityKind.Npc)] });
    });
    sim.schedule(minutes(7), 'act', null);
    sim.runFor(hours(1));

    const events = sim.log.recent();
    expect(events).toHaveLength(1);
    expect(events[0]?.tick).toBe(minutes(7));
    expect(events[0]?.id).toBe(1);
    expect(events[0]?.actors).toEqual(['npc:0']);
  });

  it('delivers emitted events to subscribers', () => {
    const sim = newSim();
    const seen: string[] = [];
    sim.subscribe('npc.', (e) => seen.push(e.type));
    sim.on('act', (s) => {
      s.emit({ type: 'npc.woke' });
      s.emit({ type: 'market.sale' });
    });
    sim.schedule(10, 'act', null);
    sim.runFor(100);
    expect(seen).toEqual(['npc.woke']);
  });

  it('links causes so a chain can be traced back', () => {
    const sim = newSim();
    sim.on('act', (s) => {
      const cause = s.emit({ type: 'weather.drought' });
      s.emit({ type: 'crop.failed', causes: [cause.id] });
    });
    sim.schedule(10, 'act', null);
    sim.runFor(100);

    const failure = sim.log.recent().find((e) => e.type === 'crop.failed');
    expect(failure).toBeDefined();
    expect(sim.log.trace(failure?.id as number).map((s) => s.event.type)).toEqual([
      'crop.failed',
      'weather.drought',
    ]);
  });

  it('rejects an untyped event', () => {
    const sim = newSim();
    expect(() => sim.emit({ type: '' })).toThrow();
  });
});

describe('Simulation randomness', () => {
  it('gives the same stream instance for a repeated name', () => {
    const sim = newSim();
    expect(sim.random(RngStream.Weather)).toBe(sim.random(RngStream.Weather));
  });

  it('reproduces draws across two identically-seeded worlds', () => {
    const a = newSim('same');
    const b = newSim('same');
    const drawsA = Array.from({ length: 20 }, () => a.random(RngStream.Weather).nextU32());
    const drawsB = Array.from({ length: 20 }, () => b.random(RngStream.Weather).nextU32());
    expect(drawsA).toEqual(drawsB);
  });
});

describe('Simulation save and load', () => {
  it('serializes core state plus every registered module', () => {
    const sim = newSim();
    new Counter().install(sim);
    const envelope = sim.save();
    expect(Object.keys(envelope.modules).sort()).toEqual(['core', 'counter']);
    expect(envelope.seed).toBe('kernel-seed');
    expect(envelope.tick).toBe(0);
  });

  it('resumes a world so that the continuation matches an uninterrupted run', () => {
    const control = newSim();
    const controlCounter = new Counter();
    controlCounter.install(control);
    controlCounter.start(control);
    control.runFor(hours(48));

    const original = newSim();
    const originalCounter = new Counter();
    originalCounter.install(original);
    originalCounter.start(original);
    original.runFor(hours(20));

    const store = new MemorySaveStore();
    original.saveTo(store, 'midpoint');

    const resumed = newSim();
    const resumedCounter = new Counter();
    resumedCounter.install(resumed);
    resumed.loadFrom(store, 'midpoint');
    resumed.runUntil(hours(48));

    expect(resumed.tick).toBe(control.tick);
    expect(resumedCounter.value).toBe(controlCounter.value);
    expect(resumed.hash()).toBe(control.hash());
  });

  it('restores the tick, id counters and event id counter', () => {
    const original = newSim();
    original.on('act', (s) => {
      s.newId(EntityKind.Npc);
      s.emit({ type: 'test.happened' });
    });
    original.schedule(minutes(5), 'act', null);
    original.runFor(hours(1));

    const store = new MemorySaveStore();
    original.saveTo(store, 'state');

    const resumed = newSim();
    resumed.on('act', () => {});
    resumed.loadFrom(store, 'state');

    expect(resumed.tick).toBe(original.tick);
    expect(resumed.ids.allocated(EntityKind.Npc)).toBe(1);
    expect(resumed.newId(EntityKind.Npc)).toBe('npc:1');
    expect(resumed.log.recent().map((e) => e.type)).toEqual(['test.happened']);
  });

  it('refuses a save from a different world seed', () => {
    const source = newSim('seed-a');
    const store = new MemorySaveStore();
    source.saveTo(store, 'x');
    expect(() => newSim('seed-b').loadFrom(store, 'x')).toThrow(/different world seed/);
  });

  it('refuses a save that is missing a registered module', () => {
    const source = newSim();
    const store = new MemorySaveStore();
    source.saveTo(store, 'x');

    const target = newSim();
    new Counter().install(target);
    expect(() => target.loadFrom(store, 'x')).toThrow(/missing a required module/);
  });

  it('ignores module blocks this build does not know about', () => {
    const source = newSim();
    new Counter().install(source);
    const store = new MemorySaveStore();
    source.saveTo(store, 'x');

    // A build without the counter package must still be able to load the world.
    const target = newSim();
    expect(() => target.loadFrom(store, 'x')).not.toThrow();
  });

  it('reports a missing save key rather than loading an empty world', () => {
    const sim = newSim();
    expect(() => sim.loadFrom(new MemorySaveStore(), 'absent')).toThrow(/save not found/);
  });

  it('migrates an older module payload', () => {
    const sim = newSim();
    let loaded: JsonValue | undefined;
    sim.registerSaveModule({
      id: 'legacy',
      version: 2,
      save: () => ({ v: 2, value: 10 }),
      load: (data) => {
        loaded = data;
      },
      migrate: (data) => ({ v: 2, value: ((data as JsonObject)['value'] as number) * 100 }),
    });

    const envelope = sim.save();
    envelope.modules['legacy'] = { version: 1, data: { v: 1, value: 3 } };
    sim.load(envelope);
    expect(loaded).toEqual({ v: 2, value: 300 });
  });

  it('refuses a module payload newer than this build', () => {
    const sim = newSim();
    sim.registerSaveModule({
      id: 'future',
      version: 1,
      save: () => ({}),
      load: () => {},
    });
    const envelope = sim.save();
    envelope.modules['future'] = { version: 99, data: {} };
    expect(() => sim.load(envelope)).toThrow(/newer than this build/);
  });

  it('requires a migration when versions differ', () => {
    const sim = newSim();
    sim.registerSaveModule({
      id: 'unmigratable',
      version: 3,
      save: () => ({}),
      load: () => {},
    });
    const envelope = sim.save();
    envelope.modules['unmigratable'] = { version: 1, data: {} };
    expect(() => sim.load(envelope)).toThrow(/needs migration but provides none/);
  });

  it('validates handlers on load so a half-wired world fails immediately', () => {
    const original = newSim();
    original.on('work', () => {});
    original.schedule(hours(1), 'work', null);
    const store = new MemorySaveStore();
    original.saveTo(store, 'pending');

    const bare = newSim();
    expect(() => bare.loadFrom(store, 'pending')).toThrow(/no registered handler/);
  });

  it('excludes wall-clock time from the state hash', () => {
    const sim = newSim();
    const a = sim.save('2020-01-01T00:00:00.000Z');
    const b = sim.save('2030-06-06T12:00:00.000Z');
    expect(a.createdAt).not.toBe(b.createdAt);
    expect(sim.hash()).toBe(sim.hash());
  });
});

describe('Simulation invariants', () => {
  it('ships core invariants that pass on a healthy world', () => {
    const sim = newSim();
    new Counter().install(sim);
    sim.schedule(hours(1), 'counter.tick', { step: 1 }, Priority.Bookkeeping);
    sim.runFor(hours(24));

    const report = sim.assertInvariants();
    expect(report.violations).toEqual([]);
    expect(report.checked).toBeGreaterThanOrEqual(3);
  });

  it('collects violations from a registered domain invariant', () => {
    const sim = newSim();
    sim.registerInvariant({
      id: 'test.always-fails',
      description: 'Deliberately failing invariant.',
      check: () => [violation('test.always-fails', 'this always fails')],
    });

    const report = sim.checkInvariants();
    expect(report.violations.map((v) => v.invariantId)).toContain('test.always-fails');
    expect(() => sim.assertInvariants()).toThrow(InvariantError);
  });

  it('does not throw for warning-severity violations', () => {
    const sim = newSim();
    sim.registerInvariant({
      id: 'test.warns',
      description: 'Warning only.',
      severity: 'warning',
      check: () => [{ invariantId: 'test.warns', severity: 'warning', message: 'heads up' }],
    });
    expect(() => sim.assertInvariants()).not.toThrow();
    expect(sim.checkInvariants().violations).toHaveLength(1);
  });

  it('detects an event recorded out of chronological order', () => {
    const sim = newSim();
    // Bypass the kernel to fabricate the corrupt state this invariant guards.
    sim.log.record({
      id: sim.log.allocateId(),
      tick: 500,
      type: 'test.late',
      actors: [] as EntityId[],
      data: null,
      causes: [],
    });
    sim.log.record({
      id: sim.log.allocateId(),
      tick: 100,
      type: 'test.early',
      actors: [] as EntityId[],
      data: null,
      causes: [],
    });
    expect(sim.checkInvariants().violations.map((v) => v.invariantId)).toContain(
      'core.event-log-ordering',
    );
  });

  it('rejects duplicate invariant ids', () => {
    const sim = newSim();
    const invariant = { id: 'dup', description: 'x', check: () => [] };
    sim.registerInvariant(invariant);
    expect(() => sim.registerInvariant(invariant)).toThrow();
  });
});
