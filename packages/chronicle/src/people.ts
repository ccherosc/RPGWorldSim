import { assert } from '@rpgsim/shared';
import { type EntityId, EntityKind, entityKindOf, isEntityId } from '@rpgsim/sim-core';
import { formatRow, isSkippable, parseRow } from './table.ts';

/**
 * Everybody who has ever existed, one line each, written once.
 *
 * Only birth facts live here, because only birth facts never change. A death, a
 * move, a marriage are all *events* and belong in the annals. Putting them in a
 * column would mean rewriting a line — and a line that can be rewritten is a
 * line that can be quietly rewritten, which is the one thing a permanent record
 * must not allow. Who is alive on a given day is derived: present here, with no
 * death in the annals before that day.
 *
 * The entity id is a column, unlike in the first sketch of this format, because
 * without it the file cannot be reopened. The annals name people by slug and the
 * archive names them by id, so something has to hold the two together; the
 * alternative was a sidecar index, which is a second file that can disagree with
 * the first. The id is itself a birth fact — it is assigned at creation and
 * never changes — so it breaks no rule to keep it here.
 */

export const PEOPLE_FILE = 'people.txt';
export const PEOPLE_HEADER = `# slug\tid\tname\tsex\tborn\tfamily`;
const PEOPLE_COLUMNS = 6;

export interface PersonRecord {
  /** Stable, human-readable handle. What the annals and the blog call them. */
  readonly slug: string;
  readonly id: EntityId;
  readonly name: string;
  readonly sex: string;
  /** `1160-03-02`. Their own birth date, not the day they were written down. */
  readonly born: string;
  /**
   * The family whose roof they were created under, as a name slug.
   *
   * A family, not a household id: two Netherby houses both read `netherby`.
   * Households become identified things when household events start to matter
   * (Phase 2); until then this column says which family a person belongs to,
   * which is what a reader wants from it and all it claims to be.
   */
  readonly family: string | null;
}

/**
 * Turn a display name into the stem of a slug: `jocelin-netherby`.
 *
 * The whole name, not just the surname. The surname alone was the first attempt
 * and it does not survive contact with a real village: twenty-four families hold
 * eighty-six people, so a household of four came out as `netherby`, `netherby-2`,
 * `netherby-3`, `netherby-4` — numbers standing in for exactly the names that
 * make a record readable. A slug's entire job is to be recognisable at a glance
 * a decade later, and `netherby-3` is not.
 *
 * Everything about it is a pure function of the name: no counters, no clock, no
 * randomness, so two runs of one seed allocate the same slugs in the same order.
 */
export function slugStem(name: string): string {
  const stem = words(name).join('-');
  if (stem.length > 0) return stem;

  // A name with nothing sluggable in it is not something to paper over with a
  // blank: the annals would then have two people sharing an empty handle.
  return 'person';
}

/**
 * The family column's value: the surname alone, with no allocation and no
 * suffix, because it names a family rather than identifying a household.
 */
export function familySlug(name: string): string {
  const parts = words(name);
  return parts.length > 0 ? (parts[parts.length - 1] as string) : 'household';
}

/**
 * Whole years between two `YYYY-MM-DD` dates, by comparison rather than by
 * arithmetic on days.
 *
 * Lives here because it reads a birth fact, and a birth fact is what this file
 * is. Three unrelated things now ask how old somebody was on a given day -- the
 * casting, which matches a face to an age band; the rota, which will not let a
 * child write; and a post, which will not let a parent speak for a son old
 * enough to speak for himself -- and none of them should have to import another
 * one's module to find out.
 *
 * Deliberately calendar-agnostic. The village year is twelve thirty-day months
 * and that is a data file's decision, so anything here that multiplied by 360
 * would be a second copy of it — quietly wrong the first time somebody adds a
 * thirteenth month. Comparing month-and-day is right under any calendar whose
 * months are ordered.
 */
export function yearsBetween(born: string, on: string): number {
  const [bornYear, bornRest] = splitDate(born);
  const [onYear, onRest] = splitDate(on);
  const age = onYear - bornYear - (onRest < bornRest ? 1 : 0);
  return age < 0 ? 0 : age;
}

function splitDate(date: string): [number, string] {
  const parts = date.split('-');
  assert(parts.length === 3, 'not a YYYY-MM-DD date', { date });
  const year = Number(parts[0]);
  assert(Number.isInteger(year), 'a date has a year that is not a number', { date });
  return [year, `${parts[1] as string}-${parts[2] as string}`];
}

/** A name's words, lowercased and stripped to letters and digits. */
function words(name: string): string[] {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((word) => word.length > 0);
}

/**
 * The people file, in memory.
 *
 * Reconstructible from its own text: the slugs it has already handed out are
 * read back off the lines, so a register reopened tomorrow keeps allocating
 * where yesterday left off without a counter to persist or to get out of step.
 */
export class PeopleRegister {
  private readonly bySlug = new Map<string, PersonRecord>();
  private readonly byId = new Map<EntityId, PersonRecord>();
  private readonly order: PersonRecord[] = [];

  /** Read a `people.txt`. An empty or header-only text gives an empty register. */
  static parse(text: string): PeopleRegister {
    const register = new PeopleRegister();
    for (const line of text.split('\n')) {
      const row = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (isSkippable(row)) continue;
      register.enrol(parsePersonLine(row));
    }
    return register;
  }

  get size(): number {
    return this.order.length;
  }

  /** Everyone, in the order they were written. */
  records(): readonly PersonRecord[] {
    return this.order;
  }

  has(id: EntityId): boolean {
    return this.byId.has(id);
  }

  find(id: EntityId): PersonRecord | undefined {
    return this.byId.get(id);
  }

  /**
   * Look somebody up by the handle the annals and the blog use.
   *
   * The reverse of `find`, and the direction everything downstream of the
   * record wants: a casting file, a persona book and a post all name people by
   * slug, because a slug is readable and an entity id is an artefact of the
   * order worldgen ran in.
   */
  findBySlug(slug: string): PersonRecord | undefined {
    return this.bySlug.get(slug);
  }

  /**
   * The slug for a person the record knows about.
   *
   * Throws when it does not, rather than inventing a placeholder. A `?` written
   * into the annals is permanent, and the usual reason an id is unknown is that
   * the archive being distilled is missing the day the village was founded —
   * exactly the failure this whole layer exists to make impossible.
   */
  require(id: EntityId): PersonRecord {
    const record = this.byId.get(id);
    assert(record !== undefined, 'the chronicle has no record of this person', { id });
    return record as PersonRecord;
  }

  /**
   * Write somebody down for the first time and hand them a slug.
   *
   * Returns the existing record if they are already known, adding nothing: a
   * person's line is written once, so re-distilling a day is a no-op rather
   * than a duplicate.
   */
  add(person: Omit<PersonRecord, 'slug'>): PersonRecord {
    assert(isEntityId(person.id), 'not a valid entity id', { id: person.id });
    assert(entityKindOf(person.id) === EntityKind.Npc, 'the people file holds people', {
      id: person.id,
    });
    const known = this.byId.get(person.id);
    if (known !== undefined) return known;

    const record: PersonRecord = { ...person, slug: this.allocate(slugStem(person.name)) };
    this.enrol(record);
    return record;
  }

  /**
   * The next free slug for a stem: `netherby`, then `netherby-2`, `netherby-3`.
   *
   * Counted up from the slugs actually taken rather than from a stored counter,
   * so the answer depends only on the file's contents. A suffix once given is
   * never reassigned, which is what lets a second Agnes Hargrave be `hargrave-2`
   * without displacing the first.
   */
  private allocate(stem: string): string {
    if (!this.bySlug.has(stem)) return stem;
    for (let suffix = 2; ; suffix++) {
      const candidate = `${stem}-${suffix}`;
      if (!this.bySlug.has(candidate)) return candidate;
    }
  }

  private enrol(record: PersonRecord): void {
    assert(!this.bySlug.has(record.slug), 'two people share a slug', { slug: record.slug });
    assert(!this.byId.has(record.id), 'that person is already in the people file', {
      id: record.id,
    });
    this.bySlug.set(record.slug, record);
    this.byId.set(record.id, record);
    this.order.push(record);
  }
}

export function formatPersonLine(person: PersonRecord): string {
  return formatRow([person.slug, person.id, person.name, person.sex, person.born, person.family]);
}

export function parsePersonLine(line: string): PersonRecord {
  const [slug, id, name, sex, born, family] = parseRow(line, PEOPLE_COLUMNS);
  // Five of the six columns are birth facts that always exist, so a blank one
  // is a damaged file rather than an absent fact. Only the family may be empty:
  // somebody can be created before any roof is assigned to them.
  assert(
    slug !== null && id !== null && name !== null && sex !== null && born !== null,
    'a people line is missing a required cell',
    { line },
  );
  assert(isEntityId(id as string), 'a people line has an id that is not an entity id', { line });
  return {
    slug: slug as string,
    id: id as EntityId,
    name: name as string,
    sex: sex as string,
    born: born as string,
    family: family ?? null,
  };
}
