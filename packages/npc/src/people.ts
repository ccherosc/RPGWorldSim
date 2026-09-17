import { assert } from '@rpgsim/shared';
import {
  type EntityId,
  EntityKind,
  RngStream,
  type SimEvent,
  type Simulation,
} from '@rpgsim/sim-core';
import { type GeneratePersonOptions, generatePerson } from './generate.ts';
import { type Person, ageInYears, fullName } from './person.ts';
import { Population } from './population.ts';

/**
 * The layer that announces things.
 *
 * `Population` holds people; this holds a `Simulation` and emits an event for
 * every change to one, because directive 8 asks that every significant state
 * change leave a record and directive 17 asks that a villager be explicable.
 * Both are answered by the same event stream — and the Chronicle in
 * CHRONICLE.md reads that stream and nothing else, so a change that happens
 * without an event is a change the village will never hear about.
 *
 * Mirrors `TravelSystem` in `@rpgsim/world`: pure container, plus a thin system
 * that knows what time it is.
 */
export const NpcEvent = {
  /** Somebody now exists. Worldgen, and later birth and immigration. */
  Created: 'npc.created',
  Removed: 'npc.removed',
  HouseholdChanged: 'npc.household-changed',
  HomeChanged: 'npc.home-changed',
} as const;

/** Where a new person came from. Births are Phase 2; the rest are placeholders. */
export const NpcOrigin = {
  /** Made by worldgen. They did not arrive, they were always here. */
  Founding: 'founding',
  Born: 'born',
  Arrived: 'arrived',
} as const;

export type NpcOriginName = (typeof NpcOrigin)[keyof typeof NpcOrigin];

/** Everything `generatePerson` needs except what the simulation already knows. */
export type GenerateVillagerOptions = Omit<GeneratePersonOptions, 'id' | 'now' | 'calendar'> & {
  readonly origin?: NpcOriginName;
  readonly causes?: readonly SimEvent['id'][];
};

export class PeopleSystem {
  constructor(
    private readonly sim: Simulation,
    readonly population: Population = new Population(),
  ) {}

  /**
   * Roll a new villager and enrol them.
   *
   * The id, the date and the calendar come from the simulation, and the draws
   * come from `RngStream.NpcGeneration` — never a stream shared with decisions
   * or weather, or adding one villager would shift every other random process
   * in the world (determinism rule 6).
   */
  generate(options: GenerateVillagerOptions): Person {
    const person = generatePerson(this.sim.random(RngStream.NpcGeneration), {
      ...options,
      id: this.sim.newId(EntityKind.Npc),
      now: this.sim.now(),
      calendar: this.sim.calendar,
    });
    return this.add(person, options.origin ?? NpcOrigin.Founding, options.causes ?? []);
  }

  /** Enrol an already-built person. Worldgen and tests use this directly. */
  add(
    person: Person,
    origin: NpcOriginName = NpcOrigin.Founding,
    causes: readonly SimEvent['id'][] = [],
  ): Person {
    this.population.add(person);
    this.sim.emit({
      type: NpcEvent.Created,
      actors: [person.id],
      ...(person.home !== null ? { location: person.home } : {}),
      data: {
        npc: person.id,
        name: fullName(person),
        sex: person.sex,
        // Both the age and the date. The age is what a reader wants; the date
        // is what a record needs, because an age is only true on the day it was
        // written and a chronicle read back in ten years would age everybody
        // wrongly from it.
        age: ageInYears(person.birth, this.sim.now()),
        born: { year: person.birth.year, month: person.birth.month, day: person.birth.day },
        culture: person.culture,
        origin,
      },
      causes,
    });
    return person;
  }

  /**
   * Take someone out of the world entirely.
   *
   * Not death — see `Population.remove`. `reason` is required because an entity
   * vanishing without a stated cause is exactly the kind of thing the Chronicle
   * would have to invent an explanation for.
   */
  remove(id: EntityId, reason: string): void {
    const person = this.population.require(id);
    assert(reason.length > 0, 'removing a person requires a stated reason', { id });
    this.population.remove(id);
    this.sim.emit({
      type: NpcEvent.Removed,
      actors: [id],
      data: { npc: id, name: fullName(person), reason },
    });
  }

  /** Move someone into a household, or out of one with `null`. */
  setHousehold(
    id: EntityId,
    household: EntityId | null,
    causes: readonly SimEvent['id'][] = [],
  ): Person {
    const before = this.population.require(id).household;
    const person = this.population.setHousehold(id, household);
    if (before !== household) {
      this.sim.emit({
        type: NpcEvent.HouseholdChanged,
        actors: [id],
        data: { npc: id, from: before, to: household },
        causes,
      });
    }
    return person;
  }

  /** Give someone a dwelling to sleep in, or none with `null`. */
  setHome(id: EntityId, home: EntityId | null, causes: readonly SimEvent['id'][] = []): Person {
    const before = this.population.require(id).home;
    const person = this.population.setHome(id, home);
    if (before !== home) {
      this.sim.emit({
        type: NpcEvent.HomeChanged,
        actors: [id],
        ...(home !== null ? { location: home } : {}),
        data: { npc: id, from: before, to: home },
        causes,
      });
    }
    return person;
  }
}
