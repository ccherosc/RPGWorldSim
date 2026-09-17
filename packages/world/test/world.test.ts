import { describe, expect, it } from 'vitest';
import { type EntityId, EntityKind, RngStream, Simulation, makeEntityId } from '@rpgsim/sim-core';
import { Access, type Building, LocationType, makeBuilding, makeLocation } from '../src/location.ts';
import { WorldMap } from '../src/map.ts';
import { WORLD_SAVE_MODULE_ID, installWorld } from '../src/save.ts';

/**
 * The map inside a simulation: persistence, invariants and determinism.
 *
 * `map.test.ts` proves the map is correct on its own. This file proves the
 * three things that only matter once it is part of a world — that it saves and
 * comes back identical, that its invariants would actually notice if it were
 * wrong, and that the same seed builds the same village.
 */

const loc = (n: number) => makeEntityId(EntityKind.Location, n);
const npc = (n: number) => makeEntityId(EntityKind.Npc, n);
const building = (n: number) => makeEntityId(EntityKind.Building, n);

const SQUARE = loc(0);
const STREET = loc(1);
const COTTAGE = loc(2);
const TAVERN = loc(3);

/**
 * A village built from a named RNG stream.
 *
 * Travel costs are rolled rather than fixed, so that "the same seed builds the
 * same village" is a claim about randomness and not just about constants.
 */
function generate(sim: Simulation, map: WorldMap): void {
  const rng = sim.random(RngStream.Worldgen);

  map.addLocation(makeLocation({ id: SQUARE, name: 'The Green', type: LocationType.Square, coordinate: { x: 0, y: 0 } }));
  map.addLocation(makeLocation({ id: STREET, name: 'Mill Road', type: LocationType.Street, coordinate: { x: 30, y: 0 } }));
  map.addLocation(
    makeLocation({
      id: COTTAGE,
      name: 'Hale Cottage',
      type: LocationType.Dwelling,
      coordinate: { x: 55, y: 20 },
      capacity: 4,
      access: Access.Private,
      owner: npc(0),
      permitted: [npc(1)],
    }),
  );
  map.addLocation(
    makeLocation({ id: TAVERN, name: 'The Boar', type: LocationType.Tavern, coordinate: { x: 20, y: -30 }, capacity: 2 }),
  );

  map.connect(SQUARE, STREET, rng.nextIntInclusive(40, 90));
  map.connect(STREET, COTTAGE, rng.nextIntInclusive(20, 60));
  map.connect(SQUARE, TAVERN, rng.nextIntInclusive(30, 70));

  map.addBuilding(
    makeBuilding({
      id: building(0),
      name: 'Hale Cottage',
      type: 'cottage',
      location: COTTAGE,
      owner: npc(0),
      residents: [npc(0), npc(1)],
      condition: rng.nextIntInclusive(50, 100),
    }),
  );

  map.place(npc(0), COTTAGE);
  map.place(npc(1), COTTAGE);
  map.place(npc(2), SQUARE);
}

function world(seed: string): { sim: Simulation; map: WorldMap } {
  const sim = new Simulation({ seed });
  const map = installWorld(sim);
  generate(sim, map);
  return { sim, map };
}

/** Reach past the API to corrupt state on purpose, to prove a check has teeth. */
interface MapInternals {
  placement: Map<EntityId, EntityId>;
  occupants: Map<EntityId, Set<EntityId>>;
  buildings: Map<EntityId, Building>;
}
const internals = (map: WorldMap): MapInternals => map as unknown as MapInternals;

describe('installWorld', () => {
  it('registers the world save module and the world invariants', () => {
    const { sim } = world('world-zero');
    expect(sim.saves.has(WORLD_SAVE_MODULE_ID)).toBe(true);
    expect(sim.invariants.ids().filter((id) => id.startsWith('world.'))).toEqual([
      'world.buildings-have-interiors',
      'world.edges-symmetric-and-positive',
      'world.entity-in-exactly-one-location',
      'world.graph-is-connected',
      'world.occupancy-within-capacity',
      'world.reservations-are-coherent',
    ]);
  });

  it('leaves a healthy village with nothing to report', () => {
    const { sim } = world('world-zero');
    const report = sim.checkInvariants();
    expect(report.violations).toEqual([]);
    expect(() => sim.assertInvariants()).not.toThrow();
  });

  it('accepts a world with no map yet', () => {
    const sim = new Simulation({ seed: 'empty' });
    installWorld(sim);
    expect(sim.checkInvariants().violations).toEqual([]);
  });
});

describe('persistence', () => {
  it('reloads into a byte-identical world', () => {
    const { sim } = world('world-zero');
    const before = sim.hash();

    const reloaded = new Simulation({ seed: 'world-zero' });
    installWorld(reloaded);
    reloaded.load(sim.save());

    expect(reloaded.hash()).toBe(before);
  });

  it('brings back the map itself, not just a matching hash', () => {
    const { sim, map } = world('world-zero');

    const reloaded = new Simulation({ seed: 'world-zero' });
    const reloadedMap = installWorld(reloaded);
    reloaded.load(sim.save());

    expect(reloadedMap.locationIds()).toEqual(map.locationIds());
    expect(reloadedMap.locationOf(npc(0))).toBe(COTTAGE);
    expect(reloadedMap.occupantsOf(COTTAGE)).toEqual(['npc:0', 'npc:1']);
    expect(reloadedMap.travelCost(SQUARE, STREET)).toBe(map.travelCost(SQUARE, STREET));
    expect(reloadedMap.building(building(0)).condition).toBe(map.building(building(0)).condition);
    expect(reloadedMap.findRoute(SQUARE, COTTAGE)).toEqual(map.findRoute(SQUARE, COTTAGE));
    expect(reloadedMap.location(COTTAGE).permitted).toEqual(['npc:1']);
  });

  /**
   * The check the hash cannot perform on itself.
   *
   * A save that omits a field hashes consistently with itself, so save/load
   * hash equality proves nothing about completeness. Comparing a *loaded* world
   * against a *separately generated* one does: if a field were missing from the
   * save, the loaded world would differ from the generated one that has it.
   */
  it('matches a freshly generated world, so no field is missing from the save', () => {
    const generated = world('world-zero');
    const source = world('world-zero');

    const loaded = new Simulation({ seed: 'world-zero' });
    installWorld(loaded);
    loaded.load(source.sim.save());

    expect(loaded.hash()).toBe(generated.sim.hash());
  });

  it('refuses to load a save whose world block is damaged', () => {
    const { sim } = world('world-zero');
    const envelope = sim.save();
    const block = envelope.modules[WORLD_SAVE_MODULE_ID] as { version: number; data: unknown };
    block.data = { locations: [], edges: [], buildings: [] };

    const reloaded = new Simulation({ seed: 'world-zero' });
    installWorld(reloaded);
    expect(() => reloaded.load(envelope)).toThrow(/world save block failed validation/);
  });
});

describe('determinism', () => {
  it('builds the same village from the same seed', () => {
    expect(world('world-zero').sim.hash()).toBe(world('world-zero').sim.hash());
  });

  it('builds a different village from a different seed', () => {
    expect(world('world-zero').sim.hash()).not.toBe(world('alder').sim.hash());
  });

  it('routes the same way twice, at every pair of locations', () => {
    const a = world('world-zero').map;
    const b = world('world-zero').map;
    for (const from of a.locationIds()) {
      for (const to of a.locationIds()) {
        expect(b.findRoute(from, to)).toEqual(a.findRoute(from, to));
      }
    }
  });
});

/**
 * Invariants with teeth.
 *
 * Every one of these corrupts state through a cast, because the map's own API
 * refuses to produce the broken state in the first place. That is exactly why
 * the corruption is necessary: an invariant that cannot be made to fire is an
 * invariant nobody has proven works, and determinism rule "before calling a
 * determinism test done" asks for the mutation that turns it red.
 */
describe('invariants notice a broken world', () => {
  const violationsOf = (sim: Simulation, id: string) =>
    sim.checkInvariants().violations.filter((v) => v.invariantId === id);

  it('catches an entity listed in two places', () => {
    const { sim, map } = world('world-zero');
    internals(map).occupants.get(TAVERN)?.add(npc(0));

    const found = violationsOf(sim, 'world.entity-in-exactly-one-location');
    expect(found.length).toBeGreaterThan(0);
    expect(() => sim.assertInvariants()).toThrow(/entity-in-exactly-one-location/);
  });

  it('catches an entity that believes it is somewhere its location does not', () => {
    const { sim, map } = world('world-zero');
    internals(map).placement.set(npc(2), TAVERN); // Still in the square's occupant set.

    expect(violationsOf(sim, 'world.entity-in-exactly-one-location').length).toBeGreaterThan(0);
  });

  it('catches an entity standing in a location that does not exist', () => {
    const { sim, map } = world('world-zero');
    internals(map).placement.set(npc(9), loc(99));

    const found = violationsOf(sim, 'world.entity-in-exactly-one-location');
    expect(found.some((v) => v.message.includes('does not exist'))).toBe(true);
  });

  it('catches a location over capacity', () => {
    const { sim, map } = world('world-zero');
    const occupants = internals(map).occupants;
    for (const n of [5, 6, 7]) {
      occupants.get(TAVERN)?.add(npc(n));
      internals(map).placement.set(npc(n), TAVERN);
    }

    const found = violationsOf(sim, 'world.occupancy-within-capacity');
    expect(found).toHaveLength(1);
    expect(found[0]?.details).toMatchObject({ capacity: 2, occupancy: 3 });
  });

  it('catches a location cut off from the rest of the map', () => {
    const { sim, map } = world('world-zero');
    map.addLocation(makeLocation({ id: loc(50), name: 'The Far Shore', type: 'boundary', coordinate: { x: 900, y: 0 } }));

    const found = violationsOf(sim, 'world.graph-is-connected');
    expect(found).toHaveLength(1);
    expect(found[0]?.details).toMatchObject({ unreachable: ['location:50'] });
  });

  it('catches a building with no interior, and one that has stolen another’s', () => {
    const { sim, map } = world('world-zero');
    const buildings = internals(map).buildings;
    buildings.set(
      building(1),
      makeBuilding({ id: building(1), name: 'The Vanished Mill', type: 'mill', location: loc(99) }),
    );
    buildings.set(
      building(2),
      makeBuilding({ id: building(2), name: 'The Squatter', type: 'cottage', location: COTTAGE }),
    );

    const found = violationsOf(sim, 'world.buildings-have-interiors');
    expect(found).toHaveLength(2);
    expect(found.map((v) => v.message)).toEqual([
      'a building has no interior location',
      'two buildings claim the same interior',
    ]);
  });

  // The same two states, reached the way they actually would be in production:
  // through a save file. `restore` refuses both before they exist.
  it('refuses at load what the invariants would only report afterwards', () => {
    const { map } = world('world-zero');
    const snapshot = map.save();

    expect(() =>
      new WorldMap().restore({
        ...snapshot,
        buildings: [
          ...snapshot.buildings,
          makeBuilding({ id: building(1), name: 'The Vanished Mill', type: 'mill', location: loc(99) }),
        ],
      }),
    ).toThrow(/needs a location that exists/);

    expect(() =>
      new WorldMap().restore({
        ...snapshot,
        buildings: [
          ...snapshot.buildings,
          makeBuilding({ id: building(2), name: 'The Squatter', type: 'cottage', location: COTTAGE }),
        ],
      }),
    ).toThrow(/cannot share one interior/);
  });
});
