import { assert } from '@rpgsim/shared';
import { type EntityId, EntityKind, entityKindOf, isEntityId } from '@rpgsim/sim-core';
import { slugStem } from './people.ts';
import { formatRow, isSkippable, parseRow } from './table.ts';

/**
 * Everywhere that exists, one line each, written once.
 *
 * The companion to `people.txt`, and the same bargain: only facts that never
 * change. A place's name, kind and who may walk into it are settled when it is
 * built; a fire, a sale or a fresh roof are *events* and belong in the annals.
 *
 * It exists because the archive used to name every person and merely number
 * every place. `npc.created` carries a name, so a reader could always say
 * "Jocelin Netherby"; nothing said what `location:3` was, so the only way to
 * find out was to count entries in `village.json` and hope worldgen had
 * allocated ids in file order. That is an assumption about the order code ran
 * in wearing the costume of a fact. `place.created` states it instead, and this
 * file is where the statement is kept.
 *
 * The plan called this half of the read model `cast.ts` — "id to display name
 * for people and places". By the time it was built, `PeopleRegister` already
 * did people, and `casting.ts` plus a `cast` command had taken the word for the
 * business of handing out portraits. Two meanings of "cast" in one package is a
 * cost paid by every reader forever, so the file is named for what it holds.
 */

export const PLACES_FILE = 'places.txt';
export const PLACES_HEADER = `# slug\tid\tname\ttype\taccess`;
const PLACE_COLUMNS = 5;

/** Somewhere anybody may walk. The green, the lanes, the church, the fields. */
export const PUBLIC = 'public';

export interface PlaceRecord {
  /** Stable, human-readable handle: `green`, `cottage-on-mill-lane-4`. */
  readonly slug: string;
  readonly id: EntityId;
  /** What a villager would call it: `The Green`. */
  readonly name: string;
  /** `square`, `street`, `dwelling`, `field`… the world's own vocabulary. */
  readonly type: string;
  /**
   * `public` or `private`, as the world settled it — not as the config asked.
   *
   * The one column here that is not merely decorative: the score reads it,
   * because something that happens on the green is seen and something that
   * happens behind a door is not, and news is a thing that was witnessed.
   */
  readonly access: string;
}

/**
 * A place's slug: the name, minus a leading article.
 *
 * `The Green` is filed under `green` rather than `the-green`, for the same
 * reason an index does it: the article is not what anybody looks under. It also
 * lands on the handle `village.json` already uses for ten of its fourteen
 * places, without this file ever reading `village.json` — the two agree because
 * they follow the same rule, not because either copies the other.
 */
export function placeSlug(name: string): string {
  const stem = slugStem(name);
  for (const article of ['the-', 'a-', 'an-']) {
    // Nothing is stripped unless the hyphen is there too, so `Theodric Barn`
    // keeps its head and what is left is never empty.
    if (stem.startsWith(article)) return stem.slice(article.length);
  }
  // `slugStem` falls back to `person` when a name has nothing sluggable in it,
  // which would be a strange thing to call a field.
  return stem === 'person' ? 'place' : stem;
}

/**
 * The places file, in memory.
 *
 * Reconstructible from its own text, exactly as `PeopleRegister` is: the slugs
 * already handed out are read back off the lines, so twenty-four cottages
 * numbered `cottage-on-mill-lane`, `-2`, `-3` keep numbering where they left
 * off with no counter to persist and no counter to get out of step.
 */
export class PlaceRegister {
  private readonly bySlug = new Map<string, PlaceRecord>();
  private readonly byId = new Map<EntityId, PlaceRecord>();
  private readonly order: PlaceRecord[] = [];

  /** Read a `places.txt`. An empty or header-only text gives an empty register. */
  static parse(text: string): PlaceRegister {
    const register = new PlaceRegister();
    for (const line of text.split('\n')) {
      const row = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (isSkippable(row)) continue;
      register.enrol(parsePlaceLine(row));
    }
    return register;
  }

  get size(): number {
    return this.order.length;
  }

  /** Everywhere, in the order it was written. */
  records(): readonly PlaceRecord[] {
    return this.order;
  }

  has(id: EntityId): boolean {
    return this.byId.has(id);
  }

  find(id: EntityId): PlaceRecord | undefined {
    return this.byId.get(id);
  }

  findBySlug(slug: string): PlaceRecord | undefined {
    return this.bySlug.get(slug);
  }

  /**
   * The place an id names.
   *
   * Throws when the record has never heard of it, rather than rendering
   * `location:3` onto a page or guessing at a name. An unknown id here means
   * the archive being read is missing the day the village was built, which is
   * the failure this layer exists to make loud instead of quiet.
   */
  require(id: EntityId): PlaceRecord {
    const record = this.byId.get(id);
    assert(record !== undefined, 'the chronicle has no record of this place', { id });
    return record as PlaceRecord;
  }

  /** Is this somewhere anybody could have seen what happened? */
  isPublic(id: EntityId): boolean {
    return this.require(id).access === PUBLIC;
  }

  /**
   * Write a place down for the first time and hand it a slug.
   *
   * Returns the existing record if it is already known, adding nothing, so
   * re-distilling a day is a no-op rather than a duplicate.
   */
  add(place: Omit<PlaceRecord, 'slug'>): PlaceRecord {
    assert(isEntityId(place.id), 'not a valid entity id', { id: place.id });
    assert(entityKindOf(place.id) === EntityKind.Location, 'the places file holds places', {
      id: place.id,
    });
    const known = this.byId.get(place.id);
    if (known !== undefined) return known;

    const record: PlaceRecord = { ...place, slug: this.allocate(placeSlug(place.name)) };
    this.enrol(record);
    return record;
  }

  /** The next free slug for a stem, counted from the slugs actually taken. */
  private allocate(stem: string): string {
    if (!this.bySlug.has(stem)) return stem;
    for (let suffix = 2; ; suffix++) {
      const candidate = `${stem}-${suffix}`;
      if (!this.bySlug.has(candidate)) return candidate;
    }
  }

  private enrol(record: PlaceRecord): void {
    assert(!this.bySlug.has(record.slug), 'two places share a slug', { slug: record.slug });
    assert(!this.byId.has(record.id), 'that place is already in the places file', {
      id: record.id,
    });
    this.bySlug.set(record.slug, record);
    this.byId.set(record.id, record);
    this.order.push(record);
  }
}

export function formatPlaceLine(place: PlaceRecord): string {
  return formatRow([place.slug, place.id, place.name, place.type, place.access]);
}

export function parsePlaceLine(line: string): PlaceRecord {
  const [slug, id, name, type, access] = parseRow(line, PLACE_COLUMNS);
  // Every column is settled when the place is built, so a blank one is a
  // damaged file rather than an absent fact.
  assert(
    slug !== null && id !== null && name !== null && type !== null && access !== null,
    'a places line is missing a required cell',
    { line },
  );
  assert(isEntityId(id as string), 'a places line has an id that is not an entity id', { line });
  return {
    slug: slug as string,
    id: id as EntityId,
    name: name as string,
    type: type as string,
    access: access as string,
  };
}
