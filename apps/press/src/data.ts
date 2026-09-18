import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_ROOT } from '@rpgsim/simulator';
import type { ZodType, ZodTypeDef } from 'zod';
import { Publication, PublicationSchema } from './publication.ts';

/**
 * The one data file only the website reads.
 *
 * Everything else the press needs -- scoring, selection, wording, the paper
 * book, the casting, the personas, the families -- is loaded through
 * `@rpgsim/simulator`'s validated loaders. Copying those here would give the
 * project two places where the shape of a data file is written down, and they
 * would agree right up until somebody changed one.
 *
 * `publication.json` is not in that list because the simulator has no business
 * knowing the site exists. Its schema lives next door in `publication.ts`, so
 * the loader is here, with the same read-and-report-everything behaviour as the
 * simulator's: a hand-edited file deserves all its mistakes in one message.
 */

export { DATA_ROOT } from '@rpgsim/simulator';

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

export function loadPublication(dataRoot: string = DATA_ROOT): Publication {
  const path = join(dataRoot, 'chronicle', 'publication.json');
  return new Publication(loadJson(path, PublicationSchema, 'publication'));
}
