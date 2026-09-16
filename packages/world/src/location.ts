import { assert, assertInt } from '@rpgsim/shared';
import { compareEntityIds, type EntityId, isEntityId } from '@rpgsim/sim-core';
import { z } from 'zod';

/**
 * Places, and the things built in them.
 *
 * WORLD_MODEL.md asks for "a graph or lightweight coordinate model before
 * detailed graphics", with each location carrying a type, position, capacity,
 * access rules, owner, parent region, connected locations and travel cost.
 * Everything on that list lives here except the connections and their costs,
 * which belong to the graph in `map.ts` — see the note on `Location` below.
 */

/**
 * What a place is.
 *
 * Kept as a plain string union rather than an enum so `data/world/village.json`
 * can name types directly (directive 10: balance and content live in data). The
 * set is deliberately small; it covers WORLD_MODEL.md's recommended minimum for
 * World Zero and nothing speculative.
 */
export const LocationType = {
  /** The open middle of the village. Everything connects to it, directly or not. */
  Square: 'square',
  Street: 'street',
  Road: 'road',
  /** The inside of a dwelling. */
  Dwelling: 'dwelling',
  /** The inside of a working building: smithy, mill, bakery. */
  Workshop: 'workshop',
  Market: 'market',
  Tavern: 'tavern',
  Church: 'church',
  Store: 'store',
  Field: 'field',
  Pasture: 'pasture',
  Woodland: 'woodland',
  Water: 'water',
  /** Where a road leaves the map. Travel beyond it is not modelled yet. */
  Boundary: 'boundary',
} as const;

export type LocationTypeName = (typeof LocationType)[keyof typeof LocationType] | (string & {});

/**
 * Who may enter.
 *
 * `public` is anywhere a villager may walk into unchallenged. `private` is
 * somewhere only named people may enter — a cottage, a locked storehouse — and
 * the names are on the location's `permitted` list. Phase 1 has no households
 * to populate that list with, so private places start empty and slice 4 fills
 * them in; until then a private location simply refuses everyone, which is the
 * honest answer rather than a convenient one.
 */
export const Access = {
  Public: 'public',
  Private: 'private',
} as const;

export type AccessName = (typeof Access)[keyof typeof Access];

export const EntityIdSchema = z.string().refine(isEntityId, { message: 'not a valid entity id' });

/**
 * Integer map coordinates, in metres from an arbitrary origin.
 *
 * Carried for later rendering and for generating plausible travel costs at
 * worldgen. **Routing does not use it.** A road is not a straight line and a
 * river crossing is not a distance, so travel cost is data on the edge. Integers
 * because directive 9 prefers them and because a coordinate that participates in
 * a hash must not be a float that might round differently.
 */
export const CoordinateSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

export type Coordinate = z.infer<typeof CoordinateSchema>;

/**
 * A place an entity can be.
 *
 * Locations are immutable once built. Everything that changes about a place at
 * runtime — who is standing in it — lives in `WorldMap`'s occupancy index, not
 * here, so there is exactly one writable copy of any fact.
 *
 * **Connections are not a field.** PHASE_1.md's slice 1 listed them on the
 * location; putting them in the graph instead means an edge cannot disagree
 * with itself, which is what makes "every edge is symmetric" true by
 * construction rather than by invariant. `WorldMap.connectionsOf` reads them.
 */
export const LocationSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1),
  type: z.string().min(1),
  coordinate: CoordinateSchema,
  /**
   * How many entities fit. `null` means unbounded — a field, a road.
   *
   * Never `Infinity`: canonical JSON refuses non-finite numbers, so an infinite
   * capacity would be a location that cannot be saved.
   */
  capacity: z.number().int().positive().nullable(),
  access: z.enum([Access.Public, Access.Private]),
  /** Who may enter a `private` location. Sorted. Ignored when `public`. */
  permitted: z.array(EntityIdSchema),
  owner: EntityIdSchema.nullable(),
  /** Parent region, for grouping places into "the village" or "the north fields". */
  region: EntityIdSchema.nullable(),
});

export type Location = {
  readonly id: EntityId;
  readonly name: string;
  readonly type: LocationTypeName;
  readonly coordinate: Coordinate;
  readonly capacity: number | null;
  readonly access: AccessName;
  readonly permitted: readonly EntityId[];
  readonly owner: EntityId | null;
  readonly region: EntityId | null;
};

export const BuildingType = {
  Cottage: 'cottage',
  Farmhouse: 'farmhouse',
  Manor: 'manor',
  Smithy: 'smithy',
  Mill: 'mill',
  Bakery: 'bakery',
  Tavern: 'tavern',
  Church: 'church',
  Barn: 'barn',
  Storehouse: 'storehouse',
} as const;

export type BuildingTypeName = (typeof BuildingType)[keyof typeof BuildingType] | (string & {});

/** The best and worst a building can be in. */
export const MAX_CONDITION = 100;
export const MIN_CONDITION = 0;

/**
 * A structure, and the location that is its inside.
 *
 * A building and its interior are two entities, not one. The building is the
 * thing that is owned, lived in, repaired and eventually falls down; the
 * location is where a person is standing when they are inside it. Keeping them
 * apart is what lets a building later have several rooms, or be demolished
 * while the plot of ground remains.
 */
export const BuildingSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1),
  type: z.string().min(1),
  /** The interior location. Exactly one building occupies any given location. */
  location: EntityIdSchema,
  owner: EntityIdSchema.nullable(),
  /** Who lives here. Sorted. Empty until slice 4 creates households. */
  residents: z.array(EntityIdSchema),
  condition: z.number().int().min(MIN_CONDITION).max(MAX_CONDITION),
});

export type Building = {
  readonly id: EntityId;
  readonly name: string;
  readonly type: BuildingTypeName;
  readonly location: EntityId;
  readonly owner: EntityId | null;
  readonly residents: readonly EntityId[];
  readonly condition: number;
};

/**
 * Sort ids so that anything derived from a collection of them is canonical.
 *
 * `compareEntityIds` rather than a plain string sort: `npc:10` must not come
 * before `npc:9`, or two saves that differ in nothing diff as though half the
 * village moved.
 */
function sortedIds(ids: readonly EntityId[], what: string): EntityId[] {
  const sorted = [...ids].sort(compareEntityIds);
  for (let i = 1; i < sorted.length; i++) {
    assert(sorted[i] !== sorted[i - 1], `${what} contains a duplicate entry`, {
      duplicate: sorted[i],
    });
  }
  return sorted;
}

export interface LocationInit {
  readonly id: EntityId;
  readonly name: string;
  readonly type: LocationTypeName;
  readonly coordinate: Coordinate;
  readonly capacity?: number | null;
  readonly access?: AccessName;
  readonly permitted?: readonly EntityId[];
  readonly owner?: EntityId | null;
  readonly region?: EntityId | null;
}

/**
 * Build a location, refusing anything malformed.
 *
 * Validation is here rather than in `WorldMap.addLocation` because a location
 * that never existed in an invalid form cannot be stored in one (sim-core rule
 * 10). Defaults are the permissive ones — public, unbounded, unowned — so a
 * data file only states what is unusual.
 */
export function makeLocation(init: LocationInit): Location {
  assert(isEntityId(init.id), 'location id is not a valid entity id', { id: init.id });
  assert(init.name.length > 0, 'location name must not be empty', { id: init.id });
  assert(init.type.length > 0, 'location type must not be empty', { id: init.id });
  assertInt(init.coordinate.x, 'location x coordinate must be an integer');
  assertInt(init.coordinate.y, 'location y coordinate must be an integer');

  const capacity = init.capacity ?? null;
  if (capacity !== null) {
    assertInt(capacity, 'location capacity must be an integer');
    assert(capacity > 0, 'location capacity must be positive; use null for unbounded', {
      id: init.id,
      capacity,
    });
  }

  const access = init.access ?? Access.Public;
  const permitted = sortedIds(init.permitted ?? [], 'location permitted list');
  assert(
    access === Access.Private || permitted.length === 0,
    'a public location cannot have a permitted list; the list would never be consulted',
    { id: init.id },
  );

  return Object.freeze({
    id: init.id,
    name: init.name,
    type: init.type,
    coordinate: Object.freeze({ x: init.coordinate.x, y: init.coordinate.y }),
    capacity,
    access,
    permitted: Object.freeze(permitted),
    owner: init.owner ?? null,
    region: init.region ?? null,
  });
}

export interface BuildingInit {
  readonly id: EntityId;
  readonly name: string;
  readonly type: BuildingTypeName;
  readonly location: EntityId;
  readonly owner?: EntityId | null;
  readonly residents?: readonly EntityId[];
  readonly condition?: number;
}

export function makeBuilding(init: BuildingInit): Building {
  assert(isEntityId(init.id), 'building id is not a valid entity id', { id: init.id });
  assert(isEntityId(init.location), 'building location is not a valid entity id', {
    id: init.id,
    location: init.location,
  });
  assert(init.name.length > 0, 'building name must not be empty', { id: init.id });
  assert(init.type.length > 0, 'building type must not be empty', { id: init.id });

  const condition = init.condition ?? MAX_CONDITION;
  assertInt(condition, 'building condition must be an integer');
  assert(
    condition >= MIN_CONDITION && condition <= MAX_CONDITION,
    'building condition is outside its legal range',
    { id: init.id, condition },
  );

  return Object.freeze({
    id: init.id,
    name: init.name,
    type: init.type,
    location: init.location,
    owner: init.owner ?? null,
    residents: Object.freeze(sortedIds(init.residents ?? [], 'building residents')),
    condition,
  });
}
