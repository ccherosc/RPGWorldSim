import { type JsonObject, type JsonValue, assert, isJsonObject } from '@rpgsim/shared';
import {
  type CalendarConfig,
  type EntityId,
  EntityKind,
  type SimEvent,
  dayKeyOf,
  entityKindOf,
  isEntityId,
  tickToDateTime,
} from '@rpgsim/sim-core';
import { type PeopleRegister, type PersonRecord, familySlug } from './people.ts';
import { type PlaceRecord, type PlaceRegister } from './places.ts';
import { type SignificanceConfig, isNotable } from './significance.ts';
import { EMPTY, formatRow } from './table.ts';

/**
 * One archived day in, one day's worth of village memory out.
 *
 * The day archive is exact and enormous — about 80 MB of JSONL a simulated year
 * — and it is a **cache**, not a record: the seed reproduces it byte for byte,
 * so it can be deleted and rebuilt at will. What cannot be rebuilt from a seed
 * is a *judgement* about what mattered. That judgement is what this file makes,
 * and it is small enough to keep forever.
 *
 * `distil` is a pure function of its inputs: no clock, no filesystem, no
 * randomness, no ambient state. The one thing it mutates is the people register
 * handed to it, which is how slugs get allocated — and that mutation is itself
 * idempotent, so distilling the same day twice produces the same lines and adds
 * nobody twice.
 */

export const ANNALS_HEADER = `# date\ttime\tevent\twho\tdetail\tid`;
export const ANNALS_COLUMNS = 6;

export interface AnnalLine {
  /** `1200-04-01`. The day the line belongs to, and the file it is filed under. */
  readonly date: string;
  /** `06:12`. Minutes, because the annals are a memory and not a log. */
  readonly time: string;
  readonly type: string;
  /** The people involved, by slug, comma-separated. `-` when nobody was. */
  readonly who: string;
  /** A short human sentence fragment, or `-` when the type has nothing to add. */
  readonly detail: string;
  /** The archived event this line came from. Every line traces back to one. */
  readonly event: number;
}

export interface DistilledDay {
  readonly key: string;
  readonly lines: readonly AnnalLine[];
  /** People written down for the first time by this day, in creation order. */
  readonly people: readonly PersonRecord[];
  /** Places written down for the first time by this day, in creation order. */
  readonly places: readonly PlaceRecord[];
}

export interface DistilOptions {
  /** The day key the events are expected to belong to, `1200-04-01`. */
  readonly key: string;
  /** One archived day, in the order it was written. */
  readonly events: readonly SimEvent[];
  readonly calendar: CalendarConfig;
  readonly significance: SignificanceConfig;
  /** Advanced in place: new people are enrolled and handed slugs. */
  readonly people: PeopleRegister;
  /** Advanced in place: new places are enrolled and handed slugs. */
  readonly places: PlaceRegister;
}

export function distil(options: DistilOptions): DistilledDay {
  const { key, events, calendar, significance, people, places } = options;

  for (const event of events) {
    assert(dayKeyOf(event.tick, calendar) === key, 'an event does not belong to the day named', {
      key,
      found: dayKeyOf(event.tick, calendar),
      event: event.id,
    });
  }

  // Two passes, because a person is announced before the roof they live under
  // is. `npc.created` carries no household -- worldgen founds the house
  // afterwards -- so the family column can only be filled in once the whole day
  // has been read. A one-pass version would write every founding villager down
  // as belonging to nobody.
  const added = enrol(events, people);
  const built = survey(events, places);
  const lines: AnnalLine[] = [];
  for (const event of events) {
    if (!isNotable(significance, event.type)) continue;
    const date = tickToDateTime(event.tick, calendar);
    lines.push({
      date: key,
      time: `${pad(date.hour)}:${pad(date.minute)}`,
      type: event.type,
      who: whoOf(event, people),
      detail: detailOf(event, people),
      event: event.id,
    });
  }
  return { key, lines, people: added, places: built };
}

export function formatAnnalLine(line: AnnalLine): string {
  return formatRow([line.date, line.time, line.type, line.who, line.detail, `#${line.event}`]);
}

/**
 * Write down everywhere this day built.
 *
 * Simpler than `enrol` because a place needs no second pass: `place.created`
 * states the name, the kind and the access all at once, whereas a person is
 * announced before the roof they live under is.
 *
 * Deliberately outside the notability filter, exactly as people are. Thirty-
 * eight lines of "somewhere exists" would drown the annals of the founding day,
 * so `place.created` carries a weight of zero and appears in no annal — but the
 * places file still has to know, because every annal line that follows names a
 * place that has to resolve to something.
 */
function survey(events: readonly SimEvent[], places: PlaceRegister): PlaceRecord[] {
  const built: PlaceRecord[] = [];
  for (const event of events) {
    if (event.type !== 'place.created') continue;
    const data = objectData(event);
    if (data === undefined) continue;
    const place = asEntity(data['place']);
    const name = asString(data['name']);
    assert(place !== undefined && name !== undefined, 'place.created is missing its place or its name', {
      event: event.id,
    });
    if (places.has(place as EntityId)) continue;
    built.push(
      places.add({
        id: place as EntityId,
        name: name as string,
        type: asString(data['type']) ?? EMPTY,
        access: asString(data['access']) ?? EMPTY,
      }),
    );
  }
  return built;
}

/**
 * Write down everybody this day announced.
 *
 * The family each of them belongs to is read from the household events in the
 * same day, which is where it is stated: `society.household-founded` names both
 * the family and its members, and `npc.household-changed` catches anybody who
 * moved in afterwards. Somebody created on a day where no house claims them
 * keeps an empty family column rather than a guess.
 */
function enrol(events: readonly SimEvent[], people: PeopleRegister): PersonRecord[] {
  const familyOf = new Map<EntityId, string>();
  const nameOfHousehold = new Map<EntityId, string>();

  for (const event of events) {
    const data = objectData(event);
    if (data === undefined) continue;
    if (event.type === 'society.household-founded') {
      const household = asEntity(data['household']);
      const name = asString(data['name']);
      if (household === undefined || name === undefined) continue;
      nameOfHousehold.set(household, name);
      for (const member of event.actors) familyOf.set(member, familySlug(name));
    } else if (event.type === 'npc.household-changed') {
      const npc = asEntity(data['npc']);
      const to = asEntity(data['to']);
      if (npc === undefined) continue;
      const name = to === undefined ? undefined : nameOfHousehold.get(to);
      if (name !== undefined) familyOf.set(npc, familySlug(name));
    }
  }

  const added: PersonRecord[] = [];
  for (const event of events) {
    if (event.type !== 'npc.created') continue;
    const data = objectData(event);
    if (data === undefined) continue;
    const npc = asEntity(data['npc']);
    const name = asString(data['name']);
    assert(npc !== undefined && name !== undefined, 'npc.created is missing its npc or its name', {
      event: event.id,
    });
    if (people.has(npc as EntityId)) continue;
    added.push(
      people.add({
        id: npc as EntityId,
        name: name as string,
        sex: asString(data['sex']) ?? EMPTY,
        born: bornOf(data['born']),
        family: familyOf.get(npc as EntityId) ?? null,
      }),
    );
  }
  return added;
}

/**
 * The people a line is about, by slug.
 *
 * Only `npc:` actors: a location or an object in the actor list is a
 * participant in the event, not somebody the annals can name. An npc the record
 * has never heard of throws rather than rendering as a placeholder — see
 * `PeopleRegister.require`.
 */
function whoOf(event: SimEvent, people: PeopleRegister): string {
  const slugs = event.actors
    .filter((actor) => entityKindOf(actor) === EntityKind.Npc)
    .map((actor) => people.require(actor).slug);
  return slugs.length > 0 ? slugs.join(',') : EMPTY;
}

/**
 * The sentence fragment for one event type.
 *
 * This is rendering, not filtering: what counts as notable is data
 * (`significance.json`), and how a notable thing reads is code. A type with no
 * entry here still gets a line — the type name, the people and the event id are
 * already the substance of it — it just says nothing extra.
 */
function detailOf(event: SimEvent, people: PeopleRegister): string {
  const data = objectData(event);
  if (data === undefined) return EMPTY;
  const renderer = DETAIL[event.type];
  if (renderer === undefined) return EMPTY;
  return renderer(data, people) ?? EMPTY;
}

type Detail = (data: JsonObject, people: PeopleRegister) => string | undefined;

const DETAIL: Record<string, Detail> = {
  'world.generated': (data) =>
    `${asString(data['village']) ?? 'the village'}: ${asNumber(data['people']) ?? 0} people, ` +
    `${asNumber(data['households']) ?? 0} households, ${asNumber(data['places']) ?? 0} places`,

  'npc.created': (data) => {
    const age = asNumber(data['age']);
    const origin = asString(data['origin']);
    const born = age === undefined ? undefined : `aged ${age}`;
    return [asString(data['name']), born, origin].filter((part) => part !== undefined).join(', ');
  },

  'npc.removed': (data) => `${asString(data['name']) ?? EMPTY}: ${asString(data['reason']) ?? ''}`,

  'society.household-founded': (data) => {
    const size = asNumber(data['size']);
    const name = asString(data['name']) ?? EMPTY;
    return size === undefined ? `the ${name} house` : `the ${name} house, ${size} under the roof`;
  },

  'society.household-dissolved': (data) =>
    `the ${asString(data['name']) ?? EMPTY} house ended: ${asString(data['reason']) ?? ''}`,

  'society.household-member-joined': (data) => `joined as ${asString(data['role']) ?? EMPTY}`,

  'society.household-member-left': (data) => `left: ${asString(data['reason']) ?? ''}`,

  'society.household-role-changed': (data) =>
    `${asString(data['from']) ?? EMPTY} to ${asString(data['role']) ?? EMPTY}`,

  'society.parentage-recorded': (data, people) =>
    `child of ${parentOf(data['mother'], data['motherAbsent'], people)} and ` +
    `${parentOf(data['father'], data['fatherAbsent'], people)}`,

  // Locations have no names yet -- the cast that gives them one is slice 4 --
  // so a refusal says why it was refused and nothing it cannot back up.
  'travel.blocked': (data) => {
    const reason = asString(data['reason']) ?? EMPTY;
    const capacity = asNumber(data['capacity']);
    const occupancy = asNumber(data['occupancy']);
    if (reason === 'full' && capacity !== undefined && occupancy !== undefined) {
      return `turned back: full (${occupancy}/${capacity})`;
    }
    return `turned back: ${reason}`;
  },

  'npc.could-not-rest': (data) => `could not get home: ${asString(data['reason']) ?? EMPTY}`,
};

/**
 * A parent, as a slug, a stated reason for absence, or `unknown`.
 *
 * The three cases are genuinely different and the record keeps them apart: a
 * known parent, a parent the world has a reason for not naming, and a parent
 * nobody recorded either way.
 */
function parentOf(npc: JsonValue | undefined, absent: JsonValue | undefined, people: PeopleRegister): string {
  const id = asEntity(npc);
  if (id !== undefined) return people.require(id).slug;
  const reason = asString(absent);
  return reason ?? 'unknown';
}

function bornOf(value: JsonValue | undefined): string {
  if (!isJsonObject(value)) return EMPTY;
  const year = asNumber(value['year']);
  const month = asNumber(value['month']);
  const day = asNumber(value['day']);
  if (year === undefined || month === undefined || day === undefined) return EMPTY;
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function objectData(event: SimEvent): JsonObject | undefined {
  return isJsonObject(event.data) ? event.data : undefined;
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** An entity id, or `undefined` for a null, a missing key or anything malformed. */
function asEntity(value: JsonValue | undefined): EntityId | undefined {
  return typeof value === 'string' && isEntityId(value) ? value : undefined;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
