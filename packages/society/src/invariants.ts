import type { EntityId, Simulation } from '@rpgsim/sim-core';
import { EntityKind, type InvariantViolation, entityKindOf, violation } from '@rpgsim/sim-core';
import { type Population, ageInYears } from '@rpgsim/npc';
import { HouseholdRole, headOf, isMember } from './household.ts';
import { MIN_PARENT_AGE_GAP } from './kinship.ts';
import type { SocietyRegister } from './register.ts';

/**
 * The rules a village obeys.
 *
 * `makeHousehold` and `HouseholdSystem` already refuse to build anything
 * malformed, so in a correct build none of these fire. They are the net under a
 * save written by a weaker version, under a future system that edits a family
 * in place, and under the next person who reaches past the API.
 *
 * Two of them are cross-package: they read `Population` as well as the
 * register. That is the whole reason this slice can finally check "everybody
 * has a household", which Phase 1 wanted in slice 3 and could not have, because
 * there were no households to check against.
 *
 * Every check is read-only. An invariant that repaired a membership would hide
 * whichever write only did half its job (sim-core rule 10).
 */
export function registerSocietyInvariants(
  sim: Simulation,
  register: SocietyRegister,
  population: Population,
): void {
  sim.registerInvariant({
    id: 'society.household-is-coherent',
    description:
      'Each household is filed under its own id, has one head, and its members are real people.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const [key, household] of register.entries()) {
        if (household.id !== key) {
          violations.push(
            violation('society.household-is-coherent', 'a household is filed under another id', {
              key,
              id: household.id,
            }),
          );
        }
        if (entityKindOf(household.id) !== EntityKind.Household) {
          violations.push(
            violation('society.household-is-coherent', 'a household lacks a household id', {
              id: household.id,
            }),
          );
        }
        if (household.members.length === 0) {
          violations.push(
            violation('society.household-is-coherent', 'a household has nobody in it', {
              household: household.id,
            }),
          );
        }
        const heads = household.members.filter(
          (member) => member.role === HouseholdRole.Head,
        ).length;
        if (heads !== 1) {
          violations.push(
            violation('society.household-is-coherent', 'a household does not have one head', {
              household: household.id,
              heads,
            }),
          );
        }
        for (const member of household.members) {
          if (!population.has(member.npc)) {
            violations.push(
              violation('society.household-is-coherent', 'a household member does not exist', {
                household: household.id,
                npc: member.npc,
              }),
            );
          }
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'society.membership-is-symmetric',
    description: 'A household and its members agree about who lives there.',
    check: () => {
      const violations: InvariantViolation[] = [];

      // The household's view: everyone it claims must claim it back.
      const claimed = new Map<EntityId, EntityId>();
      for (const household of register.all()) {
        for (const member of household.members) {
          const alreadyIn = claimed.get(member.npc);
          if (alreadyIn !== undefined) {
            violations.push(
              violation('society.membership-is-symmetric', 'somebody is in two households', {
                npc: member.npc,
                households: [alreadyIn, household.id],
              }),
            );
          }
          claimed.set(member.npc, household.id);

          const person = population.get(member.npc);
          if (person !== undefined && person.household !== household.id) {
            violations.push(
              violation(
                'society.membership-is-symmetric',
                'a household claims somebody who does not claim it',
                { household: household.id, npc: member.npc, personSays: person.household },
              ),
            );
          }
        }
      }

      // The person's view: everyone who claims a household must be in it.
      for (const person of population.all()) {
        if (person.household === null) continue;
        const household = register.get(person.household);
        if (household === undefined) {
          violations.push(
            violation(
              'society.membership-is-symmetric',
              'somebody belongs to a household that does not exist',
              { npc: person.id, household: person.household },
            ),
          );
          continue;
        }
        if (!isMember(household, person.id)) {
          violations.push(
            violation(
              'society.membership-is-symmetric',
              'somebody claims a household that does not claim them',
              { npc: person.id, household: household.id },
            ),
          );
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'society.everybody-is-housed',
    description: 'Every person belongs to a household and sleeps in its dwelling.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const person of population.all()) {
        if (person.household === null) {
          violations.push(
            violation('society.everybody-is-housed', 'somebody belongs to no household', {
              npc: person.id,
            }),
          );
          continue;
        }
        const household = register.get(person.household);
        if (household === undefined) continue; // reported by membership-is-symmetric
        if (person.home !== household.dwelling) {
          violations.push(
            violation('society.everybody-is-housed', 'somebody sleeps outside their household', {
              npc: person.id,
              home: person.home,
              dwelling: household.dwelling,
            }),
          );
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'society.descent-has-no-cycles',
    description: 'Nobody is their own ancestor.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const record of register.allParentage()) {
        // Walk up from each person. A village is a hundred people, so the naive
        // walk is cheap; correctness here matters more than the index would.
        const seen = new Set<EntityId>([record.child]);
        let frontier: EntityId[] = parentsOf(register, record.child);
        let depth = 0;
        while (frontier.length > 0 && depth <= population.count) {
          const next: EntityId[] = [];
          for (const ancestor of frontier) {
            if (ancestor === record.child) {
              violations.push(
                violation('society.descent-has-no-cycles', 'somebody descends from themselves', {
                  npc: record.child,
                }),
              );
              frontier = [];
              break;
            }
            if (seen.has(ancestor)) continue;
            seen.add(ancestor);
            next.push(...parentsOf(register, ancestor));
          }
          if (frontier.length === 0) break;
          frontier = next;
          depth++;
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'society.parents-are-older-than-their-children',
    description: `A recorded parent is at least ${MIN_PARENT_AGE_GAP} years older than their child.`,
    check: () => {
      const violations: InvariantViolation[] = [];
      const now = sim.now();
      for (const record of register.allParentage()) {
        const child = population.get(record.child);
        if (child === undefined) continue; // reported by children-have-recorded-parents
        const childAge = ageInYears(child.birth, now);
        for (const parentId of parentsOf(register, record.child)) {
          const parent = population.get(parentId);
          if (parent === undefined) continue;
          const gap = ageInYears(parent.birth, now) - childAge;
          if (gap < MIN_PARENT_AGE_GAP) {
            violations.push(
              violation(
                'society.parents-are-older-than-their-children',
                'a parent is too young to be one',
                { npc: record.child, parent: parentId, gap, required: MIN_PARENT_AGE_GAP },
              ),
            );
          }
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'society.children-have-recorded-parents',
    description:
      'Every child of a house has both parents accounted for, present or absent for a reason.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const household of register.all()) {
        for (const member of household.members) {
          if (member.role !== HouseholdRole.Child) continue;
          const record = register.parentageOf(member.npc);
          if (record === undefined) {
            violations.push(
              violation(
                'society.children-have-recorded-parents',
                'a child of the house has no recorded parents',
                { npc: member.npc, household: household.id },
              ),
            );
          }
        }
      }
      // A named parent must be somebody the world has actually heard of.
      for (const record of register.allParentage()) {
        for (const parentId of parentsOf(register, record.child)) {
          if (!population.has(parentId)) {
            violations.push(
              violation(
                'society.children-have-recorded-parents',
                'a recorded parent does not exist',
                { npc: record.child, parent: parentId },
              ),
            );
          }
        }
      }
      return violations;
    },
  });
}

/** The known parents of somebody, in a fixed order. Absent ones are not people. */
function parentsOf(register: SocietyRegister, npc: EntityId): EntityId[] {
  const record = register.parentageOf(npc);
  if (record === undefined) return [];
  const parents: EntityId[] = [];
  if (record.mother.kind === 'known') parents.push(record.mother.npc);
  if (record.father.kind === 'known') parents.push(record.father.npc);
  return parents;
}

/** Re-exported so callers can build the same head lookup the invariants use. */
export { headOf };
