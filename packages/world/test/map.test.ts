import { describe, expect, it } from 'vitest';
import { canonicalStringify } from '@rpgsim/shared';
import { type EntityId, EntityKind, makeEntityId } from '@rpgsim/sim-core';
import {
  Access,
  LocationType,
  makeBuilding,
  makeLocation,
  withBuilding,
  withLocation,
} from '../src/location.ts';
import { EntryRefusal, WorldMap, compareFrontier } from '../src/map.ts';

/**
 * The map: topology, occupancy, entry rules and routing.
 *
 * Prime Directive 7 says physical actions respect location, travel time and
 * access. Everything here is the part of that directive that can be violated
 * without anyone noticing: an entity in two places, a location over capacity, a
 * route that is shorter than the roads allow.
 */

const loc = (n: number) => makeEntityId(EntityKind.Location, n);
const npc = (n: number) => makeEntityId(EntityKind.Npc, n);
const building = (n: number) => makeEntityId(EntityKind.Building, n);

const SQUARE = loc(0);
const STREET = loc(1);
const COTTAGE = loc(2);
const FIELD = loc(3);
const TAVERN = loc(4);

/**
 * A five-place village.
 *
 * Shaped for the awkward cases rather than for plausibility: the cottage can be
 * reached two ways, and the direct way is much the more expensive, so a route
 * that counts hops instead of ticks gets a different answer from one that reads
 * the costs.
 */
function village(): WorldMap {
  const map = new WorldMap();
  map.addLocation(makeLocation({ id: SQUARE, name: 'The Green', type: LocationType.Square, coordinate: { x: 0, y: 0 } }));
  map.addLocation(makeLocation({ id: STREET, name: 'Mill Road', type: LocationType.Street, coordinate: { x: 30, y: 10 } }));
  map.addLocation(
    makeLocation({
      id: COTTAGE,
      name: 'Hale Cottage',
      type: LocationType.Dwelling,
      coordinate: { x: 55, y: 20 },
      capacity: 4,
      access: Access.Private,
      owner: npc(1),
      permitted: [npc(2)],
    }),
  );
  map.addLocation(
    makeLocation({ id: FIELD, name: 'Low Field', type: LocationType.Field, coordinate: { x: -200, y: 60 } }),
  );
  map.addLocation(
    makeLocation({
      id: TAVERN,
      name: 'The Boar',
      type: LocationType.Tavern,
      coordinate: { x: 20, y: -30 },
      capacity: 2,
    }),
  );

  map.connect(SQUARE, STREET, 60);
  map.connect(STREET, COTTAGE, 30);
  map.connect(SQUARE, COTTAGE, 200); // The long way round the back.
  map.connect(SQUARE, FIELD, 300);
  map.connect(SQUARE, TAVERN, 45);
  return map;
}

describe('topology', () => {
  it('refuses a duplicate location id', () => {
    const map = village();
    expect(() =>
      map.addLocation(makeLocation({ id: SQUARE, name: 'Another Green', type: 'square', coordinate: { x: 1, y: 1 } })),
    ).toThrow(/already exists/);
  });

  it('connects both directions for the same cost', () => {
    const map = village();
    expect(map.travelCost(SQUARE, STREET)).toBe(60);
    expect(map.travelCost(STREET, SQUARE)).toBe(60);
    expect(map.areConnected(SQUARE, FIELD)).toBe(true);
    expect(map.areConnected(FIELD, TAVERN)).toBe(false);
    expect(map.travelCost(FIELD, TAVERN)).toBeUndefined();
  });

  it('refuses an edge that is not a real way between two real places', () => {
    const map = village();
    expect(() => map.connect(SQUARE, SQUARE, 10)).toThrow(/cannot connect to itself/);
    expect(() => map.connect(SQUARE, loc(99), 10)).toThrow(/no such location/);
    expect(() => map.connect(loc(99), SQUARE, 10)).toThrow(/no such location/);
  });

  // A zero-cost edge is Prime Directive 7 defeated by arithmetic: the traveller
  // arrives on the tick they left, from anywhere reachable by such edges.
  it('refuses a cost that is not a positive whole number of ticks', () => {
    const map = village();
    for (const cost of [0, -30, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => map.connect(STREET, TAVERN, cost)).toThrow(/cost/);
    }
    expect(map.areConnected(STREET, TAVERN)).toBe(false);
  });

  it('accepts the same edge twice but refuses a contradictory one', () => {
    const map = village();
    expect(() => map.connect(SQUARE, STREET, 60)).not.toThrow();
    expect(() => map.connect(SQUARE, STREET, 61)).toThrow(/already connected at a different cost/);
    expect(map.travelCost(SQUARE, STREET)).toBe(60);
  });

  it('lists connections in numeric id order', () => {
    const map = new WorldMap();
    for (const n of [0, 2, 9, 10, 11]) {
      map.addLocation(makeLocation({ id: loc(n), name: `p${n}`, type: 'street', coordinate: { x: n, y: 0 } }));
    }
    // Added out of order on purpose: the reported order must come from the
    // comparator, not from whichever edge happened to be written first.
    map.connect(loc(0), loc(11), 5);
    map.connect(loc(0), loc(2), 5);
    map.connect(loc(0), loc(10), 5);
    map.connect(loc(0), loc(9), 5);

    expect(map.connectionsOf(loc(0)).map((c) => c.to)).toEqual([
      'location:2',
      'location:9',
      'location:10',
      'location:11',
    ]);
  });

  it('puts buildings in real locations, one to an interior', () => {
    const map = village();
    map.addBuilding(makeBuilding({ id: building(0), name: 'Hale Cottage', type: 'cottage', location: COTTAGE }));

    expect(map.building(building(0)).name).toBe('Hale Cottage');
    expect(map.buildingCount).toBe(1);
    expect(() =>
      map.addBuilding(makeBuilding({ id: building(1), name: 'Elsewhere', type: 'cottage', location: loc(99) })),
    ).toThrow(/needs a location that exists/);
    expect(() =>
      map.addBuilding(makeBuilding({ id: building(2), name: 'Overlap', type: 'cottage', location: COTTAGE })),
    ).toThrow(/cannot share one interior/);
    expect(() =>
      map.addBuilding(makeBuilding({ id: building(0), name: 'Twin', type: 'cottage', location: TAVERN })),
    ).toThrow(/already exists/);
  });

  it('refuses to read a location that does not exist', () => {
    const map = village();
    expect(() => map.location(loc(99))).toThrow(/no such location/);
    expect(map.tryLocation(loc(99))).toBeUndefined();
    expect(map.hasLocation(loc(99))).toBe(false);
    expect(map.locationCount).toBe(5);
  });
});

describe('occupancy', () => {
  it('records a placement in both directions', () => {
    const map = village();
    map.place(npc(1), SQUARE);

    expect(map.locationOf(npc(1))).toBe(SQUARE);
    expect(map.occupantsOf(SQUARE)).toEqual(['npc:1']);
    expect(map.occupancyOf(SQUARE)).toBe(1);
    expect(map.isPlaced(npc(1))).toBe(true);
    expect(map.isPlaced(npc(2))).toBe(false);
    expect(map.locationOf(npc(2))).toBeUndefined();
  });

  it('lists occupants in numeric id order', () => {
    const map = village();
    for (const n of [12, 3, 7, 10]) map.place(npc(n), FIELD);
    expect(map.occupantsOf(FIELD)).toEqual(['npc:3', 'npc:7', 'npc:10', 'npc:12']);
    expect(map.placedEntities()).toEqual(['npc:3', 'npc:7', 'npc:10', 'npc:12']);
  });

  // Placing an already-placed entity would be a teleport with no travel time,
  // which is the single easiest way to violate Prime Directive 7 by accident.
  it('refuses to place an entity that is already somewhere', () => {
    const map = village();
    map.place(npc(1), SQUARE);
    expect(() => map.place(npc(1), FIELD)).toThrow(/already placed/);
    expect(map.locationOf(npc(1))).toBe(SQUARE);
  });

  it('moves an entity and leaves nothing behind', () => {
    const map = village();
    map.place(npc(1), SQUARE);
    map.move(npc(1), FIELD);

    expect(map.locationOf(npc(1))).toBe(FIELD);
    expect(map.occupantsOf(SQUARE)).toEqual([]);
    expect(map.occupancyOf(SQUARE)).toBe(0);
    expect(map.occupantsOf(FIELD)).toEqual(['npc:1']);
  });

  it('treats a move to where you already are as nothing happening', () => {
    const map = village();
    map.place(npc(1), SQUARE);
    map.move(npc(1), SQUARE);
    expect(map.occupantsOf(SQUARE)).toEqual(['npc:1']);
  });

  it('refuses to move an entity that is nowhere', () => {
    const map = village();
    expect(() => map.move(npc(1), SQUARE)).toThrow(/not placed anywhere/);
  });

  it('removes an entity from the map and reports where it was', () => {
    const map = village();
    map.place(npc(1), TAVERN);

    expect(map.remove(npc(1))).toBe(TAVERN);
    expect(map.locationOf(npc(1))).toBeUndefined();
    expect(map.occupantsOf(TAVERN)).toEqual([]);
    // Removing again is not an error — it is how "already gone" reads.
    expect(map.remove(npc(1))).toBeUndefined();
  });
});

describe('entry rules', () => {
  it('lets anyone into a public place', () => {
    const map = village();
    expect(map.canEnter(npc(1), SQUARE)).toEqual({ allowed: true });
  });

  it('refuses a place that does not exist, and says so', () => {
    const map = village();
    const check = map.canEnter(npc(1), loc(99));
    expect(check.allowed).toBe(false);
    expect(check.allowed === false && check.reason).toBe(EntryRefusal.UnknownLocation);
  });

  it('keeps strangers out of a private dwelling but lets the owner and the named in', () => {
    const map = village();
    const stranger = map.canEnter(npc(7), COTTAGE);
    expect(stranger.allowed).toBe(false);
    expect(stranger.allowed === false && stranger.reason).toBe(EntryRefusal.Forbidden);
    expect(stranger.allowed === false && stranger.details['entity']).toBe('npc:7');

    expect(map.canEnter(npc(1), COTTAGE).allowed).toBe(true); // owner
    expect(map.canEnter(npc(2), COTTAGE).allowed).toBe(true); // on the permitted list
  });

  it('refuses a full place, and reports the numbers', () => {
    const map = village();
    map.place(npc(1), TAVERN);
    map.place(npc(2), TAVERN);

    const check = map.canEnter(npc(3), TAVERN);
    expect(check.allowed).toBe(false);
    expect(check.allowed === false && check.reason).toBe(EntryRefusal.Full);
    expect(check.allowed === false && check.details).toMatchObject({ capacity: 2, occupancy: 2 });
  });

  // Boundary case worth stating: you are always allowed to be where you already
  // are. Without this, the last person into a full room would be told they may
  // not stand where they are standing, and any "am I allowed to be here" check
  // would start reporting the world as illegal.
  it('always allows the place an entity is already standing in, even when full', () => {
    const map = village();
    map.place(npc(1), TAVERN);
    map.place(npc(2), TAVERN);
    expect(map.occupancyOf(TAVERN)).toBe(2);
    expect(map.canEnter(npc(1), TAVERN)).toEqual({ allowed: true });
  });

  it('never fills an unbounded place', () => {
    const map = village();
    for (let i = 0; i < 200; i++) map.place(npc(i), FIELD);
    expect(map.canEnter(npc(999), FIELD)).toEqual({ allowed: true });
    expect(map.occupancyOf(FIELD)).toBe(200);
  });

  it('refuses a placement into a full or forbidden place', () => {
    const map = village();
    map.place(npc(1), TAVERN);
    map.place(npc(2), TAVERN);
    expect(() => map.place(npc(3), TAVERN)).toThrow(/may not enter/);
    expect(() => map.place(npc(7), COTTAGE)).toThrow(/may not enter/);
    expect(map.isPlaced(npc(3))).toBe(false);
  });

  // Regression guard for the worst possible shape of this bug: a refused move
  // that has already taken the traveller out of the room they were in. They
  // would be nowhere, which no invariant on placement alone would catch.
  it('leaves a refused move with the traveller exactly where they were', () => {
    const map = village();
    map.place(npc(1), TAVERN);
    map.place(npc(2), TAVERN);
    map.place(npc(3), SQUARE);

    expect(() => map.move(npc(3), TAVERN)).toThrow(/may not enter/);
    expect(map.locationOf(npc(3))).toBe(SQUARE);
    expect(map.occupantsOf(SQUARE)).toEqual(['npc:3']);
    expect(map.occupantsOf(TAVERN)).toEqual(['npc:1', 'npc:2']);
    expect(map.occupancyOf(TAVERN)).toBe(2);
  });
});

describe('routing', () => {
  it('finds the single-step route', () => {
    expect(village().findRoute(SQUARE, TAVERN)).toEqual({ path: [SQUARE, TAVERN], cost: 45 });
  });

  // The whole reason routing is over the graph and not over the coordinates.
  it('prefers the cheaper route over the one with fewer steps', () => {
    const map = village();
    expect(map.travelCost(SQUARE, COTTAGE)).toBe(200);
    expect(map.findRoute(SQUARE, COTTAGE)).toEqual({ path: [SQUARE, STREET, COTTAGE], cost: 90 });
  });

  it('costs nothing to be where you are', () => {
    expect(village().findRoute(FIELD, FIELD)).toEqual({ path: [FIELD], cost: 0 });
  });

  it('is symmetric, because every edge is', () => {
    const map = village();
    const there = map.findRoute(FIELD, COTTAGE) as { path: EntityId[]; cost: number };
    const back = map.findRoute(COTTAGE, FIELD) as { path: EntityId[]; cost: number };
    expect(back.cost).toBe(there.cost);
    expect([...back.path].reverse()).toEqual(there.path);
  });

  it('returns no route when there is none', () => {
    const map = village();
    map.addLocation(makeLocation({ id: loc(9), name: 'The Far Shore', type: 'boundary', coordinate: { x: 900, y: 0 } }));
    expect(map.findRoute(SQUARE, loc(9))).toBeUndefined();
    expect(map.routeCost(SQUARE, loc(9))).toBeUndefined();
  });

  it('refuses to route from or to a place that does not exist', () => {
    const map = village();
    expect(() => map.findRoute(loc(99), SQUARE)).toThrow(/no such origin/);
    expect(() => map.findRoute(SQUARE, loc(99))).toThrow(/no such destination/);
  });

  // A route is a fact about the map, not about the traveller. If access or
  // capacity narrowed it, the same journey would exist or not depending on who
  // asked, and no route could ever be cached or reasoned about.
  it('routes through places the traveller could not enter', () => {
    const map = village();
    map.place(npc(5), TAVERN);
    map.place(npc(6), TAVERN);
    expect(map.findRoute(SQUARE, COTTAGE)?.path).toContain(COTTAGE);
    expect(map.canEnter(npc(7), COTTAGE).allowed).toBe(false);
  });

  /**
   * Two routes of exactly equal cost.
   *
   * The same graph, built with its edges written in four different orders. Every
   * one must return the identical path, or the same seed would send a villager a
   * different way after a harmless-looking change to worldgen's ordering. The
   * expected path is pinned rather than merely compared, so a change of route is
   * visible as a change of route and not just as two runs agreeing with each
   * other.
   */
  it('returns the same equal-cost route however the graph was built', () => {
    const A = loc(1);
    const B = loc(2);
    const C = loc(3);
    const edges: Array<[EntityId, EntityId, number]> = [
      [SQUARE, A, 10],
      [SQUARE, B, 10],
      [A, C, 10],
      [B, C, 10],
    ];

    const build = (order: number[]): WorldMap => {
      const map = new WorldMap();
      for (const id of [SQUARE, A, B, C]) {
        map.addLocation(makeLocation({ id, name: id, type: 'street', coordinate: { x: 0, y: 0 } }));
      }
      for (const index of order) {
        const edge = edges[index] as [EntityId, EntityId, number];
        map.connect(edge[0], edge[1], edge[2]);
      }
      return map;
    };

    for (const order of [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [1, 3, 0, 2],
      [2, 0, 3, 1],
    ]) {
      expect(build(order).findRoute(SQUARE, C)).toEqual({ path: [SQUARE, A, C], cost: 20 });
    }
  });
});

/**
 * The route search's frontier ordering, on its own.
 *
 * Tested directly because it cannot be tested through `findRoute`: sorted
 * adjacency already makes the search deterministic, so removing the tie-break
 * leaves every end-to-end route test green while quietly making the result a
 * property of the heap rather than of the map.
 */
describe('frontier ordering', () => {
  it('orders by cost first', () => {
    expect(compareFrontier({ id: SQUARE, cost: 10 }, { id: STREET, cost: 20 })).toBeLessThan(0);
    expect(compareFrontier({ id: STREET, cost: 20 }, { id: SQUARE, cost: 10 })).toBeGreaterThan(0);
  });

  it('never calls two different places equal, however equal their cost', () => {
    expect(compareFrontier({ id: SQUARE, cost: 10 }, { id: STREET, cost: 10 })).not.toBe(0);
    expect(compareFrontier({ id: loc(9), cost: 10 }, { id: loc(10), cost: 10 })).toBeLessThan(0);
    expect(compareFrontier({ id: SQUARE, cost: 10 }, { id: SQUARE, cost: 10 })).toBe(0);
  });

  it('is antisymmetric, so the order does not depend on the order asked', () => {
    const entries = [
      { id: SQUARE, cost: 10 },
      { id: STREET, cost: 10 },
      { id: COTTAGE, cost: 5 },
      { id: FIELD, cost: 40 },
    ];
    for (const a of entries) {
      for (const b of entries) {
        // Summed rather than negated and compared: `Math.sign(0)` is `0` and
        // `-Math.sign(0)` is `-0`, which `toBe` treats as different values.
        expect(Math.sign(compareFrontier(a, b)) + Math.sign(compareFrontier(b, a))).toBe(0);
      }
    }
  });
});

describe('connectivity', () => {
  it('sees a fully connected village as connected', () => {
    const map = village();
    expect(map.isFullyConnected()).toBe(true);
    expect(map.unreachableLocations()).toEqual([]);
  });

  it('names the places that cannot be reached, in id order', () => {
    const map = village();
    for (const n of [12, 8]) {
      map.addLocation(makeLocation({ id: loc(n), name: `island${n}`, type: 'woodland', coordinate: { x: n, y: n } }));
    }
    map.connect(loc(8), loc(12), 50); // Connected to each other, not to the village.

    expect(map.isFullyConnected()).toBe(false);
    expect(map.unreachableLocations()).toEqual(['location:8', 'location:12']);
  });

  it('treats a map with no locations as trivially connected', () => {
    expect(new WorldMap().isFullyConnected()).toBe(true);
  });
});

describe('snapshots', () => {
  it('round-trips through save and restore', () => {
    const map = village();
    map.addBuilding(makeBuilding({ id: building(0), name: 'Hale Cottage', type: 'cottage', location: COTTAGE, owner: npc(1), residents: [npc(2), npc(1)] }));
    map.place(npc(1), COTTAGE);
    map.place(npc(3), FIELD);

    const restored = new WorldMap();
    restored.restore(map.save());

    expect(restored.save()).toEqual(map.save());
    expect(restored.locationOf(npc(1))).toBe(COTTAGE);
    expect(restored.occupantsOf(FIELD)).toEqual(['npc:3']);
    expect(restored.travelCost(STREET, COTTAGE)).toBe(30);
    expect(restored.building(building(0)).residents).toEqual(['npc:1', 'npc:2']);
    expect(restored.findRoute(SQUARE, COTTAGE)).toEqual(map.findRoute(SQUARE, COTTAGE));
  });

  it('writes one row per edge, in a canonical direction', () => {
    const edges = village().save().edges;
    expect(edges).toEqual([
      { a: SQUARE, b: STREET, cost: 60 },
      { a: SQUARE, b: COTTAGE, cost: 200 },
      { a: SQUARE, b: FIELD, cost: 300 },
      { a: SQUARE, b: TAVERN, cost: 45 },
      { a: STREET, b: COTTAGE, cost: 30 },
    ]);
  });

  /**
   * Two maps with the same contents must save to the same bytes.
   *
   * Hash equality across a save/load boundary cannot prove this: the hash is
   * computed from the save, so an ordering that depends on insertion order is
   * invisible to it. Building the same village twice in different orders and
   * comparing the canonical text is what actually has teeth.
   */
  it('saves identical bytes for the same village built in a different order', () => {
    const forward = new WorldMap();
    const backward = new WorldMap();
    const places = [SQUARE, STREET, COTTAGE, FIELD, TAVERN];

    for (const [map, order] of [
      [forward, places],
      [backward, [...places].reverse()],
    ] as const) {
      for (const id of order) {
        map.addLocation(makeLocation({ id, name: id, type: 'street', coordinate: { x: 1, y: 2 } }));
      }
    }
    forward.connect(SQUARE, STREET, 60);
    forward.connect(STREET, COTTAGE, 30);
    forward.connect(SQUARE, TAVERN, 45);
    backward.connect(SQUARE, TAVERN, 45);
    backward.connect(STREET, COTTAGE, 30);
    backward.connect(SQUARE, STREET, 60);

    for (const n of [5, 2, 9]) forward.place(npc(n), SQUARE);
    for (const n of [9, 5, 2]) backward.place(npc(n), SQUARE);

    expect(canonicalStringify(backward.toJson())).toBe(canonicalStringify(forward.toJson()));
  });

  it('replaces everything it had before, rather than merging', () => {
    const map = village();
    map.place(npc(1), SQUARE);

    const empty = new WorldMap();
    empty.addLocation(makeLocation({ id: loc(42), name: 'Elsewhere', type: 'square', coordinate: { x: 0, y: 0 } }));
    map.restore(empty.save());

    expect(map.locationIds()).toEqual(['location:42']);
    expect(map.isPlaced(npc(1))).toBe(false);
    expect(map.buildingCount).toBe(0);
  });

  it('refuses a save that is the wrong shape', () => {
    expect(() => WorldMap.fromJson(null)).toThrow(/failed validation/);
    expect(() => WorldMap.fromJson({ locations: [], edges: [], buildings: [] })).toThrow(/failed validation/);
    expect(() =>
      WorldMap.fromJson({ locations: [], edges: [], buildings: [], occupancy: [{ entity: 'not-an-id', location: 'location:0' }] }),
    ).toThrow(/not a valid entity id/);
    expect(() =>
      WorldMap.fromJson({ locations: [], edges: [{ a: SQUARE, b: STREET, cost: 0 }], buildings: [], occupancy: [] }),
    ).toThrow(/failed validation/);
  });

  /**
   * A structurally valid save can still describe an impossible world — three
   * people in a two-person tavern, an occupant of a location that is not in the
   * file. `restore` puts everything back through the same checks a live world
   * uses, so a bad save is refused at load rather than becoming the new truth.
   */
  it('refuses a structurally valid save that describes an illegal world', () => {
    const map = village();
    map.place(npc(1), TAVERN);
    map.place(npc(2), TAVERN);

    const overfull = {
      ...map.save(),
      occupancy: [
        { entity: npc(1), location: TAVERN },
        { entity: npc(2), location: TAVERN },
        { entity: npc(3), location: TAVERN },
      ],
    };
    expect(() => new WorldMap().restore(WorldMap.fromJson(overfull))).toThrow(/may not enter/);

    const nowhere = { ...map.save(), occupancy: [{ entity: npc(1), location: loc(99) }] };
    expect(() => new WorldMap().restore(WorldMap.fromJson(nowhere))).toThrow(/unknown-location|no such location|may not enter/);

    const twice = {
      ...map.save(),
      occupancy: [
        { entity: npc(1), location: SQUARE },
        { entity: npc(1), location: FIELD },
      ],
    };
    expect(() => new WorldMap().restore(WorldMap.fromJson(twice))).toThrow(/already placed/);
  });
});

/**
 * Rewriting a place or a building that is already on the map.
 *
 * Worldgen needs this: a cottage is laid out before the family that lives in it
 * is generated, so the house has to learn its owner, its residents and who may
 * walk in afterwards. The risk is that "afterwards" becomes a door through
 * which anything can be changed, including the two things the rest of the map
 * has already been built against — where a place stands, and how many people
 * fit in it.
 */
describe('replacing a place or a building', () => {
  it('takes a rewritten place and keeps the map consistent', () => {
    const map = village();
    const before = map.location(COTTAGE);
    map.replaceLocation(withLocation(before, { name: 'Hale Cottage', permitted: [npc(2), npc(5)] }));

    expect(map.location(COTTAGE).name).toBe('Hale Cottage');
    expect(map.location(COTTAGE).permitted).toEqual(['npc:2', 'npc:5']);
    // Rewriting a place must not disturb the roads that lead to it.
    expect(map.travelCost(STREET, COTTAGE)).toBe(30);
    expect(map.findRoute(SQUARE, COTTAGE)?.cost).toBe(90);
  });

  it('opens a private house to the family that moves into it', () => {
    const map = village();
    const check = map.canEnter(npc(7), COTTAGE);
    expect(check.allowed === false && check.reason).toBe(EntryRefusal.Forbidden);
    map.replaceLocation(withLocation(map.location(COTTAGE), { permitted: [npc(7)] }));
    expect(map.canEnter(npc(7), COTTAGE).allowed).toBe(true);
  });

  it('refuses to move a place, because the roads were costed against where it stands', () => {
    const map = village();
    const moved = makeLocation({ ...map.location(COTTAGE), coordinate: { x: 999, y: 999 } });
    expect(() => map.replaceLocation(moved)).toThrow(/cannot move/);
    expect(map.location(COTTAGE).coordinate).toEqual({ x: 55, y: 20 });
  });

  it('refuses to shrink a place below the people already inside it', () => {
    const map = village();
    const shrink = (capacity: number | null) =>
      map.replaceLocation(withLocation(map.location(COTTAGE), { capacity }));

    map.place(npc(1), COTTAGE);
    map.place(npc(2), COTTAGE);
    expect(() => shrink(1)).toThrow(/below the people already in it/);
    expect(() => shrink(2)).not.toThrow();
    expect(() => shrink(null)).not.toThrow();

    // A reservation is a place held for somebody walking towards it, so it
    // counts: shrinking underneath it would let the map accept a traveller it
    // then has to turn away on arrival.
    map.replaceLocation(withLocation(map.location(COTTAGE), { permitted: [npc(2), npc(3)] }));
    map.reserve(npc(3), COTTAGE);
    expect(() => shrink(2)).toThrow(/below the people already in it/);
    expect(map.location(COTTAGE).capacity).toBeNull();
  });

  it('refuses to replace a place that was never added', () => {
    const map = village();
    const stranger = makeLocation({
      id: loc(99),
      name: 'Nowhere',
      type: LocationType.Street,
      coordinate: { x: 0, y: 0 },
    });
    expect(() => map.replaceLocation(stranger)).toThrow(/no location with this id/);
    expect(map.hasLocation(loc(99))).toBe(false);
  });

  it('takes a rewritten building but refuses to move its interior', () => {
    const map = village();
    map.addBuilding(
      makeBuilding({ id: building(1), name: 'A cottage', type: 'cottage', location: COTTAGE }),
    );

    map.replaceBuilding(
      withBuilding(map.building(building(1)), {
        name: 'Hale Cottage',
        owner: npc(1),
        residents: [npc(1), npc(2)],
      }),
    );
    expect(map.building(building(1)).name).toBe('Hale Cottage');
    expect(map.building(building(1)).residents).toEqual(['npc:1', 'npc:2']);

    // The interior is what every household's `dwelling` points at. Moving it
    // would leave those pointers aimed at a room the building no longer owns.
    expect(() =>
      map.replaceBuilding(withBuilding(map.building(building(1)), { location: TAVERN })),
    ).toThrow();
    expect(map.building(building(1)).location).toBe(COTTAGE);
  });

  it('refuses to replace a building that was never added', () => {
    const map = village();
    expect(() =>
      map.replaceBuilding(
        makeBuilding({ id: building(9), name: 'Ghost', type: 'barn', location: FIELD }),
      ),
    ).toThrow(/no building with this id/);
  });
});
