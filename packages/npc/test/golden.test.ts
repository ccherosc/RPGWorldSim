import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EntityKind,
  Rng,
  RngStream,
  Simulation,
  dateTimeToTick,
  makeEntityId,
  minutes,
} from '@rpgsim/sim-core';
import {
  Access,
  LocationType,
  installTravel,
  installWorld,
  makeLocation,
} from '@rpgsim/world';
import { canonicalStringify } from '@rpgsim/shared';
import { makeNameBook } from '../src/names.ts';
import { installPeople } from '../src/save.ts';
import { makePerson } from '../src/person.ts';
import { installRest } from '../src/rest.ts';
import { generateRoutine } from '../src/routine.ts';
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

const COT = makeEntityId(EntityKind.Location, 0);
const MILL = makeEntityId(EntityKind.Location, 1);

/** A cottage and a mill twenty minutes apart, so the walk home is visible. */
function hamlet(sim: Simulation) {
  const map = installWorld(sim);
  map.addLocation(
    makeLocation({
      id: COT,
      name: 'Hale Cottage',
      type: LocationType.Dwelling,
      coordinate: { x: 0, y: 0 },
      capacity: 8,
      access: Access.Public,
    }),
  );
  map.addLocation(
    makeLocation({
      id: MILL,
      name: 'The Mill',
      type: LocationType.Workshop,
      coordinate: { x: 20, y: 0 },
      capacity: 8,
    }),
  );
  map.connect(COT, MILL, minutes(20));
  const travel = installTravel(sim, map);
  const people = installPeople(sim);
  const rest = installRest(sim, people.population, map, travel);
  for (let i = 0; i < 3; i++) {
    people.add(
      makePerson({
        id: makeEntityId(EntityKind.Npc, i),
        givenName: 'Edric',
        familyName: 'Hale',
        sex: 'male',
        culture: 'valefolk',
        birth: { year: 1200 - (10 + i * 20), month: 3, day: 4 },
        home: COT,
      }),
    );
    map.place(makeEntityId(EntityKind.Npc, i), COT);
    rest.begin(makeEntityId(EntityKind.Npc, i), { dayDestination: MILL });
  }
  return { map, travel, people, rest };
}

describe('golden: the daily cycle', () => {
  it('rolls the same four habits it has always rolled', () => {
    // Straight off a bare stream, so this pins `generateRoutine` itself rather
    // than whatever `begin` happens to feed it. One villager per band, and two
    // of the four carry a role, because the role shift is arithmetic on the
    // draw rather than a draw of its own: swapping those two lines would leave
    // the draw count untouched and every apprentice in the world rising an hour
    // late.
    const rng = Rng.forStream(SEED, RngStream.Routines);
    const habits = [{ age: 9 }, { age: 19, role: 'apprentice' }, { age: 34, role: 'head' }, { age: 71 }].map(
      (who) => generateRoutine(rng, who),
    );

    expect(habits).toEqual([
      { rise: 20863, bed: 73989 },
      { rise: 16144, bed: 75635 },
      { rise: 15764, bed: 77769 },
      { rise: 19386, bed: 73801 },
    ]);

    // Two draws apiece, rise then bed. A third draw here — a role rolled
    // instead of added, say — shifts everybody generated afterwards.
    expect(rng.draws).toBe(8);
  });

  it('opens the cycle on the habit hour exactly, undrifted', () => {
    const sim = new Simulation({ seed: SEED, startTick: MIDYEAR });
    const { rest } = hamlet(sim);

    // Three villagers, six draws: the founding transition is scheduled from the
    // habit's own hour with no jitter drawn. Bedtime drifts by up to twenty
    // minutes every evening after this, but a drifted *founding* bedtime can
    // land behind the clock and cost the villager a whole day, so the first one
    // is deliberately exact — and being exact is the same as spending no draw.
    expect(sim.random(RngStream.Routines).draws).toBe(6);
    expect(sim.random(RngStream.NpcDecisions).draws).toBe(0);

    // `nextAt` is `MIDYEAR + rise` to the tick for all three.
    for (const id of [0, 1, 2]) {
      const record = rest.require(makeEntityId(EntityKind.Npc, id));
      expect(record.nextAt).toBe(MIDYEAR + record.routine.rise);
    }
  });

  it('writes the same rest block it has always written', () => {
    const sim = new Simulation({ seed: SEED, startTick: MIDYEAR });
    hamlet(sim);

    // Whole-block equality. The pending scheduled-event handle is in here on
    // purpose: a save that drops it reloads to a matching hash and then leaves
    // three villagers asleep for good, which no round-trip comparison of the
    // save against itself can see.
    expect(canonicalStringify(sim.save().modules['rest'] ?? null)).toBe(
      '{"data":{"resting":[' +
        '{"asleep":true,"dayDestination":"location:1","headingHome":false,"next":1,' +
        '"nextAt":16782463,"nextKind":"rise","npc":"npc:0","routine":{"bed":73989,"rise":20863}},' +
        '{"asleep":true,"dayDestination":"location:1","headingHome":false,"next":2,' +
        '"nextAt":16778644,"nextKind":"rise","npc":"npc:1","routine":{"bed":73835,"rise":17044}},' +
        '{"asleep":true,"dayDestination":"location:1","headingHome":false,"next":3,' +
        '"nextAt":16778264,"nextKind":"rise","npc":"npc:2","routine":{"bed":77769,"rise":16664}}' +
        ']},"version":1}',
    );
  });

  it('replays two days to the same world hash', () => {
    const sim = new Simulation({ seed: SEED, startTick: MIDYEAR });
    hamlet(sim);
    sim.runFor(2 * 86_400);

    // The whole point of directive 3, pinned to a number. Two days of waking,
    // walking to the mill, walking home and going to bed, with every jitter
    // draw and every scheduled handle folded in. A change to draw order
    // anywhere in the cycle moves this even when nothing visible changes.
    expect(sim.hash()).toBe('cee71217ba3a9e4b');
  });
});
