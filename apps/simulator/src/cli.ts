import { pathToFileURL } from 'node:url';
import { JsonFileSaveStore, TICKS_PER_DAY, formatTimestamp } from '@rpgsim/sim-core';
import { loadCalendar } from './data.ts';
import { type ProbeWorld, attachProbeWorld, createProbeWorld } from './probe-world.ts';
import { verifyDeterminism } from './verify.ts';

/**
 * Headless driver for the Phase 0 kernel.
 *
 * The observer UI (Phase 2+) will be a separate app; this one exists so the
 * simulation can be exercised, saved, resumed and verified with nothing but a
 * terminal, which CLAUDE.md requires of every system before any UI exists.
 */

const USAGE = `AI RPG Simulator - Phase 0 kernel driver

Usage:
  npm run sim -- run     [options]   Run the Phase 0 probe world
  npm run sim -- resume  [options]   Load a save and keep running
  npm run sim -- verify  [options]   Run the Phase 0 determinism checks
  npm run sim -- help                Show this message

Options:
  --seed <string>   World seed (default: "world-zero")
  --days <n>        Simulated days to run (default: 30)
  --probes <n>      Number of probe agents (default: 12)
  --dir <path>      Save directory (default: "./saves")
  --key <name>      Save slot name (default: "autosave")
  --save            Write a save when the run finishes
  --every <n>       Print a status line every n simulated days (default: 5, 0 = off)

The "probe world" is a Phase 0 test harness, not the World Zero village.
It has no economy, needs, knowledge or spatial model by design.
`;

interface Options {
  seed: string;
  days: number;
  probes: number;
  dir: string;
  key: string;
  save: boolean;
  every: number;
}

export function parseArgs(argv: readonly string[]): { command: string; options: Options } {
  const options: Options = {
    seed: 'world-zero',
    days: 30,
    probes: 12,
    dir: './saves',
    key: 'autosave',
    save: false,
    every: 5,
  };

  const command = argv[0] ?? 'help';
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i] as string;
    const value = argv[i + 1];
    switch (flag) {
      case '--seed':
        options.seed = requireValue(flag, value);
        i++;
        break;
      case '--days':
        options.days = requireNumber(flag, value);
        i++;
        break;
      case '--probes':
        options.probes = requireNumber(flag, value);
        i++;
        break;
      case '--dir':
        options.dir = requireValue(flag, value);
        i++;
        break;
      case '--key':
        options.key = requireValue(flag, value);
        i++;
        break;
      case '--every':
        options.every = requireNumber(flag, value);
        i++;
        break;
      case '--save':
        options.save = true;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  return { command, options };
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function requireNumber(flag: string, value: string | undefined): number {
  const parsed = Number(requireValue(flag, value));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer`);
  }
  return parsed;
}

function runWorld(world: ProbeWorld, options: Options, startDay: number): void {
  const endDay = startDay + options.days;
  for (let day = startDay + 1; day <= endDay; day++) {
    world.sim.runUntil(day * TICKS_PER_DAY);
    if (options.every > 0 && (day - startDay) % options.every === 0) {
      console.log(`  ${world.summary()}`);
    }
  }

  world.sim.assertInvariants();
  console.log(`\nfinal state: ${world.summary()}`);
  console.log(`state hash:  ${world.sim.hash()}`);
  console.log(`world time:  ${formatTimestamp(world.sim.tick, world.sim.calendar)}`);

  if (options.save) {
    const store = new JsonFileSaveStore(options.dir);
    world.sim.saveTo(store, options.key);
    console.log(`saved to:    ${store.directory} (${options.key})`);
  }
}

function commandRun(options: Options): void {
  const calendar = loadCalendar();
  console.log(
    `seed "${options.seed}", ${options.probes} probes, ${options.days} days, calendar "${calendar.id}"\n`,
  );
  runWorld(createProbeWorld({ seed: options.seed, probes: options.probes, calendar }), options, 0);
}

function commandResume(options: Options): void {
  const store = new JsonFileSaveStore(options.dir);
  const world = attachProbeWorld({
    seed: options.seed,
    probes: options.probes,
    calendar: loadCalendar(),
  });
  world.sim.loadFrom(store, options.key);

  const startDay = Math.floor(world.sim.tick / TICKS_PER_DAY);
  console.log(`resumed "${options.key}" at ${world.sim.format()}\n`);
  runWorld(world, options, startDay);
}

function commandVerify(options: Options): number {
  const report = verifyDeterminism({
    seed: options.seed,
    days: options.days,
    probes: options.probes,
    calendar: loadCalendar(),
  });
  console.log(
    `determinism check: seed "${report.seed}", ${report.probes} probes, ${report.days} days\n`,
  );
  for (const check of report.checks) {
    console.log(`  ${check.passed ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
  }
  console.log(`\n${report.passed ? 'All determinism checks passed.' : 'DETERMINISM CHECK FAILED.'}`);
  return report.passed ? 0 : 1;
}

export function main(argv: readonly string[]): number {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`${(error as Error).message}\n`);
    console.error(USAGE);
    return 2;
  }

  switch (parsed.command) {
    case 'run':
      commandRun(parsed.options);
      return 0;
    case 'resume':
      commandResume(parsed.options);
      return 0;
    case 'verify':
      return commandVerify(parsed.options);
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;
    default:
      console.error(`Unknown command: ${parsed.command}\n`);
      console.error(USAGE);
      return 2;
  }
}

// Only run when invoked directly, so tests can import `main` without side effects.
const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = main(process.argv.slice(2));
}
