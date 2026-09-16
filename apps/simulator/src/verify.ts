import { type CalendarConfig, MemorySaveStore, TICKS_PER_DAY } from '@rpgsim/sim-core';
import { ProbeWorld, attachProbeWorld, createProbeWorld } from './probe-world.ts';

/**
 * The Phase 0 acceptance checks, expressed as runnable code rather than prose.
 *
 * These are the guarantees the kickoff brief names: seeded reproducibility,
 * stable ordering, deterministic scheduling, save/load continuation, and
 * identical replay from identical inputs. They run in the test suite and from
 * `npm run verify`, so a determinism regression is catchable in one command
 * without reading a test report.
 */

export interface VerificationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface VerificationReport {
  readonly seed: string;
  readonly days: number;
  readonly probes: number;
  readonly checks: readonly VerificationCheck[];
  readonly passed: boolean;
}

export interface VerifyOptions {
  readonly seed: string;
  readonly days?: number;
  readonly probes?: number;
  readonly calendar?: CalendarConfig;
}

const DEFAULT_DAYS = 30;

/** Run a world for `days` and fingerprint it at every day boundary. */
export function fingerprintRun(world: ProbeWorld, days: number): string[] {
  const hashes: string[] = [];
  for (let day = 1; day <= days; day++) {
    world.sim.runUntil(day * TICKS_PER_DAY);
    hashes.push(world.sim.hash());
  }
  return hashes;
}

export function verifyDeterminism(options: VerifyOptions): VerificationReport {
  const seed = options.seed;
  const days = options.days ?? DEFAULT_DAYS;
  const probes = options.probes ?? 12;
  const calendar = options.calendar;
  const world = (worldSeed: string): ProbeWorld =>
    createProbeWorld({
      seed: worldSeed,
      probes,
      ...(calendar !== undefined ? { calendar } : {}),
    });
  const attach = (): ProbeWorld =>
    attachProbeWorld({ seed, probes, ...(calendar !== undefined ? { calendar } : {}) });
  const checks: VerificationCheck[] = [];

  // 1. Identical replay from identical inputs.
  const runA = fingerprintRun(world(seed), days);
  const runB = fingerprintRun(world(seed), days);
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
  const other = fingerprintRun(world(`${seed}-variant`), days);
  checks.push({
    name: 'seed sensitivity',
    passed: other[days - 1] !== runA[days - 1],
    detail: `alternate seed produced ${other[days - 1] as string}`,
  });

  // 3. Save, reload into freshly-wired systems, and continue. The resumed world
  //    must land on the same state as one that was never interrupted.
  const half = Math.max(1, Math.floor(days / 2));
  const original = world(seed);
  original.sim.runUntil(half * TICKS_PER_DAY);

  const store = new MemorySaveStore();
  original.sim.saveTo(store, 'verify');

  const resumed = attach();
  resumed.sim.loadFrom(store, 'verify');

  const resumedHashes: string[] = [];
  for (let day = half + 1; day <= days; day++) {
    resumed.sim.runUntil(day * TICKS_PER_DAY);
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
  original.sim.runUntil(days * TICKS_PER_DAY);
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

  return { seed, days, probes, checks, passed: checks.every((check) => check.passed) };
}
