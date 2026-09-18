import { pathToFileURL } from 'node:url';
import { readArchiveManifest } from '@rpgsim/sim-core';
import { loadPublication } from './data.ts';
import { checkFrozen, loadFrozenHistory, writeFrozenHistory } from './freeze.ts';
import { daysToRun } from './schedule.ts';
import { buildSite } from './site.ts';

/**
 * The third and last step of publishing.
 *
 * `sim run` makes the days, `sim annals` distils them, and `press build` prints
 * them. Three commands rather than one because each writes something worth
 * keeping on its own and each is worth being able to re-run without the others:
 * the site is rebuilt whenever the wording changes, and rebuilding it must
 * never mean re-simulating the village.
 *
 * `days` and `freeze` are the two the publishing workflow needs and a person
 * rarely does: one answers "how long is the village now", the other answers
 * "is the history still the history".
 */

const USAGE = `Pennycroft press - turns the village record into a website

Usage:
  npm run press -- build  [options]  Write the whole site
  npm run press -- days   [options]  Print how many village days to run today
  npm run press -- freeze [options]  Check the archive against the frozen history
  npm run press -- help              Show this message

Options:
  --archive <path>  The day archive written by "sim run --archive"
  --annals <path>   The record written by "sim annals --annals"
  --out <path>      Where to write the site (default: "./site")
  --data <path>     Override the data directory
  --assets <path>   Override the asset directory (default: assets/site)
  --allow-incomplete  Publish from a run that never finished
  --today <date>    Real-world date, YYYY-MM-DD, for the days command
  --write           Have freeze write the hashes instead of checking them

build needs --archive and --annals. days needs --today. freeze needs --archive.

The output is emptied before it is written, so nothing renamed in the generator
can linger on the site. Nothing about this machine reaches the pages: the site
is a function of the archive, the record and the data files.
`;

interface Options {
  archive?: string;
  annals?: string;
  out: string;
  data?: string;
  assets?: string;
  allowIncomplete: boolean;
  /** Real-world date, supplied by the caller. Nothing here reads a clock. */
  today?: string;
  write: boolean;
}

interface Parsed {
  readonly command: string;
  readonly options: Options;
}

export function parseArgs(argv: readonly string[]): Parsed {
  const options: Options = { out: './site', allowIncomplete: false, write: false };
  const command = argv[0] ?? 'help';

  for (let at = 1; at < argv.length; at += 1) {
    const flag = argv[at];
    const value = argv[at + 1];
    switch (flag) {
      case '--archive':
        options.archive = need(flag, value);
        at += 1;
        break;
      case '--annals':
        options.annals = need(flag, value);
        at += 1;
        break;
      case '--out':
        options.out = need(flag, value);
        at += 1;
        break;
      case '--data':
        options.data = need(flag, value);
        at += 1;
        break;
      case '--assets':
        options.assets = need(flag, value);
        at += 1;
        break;
      case '--today':
        options.today = need(flag, value);
        at += 1;
        break;
      case '--allow-incomplete':
        options.allowIncomplete = true;
        break;
      case '--write':
        options.write = true;
        break;
      default:
        throw new Error(`Unknown option: ${String(flag)}`);
    }
  }

  return { command, options };
}

function need(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
  return value;
}

function commandBuild(options: Options): number {
  if (options.archive === undefined || options.annals === undefined) {
    console.error('build needs both --archive and --annals\n');
    console.error(USAGE);
    return 2;
  }

  const site = buildSite({
    archive: options.archive,
    annals: options.annals,
    out: options.out,
    dataRoot: options.data,
    assetRoot: options.assets,
    allowIncomplete: options.allowIncomplete,
  });

  const first = site.village.issues[0];
  const last = site.village.issues[site.village.issues.length - 1];
  console.log(`${site.publication.masthead}`);
  console.log(`  days       ${first?.day.key ?? '-'} to ${last?.day.key ?? '-'}`);
  console.log(`  seed       ${site.village.worldSeed}`);
  console.log(`  people     ${site.village.people.length}`);
  console.log(`  pages      ${site.pages.length}`);
  console.log(`  assets     ${site.assets.length}`);
  console.log(`  written to ${options.out}`);
  return 0;
}

/**
 * How many village days exist today.
 *
 * Prints the bare number and nothing else, because the only caller is a shell
 * substitution in the publishing workflow. `--today` is required rather than
 * defaulted to the clock: the press must stay a pure function of its inputs,
 * and a command that quietly read the date would be reproducible right up until
 * midnight.
 */
function commandDays(options: Options): number {
  if (options.today === undefined) {
    console.error('days needs --today <YYYY-MM-DD>\n');
    console.error(USAGE);
    return 2;
  }
  const publication = loadPublication(options.data);
  console.log(String(daysToRun(publication.config, options.today)));
  return 0;
}

/** Check a rebuilt archive against the hashes of the days already published. */
function commandFreeze(options: Options): number {
  if (options.archive === undefined) {
    console.error('freeze needs --archive\n');
    console.error(USAGE);
    return 2;
  }
  const publication = loadPublication(options.data);
  const frozenThrough = publication.frozenThrough;

  if (options.write) {
    if (frozenThrough === null) {
      console.error('set frozenThrough in publication.json before freezing anything\n');
      return 2;
    }
    const history = writeFrozenHistory({
      archive: options.archive,
      frozenThrough,
      ...(options.data === undefined ? {} : { dataRoot: options.data }),
    });
    console.log(`froze ${Object.keys(history.days).length} days through ${frozenThrough}`);
    return 0;
  }

  const manifest = readArchiveManifest(options.archive);
  if (manifest === undefined) {
    console.error(`no archive to check at ${options.archive}`);
    return 2;
  }
  const report = checkFrozen({
    manifest,
    frozen: loadFrozenHistory(options.data),
    frozenThrough,
  });
  console.log(
    report.idle
      ? 'nothing is frozen yet, so nothing was checked'
      : `${report.checked} published days still match their hashes`,
  );
  return 0;
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
    case 'build':
      return commandBuild(parsed.options);
    case 'days':
      return commandDays(parsed.options);
    case 'freeze':
      return commandFreeze(parsed.options);
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
