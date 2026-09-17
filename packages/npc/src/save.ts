import type { JsonValue } from '@rpgsim/shared';
import type { SaveModule, Simulation } from '@rpgsim/sim-core';
import { registerNpcInvariants } from './invariants.ts';
import { PeopleSystem } from './people.ts';
import { Population } from './population.ts';

/**
 * Persistence for people.
 *
 * Its own module, so that adding a trait bumps this version and leaves the
 * world's and travel's saved bytes untouched — which is what makes directive
 * 16's backward compatibility affordable rather than heroic.
 *
 * Note the load order this gives us for free: modules load in sorted id order,
 * so `npc` loads before `travel` and `world`. Anything the npc module wants to
 * assert about a *place* therefore belongs in `verify()`, not `load()`. There is
 * nothing to assert yet — homes are slice 4 — so there is no `verify` here.
 */
export const NPC_SAVE_MODULE_ID = 'npc';

/** 1 — identity, twelve traits, household and home references. */
export const NPC_SAVE_MODULE_VERSION = 1;

export function npcSaveModule(sim: Simulation, population: Population): SaveModule {
  return {
    id: NPC_SAVE_MODULE_ID,
    version: NPC_SAVE_MODULE_VERSION,
    save: (): JsonValue => population.toJson(),
    load: (data: JsonValue): void => {
      population.restore(Population.fromJson(data, sim.calendar));
    },
  };
}

/**
 * Attach a population to a simulation: persistence and invariants, nothing else.
 *
 * Deliberately does not generate anybody. Who lives in the village is worldgen's
 * business (slice 6), and worldgen lives in the app, which knows where `data/`
 * is; `packages/npc` never reads a file (determinism rule 4).
 *
 * Call this for a world about to be generated *and* for one about to be loaded.
 * A save carries state, never wiring.
 */
export function installPeople(
  sim: Simulation,
  population: Population = new Population(),
): PeopleSystem {
  sim.registerSaveModule(npcSaveModule(sim, population));
  registerNpcInvariants(sim, population);
  return new PeopleSystem(sim, population);
}
