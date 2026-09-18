import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CastingConfig,
  CastingSchema,
  type CommunityConfig,
  CommunitySchema,
  type PersonaBookConfig,
  PersonaBookSchema,
  type PortraitAtlas,
  PortraitAtlasSchema,
  type ScoringConfig,
  ScoringSchema,
  type SelectionConfig,
  SelectionSchema,
  type SignificanceConfig,
  SignificanceSchema,
  type TemplateBook,
  TemplateBookSchema,
} from '@rpgsim/chronicle';
import { type NameBook, makeNameBook } from '@rpgsim/npc';
import { type CalendarConfig, CalendarSchema } from '@rpgsim/sim-core';
import type { ZodType, ZodTypeDef } from 'zod';
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
 *
 * The schema's input type is `unknown` rather than `T`, so a schema may fill in
 * a default the file left out. A portrait cell with nothing in its hands omits
 * `props` entirely and reads back as an empty list, which keeps the hand-edited
 * files short without making the parsed type optional everywhere downstream.
 */
function loadJson<T>(path: string, schema: ZodType<T, ZodTypeDef, unknown>, what: string): T {
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
    join(dataRoot, 'chronicle', 'significance.json'),
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

/** `<repo>/data/chronicle`: everything the press reads and the simulation does not. */
function chronicleRoot(dataRoot: string): string {
  return join(dataRoot, 'chronicle');
}

/**
 * Read every portrait sheet in `data/chronicle/portraits`.
 *
 * Discovered by listing the directory rather than by a manifest naming each
 * sheet, because the whole point of one-file-per-sheet is that adding portraits
 * is adding a file. A manifest would put the list of sheets in two places and
 * make a new sheet a two-step change that can be half done.
 *
 * The listing is sorted before anything reads it. `readdirSync` returns entries
 * in whatever order the filesystem feels like, and determinism rule 5 forbids
 * leaning on an order that is not itself deterministic — here it would decide
 * which sheet a proposed casting drew from.
 */
export function loadPortraits(dataRoot: string = DATA_ROOT): PortraitAtlas[] {
  const directory = join(chronicleRoot(dataRoot), 'portraits');
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort();
  return files.map((name) => {
    const atlas = loadJson(join(directory, name), PortraitAtlasSchema, 'portrait atlas');
    if (`${atlas.atlas}.json` !== name) {
      throw new Error(`${join(directory, name)} declares atlas "${atlas.atlas}"; rename one or the other`);
    }
    return atlas;
  });
}

/** Read who wears which face. */
export function loadCasting(dataRoot: string = DATA_ROOT): CastingConfig {
  return loadJson(join(chronicleRoot(dataRoot), 'casting.json'), CastingSchema, 'casting');
}

/** Read how each villager comes across. */
export function loadPersonas(dataRoot: string = DATA_ROOT): PersonaBookConfig {
  return loadJson(join(chronicleRoot(dataRoot), 'personas.json'), PersonaBookSchema, 'persona book');
}

/**
 * Read the weights that decide how newsworthy something is.
 *
 * Separate from the significance table on purpose, though both are weights over
 * event types. Significance decides what is *kept forever* and is answerable to
 * the archive's size; this decides what *leads today* and is answerable to
 * whether the page reads well. Those two judgements disagree — a birth is worth
 * keeping for a century and is not necessarily today's headline — and one file
 * serving both would force every future change to be a compromise between them.
 */
export function loadScoring(dataRoot: string = DATA_ROOT): ScoringConfig {
  return loadJson(join(chronicleRoot(dataRoot), 'scoring.json'), ScoringSchema, 'scoring table');
}

/** Read how long the edition is and how the posting rota turns. */
export function loadSelection(dataRoot: string = DATA_ROOT): SelectionConfig {
  return loadJson(join(chronicleRoot(dataRoot), 'selection.json'), SelectionSchema, 'selection');
}

/**
 * Read the wording the villagers post in.
 *
 * Prose in a data file rather than in code, for directive 10's reason and for
 * one more: wording is the part of this that a person with no TypeScript should
 * be able to improve. A new turn of phrase should be a line in a JSON file, not
 * a pull request against a module.
 */
export function loadTemplates(dataRoot: string = DATA_ROOT): TemplateBook {
  return loadJson(
    join(chronicleRoot(dataRoot), 'templates.json'),
    TemplateBookSchema,
    'template book',
  );
}

/** Read the families and what they are to each other. */
export function loadCommunity(dataRoot: string = DATA_ROOT): CommunityConfig {
  return loadJson(join(chronicleRoot(dataRoot), 'community.json'), CommunitySchema, 'community');
}
