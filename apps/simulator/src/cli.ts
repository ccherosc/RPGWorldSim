import { pathToFileURL } from 'node:url';
import {
  AnnalsStore,
  Casting,
  Community,
  PersonaBook,
  PortraitCatalog,
  distil,
} from '@rpgsim/chronicle';
import {
  EventArchive,
  JsonFileSaveStore,
  TICKS_PER_DAY,
  formatTimestamp,
  readArchiveManifest,
  readEventDay,
} from '@rpgsim/sim-core';
import {
  loadCalendar,
  loadCasting,
  loadCommunity,
  loadNames,
  loadPersonas,
  loadPortraits,
  loadSignificance,
  loadVillage,
} from './data.ts';
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
  npm run sim -- annals  [options]   Distil an archive into the village's memory
  npm run sim -- cast    [options]   Check the portrait casting against the record
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
  --annals <path>   Where the permanent record lives, for the annals command
  --on <date>       The day to check the casting against (default: the record's last)
  --propose         Suggest a portrait for everyone who has none, and print it

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
  /** Where the permanent record lives. The annals and cast commands read it. */
  annals?: string;
  /** The day the cast command judges ages against. */
  on?: string;
  /** Have cast suggest a face for everybody who has none. */
  propose: boolean;
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
    propose: false,
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
      case '--annals':
        options.annals = requireValue(flag, value);
        i++;
        break;
      case '--on':
        options.on = requireValue(flag, value);
        i++;
        break;
      case '--propose':
        options.propose = true;
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

/**
 * Turn an archive into the village's memory.
 *
 * The day archive is a cache: the seed reproduces it byte for byte, so it can
 * be deleted and rebuilt at will. The annals are not. That asymmetry is why
 * this is a separate command rather than something `run` does on the way past —
 * distilling is re-runnable against a rebuilt archive, and a permanent record
 * should be written on purpose and not as a side effect of a developer running
 * thirty days to look at a hash.
 *
 * An unfinished archive is refused. Its last day may be half a day, and half a
 * day written into a permanent record stays half a day forever; `manifest.complete`
 * exists precisely so a publisher can tell the difference.
 */
function commandAnnals(options: Options): number {
  if (options.archive === undefined || options.annals === undefined) {
    console.error('annals needs both --archive (to read) and --annals (to write)\n');
    console.error(USAGE);
    return 2;
  }

  const manifest = readArchiveManifest(options.archive);
  if (manifest === undefined) {
    console.error(`no archive at ${options.archive}`);
    return 1;
  }
  if (!manifest.complete) {
    console.error(`the archive at ${options.archive} was never closed; its last day may be partial`);
    return 1;
  }

  const calendar = loadCalendar();
  const significance = loadSignificance();
  const store = new AnnalsStore({ root: options.annals });
  const knownPeople = store.people.size;
  const knownPlaces = store.places.size;

  let days = 0;
  let lines = 0;
  for (const day of manifest.days) {
    // A day that produced no notable line leaves `lastDate` where it was, so it
    // is offered again on the next run. Distilling it a second time enrols
    // nobody twice and writes nothing, which is the cheapest way to be correct
    // about a village where nothing happened.
    if (store.lastDate !== null && day.key <= store.lastDate) continue;
    const distilled = distil({
      key: day.key,
      events: readEventDay(options.archive, day.key),
      calendar,
      significance,
      people: store.people,
      places: store.places,
    });
    store.record(distilled);
    days++;
    lines += distilled.lines.length;
  }

  console.log(`annals at ${store.root}`);
  console.log(`  read ${manifest.days.length} archived days, distilled ${days}`);
  console.log(
    `  ${lines} lines written, ${store.people.size - knownPeople} people and ` +
      `${store.places.size - knownPlaces} places newly recorded`,
  );
  console.log(`  the record now runs to ${store.lastDate ?? 'nothing at all'}`);
  return 0;
}

/**
 * Check the faces against the record.
 *
 * Judged against `people.txt` rather than against a running world on purpose.
 * The record is the thing that survives, and whoever is drawing the next sheet
 * of portraits needs to know what is missing without building a simulation to
 * find out. It also means the answer cannot drift: two people looking at the
 * same record get the same list.
 *
 * Nothing here writes the casting file. `--propose` prints what it would add
 * and stops, because a face is a promise to a reader -- somebody who has been
 * looking at Winifred Barrow for a month knows that face -- and a promise that
 * a tool can rewrite unattended is not one. Pasting the block in is the step
 * where a person looks at it.
 */
function commandCast(options: Options): number {
  if (options.annals === undefined) {
    console.error('cast needs --annals (the record it checks against)\n');
    console.error(USAGE);
    return 2;
  }

  const store = new AnnalsStore({ root: options.annals });
  if (store.people.size === 0) {
    console.error(`no people recorded at ${store.root}; run annals first`);
    return 1;
  }

  // Ages need a day to be ages on. The record's own last day is the honest
  // default: it is the latest moment the record can speak about at all.
  const on = options.on ?? store.lastDate;
  if (on === null || on === undefined) {
    console.error('the record holds people but no dated days; pass --on <YYYY-MM-DD>');
    return 1;
  }

  const catalog = new PortraitCatalog(loadPortraits());
  const casting = new Casting(loadCasting());
  const personas = new PersonaBook(loadPersonas());
  const community = new Community(loadCommunity());
  const people = store.people.records();
  const slugs = people.map((person) => person.slug);
  const report = casting.report(people, catalog, on);

  console.log(`casting for ${people.length} people on ${on}`);
  console.log(`  ${catalog.size} portraits on ${loadPortraits().length} sheets`);
  console.log(`  ${report.cast} cast, ${report.uncast.length} uncast, ${report.unused.length} faces spare`);
  console.log(`  ${personas.size} personas, ${community.familyCount} families, ${community.tieCount} ties`);

  const missingPersona = personas.missingFor(slugs);
  const strayPersona = personas.strayFor(slugs);
  const strayTie = community.strayFor(slugs);

  if (report.uncast.length > 0) {
    console.log('\nno face yet:');
    for (const person of report.uncast) {
      console.log(`  ${person.slug.padEnd(22)} ${person.band}/${person.sex}  ${person.name}`);
    }
  }
  if (report.shortages.length > 0) {
    console.log('\nnot enough faces to fix that:');
    for (const gap of report.shortages) {
      console.log(`  ${gap.band}/${gap.sex}: ${gap.needed} needed, ${gap.available} spare`);
    }
  }
  if (report.mismatched.length > 0) {
    console.log('\nwearing the wrong face:');
    for (const bad of report.mismatched) {
      console.log(`  ${bad.slug.padEnd(22)} ${bad.portrait} is ${bad.got}, wanted ${bad.wanted}`);
    }
  }
  for (const [label, list] of [
    ['no persona written', missingPersona],
    ['persona for somebody the record has never heard of', strayPersona],
    ['tie to somebody the record has never heard of', strayTie],
  ] as const) {
    if (list.length === 0) continue;
    console.log(`\n${label}:`);
    for (const slug of list) console.log(`  ${slug}`);
  }

  console.log('\nfaces spare, by kind:');
  const spare = new Map<string, number>();
  for (const id of report.unused) {
    const portrait = catalog.require(id);
    const key = `${portrait.band}/${portrait.sex}`;
    spare.set(key, (spare.get(key) ?? 0) + 1);
  }
  for (const key of [...spare.keys()].sort()) {
    console.log(`  ${key.padEnd(14)} ${spare.get(key) as number}`);
  }

  if (options.propose) {
    const proposals = casting.propose(people, catalog, on);
    console.log(`\nproposed (${proposals.size}); paste into data/chronicle/casting.json:`);
    for (const slug of [...proposals.keys()].sort()) {
      console.log(`    "${slug}": "${proposals.get(slug) as string}",`);
    }
  }

  // Missing faces are news, not a failure: a village acquires people faster
  // than anybody can draw them. A face on the wrong person, or a name nothing
  // else knows, is a mistake somebody made and is worth a non-zero exit.
  const broken =
    report.mismatched.length + strayPersona.length + strayTie.length + missingPersona.length;
  return broken > 0 ? 1 : 0;
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
    case 'annals':
      return commandAnnals(parsed.options);
    case 'cast':
      return commandCast(parsed.options);
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
