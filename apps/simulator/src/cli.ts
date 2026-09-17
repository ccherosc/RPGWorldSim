import { pathToFileURL } from 'node:url';
import {
  EventArchive,
  JsonFileSaveStore,
  TICKS_PER_DAY,
  formatTimestamp,
} from '@rpgsim/sim-core';
import { loadCalendar, loadNames, loadVillage } from './data.ts';
import { probeWorldFactory } from './probe-world.ts';
import { villageWorldFactory } from './village-world.ts';
import { type SimWorld, type WorldFactory, verifyDeterminism } from './verify.ts';

/**
 * Headless driver for the simulation.
 *
 * The observer UI (Phase 2+) will be a separate app; this one exists so the
 * simulation can be exercised, saved, resumed and verified with nothing but a
 * terminal, which CLAUDE.md requires of every system before any UI exists.
 *
 * Every command goes through a `WorldFactory`, so `--world` is the only thing
 * that differs between running the village and running the Phase 0 probe
 * harness. Reading the data files is this file's job and nobody else's: a world
 * that read its own config would be a world whose history depended on the state
 * of the filesystem (determinism rule 4).
 */

const USAGE = `AI RPG Simulator - headless driver

Usage:
  npm run sim -- run     [options]   Build a world and run it
  npm run sim -- resume  [options]   Load a save and keep running
  npm run sim -- verify  [options]   Run the determinism checks
  npm run sim -- help                Show this message

Options:
  --world <name>    "village" (default) or "probe"
  --seed <string>   World seed (default: "world-zero")
  --days <n>        Simulated days to run (default: 30)
  --probes <n>      Number of probe agents, --world probe only (default: 12)
  --dir <path>      Save directory (default: "./saves")
  --key <name>      Save slot name (default: "autosave")
  --save            Write a save when the run finishes
  --every <n>       Print a status line every n simulated days (default: 5, 0 = off)
  --archive <path>  Write the durable event history there, one file per day
  --rewrite         Let --archive replace days it finds already written

"village" is World Zero, built from data/world/village.json.
"probe" is the Phase 0 kernel harness: no economy, needs, knowledge or spatial
model by design. It is kept because it exercises cancellation and colliding
priorities that the village does not yet reach.
`;

const WORLDS = ['village', 'probe'] as const;
type WorldName = (typeof WORLDS)[number];

interface Options {
  world: WorldName;
  seed: string;
  days: number;
  probes: number;
  dir: string;
  key: string;
  save: boolean;
  every: number;
  /** Where to write durable history. Undefined means do not write any. */
  archive?: string;
  rewrite: boolean;
}

export function parseArgs(argv: readonly string[]): { command: string; options: Options } {
  const options: Options = {
    world: 'village',
    seed: 'world-zero',
    days: 30,
    probes: 12,
    dir: './saves',
    key: 'autosave',
    save: false,
    every: 5,
    rewrite: false,
  };

  const command = argv[0] ?? 'help';
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i] as string;
    const value = argv[i + 1];
    switch (flag) {
      case '--world':
        options.world = requireWorld(flag, value);
        i++;
        break;
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
      case '--archive':
        options.archive = requireValue(flag, value);
        i++;
        break;
      case '--save':
        options.save = true;
        break;
      case '--rewrite':
        options.rewrite = true;
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

function requireWorld(flag: string, value: string | undefined): WorldName {
  const name = requireValue(flag, value);
  if (!(WORLDS as readonly string[]).includes(name)) {
    throw new Error(`${flag} must be one of: ${WORLDS.join(', ')}`);
  }
  return name as WorldName;
}

function requireNumber(flag: string, value: string | undefined): number {
  const parsed = Number(requireValue(flag, value));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer`);
  }
  return parsed;
}

/**
 * Build the factory the chosen command will use.
 *
 * This is where the data files are read, once per command. The probe world has
 * nothing to read beyond the calendar; the village reads its layout and its
 * name book too.
 */
function worldFactory(options: Options): WorldFactory {
  const calendar = loadCalendar();
  if (options.world === 'probe') {
    return probeWorldFactory({ probes: options.probes, calendar });
  }
  return villageWorldFactory({ config: loadVillage(), names: loadNames(), calendar });
}

/**
 * Attach a durable event archive, if one was asked for.
 *
 * The world's own calendar is handed over rather than the file's, so a day file
 * is named by the date the world thinks it is. Nothing is attached by default:
 * writing history to disk is a publishing decision, and a developer running
 * thirty days to look at a hash should not silently leave an archive behind.
 */
function openArchive(world: SimWorld, options: Options): EventArchive | undefined {
  if (options.archive === undefined) return undefined;
  const archive = new EventArchive({
    root: options.archive,
    world: options.world,
    seed: options.seed,
    calendar: world.sim.calendar,
    rewrite: options.rewrite,
  });
  world.sim.log.addSink(archive);
  return archive;
}

function runWorld(
  world: SimWorld,
  options: Options,
  startDay: number,
  archive: EventArchive | undefined,
): void {
  const endDay = startDay + options.days;
  for (let day = startDay + 1; day <= endDay; day++) {
    world.sim.runUntil(day * TICKS_PER_DAY);
    // The day that just finished is the one before the boundary just crossed,
    // and it is sealed with the hash the world had at that exact moment - which
    // is the evidence a frozen history is checked against.
    archive?.sealDay(day - 1, world.sim.hash());
    if (options.every > 0 && (day - startDay) % options.every === 0) {
      console.log(`  ${world.summary()}`);
    }
  }
  if (archive !== undefined) {
    archive.close();
    console.log(`
archived to: ${archive.root} (${options.days} days)`);
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
  const factory = worldFactory(options);
  // The archive is attached *before* worldgen rather than after the world
  // comes back, because worldgen is the one moment that cannot be recovered
  // later: it announces every person and every household as it creates them,
  // and those announcements are the only record of who anybody is. A sink
  // attached to the finished world would archive a village of strangers.
  let archive: EventArchive | undefined;
  const world = factory.create(options.seed, (built) => {
    archive = openArchive(built, options);
  });

  console.log(`${factory.label}, seed "${options.seed}", ${options.days} days\n`);
  console.log(`  ${world.summary()}`);
  runWorld(world, options, Math.floor(world.sim.tick / TICKS_PER_DAY), archive);
}

function commandResume(options: Options): void {
  const store = new JsonFileSaveStore(options.dir);
  const world = worldFactory(options).attach(options.seed);
  world.sim.loadFrom(store, options.key);

  const startDay = Math.floor(world.sim.tick / TICKS_PER_DAY);
  console.log(`resumed "${options.key}" at ${world.sim.format()}\n`);
  // Nothing to catch ahead of time here: a resumed world was populated by
  // whichever run wrote the save, and that run's archive holds the founding.
  runWorld(world, options, startDay, openArchive(world, options));
}

function commandVerify(options: Options): number {
  const report = verifyDeterminism({
    seed: options.seed,
    days: options.days,
    world: worldFactory(options),
  });
  console.log(`determinism check: ${report.world}, seed "${report.seed}", ${report.days} days\n`);
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
