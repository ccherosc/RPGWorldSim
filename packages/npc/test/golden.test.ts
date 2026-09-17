import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RngStream, Simulation, dateTimeToTick } from '@rpgsim/sim-core';
import { canonicalStringify } from '@rpgsim/shared';
import { makeNameBook } from '../src/names.ts';
import { installPeople } from '../src/save.ts';
import { TRAIT_NAMES } from '../src/traits.ts';

/**
 * Golden values: the actual village, pinned.
 *
 * `npc.test.ts` proves generation is *reproducible* -- build the same village
 * twice from one seed and the hashes agree. That is a weaker claim than it
 * looks. Swap the order of two draws in `generatePerson` and both runs shift
 * together, so the comparison still passes while every world ever saved now
 * replays as different people. A mutation sweep found exactly that: reordering
 * the given-name and family-name draws, and rolling traits in declaration order
 * instead of sorted order, both survived the entire suite.
 *
 * These tests compare against constants instead, so a change in draw order,
 * draw count, or trait iteration order fails immediately.
 *
 * **If one of these fails, do not update the constant to make it pass.** It
 * means every existing world generates different villagers. Either the change
 * was unintended and is a bug, or it was deliberate and needs a save version
 * bump and a note in docs/PHASE_1.md. Updating the numbers is only correct once
 * that decision has been made on purpose.
 */

const NAMES = makeNameBook(
  JSON.parse(readFileSync(join(process.cwd(), 'data', 'world', 'names.json'), 'utf8')),
);

const SEED = 'identity';

/** Midsummer of the epoch year, matching npc.test.ts. */
const MIDYEAR = dateTimeToTick({ year: 1200, month: 7, day: 15 });

describe('golden: personality', () => {
  it('lists the traits in one fixed order', () => {
    // Generation draws one number per trait in this order and serialization
    // writes them in it. Adding a trait changes this list, and that is a save
    // format change, not a tidy-up.
    expect(TRAIT_NAMES).toEqual([
      'ambition',
      'conscientiousness',
      'courage',
      'curiosity',
      'empathy',
      'generosity',
      'honesty',
      'impulsiveness',
      'religiosity',
      'sociability',
      'stubbornness',
      'workEthic',
    ]);
  });
});

describe('golden: generation', () => {
  it('rolls the same three villagers it has always rolled', () => {
    const sim = new Simulation({ seed: SEED, startTick: MIDYEAR });
    const people = installPeople(sim);
    const made = [0, 1, 2].map(() => people.generate({ names: NAMES }));

    // A man and two women, so both given-name lists are pinned, not just one.
    expect(made.map((person) => `${person.sex} ${person.givenName} ${person.familyName}`)).toEqual([
      'male Anselm Hale',
      'female Winifred Slade',
      'female Petronilla Thatcher',
    ]);

    expect(made.map((person) => person.birth)).toEqual([
      { year: 1179, month: 1, day: 28 },
      { year: 1170, month: 2, day: 17 },
      { year: 1190, month: 4, day: 26 },
    ]);

    // Pinned per trait, not as a summary: a mutation that rolls the right
    // twelve numbers and files them under the wrong twelve names produces the
    // same mean, the same sum, and a different person.
    expect(made[0]?.traits).toEqual({
      ambition: 27,
      conscientiousness: 90,
      courage: 15,
      curiosity: 70,
      empathy: 54,
      generosity: 63,
      honesty: 49,
      impulsiveness: 73,
      religiosity: 44,
      sociability: 32,
      stubbornness: 40,
      workEthic: 48,
    });
    expect(made[1]?.traits).toEqual({
      ambition: 77,
      conscientiousness: 47,
      courage: 48,
      curiosity: 65,
      empathy: 52,
      generosity: 16,
      honesty: 49,
      impulsiveness: 26,
      religiosity: 46,
      sociability: 62,
      stubbornness: 49,
      workEthic: 61,
    });
    expect(made[2]?.traits).toEqual({
      ambition: 51,
      conscientiousness: 54,
      courage: 33,
      curiosity: 63,
      empathy: 61,
      generosity: 35,
      honesty: 47,
      impulsiveness: 40,
      religiosity: 23,
      sociability: 49,
      stubbornness: 22,
      workEthic: 33,
    });

    // The draw count is part of the contract. 150 each: one for sex, one for
    // the given name, one for the family name, one for the age band, one for
    // the age, one for the birthday, then twelve Irwin-Hall traits at twelve
    // uniforms apiece. Drawing and discarding a value a caller had already
    // fixed would show up here.
    expect(sim.random(RngStream.NpcGeneration).draws).toBe(450);
  });

  it('serialises that village to the same bytes', () => {
    const sim = new Simulation({ seed: SEED, startTick: MIDYEAR });
    const people = installPeople(sim);
    for (let i = 0; i < 3; i++) people.generate({ names: NAMES });

    // Whole-save equality, so a field that stops being written fails here even
    // if nothing else reads it. Round-trip hash equality cannot catch that: the
    // hash is computed from the save, so a symmetric omission is invisible.
    expect(canonicalStringify(people.population.toJson())).toBe(
      '{"people":[' +
        '{"birth":{"day":28,"month":1,"year":1179},"birthplace":null,"culture":"valefolk",' +
        '"familyName":"Hale","givenName":"Anselm","home":null,"household":null,"id":"npc:0",' +
        '"sex":"male","traits":{"ambition":27,"conscientiousness":90,"courage":15,"curiosity":70,' +
        '"empathy":54,"generosity":63,"honesty":49,"impulsiveness":73,"religiosity":44,' +
        '"sociability":32,"stubbornness":40,"workEthic":48}},' +
        '{"birth":{"day":17,"month":2,"year":1170},"birthplace":null,"culture":"valefolk",' +
        '"familyName":"Slade","givenName":"Winifred","home":null,"household":null,"id":"npc:1",' +
        '"sex":"female","traits":{"ambition":77,"conscientiousness":47,"courage":48,' +
        '"curiosity":65,"empathy":52,"generosity":16,"honesty":49,"impulsiveness":26,' +
        '"religiosity":46,"sociability":62,"stubbornness":49,"workEthic":61}},' +
        '{"birth":{"day":26,"month":4,"year":1190},"birthplace":null,"culture":"valefolk",' +
        '"familyName":"Thatcher","givenName":"Petronilla","home":null,"household":null,' +
        '"id":"npc:2","sex":"female","traits":{"ambition":51,"conscientiousness":54,"courage":33,' +
        '"curiosity":63,"empathy":61,"generosity":35,"honesty":47,"impulsiveness":40,' +
        '"religiosity":23,"sociability":49,"stubbornness":22,"workEthic":33}}]}',
    );
  });
});
