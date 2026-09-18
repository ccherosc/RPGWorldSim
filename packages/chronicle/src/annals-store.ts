import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assert } from '@rpgsim/shared';
import { ANNALS_HEADER, type DistilledDay, formatAnnalLine } from './annals.ts';
import { PEOPLE_FILE, PEOPLE_HEADER, PeopleRegister, formatPersonLine } from './people.ts';
import { PLACES_FILE, PLACES_HEADER, PlaceRegister, formatPlaceLine } from './places.ts';

/**
 * The village's memory on disk. The only thing in this package that touches it.
 *
 * Two kinds of file and nothing else:
 *
 *   `<root>/people.txt`        everyone who has ever existed, one line each
 *   `<root>/places.txt`        everywhere that exists, one line each
 *   `<root>/annals/<year>.txt` everything worth remembering, one line each
 *
 * All three are append-only, and that is enforced rather than intended. A line
 * already on disk is never rewritten: the people and places files skip anything
 * they already hold, and the annals refuse a day that is not later than the last
 * day written. Those two rules are what make the record trustworthy — a file that
 * can be rewritten is a file that can be *quietly* rewritten, and a memory
 * nobody can be sure of is not a memory.
 *
 * Appending is deliberately not atomic, unlike the day archive's whole-file
 * writes. The trade runs the other way here: the annals are tiny and grow a
 * handful of lines at a time, and a torn append leaves a short final line that
 * the reader refuses loudly — whereas rewriting a thirty-year file through a
 * rename would put the entire record at risk every single day.
 */

export const ANNALS_DIRECTORY = 'annals';

export interface AnnalsStoreOptions {
  /** Directory the store owns. Created if missing. */
  readonly root: string;
}

export class AnnalsStore {
  readonly root: string;
  /** Everyone the record already knows. Advanced as days are recorded. */
  readonly people: PeopleRegister;
  /** Everywhere the record already knows. Advanced as days are recorded. */
  readonly places: PlaceRegister;

  /** The date of the last annal line on disk, or `null` for a fresh record. */
  private latest: string | null;

  constructor(options: AnnalsStoreOptions) {
    this.root = resolve(options.root);
    mkdirSync(join(this.root, ANNALS_DIRECTORY), { recursive: true });
    this.people = readPeople(this.root);
    this.places = readPlaces(this.root);
    this.latest = latestDate(this.root);
  }

  /** The last day the annals have anything to say about. */
  get lastDate(): string | null {
    return this.latest;
  }

  /**
   * Add a distilled day to the record.
   *
   * A day with nothing notable in it writes no annal lines and does not move
   * `lastDate` — which is correct, and is not the same as a day nobody
   * simulated. "Did this day happen" is a question for the archive manifest;
   * the annals only ever claim to say what was worth remembering.
   */
  record(day: DistilledDay): void {
    assert(
      this.latest === null || day.lines.length === 0 || day.key > this.latest,
      'the annals already hold a day at or after this one',
      { day: day.key, latest: this.latest },
    );

    // People and places first. An annal line names both by slug, so a reader
    // who catches the record mid-write finds the slug already explained rather
    // than a handle pointing at nothing.
    this.appendPeople(day);
    this.appendPlaces(day);
    this.appendLines(day);
  }

  private appendPeople(day: DistilledDay): void {
    if (day.people.length === 0) return;
    const path = join(this.root, PEOPLE_FILE);
    const body = day.people.map((person) => `${formatPersonLine(person)}\n`).join('');
    appendFileSync(path, existsSync(path) ? body : `${PEOPLE_HEADER}\n${body}`, 'utf8');
  }

  private appendPlaces(day: DistilledDay): void {
    if (day.places.length === 0) return;
    const path = join(this.root, PLACES_FILE);
    const body = day.places.map((place) => `${formatPlaceLine(place)}\n`).join('');
    appendFileSync(path, existsSync(path) ? body : `${PLACES_HEADER}\n${body}`, 'utf8');
  }

  private appendLines(day: DistilledDay): void {
    if (day.lines.length === 0) return;
    const path = join(this.root, ANNALS_DIRECTORY, `${yearOf(day.key)}.txt`);
    const body = day.lines.map((line) => `${formatAnnalLine(line)}\n`).join('');
    appendFileSync(path, existsSync(path) ? body : `${ANNALS_HEADER}\n${body}`, 'utf8');
    this.latest = day.key;
  }
}

/** `1200-04-01` is filed under `1200`. */
export function yearOf(dayKey: string): string {
  const year = dayKey.slice(0, dayKey.indexOf('-'));
  assert(/^\d+$/.test(year), 'a day key must start with a year', { dayKey });
  return year;
}

/** Year files present on disk, oldest first. */
export function listAnnalYears(root: string): string[] {
  const directory = join(resolve(root), ANNALS_DIRECTORY);
  if (!existsSync(directory)) return [];
  // `readdirSync` order is not specified, so the years are sorted explicitly
  // rather than trusted — determinism rule 5.
  return readdirSync(directory)
    .filter((name) => /^\d+\.txt$/.test(name))
    .map((name) => name.slice(0, -4))
    .sort((a, b) => Number(a) - Number(b));
}

function readPlaces(root: string): PlaceRegister {
  const path = join(root, PLACES_FILE);
  if (!existsSync(path)) return new PlaceRegister();
  return PlaceRegister.parse(readFileSync(path, 'utf8'));
}

function readPeople(root: string): PeopleRegister {
  const path = join(root, PEOPLE_FILE);
  if (!existsSync(path)) return new PeopleRegister();
  return PeopleRegister.parse(readFileSync(path, 'utf8'));
}

/**
 * The last date written to the annals, read out of the newest year file.
 *
 * Read from the record itself rather than kept in a third file. A marker file
 * is state that can disagree with the thing it describes, and the annals
 * already carry the answer in their own first column.
 */
function latestDate(root: string): string | null {
  const years = listAnnalYears(root);
  const newest = years[years.length - 1];
  if (newest === undefined) return null;

  const text = readFileSync(join(resolve(root), ANNALS_DIRECTORY, `${newest}.txt`), 'utf8');
  const lines = text.split('\n').filter((line) => line.length > 0 && !line.startsWith('#'));
  const last = lines[lines.length - 1];
  if (last === undefined) return null;

  const date = last.split('\t')[0];
  assert(date !== undefined && date.length > 0, 'the last annal line has no date', { year: newest });
  return date;
}
