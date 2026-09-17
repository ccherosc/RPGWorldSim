// People
export {
  BirthDateSchema,
  PersonSchema,
  Sex,
  ageInYears,
  fullName,
  isBirthday,
  isValidBirthDate,
  makePerson,
  withPerson,
} from './person.ts';
export type { BirthDate, Person, PersonInit, SexName } from './person.ts';

// Personality
export {
  DEFAULT_TRAIT_DISTRIBUTION,
  DEFAULT_TRAIT_MEAN,
  DEFAULT_TRAIT_STD_DEV,
  TRAIT_MAX,
  TRAIT_MIN,
  TRAIT_NAMES,
  Trait,
  TraitDistributionSchema,
  TraitsSchema,
  clampTrait,
  isTraitName,
  makeTraits,
} from './traits.ts';
export type { TraitDistribution, TraitName, Traits } from './traits.ts';

// Names
export { NameBookSchema, makeNameBook } from './names.ts';
export type { NameBook } from './names.ts';

// Generation
export {
  AgeBandSchema,
  DEFAULT_AGE_BANDS,
  availableGivenNames,
  birthYearForAge,
  generateAge,
  generateBirthDayOfYear,
  generatePerson,
  generateTraits,
  validateAgeBands,
} from './generate.ts';
export type { AgeBand, GeneratePersonOptions } from './generate.ts';

// The register
export { Population, PopulationSnapshotShape } from './population.ts';
export type { PopulationSnapshot } from './population.ts';
export { NpcEvent, NpcOrigin, PeopleSystem } from './people.ts';
export type { GenerateVillagerOptions, NpcOriginName } from './people.ts';

// The daily cycle
export {
  DEFAULT_ROUTINE_BANDS,
  MIN_WAKING_TICKS,
  ROUTINE_JITTER,
  ROUTINE_ROLE_SHIFTS,
  RoutineBandSchema,
  RoutineSchema,
  TickRangeSchema,
  at,
  generateRoutine,
  isWakingTime,
  jitter,
  makeRoutine,
  nextTickOfDay,
  routineBandFor,
  routineBandsFromJson,
  tickOfDayTomorrow,
  validateRoutineBands,
} from './routine.ts';
export type { GenerateRoutineOptions, Routine, RoutineBand, TickRange } from './routine.ts';
export {
  BED_EVENT,
  REST_SAVE_MODULE_ID,
  REST_SAVE_MODULE_VERSION,
  RISE_EVENT,
  RestEvent,
  RestKind,
  RestSnapshotShape,
  RestSystem,
  installRest,
  registerRestInvariants,
} from './rest.ts';
export type { BeginRestOptions, Rest, RestEventName, RestKindName } from './rest.ts';

// Wiring
export { registerNpcInvariants } from './invariants.ts';
export { NPC_SAVE_MODULE_ID, NPC_SAVE_MODULE_VERSION, installPeople, npcSaveModule } from './save.ts';
