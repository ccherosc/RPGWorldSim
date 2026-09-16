import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assert } from '@rpgsim/shared';
import {
  type SaveEnvelope,
  type SaveStore,
  parseEnvelope,
  serializeEnvelope,
} from './save.ts';

const SAVE_EXTENSION = '.save.json';
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Saves as canonical JSON files on disk.
 *
 * SQLite (via `better-sqlite3`) is the documented long-term persistence layer,
 * but Phase 0 has no entity tables to store yet and JSON keeps the save format
 * inspectable with a text editor while the schema is still moving. The
 * `SaveStore` interface is the seam where SQLite drops in later; see
 * `docs/PHASE_0.md` for the rationale and the migration path.
 *
 * Files are written canonically (sorted keys), so two saves of identical world
 * state are byte-identical and diff cleanly in version control.
 */
export class JsonFileSaveStore implements SaveStore {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true });
  }

  write(key: string, envelope: SaveEnvelope): void {
    writeFileSync(this.pathFor(key), serializeEnvelope(envelope), 'utf8');
  }

  read(key: string): SaveEnvelope | undefined {
    const path = this.pathFor(key);
    if (!existsSync(path)) return undefined;
    return parseEnvelope(readFileSync(path, 'utf8'));
  }

  list(): string[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .filter((name) => name.endsWith(SAVE_EXTENSION))
      .map((name) => name.slice(0, -SAVE_EXTENSION.length))
      .sort();
  }

  delete(key: string): boolean {
    const path = this.pathFor(key);
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
  }

  private pathFor(key: string): string {
    // Save keys become filenames, so reject anything that could escape the
    // directory or collide with shell/OS-special names.
    assert(
      KEY_PATTERN.test(key),
      'save key must be alphanumeric with dots, dashes or underscores',
      { key },
    );
    return join(this.directory, `${key}${SAVE_EXTENSION}`);
  }
}
