import { type JsonValue, assert, isJsonObject } from '@rpgsim/shared';
import type { SaveModule, Simulation } from '@rpgsim/sim-core';
import { registerWorldInvariants } from './invariants.ts';
import { WorldMap } from './map.ts';

/**
 * Persistence for space.
 *
 * The map gets its own save module rather than living in `core`, so that adding
 * a field to a location bumps only this module's version and leaves every other
 * package's saved bytes untouched (directive 16, via `SaveModule`'s contract).
 */
export const WORLD_SAVE_MODULE_ID = 'world';

/**
 * 1 — locations, edges, buildings, occupancy.
 * 2 — adds `reservations`: room held for travellers on the road (slice 2).
 */
export const WORLD_SAVE_MODULE_VERSION = 2;

export function worldSaveModule(map: WorldMap): SaveModule {
  return {
    id: WORLD_SAVE_MODULE_ID,
    version: WORLD_SAVE_MODULE_VERSION,
    save: (): JsonValue => map.toJson(),
    load: (data: JsonValue): void => {
      map.restore(WorldMap.fromJson(data));
    },
    /**
     * A version 1 world had no travellers, because nothing could travel yet.
     * An empty reservation list is therefore not a guess about what the old
     * save meant — it is the only thing it could have meant.
     */
    migrate: (data: JsonValue, fromVersion: number): JsonValue => {
      assert(fromVersion === 1, 'no migration path from this world save version', { fromVersion });
      assert(isJsonObject(data), 'a version 1 world save must be an object');
      return { ...data, reservations: [] };
    },
  };
}

/**
 * Attach a map to a simulation: persistence and invariants, nothing else.
 *
 * Deliberately does not build a village. Worldgen is slice 6's job and belongs
 * in the app, which knows where `data/` is; `packages/world` never reads a file
 * (determinism rule 4).
 *
 * Call this for a world that is about to be generated *and* for one that is
 * about to be loaded. A save carries state, never wiring — which is what keeps
 * saves portable across builds.
 */
export function installWorld(sim: Simulation, map: WorldMap = new WorldMap()): WorldMap {
  sim.registerSaveModule(worldSaveModule(map));
  registerWorldInvariants(sim, map);
  return map;
}
