import type { EntityId, Simulation } from '@rpgsim/sim-core';
import { type InvariantViolation, violation } from '@rpgsim/sim-core';
import type { WorldMap } from './map.ts';

/**
 * The rules space obeys.
 *
 * `WorldMap` already refuses to enter an illegal state through its own methods,
 * so in a correct build these never fire. That is the point: they are the net
 * under the next person who reaches past the API, or under a save file that was
 * written by a version whose checks were weaker. sim-core rule 11 requires an
 * invariant for every new core concept, and these are space's.
 *
 * Every check is read-only. A check that repaired occupancy would hide the bug
 * it exists to catch, which CLAUDE.md directive and sim-core rule 10 both
 * forbid.
 */
export function registerWorldInvariants(sim: Simulation, map: WorldMap): void {
  sim.registerInvariant({
    id: 'world.entity-in-exactly-one-location',
    description: 'Placement and the occupancy index agree, in both directions.',
    check: () => {
      const violations: InvariantViolation[] = [];
      const seen = new Map<EntityId, EntityId>();

      for (const location of map.locationIds()) {
        for (const entity of map.occupantsOf(location)) {
          const first = seen.get(entity);
          if (first !== undefined) {
            violations.push(
              violation(
                'world.entity-in-exactly-one-location',
                'an entity appears in the occupants of two locations',
                { entity, locations: [first, location] },
              ),
            );
            continue;
          }
          seen.set(entity, location);

          if (map.locationOf(entity) !== location) {
            violations.push(
              violation(
                'world.entity-in-exactly-one-location',
                'an occupant of a location does not believe it is there',
                { entity, occupantOf: location, believes: map.locationOf(entity) ?? null },
              ),
            );
          }
        }
      }

      for (const entity of map.placedEntities()) {
        const location = map.locationOf(entity) as EntityId;
        if (!map.hasLocation(location)) {
          violations.push(
            violation('world.entity-in-exactly-one-location', 'an entity is in a location that does not exist', {
              entity,
              location,
            }),
          );
          continue;
        }
        if (!seen.has(entity)) {
          violations.push(
            violation(
              'world.entity-in-exactly-one-location',
              'a placed entity is missing from its location’s occupants',
              { entity, location },
            ),
          );
        }
      }

      return violations;
    },
  });

  sim.registerInvariant({
    id: 'world.occupancy-within-capacity',
    description: 'No location holds more entities, present or inbound, than it has room for.',
    check: () =>
      map
        .locationsInOrder()
        .filter(
          (location) =>
            location.capacity !== null &&
            map.occupancyOf(location.id) + map.reservationCountAt(location.id) > location.capacity,
        )
        .map((location) =>
          violation('world.occupancy-within-capacity', 'a location is over capacity', {
            location: location.id,
            name: location.name,
            capacity: location.capacity,
            occupancy: map.occupancyOf(location.id),
            inbound: map.reservationCountAt(location.id),
          }),
        ),
  });

  sim.registerInvariant({
    id: 'world.reservations-are-coherent',
    description: 'A held seat belongs to someone who is not already here, and is counted once.',
    check: () => {
      const violations: InvariantViolation[] = [];
      const seen = new Map<EntityId, EntityId>();

      for (const location of map.locationIds()) {
        for (const entity of map.reservationsAt(location)) {
          const first = seen.get(entity);
          if (first !== undefined) {
            violations.push(
              violation('world.reservations-are-coherent', 'an entity holds two reservations', {
                entity,
                locations: [first, location],
              }),
            );
            continue;
          }
          seen.set(entity, location);

          if (map.reservationOf(entity) !== location) {
            violations.push(
              violation(
                'world.reservations-are-coherent',
                'a location holds a seat for an entity that is not headed there',
                { entity, heldBy: location, headedFor: map.reservationOf(entity) ?? null },
              ),
            );
          }
          if (map.isPlaced(entity)) {
            violations.push(
              violation(
                'world.reservations-are-coherent',
                'an entity is standing somewhere and holding a seat elsewhere',
                { entity, standingIn: map.locationOf(entity) ?? null, holding: location },
              ),
            );
          }
        }
      }

      for (const entity of map.reservingEntities()) {
        const location = map.reservationOf(entity) as EntityId;
        if (!map.hasLocation(location)) {
          violations.push(
            violation('world.reservations-are-coherent', 'a seat is held at a location that does not exist', {
              entity,
              location,
            }),
          );
        } else if (!seen.has(entity)) {
          violations.push(
            violation(
              'world.reservations-are-coherent',
              'a held seat is missing from its location’s reservation list',
              { entity, location },
            ),
          );
        }
      }

      return violations;
    },
  });

  sim.registerInvariant({
    id: 'world.edges-symmetric-and-positive',
    description: 'Every connection is two-way, costs the same in both directions, and costs something.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const from of map.locationIds()) {
        for (const { to, cost } of map.connectionsOf(from)) {
          const back = map.travelCost(to, from);
          if (back !== cost) {
            violations.push(
              violation('world.edges-symmetric-and-positive', 'a connection is not symmetric', {
                from,
                to,
                cost,
                reverseCost: back ?? null,
              }),
            );
          }
          if (!Number.isSafeInteger(cost) || cost <= 0) {
            violations.push(
              violation(
                'world.edges-symmetric-and-positive',
                'a connection has a cost that is not a positive integer number of ticks',
                { from, to, cost },
              ),
            );
          }
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'world.graph-is-connected',
    description: 'Every location is reachable from every other.',
    check: () => {
      // An empty map is vacuously connected; a world with no locations yet is a
      // world before worldgen, not a broken one.
      if (map.locationCount === 0) return [];
      const unreachable = map.unreachableLocations();
      return unreachable.length === 0
        ? []
        : [
            violation('world.graph-is-connected', 'some locations cannot be reached from the rest of the map', {
              unreachable,
              from: map.locationIds()[0] ?? null,
            }),
          ];
    },
  });

  sim.registerInvariant({
    id: 'world.buildings-have-interiors',
    description: 'Every building stands in a location that exists, and no two share one.',
    check: () => {
      const violations: InvariantViolation[] = [];
      const interiors = new Map<EntityId, EntityId>();
      for (const building of map.buildingsInOrder()) {
        if (!map.hasLocation(building.location)) {
          violations.push(
            violation('world.buildings-have-interiors', 'a building has no interior location', {
              building: building.id,
              location: building.location,
            }),
          );
          continue;
        }
        const other = interiors.get(building.location);
        if (other !== undefined) {
          violations.push(
            violation('world.buildings-have-interiors', 'two buildings claim the same interior', {
              buildings: [other, building.id],
              location: building.location,
            }),
          );
          continue;
        }
        interiors.set(building.location, building.id);
      }
      return violations;
    },
  });
}
