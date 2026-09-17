import type { EntityId, Simulation } from '@rpgsim/sim-core';
import { EntityKind, type InvariantViolation, entityKindOf, violation } from '@rpgsim/sim-core';
import { Sex, ageInYears, isValidBirthDate } from './person.ts';
import type { Population } from './population.ts';
import { TRAIT_MAX, TRAIT_MIN, TRAIT_NAMES, type TraitName } from './traits.ts';

/**
 * The rules a person obeys.
 *
 * `makePerson` already refuses to build anything malformed, so in a correct
 * build none of these fire. That is the point, as with the world's invariants:
 * they are the net under a save written by a weaker version, under the next
 * person who reaches past the API, and under a future system that edits a
 * villager in place.
 *
 * Every check is read-only. An invariant that fixed a trait would hide the
 * arithmetic that broke it (sim-core rule 10).
 */
export function registerNpcInvariants(sim: Simulation, population: Population): void {
  sim.registerInvariant({
    id: 'npc.registry-is-coherent',
    description: 'Each person is filed under their own id, and that id is an npc id.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const [key, person] of population.entries()) {
        if (person.id !== key) {
          violations.push(
            violation('npc.registry-is-coherent', 'a person is filed under somebody else’s id', {
              key,
              id: person.id,
            }),
          );
        }
        if (entityKindOf(person.id) !== EntityKind.Npc) {
          violations.push(
            violation('npc.registry-is-coherent', 'a person does not have an npc id', {
              id: person.id,
            }),
          );
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'npc.traits-within-range',
    description: 'Everybody has exactly the known traits, each an integer on the 0-100 scale.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const person of population.all()) {
        const present = Object.keys(person.traits).sort();
        for (const name of present) {
          if (!(TRAIT_NAMES as readonly string[]).includes(name)) {
            violations.push(
              violation('npc.traits-within-range', 'a person has a trait nobody has heard of', {
                npc: person.id,
                trait: name,
              }),
            );
          }
        }
        for (const name of TRAIT_NAMES) {
          const value = person.traits[name as TraitName];
          if (value === undefined) {
            violations.push(
              violation('npc.traits-within-range', 'a person is missing a trait', {
                npc: person.id,
                trait: name,
              }),
            );
            continue;
          }
          if (!Number.isSafeInteger(value) || value < TRAIT_MIN || value > TRAIT_MAX) {
            violations.push(
              violation('npc.traits-within-range', 'a trait is outside its range', {
                npc: person.id,
                trait: name,
                value,
              }),
            );
          }
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'npc.birth-date-is-in-the-past',
    description: 'Every birth date is a day this calendar has, and it has already happened.',
    check: () => {
      const violations: InvariantViolation[] = [];
      const now = sim.now();
      for (const person of population.all()) {
        if (!isValidBirthDate(person.birth, sim.calendar)) {
          violations.push(
            violation(
              'npc.birth-date-is-in-the-past',
              'a person was born on a day the calendar does not have',
              { npc: person.id, birth: person.birth, calendar: sim.calendar.id },
            ),
          );
          continue;
        }
        const age = ageInYears(person.birth, now);
        if (age < 0) {
          violations.push(
            violation('npc.birth-date-is-in-the-past', 'a person has not been born yet', {
              npc: person.id,
              birth: person.birth,
              today: { year: now.year, month: now.month, day: now.day },
              age,
            }),
          );
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'npc.identity-is-complete',
    description: 'Everybody has a name, a culture and a known sex.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const person of population.all()) {
        const missing: string[] = [];
        if (person.givenName.length === 0) missing.push('givenName');
        if (person.familyName.length === 0) missing.push('familyName');
        if (person.culture.length === 0) missing.push('culture');
        if (person.sex !== Sex.Male && person.sex !== Sex.Female) missing.push('sex');
        if (missing.length > 0) {
          violations.push(
            violation('npc.identity-is-complete', 'a person is missing part of their identity', {
              npc: person.id as EntityId,
              missing,
            }),
          );
        }
      }
      return violations;
    },
  });
}
