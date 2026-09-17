import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalStringify } from '@rpgsim/shared';
import { EntityKind, RngStream, Simulation, dateTimeToTick, makeEntityId } from '@rpgsim/sim-core';
import { ageInYears, fullName, installPeople, makeNameBook } from '@rpgsim/npc';
import {
  DEFAULT_HOUSEHOLD_TEMPLATES,
  HOUSEHOLD_ROLES,
  MIN_PARENT_AGE_GAP,
  PARENT_ABSENCES,
  installSociety,
} from '../src/index.ts';

/**
 * Golden values: the actual village, pinned.
 *
 * `society.test.ts` proves generation is *reproducible* -- build the same
 * village twice from one seed and the hashes agree. That is a weaker claim than
 * it looks, and slice 3 learned it the hard way: swap the order of two draws and
 * both runs shift together, so the comparison still passes while every world
 * ever saved now replays as different people. A mutation sweep on
 * `@rpgsim/npc` found exactly that, twice.
 *
 * So these tests compare against constants instead. Between them they pin the
 * draw order, the draw count, the balance table, the serialization vocabulary
 * and the village that comes out the far end.
 *
 * **If one of these fails, do not update the constant to make it pass.** It
 * means every existing world generates a different village. Either the change
 * was unintended and is a bug, or it was deliberate and needs a save version
 * bump and a note in docs/PHASE_1.md. Updating the numbers is only correct once
 * that decision has been made on purpose.
 */

const NAMES = makeNameBook(
  JSON.parse(readFileSync(join(process.cwd(), 'data', 'world', 'names.json'), 'utf8')),
);

const SEED = 'golden';

/** Midsummer of the epoch year, matching the npc golden tests. */
const MIDYEAR = dateTimeToTick({ year: 1200, month: 7, day: 15 });

/** Six households: enough for every role and every template to turn up. */
const HOUSEHOLDS = 6;

function pinnedVillage() {
  const sim = new Simulation({ seed: SEED, startTick: MIDYEAR });
  const people = installPeople(sim);
  const households = installSociety(sim, people);
  for (let i = 0; i < HOUSEHOLDS; i++) {
    households.generate({ dwelling: makeEntityId(EntityKind.Building, i), names: NAMES });
  }
  return { sim, people, register: households.register };
}

describe('golden: the vocabulary a save is written in', () => {
  it('lists the household roles in one fixed order', () => {
    // Serialized on every member of every household. Adding a role is a save
    // format change, not a tidy-up.
    expect(HOUSEHOLD_ROLES).toEqual([
      'apprentice',
      'child',
      'dependent',
      'head',
      'parent',
      'spouse',
    ]);
  });

  it('lists the reasons a parent can be absent in one fixed order', () => {
    expect(PARENT_ABSENCES).toEqual(['dead', 'departed', 'unknown']);
  });

  it('holds the floor between a parent and their child where the rules can see it', () => {
    expect(MIN_PARENT_AGE_GAP).toBe(14);
  });
});

describe('golden: the shape of a village', () => {
  it('weights the household templates exactly as the demographics were measured with', () => {
    // These produce 20-35 households over 80-120 people, with an age pyramid of
    // roughly a third children, a fifth youths, and seven percent over sixty.
    // Changing a weight changes every village ever generated, which is a
    // decision, not a tweak.
    expect(
      DEFAULT_HOUSEHOLD_TEMPLATES.map((template) => [template.name, template.weight]),
    ).toEqual([
      ['family', 36],
      ['young-couple', 10],
      ['widowed-parent', 14],
      ['single-adult', 16],
      ['elder-couple', 11],
      ['elder-alone', 7],
    ]);
    expect(DEFAULT_HOUSEHOLD_TEMPLATES.reduce((sum, t) => sum + t.weight, 0)).toBe(94);
  });

  it('pins the age ranges and chances each template rolls within', () => {
    expect(
      DEFAULT_HOUSEHOLD_TEMPLATES.map(
        (t) =>
          `${t.name} head ${t.headAge.min}-${t.headAge.max} ` +
          `${t.spouse ? 'married' : 'alone'} children ${t.children.min}-${t.children.max} ` +
          `elder ${t.residentParentChance} apprentice ${t.apprenticeChance}`,
      ),
    ).toEqual([
      'family head 25-52 married children 1-5 elder 0.18 apprentice 0.18',
      'young-couple head 18-27 married children 0-1 elder 0.1 apprentice 0.04',
      'widowed-parent head 30-58 alone children 1-4 elder 0.08 apprentice 0.1',
      'single-adult head 18-45 alone children 0-0 elder 0.08 apprentice 0.02',
      'elder-couple head 55-76 married children 0-1 elder 0 apprentice 0.08',
      'elder-alone head 58-82 alone children 0-0 elder 0 apprentice 0.04',
    ]);
  });
});

describe('golden: generation', () => {
  it('rolls this village, and nobody else', () => {
    const { sim, people, register } = pinnedVillage();
    const now = sim.now();
    const roster = register.all().map(
      (household) =>
        `${household.name}: ` +
        household.members
          .map((member) => {
            const person = people.population.require(member.npc);
            return `${member.role} ${fullName(person)} ${person.sex[0]}${ageInYears(person.birth, now)}`;
          })
          .join(', '),
    );

    expect(roster).toEqual([
      'Thatcher: head Gunnora Thatcher f69, spouse Ralph Thatcher m68, child Eleanor Thatcher f2',
      'Ashdown: head Cuthbert Ashdown m23, spouse Nesta Ashdown f21, child Avice Ashdown f6',
      'Rushton: head Warin Rushton m28, parent Peter Rushton m62',
      'Carter: head Beatrice Carter f82',
      'Clay: head Thomas Clay m31, child Joan Clay f12, child Stephen Clay m7, child Oswin Clay m16, child Colin Clay m14',
      'Hayward: head Sabina Hayward f31, spouse Anselm Hayward m28, child Adela Hayward f13, child Edmund Hayward m11, child Joan Hayward f7, child Hamon Hayward m0, child Katherine Hayward f10, apprentice Godwin Chandler m19',
    ]);
  });

  it('spends exactly this many draws doing it', () => {
    // Composition and people come from separate streams, so a change to one
    // moves one number and not the other. If both move, the streams have been
    // crossed and adding a household template now reshuffles every personality.
    const { sim, people, register } = pinnedVillage();
    expect(sim.random(RngStream.Households).draws).toBe(70);
    expect(sim.random(RngStream.NpcGeneration).draws).toBe(3212);
    expect(people.population.count).toBe(22);
    expect(register.householdCount).toBe(HOUSEHOLDS);
    expect(register.parentageCount).toBe(12);
  });

  it('writes exactly this save block', () => {
    // Everything at once: membership, roles, roofs, founding tick and descent.
    // A field that stopped persisting would pass a save/load hash comparison,
    // because the hash is computed from the save.
    const { register } = pinnedVillage();
    expect(canonicalStringify(register.toJson())).toBe(
      '{"households":[' +
        '{"dwelling":"building:0","founded":16761600,"id":"household:0","members":[{"npc":"npc:0","role":"head"},{"npc":"npc:1","role":"spouse"},{"npc":"npc:2","role":"child"}],"name":"Thatcher"},' +
        '{"dwelling":"building:1","founded":16761600,"id":"household:1","members":[{"npc":"npc:3","role":"head"},{"npc":"npc:4","role":"spouse"},{"npc":"npc:5","role":"child"}],"name":"Ashdown"},' +
        '{"dwelling":"building:2","founded":16761600,"id":"household:2","members":[{"npc":"npc:6","role":"head"},{"npc":"npc:7","role":"parent"}],"name":"Rushton"},' +
        '{"dwelling":"building:3","founded":16761600,"id":"household:3","members":[{"npc":"npc:8","role":"head"}],"name":"Carter"},' +
        '{"dwelling":"building:4","founded":16761600,"id":"household:4","members":[{"npc":"npc:9","role":"head"},{"npc":"npc:10","role":"child"},{"npc":"npc:11","role":"child"},{"npc":"npc:12","role":"child"},{"npc":"npc:13","role":"child"}],"name":"Clay"},' +
        '{"dwelling":"building:5","founded":16761600,"id":"household:5","members":[{"npc":"npc:14","role":"head"},{"npc":"npc:15","role":"spouse"},{"npc":"npc:16","role":"child"},{"npc":"npc:17","role":"child"},{"npc":"npc:18","role":"child"},{"npc":"npc:19","role":"child"},{"npc":"npc:20","role":"child"},{"npc":"npc:21","role":"apprentice"}],"name":"Hayward"}' +
        '],"parentage":[' +
        '{"child":"npc:2","father":{"kind":"known","npc":"npc:1"},"mother":{"kind":"known","npc":"npc:0"}},' +
        '{"child":"npc:5","father":{"kind":"known","npc":"npc:3"},"mother":{"kind":"known","npc":"npc:4"}},' +
        '{"child":"npc:6","father":{"kind":"known","npc":"npc:7"},"mother":{"kind":"absent","reason":"dead"}},' +
        '{"child":"npc:10","father":{"kind":"known","npc":"npc:9"},"mother":{"kind":"absent","reason":"dead"}},' +
        '{"child":"npc:11","father":{"kind":"known","npc":"npc:9"},"mother":{"kind":"absent","reason":"dead"}},' +
        '{"child":"npc:12","father":{"kind":"known","npc":"npc:9"},"mother":{"kind":"absent","reason":"dead"}},' +
        '{"child":"npc:13","father":{"kind":"known","npc":"npc:9"},"mother":{"kind":"absent","reason":"dead"}},' +
        '{"child":"npc:16","father":{"kind":"known","npc":"npc:15"},"mother":{"kind":"known","npc":"npc:14"}},' +
        '{"child":"npc:17","father":{"kind":"known","npc":"npc:15"},"mother":{"kind":"known","npc":"npc:14"}},' +
        '{"child":"npc:18","father":{"kind":"known","npc":"npc:15"},"mother":{"kind":"known","npc":"npc:14"}},' +
        '{"child":"npc:19","father":{"kind":"known","npc":"npc:15"},"mother":{"kind":"known","npc":"npc:14"}},' +
        '{"child":"npc:20","father":{"kind":"known","npc":"npc:15"},"mother":{"kind":"known","npc":"npc:14"}}' +
        ']}',
    );
  });

  it('hashes to one fixed world', () => {
    expect(pinnedVillage().sim.hash()).toBe('6a989ee107c4f47d');
  });
});
