import type { JsonValue } from '@rpgsim/shared';
import type { SaveModule, Simulation } from '@rpgsim/sim-core';
import type { PeopleSystem } from '@rpgsim/npc';
import { registerSocietyInvariants } from './invariants.ts';
import { SocietyRegister } from './register.ts';
import { HouseholdSystem } from './system.ts';

/**
 * Persistence for households and descent.
 *
 * Its own module, so that a change to family structure bumps this version and
 * leaves npc, travel and world untouched (directive 16).
 *
 * The load order matters here more than it did for npc. Modules load in sorted
 * id order -- `npc`, then `society`, then `travel`, then `world` -- so by the
 * time this loads, every person exists and can be cross-checked, but no
 * location does. Anything this module wants to assert about a *place* therefore
 * cannot live in `load()`.
 *
 * It cannot live in `verify()` either, and that is worth being explicit about:
 * a household's dwelling should be a building that exists, but this package has
 * no reference to the map and no dependency on `@rpgsim/world`. Adding one to
 * check a single id would couple family structure to terrain. The check belongs
 * where something holds both -- the worldgen wiring in slice 6 -- and it is
 * recorded there rather than left as a comment nobody reads.
 */
export const SOCIETY_SAVE_MODULE_ID = 'society';

/** 1 -- households with roles and one dwelling, plus recorded parentage. */
export const SOCIETY_SAVE_MODULE_VERSION = 1;

export function societySaveModule(register: SocietyRegister): SaveModule {
  return {
    id: SOCIETY_SAVE_MODULE_ID,
    version: SOCIETY_SAVE_MODULE_VERSION,
    save: (): JsonValue => register.toJson(),
    load: (data: JsonValue): void => {
      register.restore(SocietyRegister.fromJson(data));
    },
  };
}

/**
 * Attach households to a simulation: persistence and invariants, nothing else.
 *
 * Deliberately builds no families. Who is married to whom is worldgen's
 * business (slice 6), and worldgen lives in the app, which knows where `data/`
 * is; this package never reads a file (determinism rule 4).
 *
 * Takes a `PeopleSystem` rather than a `Population`, because every membership
 * change writes both sides -- the household's list and the person's record --
 * and the person's side has to emit an event when it moves.
 */
export function installSociety(
  sim: Simulation,
  people: PeopleSystem,
  register: SocietyRegister = new SocietyRegister(),
): HouseholdSystem {
  sim.registerSaveModule(societySaveModule(register));
  registerSocietyInvariants(sim, register, people.population);
  return new HouseholdSystem(sim, people, register);
}
