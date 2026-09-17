import { assert, assertInt } from '@rpgsim/shared';
import {
  type CalendarConfig,
  DEFAULT_CALENDAR,
  type EntityId,
  EntityKind,
  type MonthConfig,
  type WorldDateTime,
  entityKindOf,
  isEntityId,
} from '@rpgsim/sim-core';
import { z } from 'zod';
import { type TraitName, type Traits, TraitsSchema, makeTraits } from './traits.ts';

/**
 * A person, at the identity layer.
 *
 * NPC_MODEL.md separates NPC data by rate of change. This is the slowest layer:
 * the facts that are true of someone for their whole life, or close to it. Fast
 * state (hunger, mood, what they are doing) is Phase 2 and gets its own record,
 * so that a save of a hundred villagers does not rewrite a hundred birth dates
 * every tick.
 *
 * A `Person` is immutable, on the same reasoning as `Location`: exactly one
 * writable copy of any fact. Household and home *do* change over a life, so the
 * registry replaces the whole record rather than mutating a field — see
 * `Population.setHousehold`.
 */

export const Sex = {
  Male: 'male',
  Female: 'female',
} as const;

export type SexName = (typeof Sex)[keyof typeof Sex];

/**
 * A birth date, as a calendar date rather than a tick.
 *
 * The obvious encoding is `birthTick`, and it is wrong here. Tick 0 is the first
 * instant of the epoch year, so a forty-year-old alive at the start of the
 * simulation was born four decades *before* tick 0, and `tickToDateTime` refuses
 * a negative tick by design. Every alternative — shifting the epoch back a
 * century, allowing signed ticks — spends real complexity to store a fact that
 * is only ever read as a date anyway. Age is then integer year arithmetic with
 * no tick involved at all, which is exact.
 */
export interface BirthDate {
  readonly year: number;
  /** 1-based index into the calendar's months. */
  readonly month: number;
  /** 1-based day within the month. */
  readonly day: number;
}

export const BirthDateSchema = z
  .object({
    year: z.number().int(),
    month: z.number().int().positive(),
    day: z.number().int().positive(),
  })
  .strict();

const EntityIdSchema = z.string().refine(isEntityId, { message: 'not a valid entity id' });

export const PersonSchema = z
  .object({
    id: EntityIdSchema,
    givenName: z.string().min(1),
    familyName: z.string().min(1),
    sex: z.enum([Sex.Male, Sex.Female]),
    birth: BirthDateSchema,
    /**
     * Where they were born. `null` means "not here" — an incomer whose origin
     * the village does not model. Directive 6 in miniature: a person with an
     * invented birthplace would be a fact from nowhere.
     */
    birthplace: EntityIdSchema.nullable(),
    culture: z.string().min(1),
    traits: TraitsSchema,
    /** Their household. `null` until slice 4 forms households. */
    household: EntityIdSchema.nullable(),
    /** The dwelling location they sleep in. `null` until slice 4 assigns one. */
    home: EntityIdSchema.nullable(),
  })
  .strict();

export type Person = {
  readonly id: EntityId;
  readonly givenName: string;
  readonly familyName: string;
  readonly sex: SexName;
  readonly birth: BirthDate;
  readonly birthplace: EntityId | null;
  readonly culture: string;
  readonly traits: Traits;
  readonly household: EntityId | null;
  readonly home: EntityId | null;
};

export interface PersonInit {
  readonly id: EntityId;
  readonly givenName: string;
  readonly familyName: string;
  readonly sex: SexName;
  readonly birth: BirthDate;
  readonly birthplace?: EntityId | null;
  readonly culture: string;
  readonly traits?: Partial<Record<TraitName, number>> | Traits;
  readonly household?: EntityId | null;
  readonly home?: EntityId | null;
}

/**
 * Build a person, refusing anything malformed.
 *
 * Validation happens here rather than in `Population.add`, so that a person who
 * never existed in an invalid form cannot be stored in one. The calendar is a
 * parameter because a birth date is only meaningful against one: Deepfrost 47
 * is not a day, and a record holding it should never come into being.
 */
export function makePerson(init: PersonInit, calendar: CalendarConfig = DEFAULT_CALENDAR): Person {
  assert(isEntityId(init.id), 'person id is not a valid entity id', { id: init.id });
  assert(entityKindOf(init.id) === EntityKind.Npc, 'a person must have an npc id', { id: init.id });
  assert(init.givenName.length > 0, 'a person must have a given name', { id: init.id });
  assert(init.familyName.length > 0, 'a person must have a family name', { id: init.id });
  assert(init.culture.length > 0, 'a person must have a culture', { id: init.id });
  assert(
    init.sex === Sex.Male || init.sex === Sex.Female,
    'a person must have a known sex',
    { id: init.id, sex: init.sex },
  );
  assertBirthDate(init.birth, calendar, init.id);

  return Object.freeze({
    id: init.id,
    givenName: init.givenName,
    familyName: init.familyName,
    sex: init.sex,
    birth: Object.freeze({ ...init.birth }),
    birthplace: init.birthplace ?? null,
    culture: init.culture,
    traits: makeTraits(init.traits ?? {}),
    household: init.household ?? null,
    home: init.home ?? null,
  });
}

/** Is this a date the calendar actually has? */
export function isValidBirthDate(birth: BirthDate, calendar: CalendarConfig): boolean {
  if (!Number.isSafeInteger(birth.year)) return false;
  if (!Number.isSafeInteger(birth.month) || !Number.isSafeInteger(birth.day)) return false;
  if (birth.month < 1 || birth.month > calendar.months.length) return false;
  const month = calendar.months[birth.month - 1] as MonthConfig;
  return birth.day >= 1 && birth.day <= month.days;
}

function assertBirthDate(birth: BirthDate, calendar: CalendarConfig, id: EntityId): void {
  assertInt(birth.year, 'birth year must be an integer');
  assertInt(birth.month, 'birth month must be an integer');
  assertInt(birth.day, 'birth day must be an integer');
  assert(isValidBirthDate(birth, calendar), 'birth date is not a day this calendar has', {
    id,
    birth,
    calendarId: calendar.id,
  });
}

/**
 * Whole years lived, as of `now`.
 *
 * Returns a negative number for someone whose birth date is in the future
 * rather than clamping to zero. That is not a state the simulation should ever
 * reach, and `npc.birth-date-is-in-the-past` exists to catch it; a helpfully
 * clamped zero would hide it instead (sim-core rule 10).
 */
export function ageInYears(birth: BirthDate, now: WorldDateTime): number {
  const hadBirthday = now.month > birth.month || (now.month === birth.month && now.day >= birth.day);
  return now.year - birth.year - (hadBirthday ? 0 : 1);
}

/** `Edric Hale` */
export function fullName(person: Person): string {
  return `${person.givenName} ${person.familyName}`;
}

/** Is today their birthday? Used later for ageing and for the Chronicle. */
export function isBirthday(person: Person, now: WorldDateTime): boolean {
  return now.month === person.birth.month && now.day === person.birth.day;
}

/** A copy with some identity facts replaced. The only way a person changes. */
export function withPerson(person: Person, changes: Partial<Omit<Person, 'id'>>): Person {
  return Object.freeze({ ...person, ...changes });
}
