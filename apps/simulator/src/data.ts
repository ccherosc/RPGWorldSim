import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CalendarConfig, CalendarSchema } from '@rpgsim/sim-core';

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

export function loadCalendar(dataRoot: string = DATA_ROOT): CalendarConfig {
  const path = join(dataRoot, 'world', 'calendar.json');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = CalendarSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${path} is not a valid calendar: ${issues}`);
  }
  return result.data;
}
