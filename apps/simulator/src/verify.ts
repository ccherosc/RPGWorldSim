import { MemorySaveStore, type Simulation, TICKS_PER_DAY } from '@rpgsim/sim-core';

/**
 * The acceptance checks, expressed as runnable code rather than prose.
 *
 * These are the guarantees the kickoff brief names: seeded reproducibility,
 * stable ordering, deterministic scheduling, save/load continuation, and
 * identical replay from identical inputs. They run in the test suite and from
 * `npm run verify`, so a determinism regression is catchable in one command
 * without reading a test report.
 *
 * **Nothing here knows what a world is.** It takes a factory and asks it for
 * worlds. That is slice 6's doing: until then this file built probe worlds
 * directly, and the village could not be checked by the one command that is
 * supposed to be the answer to "is it still deterministic?". Both worlds are
 * worth checking and for different reasons -- the probe harness exercises
 * cancellation and colliding priorities that the village does not yet reach,
 * and the village exercises everything the project is actually about.
 */

/** The little a determinism check needs from a world. */
export interface SimWorld {
  readonly sim: Simulation;
  summary(): string;
}

/**
 * How to build the world under test, twice over.
 *
 * `create` builds a populated world from a seed. `attach` builds the same
 * wiring with nothing in it, ready to be loaded from a save — which is the
 * whole point of having two: a save that only ever loads into the world that
 * wrote it proves nothing about whether the save is complete.
 */
export interface WorldFactory {
  /** What to call it in the report: "probe", "village". */
  readonly label: string;
  create(seed: string): SimWorld;
  attach(seed: string): SimWorld;
}

export interface VerificationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface VerificationReport {
  readonly seed: string;
  readonly world: string;
  readonly days: number;
  readonly checks: readonly VerificationCheck[];
  readonly passed: boolean;
}

export interface VerifyOptions {
  readonly seed: string;
  readonly world: WorldFactory;
  readonly days?: number;
}

const DEFAULT_DAYS = 30;

/**
 * Run a world for `days` and fingerprint it at every day boundary.
 *
 * Boundaries are counted from the world's own starting tick, not from tick
 * zero. The probe world opens at tick 0 and the village opens on a date, so a
 * run measured absolutely would ask the village to run until a moment ninety
 * days behind it and stop instantly.
 */
export function fingerprintRun(world: SimWorld, days: number): string[] {
  const origin = world.sim.tick;
  const hashes: string[] = [];
  for (let day = 1; day <= days; day++) {
    world.sim.runUntil(origin + day * TICKS_PER_DAY);
    hashes.push(world.sim.hash());
  }
  return hashes;
}

export function verifyDeterminism(options: VerifyOptions): VerificationReport {
  const seed = options.seed;
  const days = options.days ?? DEFAULT_DAYS;
  const factory = options.world;
  const checks: VerificationCheck[] = [];

  // 1. Identical replay from identical inputs.
  const runA = fingerprintRun(factory.create(seed), days);
  const runB = fingerprintRun(factory.create(seed), days);
  const firstDivergence = runA.findIndex((hash, day) => hash !== runB[day]);
  checks.push({
    name: 'identical replay',
    passed: firstDivergence === -1,
    detail:
      firstDivergence === -1
        ? `${days} day-boundary hashes matched; final ${runA[days - 1] as string}`
        : `diverged first at day ${firstDivergence + 1}: ${runA[firstDivergence] as string} vs ${
            runB[firstDivergence] as string
          }`,
  });

  // 2. The seed actually matters. A kernel that ignored the seed would pass
  //    every other check here, so this is the control.
  const other = fingerprintRun(factory.create(`${seed}-variant`), days);
  checks.push({
    name: 'seed sensitivity',
    passed: other[days - 1] !== runA[days - 1],
    detail: `alternate seed produced ${other[days - 1] as string}`,
  });

  // 3. Save, reload into freshly-wired systems, and continue. The resumed world
  //    must land on the same state as one that was never interrupted.
  const half = Math.max(1, Math.floor(days / 2));
  const original = factory.create(seed);
  const origin = original.sim.tick;
  original.sim.runUntil(origin + half * TICKS_PER_DAY);

  const store = new MemorySaveStore();
  original.sim.saveTo(store, 'verify');

  const resumed = factory.attach(seed);
  resumed.sim.loadFrom(store, 'verify');

  const resumedHashes: string[] = [];
  for (let day = half + 1; day <= days; day++) {
    resumed.sim.runUntil(origin + day * TICKS_PER_DAY);
    resumedHashes.push(resumed.sim.hash());
  }
  const expectedTail = runA.slice(half);
  const tailDivergence = resumedHashes.findIndex((hash, i) => hash !== expectedTail[i]);
  checks.push({
    name: 'save/load continuation',
    passed: resumed.sim.hash() === (runA[days - 1] as string) && tailDivergence === -1,
    detail:
      tailDivergence === -1
        ? `resumed at day ${half} and matched to day ${days}`
        : `resumed run diverged at day ${half + tailDivergence + 1}`,
  });

  // 4. Saving must not perturb the world that was saved.
  original.sim.runUntil(origin + days * TICKS_PER_DAY);
  checks.push({
    name: 'saving is side-effect free',
    passed: original.sim.hash() === (runA[days - 1] as string),
    detail: `saved-then-continued world hashed ${original.sim.hash()}`,
  });

  // 5. Invariants hold at the end of the run.
  const report = resumed.sim.checkInvariants();
  checks.push({
    name: 'invariants',
    passed: report.violations.length === 0,
    detail:
      report.violations.length === 0
        ? `${report.checked} invariants held at tick ${report.tick}`
        : report.violations.map((v) => `[${v.invariantId}] ${v.message}`).join('; '),
  });

  return {
    seed,
    world: factory.label,
    days,
    checks,
    passed: checks.every((check) => check.passed),
  };
}
