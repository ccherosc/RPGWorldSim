import { type JsonValue, assert } from '@rpgsim/shared';
import {
  type CalendarConfig,
  DEFAULT_CALENDAR,
  type EntityId,
  compareEntityIds,
} from '@rpgsim/sim-core';
import { z } from 'zod';
import { type Person, PersonSchema, makePerson, withPerson } from './person.ts';

/**
 * Everyone who exists.
 *
 * The registry is pure state: no clock, no RNG, no event bus. It is to people
 * what `WorldMap` is to places, and for the same reason — a container that
 * emitted events would be a container that could not be used to rebuild a world
 * from a save without the save appearing to happen all over again. `PeopleSystem`
 * is the layer that holds a `Simulation` and announces things.
 *
 * Iteration is always by sorted id. Determinism rule 5: a `Map` hands back
 * insertion order, and insertion order after a load is whatever order the save
 * file happened to list people in.
 */
export interface PopulationSnapshot {
  readonly people: readonly Person[];
}

export const PopulationSnapshotShape = z
  .object({
    people: z.array(PersonSchema),
  })
  .strict();

export class Population {
  private readonly people = new Map<EntityId, Person>();

  get count(): number {
    return this.people.size;
  }

  has(id: EntityId): boolean {
    return this.people.has(id);
  }

  get(id: EntityId): Person | undefined {
    return this.people.get(id);
  }

  /** Look someone up, refusing to continue if they are not there. */
  require(id: EntityId): Person {
    const person = this.people.get(id);
    assert(person !== undefined, 'no such person', { id });
    return person;
  }

  /**
   * Enrol a person.
   *
   * Refuses a duplicate id outright. Ids come from monotonic counters, so a
   * collision means either a counter was rewound or a save was loaded on top of
   * a live world; overwriting the existing person would destroy them silently.
   */
  add(person: Person): Person {
    assert(!this.people.has(person.id), 'a person with this id already exists', { id: person.id });
    this.people.set(person.id, person);
    return person;
  }

  /**
   * Remove someone from the registry.
   *
   * Death is not this, and will not be this. A dead villager stays in the world
   * as a dead villager — inheritance, grief and the Chronicle all need them. This
   * is for the narrow case of taking an entity out of play entirely, and for
   * tests. Returns whether anyone was there.
   */
  remove(id: EntityId): boolean {
    return this.people.delete(id);
  }

  /** Ids, in a canonical order. */
  ids(): EntityId[] {
    return [...this.people.keys()].sort(compareEntityIds);
  }

  /** Everyone, in a canonical order. */
  all(): Person[] {
    return this.ids().map((id) => this.people.get(id) as Person);
  }

  /**
   * Key/record pairs, in a canonical order.
   *
   * Exposed so `npc.registry-is-coherent` can compare the two. Every other
   * reader wants `all()`; this one specifically needs to see the filing as well
   * as the file.
   */
  entries(): [EntityId, Person][] {
    return this.ids().map((id) => [id, this.people.get(id) as Person]);
  }

  /** Everyone matching a predicate, in a canonical order. */
  filter(predicate: (person: Person) => boolean): Person[] {
    return this.all().filter(predicate);
  }

  /** Members of a household, in a canonical order. */
  membersOf(household: EntityId): Person[] {
    return this.filter((person) => person.household === household);
  }

  /** Whoever sleeps at this dwelling, in a canonical order. */
  residentsOf(home: EntityId): Person[] {
    return this.filter((person) => person.home === home);
  }

  /**
   * Replace a person's record wholesale.
   *
   * A `Person` is immutable, so every change to one goes through here, and the
   * id is not allowed to move: changing it would make the registry key and the
   * record disagree, which is the exact state `npc.registry-is-coherent` exists
   * to catch.
   */
  replace(person: Person): Person {
    assert(this.people.has(person.id), 'cannot replace a person who is not here', { id: person.id });
    this.people.set(person.id, person);
    return person;
  }

  /** Move someone into a household, or out of every household with `null`. */
  setHousehold(id: EntityId, household: EntityId | null): Person {
    return this.replace(withPerson(this.require(id), { household }));
  }

  /** Give someone a dwelling to sleep in, or none with `null`. */
  setHome(id: EntityId, home: EntityId | null): Person {
    return this.replace(withPerson(this.require(id), { home }));
  }

  save(): PopulationSnapshot {
    return { people: this.all() };
  }

  /**
   * Replace the entire population.
   *
   * Clears first. A restore that merged into a live world would leave whoever
   * the save did not mention still walking about, which is a world that never
   * existed.
   */
  restore(snapshot: PopulationSnapshot): void {
    this.people.clear();
    for (const person of snapshot.people) this.add(person);
  }

  toJson(): JsonValue {
    return { people: this.all().map(personToJson) } as unknown as JsonValue;
  }

  /**
   * Validate and rebuild a saved population.
   *
   * Every record goes back through `makePerson`, so a save that somehow carries
   * a birth date this calendar does not have is refused at load rather than
   * becoming a villager whose birthday never arrives. A refused load is the
   * better failure (sim-core rule 10).
   */
  static fromJson(value: JsonValue, calendar: CalendarConfig = DEFAULT_CALENDAR): PopulationSnapshot {
    const result = PopulationSnapshotShape.safeParse(value);
    assert(result.success, 'npc save block failed validation', {
      issues: result.success
        ? []
        : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return {
      people: result.data.people.map((raw) =>
        makePerson(
          {
            id: raw.id as EntityId,
            givenName: raw.givenName,
            familyName: raw.familyName,
            sex: raw.sex,
            birth: raw.birth,
            birthplace: (raw.birthplace ?? null) as EntityId | null,
            culture: raw.culture,
            traits: raw.traits,
            household: (raw.household ?? null) as EntityId | null,
            home: (raw.home ?? null) as EntityId | null,
          },
          calendar,
        ),
      ),
    };
  }
}

/**
 * Serialize a person with every key written explicitly.
 *
 * Spelling the fields out rather than spreading the object is what makes a new
 * field a compile error here instead of a field that quietly fails to persist.
 */
function personToJson(person: Person): JsonValue {
  return {
    id: person.id,
    givenName: person.givenName,
    familyName: person.familyName,
    sex: person.sex,
    birth: { year: person.birth.year, month: person.birth.month, day: person.birth.day },
    birthplace: person.birthplace,
    culture: person.culture,
    traits: { ...person.traits },
    household: person.household,
    home: person.home,
  } as unknown as JsonValue;
}
