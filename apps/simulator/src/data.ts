import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type SignificanceConfig, SignificanceSchema } from '@rpgsim/chronicle';
import { type NameBook, makeNameBook } from '@rpgsim/npc';
import { type CalendarConfig, CalendarSchema } from '@rpgsim/sim-core';
import type { ZodType } from 'zod';
import { type VillageConfig, VillageSchema } from './village-schema.ts';

/**
 * Loading of world data files.
 *
 * CLAUDE.md directive 10 puts balance and configuration values in data files
 * rather than in code. Everything loaded here is validated against a schema at
 * the boundary, so a typo in a data file fails immediately with a readable
 * message instead of producing a subtly wrong world.
 *
 * Data is loaded once, at world construction. Nothing reads a file while the
 * simulation is running: a mid-run read would make world history depend on the
 * state of the filesystem and break replay.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** `<repo>/data`, resolved from this module rather than the process CWD. */
export const DATA_ROOT = resolve(HERE, '..', '..', '..', 'data');

/**
 * Read one JSON file and validate it, or fail with every reason at once.
 *
 * Every issue is reported, not just the first. A data file is edited by hand,
 * and a validator that stops at the first problem turns one careless paste into
 * four rounds of run-read-fix. The path is in the message because by the time
 * anybody reads it they are several layers from the call that chose the file.
 */
function loadJson<T>(path: string, schema: ZodType<T>, what: string): T {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${path} is not a valid ${what}: ${issues}`);
  }
  return result.data;
}

export function loadCalendar(dataRoot: string = DATA_ROOT): CalendarConfig {
  return loadJson(join(dataRoot, 'world', 'calendar.json'), CalendarSchema, 'calendar');
}

export function loadVillage(dataRoot: string = DATA_ROOT): VillageConfig {
  return loadJson(join(dataRoot, 'world', 'village.json'), VillageSchema, 'village');
}

/**
 * Read the weights that decide what the annals keep.
 *
 * Loaded here with everything else rather than inside the chronicle, for the
 * same reason the village config is: a package that reads its own data file is
 * a package whose output depends on the state of the filesystem. The chronicle
 * is handed its numbers.
 */
export function loadSignificance(dataRoot: string = DATA_ROOT): SignificanceConfig {
  return loadJson(
    join(dataRoot, 'world', 'significance.json'),
    SignificanceSchema,
    'significance table',
  );
}

/**
 * Read the name book.
 *
 * `makeNameBook` does the validating, so this is the one loader that does not
 * go through `loadJson`: the book has rules a schema cannot state -- no list
 * may be empty, and the culture names itself -- and those live with the type.
 */
export function loadNames(dataRoot: string = DATA_ROOT): NameBook {
  const path = join(dataRoot, 'world', 'names.json');
  return makeNameBook(JSON.parse(readFileSync(path, 'utf8')));
}
