import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemorySaveStore, TICKS_PER_DAY, dateTimeToTick } from '@rpgsim/sim-core';
import { memberIds } from '@rpgsim/society';
import {
  type VillageConfig,
  attachVillageWorld,
  createVillageWorld,
  loadCalendar,
  loadNames,
  loadVillage,
  verifyDeterminism,
  villageWorldFactory,
} from '../src/index.ts';

/**
 * World Zero, from the data file to a village that runs.
 *
 * Two things are being tested here and they fail in different ways. The
 * **loader** fails loudly or not at all: a data file that is wrong in a way the
 * schema does not catch produces a village that is quietly wrong for as long as
 * it runs. The **builder** fails quietly by construction — nothing complains
 * when a cottage ends up with no residents, when two families share a roof, or
 * when the family that owns a house cannot get into it, and every one of those
 * is a Prime Directive (6, 7) broken without a single error. So most of what is
 * below asks whether the built village is physically coherent, not whether the
 * builder ran.
 */

const CONFIG = loadVillage();
const NAMES = loadNames();
const CALENDAR = loadCalendar();

function village(seed = 'village-test', config: VillageConfig = CONFIG) {
  return createVillageWorld({ seed, config, names: NAMES, calendar: CALENDAR });
}

/** A copy of the shipped config with one thing changed, for the refusal tests. */
function broken(changes: (config: VillageConfig) => unknown): VillageConfig {
  return { ...structuredClone(CONFIG), ...(changes(CONFIG) as object) } as VillageConfig;
}

function writeVillage(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'rpgsim-village-'));
  mkdirSync(join(root, 'world'), { recursive: true });
  writeFileSync(join(root, 'world', 'village.json'), JSON.stringify(value), 'utf8');
  return root;
}

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('loading village.json', () => {
  it('loads the shipped village', () => {
    expect(CONFIG.name.length).toBeGreaterThan(0);
    expect(CONFIG.places.length).toBeGreaterThan(0);
    expect(CONFIG.population.households).toBeGreaterThan(0);
  });

  it('refers only to places it defines', () => {
    // The builder throws on an unknown slug, but only for a slug it reaches.
    // This covers every slug in the file, including ones on paths a short test
    // run never walks down.
    const slugs = new Set(CONFIG.places.map((place) => place.slug));
    const referenced = [
      ...CONFIG.roads.flatMap((road) => [road.from, road.to]),
      ...CONFIG.structures.map((structure) => structure.place),
      ...CONFIG.dwellings.lanes,
      ...CONFIG.population.dayDestinations,
    ];
    expect(referenced.filter((slug) => !slugs.has(slug))).toEqual([]);
  });

  it('gives every household a roof', () => {
    expect(CONFIG.population.households).toBeLessThanOrEqual(CONFIG.dwellings.count);
  });

  it('covers every age with its routine bands', () => {
    // The last band is the catch-all. Without it, a villager who outlives the
    // table has no rise time and the routine system decides what to do about
    // it — which is exactly the silent correction sim-core rule 10 forbids.
    const last = CONFIG.population.routineBands.at(-1);
    expect(last?.maxAge).toBeNull();
  });

  it('rejects a village file that does not match the schema', () => {
    const root = writeVillage({ ...CONFIG, places: [] });
    temporaryRoots.push(root);
    expect(() => loadVillage(root)).toThrow(/is not a valid village/);
  });

  it('names every offending field, not just the first', () => {
    const root = writeVillage({
      ...CONFIG,
      name: 42,
      dwellings: { ...CONFIG.dwellings, count: -3 },
    });
    temporaryRoots.push(root);
    expect(() => loadVillage(root)).toThrow(/name/);
    expect(() => loadVillage(root)).toThrow(/dwellings.count/);
  });

  it('rejects an unknown key rather than ignoring it', () => {
    // A misspelled key that parses is a setting somebody wrote and nothing read.
    const root = writeVillage({ ...CONFIG, dwelings: CONFIG.dwellings });
    temporaryRoots.push(root);
    expect(() => loadVillage(root)).toThrow(/is not a valid village/);
  });

  it('fails when the file is missing rather than building an empty village', () => {
    const root = mkdtempSync(join(tmpdir(), 'rpgsim-novillage-'));
    temporaryRoots.push(root);
    expect(() => loadVillage(root)).toThrow();
  });

  it('loads a name book with names in it', () => {
    expect(NAMES.culture.length).toBeGreaterThan(0);
    expect(NAMES.given.male.length).toBeGreaterThan(0);
    expect(NAMES.given.female.length).toBeGreaterThan(0);
    expect(NAMES.family.length).toBeGreaterThan(0);
  });

  it('has enough family names that the village is not all one household', () => {
    expect(NAMES.family.length).toBeGreaterThanOrEqual(CONFIG.population.households);
  });

  it('fails on a name book the generator could not use', () => {
    const root = mkdtempSync(join(tmpdir(), 'rpgsim-names-'));
    temporaryRoots.push(root);
    mkdirSync(join(root, 'world'), { recursive: true });
    const path = join(root, 'world', 'names.json');

    writeFileSync(path, JSON.stringify({ culture: 'x', given: { male: [], female: ['A'] }, family: ['B'] }), 'utf8');
    expect(() => loadNames(root)).toThrow();

    // A repeated name is a paste error, not a weighting choice, and it would
    // silently double that name's frequency in the village.
    writeFileSync(
      path,
      JSON.stringify({ culture: 'x', given: { male: ['A', 'A'], female: ['B'] }, family: ['C'] }),
      'utf8',
    );
    expect(() => loadNames(root)).toThrow(/duplicate/i);
  });
});

describe('building the village', () => {
  it('builds the shape the data file describes', () => {
    const world = village();
    expect(world.map.locationCount).toBe(CONFIG.places.length + CONFIG.dwellings.count);
    expect(world.map.buildingIds()).toHaveLength(
      CONFIG.structures.length + CONFIG.dwellings.count,
    );
    expect(world.households.register.householdCount).toBe(CONFIG.population.households);
    expect(world.population).toBeGreaterThan(CONFIG.population.households);
  });

  it('opens on the date the data file names, not at tick zero', () => {
    const world = village();
    expect(world.sim.tick).toBe(dateTimeToTick(CONFIG.start, CALENDAR));
    expect(world.sim.tick).toBeGreaterThan(0);
  });

  it('puts one household in each cottage and nobody under two roofs', () => {
    const world = village();
    const dwellings = world.households.register.all().map((household) => household.dwelling);
    expect(new Set(dwellings).size).toBe(dwellings.length);

    const everyone = world.households.register.all().flatMap((household) => memberIds(household));
    expect(new Set(everyone).size).toBe(everyone.length);
    expect(everyone).toHaveLength(world.population);
  });

  it('names each cottage for its family and records who owns and lives in it', () => {
    const world = village();
    for (const household of world.households.register.all()) {
      const building = world.map
        .buildingsInOrder()
        .find((candidate) => candidate.location === household.dwelling);
      expect(building, `no building for ${household.id}`).toBeDefined();

      const family = memberIds(household);
      expect(building?.name).toContain(household.name);
      expect(building?.owner).toBe(family[0]);
      expect([...(building?.residents ?? [])].sort()).toEqual([...family].sort());
    }
  });

  it('lets a family into its own house and keeps strangers out', () => {
    const world = village();
    const households = world.households.register.all();
    const [first, second] = [households[0], households[1]];
    expect(first && second).toBeTruthy();

    for (const member of memberIds(first!)) {
      // Already standing inside is not a fair test of the permission list, so
      // step out to the lane and ask to come back in.
      world.map.move(member, world.map.connectionsOf(first!.dwelling)[0]!.to);
      expect(world.map.canEnter(member, first!.dwelling).allowed).toBe(true);
    }

    const outsider = memberIds(second!)[0]!;
    const check = world.map.canEnter(outsider, first!.dwelling);
    expect(check.allowed).toBe(false);
  });

  it('starts everybody at home and in bed', () => {
    const world = village();
    for (const household of world.households.register.all()) {
      for (const member of memberIds(household)) {
        expect(world.map.locationOf(member)).toBe(household.dwelling);
        expect(world.rest.isAsleep(member)).toBe(true);
      }
    }
  });

  /**
   * The village's own bell curve, not the package default.
   *
   * These two happen to state the same numbers today, so nothing about the
   * shipped village can tell whether `village.json` reaches the generator at
   * all. Extreme curves make the wiring visible: if the config stopped being
   * passed through, both villages would come out identical and average.
   */
  it('rolls personalities from the curve the data file states', () => {
    const averageTrait = (mean: number) => {
      const config = broken((c) => ({
        population: { ...c.population, traits: { mean, stdDev: 2 } },
      }));
      const values = village('traits', config)
        .people.population.all()
        .flatMap((person) => Object.values(person.traits));
      expect(values.length).toBeGreaterThan(100);
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    expect(averageTrait(10)).toBeLessThan(20);
    expect(averageTrait(90)).toBeGreaterThan(80);
  });

  it('refuses to house more families than there are cottages', () => {
    const config = broken((c) => ({
      population: { ...c.population, households: c.dwellings.count + 1 },
    }));
    expect(() => village('overcrowded', config)).toThrow(/households and/);
  });

  it('refuses a config that names a place it never defines', () => {
    const config = broken((c) => ({
      structures: [{ ...c.structures[0]!, place: 'nowhere-at-all' }, ...c.structures.slice(1)],
    }));
    expect(() => village('missing-place', config)).toThrow(/never defines/);
  });
});

describe('the village under way', () => {
  it('holds every invariant at each of 20 day boundaries', () => {
    const world = village();
    const start = world.sim.tick;
    for (let day = 1; day <= 20; day++) {
      world.sim.runUntil(start + day * TICKS_PER_DAY);
      const report = world.sim.assertInvariants();
      expect(report.violations, `day ${day}`).toEqual([]);
      expect(report.checked).toBeGreaterThan(20);
    }
  });

  it('keeps the whole village in the daily cycle, not just the early risers', () => {
    const world = village();
    const woke = new Set<string>();
    world.sim.subscribe('npc.woke', (event) => {
      for (const actor of event.actors) woke.add(actor);
    });
    world.sim.runFor(2 * TICKS_PER_DAY);

    // Everybody, not merely most: one villager who silently drops out of the
    // routine would be invisible in an average and permanent in the world.
    expect(woke.size).toBe(world.population);
    expect(world.sim.log.byType('npc.could-not-rest', 100)).toHaveLength(0);
  });

  it('resumes from a save exactly where it left off', () => {
    const control = village('save-parity');
    const start = control.sim.tick;
    control.sim.runUntil(start + 6 * TICKS_PER_DAY);

    const interrupted = village('save-parity');
    interrupted.sim.runUntil(start + 2 * TICKS_PER_DAY);
    const store = new MemorySaveStore();
    interrupted.sim.saveTo(store, 'midway');

    const resumed = attachVillageWorld({
      seed: 'save-parity',
      config: CONFIG,
      names: NAMES,
      calendar: CALENDAR,
    });
    resumed.sim.loadFrom(store, 'midway');
    resumed.sim.runUntil(start + 6 * TICKS_PER_DAY);

    expect(resumed.sim.hash()).toBe(control.sim.hash());
    expect(resumed.summary()).toBe(control.summary());
  });

  it('gives a different village for a different seed', () => {
    expect(village('seed-a').sim.hash()).not.toBe(village('seed-b').sim.hash());
  });

  /**
   * The golden hash: the shipped data, the shipped seed, three days.
   *
   * A determinism test that builds two worlds and compares them passes just as
   * happily when both are wrong in the same way. This one pins an actual value,
   * so a change in the engine, in worldgen or in `village.json` that nobody
   * meant to make shows up here as a diff rather than as a world that is
   * plausible and different.
   *
   * When this fails, first decide whether the change was intentional. If it
   * was, update the constant in the same commit as the change that caused it.
   */
  it('reproduces the pinned hash for the shipped data and seed', () => {
    const world = village('world-zero');
    world.sim.runUntil(world.sim.tick + 3 * TICKS_PER_DAY);
    expect(world.sim.hash()).toBe('3efcad9ed1df72d2');
  });
});

describe('the verify command against the village', () => {
  it('passes every determinism check for several seeds', () => {
    const factory = villageWorldFactory({ config: CONFIG, names: NAMES, calendar: CALENDAR });
    for (const seed of ['world-zero', 'another-village']) {
      const report = verifyDeterminism({ seed, days: 4, world: factory });
      expect(
        report.checks.filter((check) => !check.passed),
        seed,
      ).toEqual([]);
      expect(report.world).toBe('village');
    }
  });
});
