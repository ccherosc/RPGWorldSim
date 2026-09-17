import { BinaryHeap, type JsonValue, assert, assertInt } from '@rpgsim/shared';
import { compareEntityIds, type EntityId, isEntityId } from '@rpgsim/sim-core';
import { z } from 'zod';
import {
  Access,
  type Building,
  BuildingSchema,
  EntityIdSchema,
  type Location,
  LocationSchema,
  makeBuilding,
  makeLocation,
} from './location.ts';

/**
 * The village as a graph.
 *
 * Nodes are locations, edges are ways between them, and the weight on an edge
 * is the travel cost in ticks on foot. Routing is over the graph and never over
 * the coordinates: a road bends, a ford is not a straight line, and a wall
 * between two adjacent buildings is a long walk. Costs are data (PHASE_1.md,
 * "Travel cost in ticks, on the edge").
 *
 * The map owns two kinds of state that behave very differently:
 *
 *   - **topology** — locations, edges, buildings. Built at worldgen and treated
 *     as immutable afterwards.
 *   - **occupancy** — who is where. Changes constantly, and is the thing every
 *     invariant in this module is really about.
 *
 * Everything that iterates does so in sorted order, because an event, a hash or
 * a saved byte that depends on `Map` insertion order is a determinism bug
 * waiting for the first refactor (determinism rule 5).
 */

/** Why an entity may not enter a location. */
export const EntryRefusal = {
  /** There is no such place. Almost always a bug in the caller, not the world. */
  UnknownLocation: 'unknown-location',
  /** The place is at capacity. */
  Full: 'full',
  /** Access rules forbid it. */
  Forbidden: 'forbidden',
} as const;

export type EntryRefusalReason = (typeof EntryRefusal)[keyof typeof EntryRefusal];

export type EntryCheck =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: EntryRefusalReason;
      /** Enough context to put in a `travel.blocked` event without re-deriving it. */
      readonly details: Readonly<Record<string, unknown>>;
    };

const ALLOWED: EntryCheck = Object.freeze({ allowed: true });

/** A way through the graph, and what it costs. */
export interface Route {
  /** Every location passed through, starting at the origin and ending at the destination. */
  readonly path: readonly EntityId[];
  /** Total travel cost in ticks. */
  readonly cost: number;
}

export interface Connection {
  readonly to: EntityId;
  readonly cost: number;
}

export interface Frontier {
  readonly id: EntityId;
  readonly cost: number;
}

/**
 * Deterministic frontier ordering for the route search.
 *
 * Cost alone is not a total order — two routes of equal length are common in a
 * village laid out along one street — and a heap given equal keys arranges them
 * however its sift happens to fall out. Breaking the tie on the entity id makes
 * the search independent of that: the route a villager takes is a property of
 * the map, not of `BinaryHeap`'s internals, and stays the same if the heap is
 * ever replaced.
 *
 * Exported for its own test. Sorted adjacency in `connectionsOf` happens to
 * make the current search deterministic even without this, so an end-to-end
 * route test cannot tell whether the tie-break works — only a direct one can.
 */
export function compareFrontier(a: Frontier, b: Frontier): number {
  return a.cost !== b.cost ? a.cost - b.cost : compareEntityIds(a.id, b.id);
}

export interface WorldMapSnapshot {
  readonly locations: readonly Location[];
  readonly edges: readonly { readonly a: EntityId; readonly b: EntityId; readonly cost: number }[];
  readonly buildings: readonly Building[];
  readonly occupancy: readonly { readonly entity: EntityId; readonly location: EntityId }[];
  /** Who is on the road, and which place is holding room for them. */
  readonly reservations: readonly { readonly entity: EntityId; readonly location: EntityId }[];
}

export class WorldMap {
  private locations = new Map<EntityId, Location>();
  private buildings = new Map<EntityId, Building>();
  /** Adjacency. Both directions of every edge are stored, and kept equal. */
  private edges = new Map<EntityId, Map<EntityId, number>>();
  /** Where each entity is. The authoritative copy. */
  private placement = new Map<EntityId, EntityId>();
  /** Reverse index of `placement`, maintained in lockstep so lookups are O(1). */
  private occupants = new Map<EntityId, Set<EntityId>>();
  /**
   * Room held for travellers who are on their way.
   *
   * A traveller belongs to no location while walking, but the place they are
   * walking to holds their seat: the last stool in the tavern is taken by the
   * man coming up the lane. This is what makes arrival unable to fail — see
   * `reserve`.
   */
  private reservations = new Map<EntityId, EntityId>();
  /** Reverse index of `reservations`. */
  private reserved = new Map<EntityId, Set<EntityId>>();

  // --- topology -------------------------------------------------------------

  addLocation(location: Location): void {
    assert(!this.locations.has(location.id), 'a location with this id already exists', {
      id: location.id,
    });
    this.locations.set(location.id, location);
    this.edges.set(location.id, new Map());
    this.occupants.set(location.id, new Set());
    this.reserved.set(location.id, new Set());
  }

  /**
   * Join two locations, in both directions, for the same cost.
   *
   * Symmetry is not checked later because it cannot be violated here: one call
   * writes both directions. Costs are integer ticks and must be positive — a
   * zero-cost edge would let a villager cross the village in no time at all,
   * which is Prime Directive 7 defeated by arithmetic.
   */
  connect(a: EntityId, b: EntityId, cost: number): void {
    assert(a !== b, 'a location cannot connect to itself', { id: a });
    const from = this.requireEdges(a);
    const to = this.requireEdges(b);
    assertInt(cost, 'travel cost must be an integer number of ticks');
    assert(cost > 0, 'travel cost must be positive', { a, b, cost });

    const existing = from.get(b);
    assert(existing === undefined || existing === cost, 'these locations are already connected at a different cost', {
      a,
      b,
      existing,
      cost,
    });

    from.set(b, cost);
    to.set(a, cost);
  }

  addBuilding(building: Building): void {
    assert(!this.buildings.has(building.id), 'a building with this id already exists', {
      id: building.id,
    });
    assert(this.locations.has(building.location), 'a building needs a location that exists', {
      id: building.id,
      location: building.location,
    });
    for (const other of this.buildingsInOrder()) {
      assert(other.location !== building.location, 'two buildings cannot share one interior', {
        id: building.id,
        other: other.id,
        location: building.location,
      });
    }
    this.buildings.set(building.id, building);
  }

  location(id: EntityId): Location {
    const location = this.locations.get(id);
    assert(location !== undefined, 'no such location', { id });
    return location;
  }

  tryLocation(id: EntityId): Location | undefined {
    return this.locations.get(id);
  }

  hasLocation(id: EntityId): boolean {
    return this.locations.has(id);
  }

  building(id: EntityId): Building {
    const building = this.buildings.get(id);
    assert(building !== undefined, 'no such building', { id });
    return building;
  }

  get locationCount(): number {
    return this.locations.size;
  }

  get buildingCount(): number {
    return this.buildings.size;
  }

  /** Every location, in id order. */
  locationsInOrder(): Location[] {
    return this.locationIds().map((id) => this.locations.get(id) as Location);
  }

  locationIds(): EntityId[] {
    return [...this.locations.keys()].sort(compareEntityIds);
  }

  buildingsInOrder(): Building[] {
    return this.buildingIds().map((id) => this.buildings.get(id) as Building);
  }

  buildingIds(): EntityId[] {
    return [...this.buildings.keys()].sort(compareEntityIds);
  }

  /** What this location connects to, in id order. */
  connectionsOf(id: EntityId): Connection[] {
    const adjacency = this.requireEdges(id);
    return [...adjacency.keys()]
      .sort(compareEntityIds)
      .map((to) => ({ to, cost: adjacency.get(to) as number }));
  }

  /** Cost of a single step, or `undefined` if the two are not adjacent. */
  travelCost(from: EntityId, to: EntityId): number | undefined {
    return this.requireEdges(from).get(to);
  }

  areConnected(a: EntityId, b: EntityId): boolean {
    return this.travelCost(a, b) !== undefined;
  }

  // --- occupancy ------------------------------------------------------------

  /** Where an entity is, or `undefined` if it is nowhere — in transit, or unborn. */
  locationOf(entity: EntityId): EntityId | undefined {
    return this.placement.get(entity);
  }

  isPlaced(entity: EntityId): boolean {
    return this.placement.has(entity);
  }

  /** Who is here, in id order. */
  occupantsOf(location: EntityId): EntityId[] {
    return [...this.requireOccupants(location)].sort(compareEntityIds);
  }

  occupancyOf(location: EntityId): number {
    return this.requireOccupants(location).size;
  }

  /** Every placed entity, in id order. */
  placedEntities(): EntityId[] {
    return [...this.placement.keys()].sort(compareEntityIds);
  }

  /**
   * May this entity enter?
   *
   * Returns a reason rather than a boolean because the reason is the useful
   * part: it goes into the `travel.blocked` event, and from there into the
   * `WHY?` view, which has to explain the constraints that prevented an action.
   */
  canEnter(entity: EntityId, location: EntityId): EntryCheck {
    const place = this.locations.get(location);
    if (place === undefined) {
      return { allowed: false, reason: EntryRefusal.UnknownLocation, details: { location } };
    }

    // Already here: entering where you are is not a movement and cannot be
    // refused, or an entity could be told it may not stand where it stands.
    if (this.placement.get(entity) === location) return ALLOWED;

    if (place.access === Access.Private && place.owner !== entity && !place.permitted.includes(entity)) {
      return {
        allowed: false,
        reason: EntryRefusal.Forbidden,
        details: { location, entity, access: place.access },
      };
    }

    // Occupants *plus* inbound travellers. Counting only the people already
    // standing here would let two walkers be promised the same last seat, and
    // the second one would arrive to find no room and nowhere to be.
    const pressure = this.pressureOn(location, entity);
    if (place.capacity !== null && pressure >= place.capacity) {
      return {
        allowed: false,
        reason: EntryRefusal.Full,
        details: {
          location,
          capacity: place.capacity,
          occupancy: this.occupancyOf(location),
          inbound: this.reservationCountAt(location),
        },
      };
    }

    return ALLOWED;
  }

  /**
   * Put an entity somewhere it has never been placed.
   *
   * Used at worldgen and at birth. Distinct from `move` so that placing an
   * entity that is already somewhere is an error rather than a teleport: the
   * only legitimate way to change location is through movement, which costs
   * time (slice 2).
   */
  place(entity: EntityId, location: EntityId): void {
    assert(isEntityId(entity), 'not a valid entity id', { entity });
    assert(!this.placement.has(entity), 'entity is already placed; use move or remove first', {
      entity,
      at: this.placement.get(entity),
    });
    // A traveller holding a seat must arrive through `settle`, or the seat
    // would stay held forever and quietly shrink the place by one.
    assert(!this.reservations.has(entity), 'entity holds a reservation; settle or release it first', {
      entity,
      reservedAt: this.reservations.get(entity),
    });
    this.enter(entity, location);
  }

  /** Move an already-placed entity. Slice 2 calls this on arrival, not on departure. */
  move(entity: EntityId, to: EntityId): void {
    const from = this.placement.get(entity);
    assert(from !== undefined, 'entity is not placed anywhere and so cannot move', { entity });
    if (from === to) return;
    this.requireEntry(entity, to);
    this.detach(entity, from);
    this.enter(entity, to);
  }

  /**
   * Take an entity off the map entirely.
   *
   * Returns where it was, or `undefined` if it was nowhere. This is how travel
   * begins — a traveller belongs to no location while on the road — and how
   * death and departure end.
   */
  remove(entity: EntityId): EntityId | undefined {
    const from = this.placement.get(entity);
    if (from === undefined) return undefined;
    this.detach(entity, from);
    this.placement.delete(entity);
    return from;
  }

  // --- reservations ---------------------------------------------------------

  /**
   * Hold room at a location for an entity that is on its way there.
   *
   * Travel takes time, and a place can fill up while someone is walking to it.
   * Without a held seat the walker arrives to a full room and has to be put
   * *somewhere* — and every candidate (back where they came from, the nearest
   * open door) can be full too, which ends with a person who is nowhere. Taking
   * the seat at departure removes the whole class of problem: if the reservation
   * succeeded, the arrival will succeed.
   *
   * The reservation is real occupancy pressure. Someone already in the room
   * cannot be displaced by it, but a third party trying to walk in is refused.
   */
  reserve(entity: EntityId, location: EntityId): void {
    assert(isEntityId(entity), 'not a valid entity id', { entity });
    // Deliberately allowed while the entity is still standing somewhere: a
    // traveller takes the seat at the far end *before* stepping off the map, so
    // that a refusal leaves them exactly where they were rather than nowhere.
    // Holding both at rest is a broken world, and
    // `world.reservations-are-coherent` is the check that says so.
    assert(!this.reservations.has(entity), 'entity already holds a reservation', {
      entity,
      at: this.reservations.get(entity),
    });
    this.requireEntry(entity, location);
    this.reservations.set(entity, location);
    this.requireReserved(location).add(entity);
  }

  /** Give up a held seat. Returns where it was held, or `undefined`. */
  releaseReservation(entity: EntityId): EntityId | undefined {
    const at = this.reservations.get(entity);
    if (at === undefined) return undefined;
    this.reservations.delete(entity);
    this.reserved.get(at)?.delete(entity);
    return at;
  }

  /**
   * Turn a held seat into presence: the traveller has arrived.
   *
   * Cannot be refused for room, because the room was taken at departure. Access
   * is still checked, and a refusal here throws rather than returning: nothing
   * in Phase 1 can revoke permission while someone is walking, so if it happens
   * it is a bug, and sim-core rule 10 says a bug is reported, not absorbed. A
   * later slice that lets an owner bar the door mid-journey has to decide where
   * the traveller ends up, and that decision belongs to that slice.
   */
  settle(entity: EntityId): EntityId {
    const location = this.reservations.get(entity);
    assert(location !== undefined, 'entity holds no reservation to settle', { entity });
    const place = this.locations.get(location) as Location;
    assert(
      place.access !== Access.Private || place.owner === entity || place.permitted.includes(entity),
      'a traveller arrived somewhere they are no longer permitted',
      { entity, location },
    );
    this.releaseReservation(entity);
    this.enter(entity, location);
    return location;
  }

  /** Where this entity is headed, or `undefined` if it holds no seat. */
  reservationOf(entity: EntityId): EntityId | undefined {
    return this.reservations.get(entity);
  }

  /** Who is on their way here, in id order. */
  reservationsAt(location: EntityId): EntityId[] {
    return [...this.requireReserved(location)].sort(compareEntityIds);
  }

  reservationCountAt(location: EntityId): number {
    return this.requireReserved(location).size;
  }

  /** Every entity holding a seat, in id order. */
  reservingEntities(): EntityId[] {
    return [...this.reservations.keys()].sort(compareEntityIds);
  }

  /** Occupancy as capacity sees it: bodies present plus seats held by others. */
  private pressureOn(location: EntityId, asker: EntityId): number {
    const held = this.reservations.get(asker) === location ? 1 : 0;
    return this.occupancyOf(location) + this.reservationCountAt(location) - held;
  }

  private requireReserved(location: EntityId): Set<EntityId> {
    const set = this.reserved.get(location);
    assert(set !== undefined, 'no such location', { location });
    return set;
  }

  // --- routing --------------------------------------------------------------

  /**
   * Cheapest route between two locations, or `undefined` if there is none.
   *
   * Plain Dijkstra with a deterministic tie-break. Costs are positive integers,
   * so no negative-weight case exists and no float arithmetic enters the
   * result: a route's cost is exactly the sum of its edges, on every platform.
   *
   * Access and capacity are deliberately *not* considered. A route is a fact
   * about the map; whether a particular person may walk it is a fact about
   * them, and asking `canEnter` at each step is the traveller's job. Mixing the
   * two would make routes depend on who asked, and cache wrongly forever after.
   */
  findRoute(from: EntityId, to: EntityId): Route | undefined {
    assert(this.locations.has(from), 'no such origin location', { from });
    assert(this.locations.has(to), 'no such destination location', { to });
    // A fast path, not a special case: the search below settles `from`
    // immediately and returns the same `{ path: [from], cost: 0 }`. Deleting
    // this line is an equivalent mutation, so no test can guard it — which is
    // why it says so here.
    if (from === to) return { path: [from], cost: 0 };

    const best = new Map<EntityId, number>([[from, 0]]);
    const cameFrom = new Map<EntityId, EntityId>();
    const settled = new Set<EntityId>();
    const frontier = new BinaryHeap<Frontier>(compareFrontier);
    frontier.push({ id: from, cost: 0 });

    for (;;) {
      const current = frontier.pop();
      if (current === undefined) return undefined;
      if (settled.has(current.id)) continue;
      settled.add(current.id);

      if (current.id === to) {
        const path: EntityId[] = [to];
        let step = to;
        while (step !== from) {
          step = cameFrom.get(step) as EntityId;
          path.push(step);
        }
        path.reverse();
        return { path, cost: current.cost };
      }

      // Sorted, so that equal-cost neighbours are pushed in a fixed order and
      // the heap's internal arrangement cannot depend on Map insertion order.
      for (const { to: neighbour, cost } of this.connectionsOf(current.id)) {
        if (settled.has(neighbour)) continue;
        const candidate = current.cost + cost;
        const known = best.get(neighbour);
        if (known !== undefined && known <= candidate) continue;
        best.set(neighbour, candidate);
        cameFrom.set(neighbour, current.id);
        frontier.push({ id: neighbour, cost: candidate });
      }
    }
  }

  /** Total travel cost of the cheapest route, or `undefined` if unreachable. */
  routeCost(from: EntityId, to: EntityId): number | undefined {
    return this.findRoute(from, to)?.cost;
  }

  /**
   * Locations unreachable from the lowest-numbered one, in id order.
   *
   * Empty means the graph is connected. A village with an unreachable building
   * is a worldgen bug, and it is enormously cheaper to find it before the world
   * starts than on the day someone is sent there.
   */
  unreachableLocations(): EntityId[] {
    const ids = this.locationIds();
    const root = ids[0];
    if (root === undefined) return [];

    const seen = new Set<EntityId>([root]);
    const queue: EntityId[] = [root];
    while (queue.length > 0) {
      const current = queue.shift() as EntityId;
      for (const { to } of this.connectionsOf(current)) {
        if (seen.has(to)) continue;
        seen.add(to);
        queue.push(to);
      }
    }
    return ids.filter((id) => !seen.has(id));
  }

  isFullyConnected(): boolean {
    return this.unreachableLocations().length === 0;
  }

  // --- persistence ----------------------------------------------------------

  /**
   * The whole map, canonically ordered.
   *
   * Topology is saved rather than regenerated. Re-running worldgen from the
   * seed would in principle produce the same village, but it would make every
   * old save depend on the current worldgen code, so a tweak to how cottages
   * are laid out would silently relocate the people in an existing world.
   */
  save(): WorldMapSnapshot {
    const edges: { a: EntityId; b: EntityId; cost: number }[] = [];
    for (const a of this.locationIds()) {
      for (const { to: b, cost } of this.connectionsOf(a)) {
        // One row per edge, not two: `a < b` picks a canonical direction.
        if (compareEntityIds(a, b) < 0) edges.push({ a, b, cost });
      }
    }

    return {
      locations: this.locationsInOrder(),
      edges,
      buildings: this.buildingsInOrder(),
      occupancy: this.placedEntities().map((entity) => ({
        entity,
        location: this.placement.get(entity) as EntityId,
      })),
      reservations: this.reservingEntities().map((entity) => ({
        entity,
        location: this.reservations.get(entity) as EntityId,
      })),
    };
  }

  toJson(): JsonValue {
    return this.save() as unknown as JsonValue;
  }

  /**
   * Rebuild from a snapshot, replacing everything.
   *
   * Every record goes back through `makeLocation` and `makeBuilding`, so a save
   * that has been hand-edited, truncated or written by a buggy build is refused
   * at load rather than absorbed into the world (sim-core rule 10). Placement
   * goes through `place`, so capacity and access are re-checked too.
   */
  restore(snapshot: WorldMapSnapshot): void {
    this.locations = new Map();
    this.buildings = new Map();
    this.edges = new Map();
    this.placement = new Map();
    this.occupants = new Map();
    this.reservations = new Map();
    this.reserved = new Map();

    for (const location of snapshot.locations) {
      this.addLocation(makeLocation(location));
    }
    for (const edge of snapshot.edges) {
      this.connect(edge.a, edge.b, edge.cost);
    }
    for (const building of snapshot.buildings) {
      this.addBuilding(makeBuilding(building));
    }
    for (const { entity, location } of snapshot.occupancy) {
      this.place(entity, location);
    }
    // After the occupants, so that a save in which the room was already full
    // before the traveller set out is refused rather than quietly overbooked.
    for (const { entity, location } of snapshot.reservations) {
      this.reserve(entity, location);
    }
  }

  static fromJson(data: unknown): WorldMapSnapshot {
    const result = SnapshotShape.safeParse(data);
    assert(result.success, 'world save block failed validation', {
      issues: result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return result.data as WorldMapSnapshot;
  }

  // --- internals ------------------------------------------------------------

  private requireEdges(id: EntityId): Map<EntityId, number> {
    const adjacency = this.edges.get(id);
    assert(adjacency !== undefined, 'no such location', { id });
    return adjacency;
  }

  private requireOccupants(id: EntityId): Set<EntityId> {
    const here = this.occupants.get(id);
    assert(here !== undefined, 'no such location', { id });
    return here;
  }

  private requireEntry(entity: EntityId, location: EntityId): void {
    const check = this.canEnter(entity, location);
    assert(check.allowed, 'entity may not enter this location', {
      entity,
      location,
      ...(check.allowed ? {} : { reason: check.reason, ...check.details }),
    });
  }

  private enter(entity: EntityId, location: EntityId): void {
    this.requireEntry(entity, location);
    this.requireOccupants(location).add(entity);
    this.placement.set(entity, location);
  }

  private detach(entity: EntityId, from: EntityId): void {
    this.requireOccupants(from).delete(entity);
  }
}

// Structural validation of a saved map. The *semantic* rules — positive costs,
// real capacities, condition in range, one building per interior — are enforced
// by `makeLocation`, `makeBuilding`, `connect` and `place` during `restore`, so
// they are not duplicated here. This schema's job is only to guarantee that
// `restore` is handed the shape it expects rather than crashing halfway through
// and leaving a half-built map behind.
const SnapshotShape = z.object({
  locations: z.array(LocationSchema),
  edges: z.array(
    z.object({ a: EntityIdSchema, b: EntityIdSchema, cost: z.number().int().positive() }),
  ),
  buildings: z.array(BuildingSchema),
  occupancy: z.array(z.object({ entity: EntityIdSchema, location: EntityIdSchema })),
  reservations: z.array(z.object({ entity: EntityIdSchema, location: EntityIdSchema })),
});
