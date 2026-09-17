import { clamp, clamp01 } from '@rpgsim/shared';
import {
  type CalendarConfig,
  type EntityId,
  EntityKind,
  Priority,
  RngStream,
  type SaveModule,
  type ScheduledEventId,
  Simulation,
  TICKS_PER_DAY,
  minutes,
  nextTimeOfDay,
  violation,
} from '@rpgsim/sim-core';
import type { WorldFactory } from './verify.ts';

/**
 * A deliberately trivial world used to exercise the Phase 0 kernel.
 *
 * This is NOT the World Zero village and must not grow into it. It has no
 * economy, no needs model, no knowledge model and no spatial model, because
 * Phase 0 owns none of those. Its only job is to put the kernel under a load
 * that has every property determinism depends on:
 *
 *   - many agents drawing from several named RNG streams,
 *   - events at several priorities colliding on the same tick,
 *   - events that schedule further events at varying delays,
 *   - scheduled events that are cancelled before they fire,
 *   - recorded events with causal links,
 *   - mutable per-agent state persisted through its own save module.
 *
 * When Phase 1 introduces real villagers, this harness stays as a fast
 * regression probe for the kernel itself.
 */

export const PROBE_SAVE_MODULE_ID = 'probe-world';
const PROBE_SAVE_MODULE_VERSION = 1;

/** Dawn is the daily heartbeat that drives weather and wakes every probe. */
const DAWN_HOUR = 6;
const REST_THRESHOLD = 25;
const MAX_ENERGY = 100;

export const PROBE_EVENT = {
  Dawn: 'probe.dawn',
  Act: 'probe.act',
  Rest: 'probe.rest',
} as const;

const WEATHER = ['clear', 'overcast', 'rain', 'storm'] as const;
// Storms are over-represented relative to anything plausible on purpose: the
// storm branch is the only cancellation path in the harness, and a path that
// fires twice a month is a path the acceptance tests cannot see.
const WEATHER_WEIGHTS = [4, 3, 2, 3];
export type ProbeWeather = (typeof WEATHER)[number];

interface ProbeState {
  id: EntityId;
  energy: number;
  mood: number;
  actions: number;
  rests: number;
  /** Handle of this probe's pending rest, so a storm can cancel it. */
  pendingRest: ScheduledEventId | null;
}

export interface ProbeWorldOptions {
  readonly seed: string;
  readonly probes?: number;
  /** Defaults to the built-in calendar; the CLI loads it from `data/`. */
  readonly calendar?: CalendarConfig;
  /** Forwarded to the kernel; tests use a small window to exercise eviction. */
  readonly retainEvents?: number;
}

const DEFAULT_PROBE_COUNT = 12;

export class ProbeWorld {
  readonly sim: Simulation;

  private probes: ProbeState[] = [];
  private weather: ProbeWeather = 'clear';
  private readonly probeCount: number;

  constructor(options: ProbeWorldOptions) {
    this.probeCount = options.probes ?? DEFAULT_PROBE_COUNT;
    this.sim = new Simulation({
      seed: options.seed,
      ...(options.calendar !== undefined ? { calendar: options.calendar } : {}),
      ...(options.retainEvents !== undefined ? { eventLog: { retain: options.retainEvents } } : {}),
    });
    this.install();
  }

  /**
   * Build a fresh world. Never call this on a world that is about to be loaded
   * from a save: the save already contains the probes and their schedule.
   */
  populate(): this {
    for (let i = 0; i < this.probeCount; i++) {
      const rng = this.sim.random(RngStream.NpcGeneration);
      this.probes.push({
        id: this.sim.newId(EntityKind.Npc),
        energy: rng.nextIntInclusive(60, MAX_ENERGY),
        mood: rng.nextGaussianClamped(0.5, 0.15, 0, 1),
        actions: 0,
        rests: 0,
        pendingRest: null,
      });
    }

    this.sim.scheduleAt(
      nextTimeOfDay(this.sim.tick, DAWN_HOUR),
      PROBE_EVENT.Dawn,
      null,
      Priority.Environment,
    );

    // Every probe starts acting at the same tick on purpose: same-tick ties are
    // exactly where an unstable ordering would first show up.
    for (let i = 0; i < this.probes.length; i++) {
      this.sim.schedule(minutes(1), PROBE_EVENT.Act, { probe: i }, Priority.Decision);
    }
    return this;
  }

  get population(): number {
    return this.probes.length;
  }

  get currentWeather(): ProbeWeather {
    return this.weather;
  }

  /** Cheap, human-readable state summary for the CLI and for eyeball debugging. */
  summary(): string {
    const totalActions = this.probes.reduce((sum, p) => sum + p.actions, 0);
    const totalRests = this.probes.reduce((sum, p) => sum + p.rests, 0);
    const meanEnergy = this.probes.reduce((sum, p) => sum + p.energy, 0) / this.probes.length;
    return [
      `${this.sim.format()}`,
      `probes=${this.probes.length}`,
      `weather=${this.weather}`,
      `actions=${totalActions}`,
      `rests=${totalRests}`,
      `meanEnergy=${meanEnergy.toFixed(2)}`,
      `events=${this.sim.eventsProcessed}`,
    ].join('  ');
  }

  // --- wiring ---------------------------------------------------------------

  private install(): void {
    this.sim.on(PROBE_EVENT.Dawn, (sim) => {
      const rng = sim.random(RngStream.Weather);
      const previous = this.weather;
      this.weather = rng.pickWeighted(WEATHER, (_w, i) => WEATHER_WEIGHTS[i] as number);
      const change = sim.emit({
        type: 'weather.changed',
        data: { from: previous, to: this.weather },
      });

      if (this.weather === 'storm') {
        // A storm turns every planned rest into an interrupted one. This is the
        // cancellation path: the pending event is removed and replaced, and the
        // replacement is causally attributed to the storm.
        for (let i = 0; i < this.probes.length; i++) {
          const probe = this.probes[i] as ProbeState;
          if (probe.pendingRest === null) continue;
          sim.cancel(probe.pendingRest);
          probe.pendingRest = null;
          probe.mood = clamp01(probe.mood - 0.05);
          sim.emit({
            type: 'probe.disturbed',
            actors: [probe.id],
            data: { weather: this.weather },
            causes: [change.id],
          });
          sim.schedule(minutes(5), PROBE_EVENT.Act, { probe: i }, Priority.Decision);
        }
      }

      sim.schedule(TICKS_PER_DAY, PROBE_EVENT.Dawn, null, Priority.Environment);
    });

    this.sim.on<{ probe: number }>(PROBE_EVENT.Act, (sim, event) => {
      const index = event.payload.probe;
      const probe = this.probes[index] as ProbeState;
      const rng = sim.random(RngStream.NpcDecisions);

      const effort = rng.nextIntInclusive(1, 6) + (this.weather === 'storm' ? 2 : 0);
      probe.energy = clamp(probe.energy - effort, 0, MAX_ENERGY);
      probe.mood = clamp01(probe.mood + (rng.nextFloat() - 0.5) * 0.02);
      probe.actions++;

      const acted = sim.emit({
        type: 'probe.acted',
        actors: [probe.id],
        data: { effort, energy: probe.energy },
      });

      if (probe.energy <= REST_THRESHOLD) {
        probe.pendingRest = sim.schedule(
          minutes(rng.nextIntInclusive(90, 480)),
          PROBE_EVENT.Rest,
          { probe: index },
          Priority.Physiology,
        );
        sim.emit({
          type: 'probe.tired',
          actors: [probe.id],
          data: { energy: probe.energy },
          causes: [acted.id],
        });
        return;
      }

      sim.schedule(
        minutes(rng.nextIntInclusive(10, 90)),
        PROBE_EVENT.Act,
        { probe: index },
        Priority.Decision,
      );
    });

    this.sim.on<{ probe: number }>(PROBE_EVENT.Rest, (sim, event) => {
      const index = event.payload.probe;
      const probe = this.probes[index] as ProbeState;
      const rng = sim.random(RngStream.Health);

      probe.pendingRest = null;
      probe.energy = clamp(probe.energy + rng.nextIntInclusive(30, 70), 0, MAX_ENERGY);
      probe.mood = clamp01(probe.mood + 0.02);
      probe.rests++;

      sim.emit({
        type: 'probe.rested',
        actors: [probe.id],
        data: { energy: probe.energy },
      });
      sim.schedule(
        minutes(rng.nextIntInclusive(10, 60)),
        PROBE_EVENT.Act,
        { probe: index },
        Priority.Decision,
      );
    });

    this.sim.registerSaveModule(this.saveModule());
    this.registerInvariants();
  }

  private saveModule(): SaveModule {
    return {
      id: PROBE_SAVE_MODULE_ID,
      version: PROBE_SAVE_MODULE_VERSION,
      save: () => ({
        weather: this.weather,
        probes: this.probes.map((probe) => ({
          id: probe.id as string,
          energy: probe.energy,
          mood: probe.mood,
          actions: probe.actions,
          rests: probe.rests,
          pendingRest: probe.pendingRest,
        })),
      }),
      load: (data) => {
        const parsed = data as {
          weather: ProbeWeather;
          probes: Array<Omit<ProbeState, 'id'> & { id: string }>;
        };
        this.weather = parsed.weather;
        this.probes = parsed.probes.map((probe) => ({ ...probe, id: probe.id as EntityId }));
      },
    };
  }

  private registerInvariants(): void {
    this.sim.registerInvariant({
      id: 'probe.energy-in-range',
      description: 'Probe energy stays within [0, MAX_ENERGY].',
      check: () =>
        this.probes
          .filter((probe) => probe.energy < 0 || probe.energy > MAX_ENERGY)
          .map((probe) =>
            violation('probe.energy-in-range', 'probe energy left its legal range', {
              probe: probe.id,
              energy: probe.energy,
            }),
          ),
    });

    this.sim.registerInvariant({
      id: 'probe.rest-handle-is-live',
      description: 'A probe that believes it has a pending rest really does.',
      check: (sim) =>
        this.probes
          .filter((probe) => probe.pendingRest !== null)
          .filter((probe) => !sim.scheduler.isPending(probe.pendingRest as ScheduledEventId))
          .map((probe) =>
            violation('probe.rest-handle-is-live', 'pending rest handle refers to no live event', {
              probe: probe.id,
              handle: probe.pendingRest,
            }),
          ),
    });

    this.sim.registerInvariant({
      id: 'probe.always-has-something-to-do',
      description: 'No probe becomes permanently idle while the world is running.',
      check: (sim) => {
        if (sim.tick === 0 || this.probes.length === 0) return [];
        const scheduledFor = new Set<number>();
        for (const event of sim.scheduler.pendingInOrder()) {
          const payload = event.payload as { probe?: number } | null;
          if (payload && typeof payload.probe === 'number') scheduledFor.add(payload.probe);
        }
        const idle = this.probes
          .map((_probe, index) => index)
          .filter((index) => !scheduledFor.has(index));
        return idle.length === 0
          ? []
          : [
              violation(
                'probe.always-has-something-to-do',
                'one or more probes have no future event scheduled',
                { idle },
              ),
            ];
      },
    });
  }
}

/** Convenience for the common "new world, ready to run" case. */
export function createProbeWorld(options: ProbeWorldOptions): ProbeWorld {
  return new ProbeWorld(options).populate();
}

/** Rebuild the wiring for a world that is about to be loaded from a save. */
export function attachProbeWorld(options: ProbeWorldOptions): ProbeWorld {
  return new ProbeWorld(options);
}

/**
 * The probe world as `verify` wants it: something that builds one from a seed.
 *
 * Everything except the seed is fixed at the point the factory is made, which
 * is what lets the acceptance checks vary the seed -- and only the seed --
 * across the four worlds they build.
 */
export function probeWorldFactory(options: Omit<ProbeWorldOptions, 'seed'>): WorldFactory {
  return {
    label: 'probe',
    create: (seed) => createProbeWorld({ ...options, seed }),
    attach: (seed) => attachProbeWorld({ ...options, seed }),
  };
}
