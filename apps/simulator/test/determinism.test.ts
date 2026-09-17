import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type EventSink,
  JsonFileSaveStore,
  MemorySaveStore,
  RngStream,
  type SimEvent,
  TICKS_PER_DAY,
  days,
} from '@rpgsim/sim-core';
import {
  type ProbeWorld,
  attachProbeWorld,
  createProbeWorld,
  probeWorldFactory,
  fingerprintRun,
  verifyDeterminism,
} from '../src/index.ts';

/**
 * The Phase 0 acceptance suite.
 *
 * The kickoff brief requires proof of five things before Phase 0 can close:
 * seeded RNG reproducibility, stable event ordering, deterministic scheduler
 * execution, save/load continuation, and identical replay from identical
 * inputs. Each has a section below, tested against the probe world rather than
 * against the kernel in isolation, because determinism is a whole-system
 * property: a single unordered iteration anywhere breaks it.
 */

const SEED = 'phase-zero-acceptance';

/** Captures the complete event stream, past the log's retention window. */
class RecordingSink implements EventSink {
  readonly id = 'test-recorder';
  readonly events: SimEvent[] = [];

  write(event: SimEvent): void {
    this.events.push(event);
  }

  /** Comparable projection: id, tick, type and actors, ignoring nothing that matters. */
  signature(): string[] {
    return this.events.map(
      (e) => `${e.id}@${e.tick}:${e.type}:${e.actors.join(',')}:${JSON.stringify(e.data)}`,
    );
  }
}

function recordedWorld(seed: string, probes = 10): { world: ProbeWorld; sink: RecordingSink } {
  const world = createProbeWorld({ seed, probes });
  const sink = new RecordingSink();
  world.sim.log.addSink(sink);
  return { world, sink };
}

describe('identical replay from identical inputs', () => {
  it('produces identical state hashes at every day boundary', () => {
    const a = fingerprintRun(createProbeWorld({ seed: SEED, probes: 10 }), 40);
    const b = fingerprintRun(createProbeWorld({ seed: SEED, probes: 10 }), 40);
    expect(a).toEqual(b);
    // A run that did nothing would also be trivially equal, so prove it moved.
    expect(new Set(a).size).toBe(40);
  });

  it('produces an identical event stream, not merely an identical end state', () => {
    const first = recordedWorld(SEED);
    const second = recordedWorld(SEED);
    first.world.sim.runFor(days(20));
    second.world.sim.runFor(days(20));

    expect(first.sink.events.length).toBeGreaterThan(1_000);
    expect(first.sink.signature()).toEqual(second.sink.signature());
  });

  it('leaves the two worlds with identical pending schedules', () => {
    const a = createProbeWorld({ seed: SEED, probes: 10 });
    const b = createProbeWorld({ seed: SEED, probes: 10 });
    a.sim.runFor(days(15));
    b.sim.runFor(days(15));

    const pending = (world: ProbeWorld) =>
      world.sim.scheduler.pendingInOrder().map((e) => `${e.tick}/${e.priority}/${e.kind}`);
    expect(pending(a).length).toBeGreaterThan(0);
    expect(pending(a)).toEqual(pending(b));
  });

  it('consumes exactly the same amount of randomness from every stream', () => {
    const a = createProbeWorld({ seed: SEED, probes: 10 });
    const b = createProbeWorld({ seed: SEED, probes: 10 });
    a.sim.runFor(days(15));
    b.sim.runFor(days(15));

    const draws = (world: ProbeWorld) =>
      Object.fromEntries(
        world.sim.rng
          .activeStreamNames()
          .map((name) => [name, world.sim.random(name).draws] as const),
      );
    expect(Object.keys(draws(a))).toContain(RngStream.NpcDecisions);
    expect(draws(a)).toEqual(draws(b));
  });

  it('gives a different history for a different seed', () => {
    const a = createProbeWorld({ seed: SEED, probes: 10 });
    const b = createProbeWorld({ seed: `${SEED}-other`, probes: 10 });
    a.sim.runFor(days(15));
    b.sim.runFor(days(15));
    expect(a.sim.hash()).not.toBe(b.sim.hash());
  });
});

describe('deterministic scheduler execution', () => {
  it('reaches the same state regardless of how the caller slices the run', () => {
    const byDay = createProbeWorld({ seed: SEED, probes: 8 });
    for (let day = 1; day <= 10; day++) byDay.sim.runUntil(day * TICKS_PER_DAY);

    const oneJump = createProbeWorld({ seed: SEED, probes: 8 });
    oneJump.sim.runUntil(days(10));

    const ragged = createProbeWorld({ seed: SEED, probes: 8 });
    for (const chunk of [7, 60, 3_600, 86_399, 1, 200_000, 500_000]) ragged.sim.runFor(chunk);
    ragged.sim.runUntil(days(10));

    const stepwise = createProbeWorld({ seed: SEED, probes: 8 });
    while (stepwise.sim.step(days(10))) {
      /* one event at a time */
    }
    stepwise.sim.runUntil(days(10));

    expect(oneJump.sim.hash()).toBe(byDay.sim.hash());
    expect(ragged.sim.hash()).toBe(byDay.sim.hash());
    expect(stepwise.sim.hash()).toBe(byDay.sim.hash());
  });

  it('never moves the clock past the horizon it was given', () => {
    const world = createProbeWorld({ seed: SEED, probes: 8 });
    for (let day = 1; day <= 5; day++) {
      world.sim.runUntil(day * TICKS_PER_DAY);
      expect(world.sim.tick).toBe(day * TICKS_PER_DAY);
      const next = world.sim.scheduler.peekTick();
      expect(next).toBeGreaterThan(world.sim.tick);
    }
  });

  it('records events in non-decreasing tick order with strictly increasing ids', () => {
    const { world, sink } = recordedWorld(SEED);
    world.sim.runFor(days(10));

    for (let i = 1; i < sink.events.length; i++) {
      const previous = sink.events[i - 1] as SimEvent;
      const current = sink.events[i] as SimEvent;
      expect(current.id).toBe(previous.id + 1);
      expect(current.tick).toBeGreaterThanOrEqual(previous.tick);
    }
  });
});

describe('save/load continuation', () => {
  it('continues a reloaded world exactly as if it had never stopped', () => {
    const control = recordedWorld(SEED);
    control.world.sim.runFor(days(30));

    const interrupted = recordedWorld(SEED);
    interrupted.world.sim.runFor(days(12));

    const store = new MemorySaveStore();
    interrupted.world.sim.saveTo(store, 'midway');

    const resumed = attachProbeWorld({ seed: SEED, probes: 10 });
    const resumedSink = new RecordingSink();
    resumed.sim.log.addSink(resumedSink);
    resumed.sim.loadFrom(store, 'midway');
    resumed.sim.runUntil(days(30));

    expect(resumed.sim.tick).toBe(control.world.sim.tick);
    expect(resumed.sim.hash()).toBe(control.world.sim.hash());

    // The events after the resume point must match the control run's tail.
    const tail = control.sink.signature().slice(interrupted.sink.events.length);
    expect(resumedSink.signature()).toEqual(tail);
    expect(tail.length).toBeGreaterThan(500);
  });

  it('survives repeated save/reload cycles without drifting', () => {
    const control = createProbeWorld({ seed: SEED, probes: 8 });
    control.sim.runFor(days(24));

    const store = new MemorySaveStore();
    let world = createProbeWorld({ seed: SEED, probes: 8 });
    for (let segment = 1; segment <= 6; segment++) {
      world.sim.runUntil(segment * days(4));
      world.sim.saveTo(store, 'chain');
      world = attachProbeWorld({ seed: SEED, probes: 8 });
      world.sim.loadFrom(store, 'chain');
    }

    expect(world.sim.tick).toBe(days(24));
    expect(world.sim.hash()).toBe(control.sim.hash());
  });

  it('round-trips through a JSON file on disk', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rpgsim-phase0-'));
    try {
      const control = createProbeWorld({ seed: SEED, probes: 8 });
      control.sim.runFor(days(20));

      const original = createProbeWorld({ seed: SEED, probes: 8 });
      original.sim.runFor(days(9));
      const store = new JsonFileSaveStore(directory);
      original.sim.saveTo(store, 'disk-slot');

      const resumed = attachProbeWorld({ seed: SEED, probes: 8 });
      resumed.sim.loadFrom(store, 'disk-slot');
      resumed.sim.runUntil(days(20));

      expect(store.list()).toEqual(['disk-slot']);
      expect(resumed.sim.hash()).toBe(control.sim.hash());
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('resumes correctly from a save taken while a cancellable event is pending', () => {
    // A save at an arbitrary boundary rarely lands in the window where a
    // dropped scheduler handle would matter: the handle only matters if a storm
    // cancels that specific pending event. So find the first tick at which a
    // cancellation actually happens, and save one tick before it.
    const scout = createProbeWorld({ seed: SEED, probes: 10 });
    let disturbedTick = -1;
    scout.sim.subscribe('probe.disturbed', (event) => {
      if (disturbedTick < 0) disturbedTick = event.tick;
    });
    scout.sim.runUntil(days(30));
    expect(disturbedTick).toBeGreaterThan(0);
    const saveTick = disturbedTick - 1;

    const control = createProbeWorld({ seed: SEED, probes: 10 });
    control.sim.runUntil(days(30));

    const original = createProbeWorld({ seed: SEED, probes: 10 });
    original.sim.runUntil(saveTick);
    const store = new MemorySaveStore();
    original.sim.saveTo(store, 'mid-rest');

    const resumed = attachProbeWorld({ seed: SEED, probes: 10 });
    resumed.sim.loadFrom(store, 'mid-rest');
    resumed.sim.runUntil(days(30));

    expect(resumed.sim.hash()).toBe(control.sim.hash());
  });

  it('preserves cancellable scheduled-event handles across a save', () => {
    // Probes hold scheduler ids for their pending rests; if restore reissued
    // ids, a storm would cancel the wrong event or nothing at all.
    const world = createProbeWorld({ seed: SEED, probes: 12 });
    world.sim.runFor(days(6));

    const store = new MemorySaveStore();
    world.sim.saveTo(store, 'handles');

    const resumed = attachProbeWorld({ seed: SEED, probes: 12 });
    resumed.sim.loadFrom(store, 'handles');
    expect(resumed.sim.assertInvariants().violations).toEqual([]);
  });

  it('refuses to load a save from a different seed', () => {
    const store = new MemorySaveStore();
    createProbeWorld({ seed: SEED, probes: 4 }).sim.saveTo(store, 'slot');
    const other = attachProbeWorld({ seed: 'unrelated', probes: 4 });
    expect(() => other.sim.loadFrom(store, 'slot')).toThrow(/different world seed/);
  });
});

describe('world invariants under sustained running', () => {
  let world: ProbeWorld;

  beforeEach(() => {
    world = createProbeWorld({ seed: SEED, probes: 20 });
  });

  afterEach(() => {
    world.sim.log.close();
  });

  it('holds every invariant at each of 60 day boundaries', () => {
    for (let day = 1; day <= 60; day++) {
      world.sim.runUntil(day * TICKS_PER_DAY);
      const report = world.sim.assertInvariants();
      expect(report.violations, `day ${day}`).toEqual([]);
    }
  });

  it('keeps the event log bounded while the world keeps running', () => {
    const bounded = createProbeWorld({ seed: SEED, probes: 20 });
    bounded.sim.log.addSink({ id: 'noop', write: () => {} });
    bounded.sim.runFor(days(30));
    expect(bounded.sim.log.recent().length).toBeLessThanOrEqual(2_000);
    expect(bounded.sim.log.count).toBeGreaterThan(2_000);
  });

  it('keeps time moving and work happening', () => {
    world.sim.runFor(days(30));
    expect(world.sim.tick).toBe(days(30));
    expect(world.sim.eventsProcessed).toBeGreaterThan(1_000);
    expect(world.population).toBe(20);
  });
});

describe('the verify command', () => {
  it('passes for several unrelated seeds', () => {
    for (const seed of ['alpha', 'beta-42', 'a very long seed string with spaces']) {
      const report = verifyDeterminism({ seed, days: 12, world: probeWorldFactory({ probes: 6 }) });
      const failures = report.checks.filter((check) => !check.passed);
      expect(failures, seed).toEqual([]);
      expect(report.passed).toBe(true);
    }
  });

  it('exercises the single-probe boundary', () => {
    expect(verifyDeterminism({ seed: 'lonely', days: 8, world: probeWorldFactory({ probes: 1 }) }).passed).toBe(true);
  });
});
