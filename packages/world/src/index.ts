// Space
export {
  Access,
  BuildingSchema,
  BuildingType,
  CoordinateSchema,
  EntityIdSchema,
  LocationSchema,
  LocationType,
  MAX_CONDITION,
  MIN_CONDITION,
  makeBuilding,
  makeLocation,
} from './location.ts';
export type {
  AccessName,
  Building,
  BuildingInit,
  BuildingTypeName,
  Coordinate,
  Location,
  LocationInit,
  LocationTypeName,
} from './location.ts';

// The map
export { EntryRefusal, WorldMap } from './map.ts';
export type {
  Connection,
  EntryCheck,
  EntryRefusalReason,
  Route,
  WorldMapSnapshot,
} from './map.ts';

// Wiring
export { registerWorldInvariants } from './invariants.ts';
export {
  WORLD_SAVE_MODULE_ID,
  WORLD_SAVE_MODULE_VERSION,
  installWorld,
  worldSaveModule,
} from './save.ts';
