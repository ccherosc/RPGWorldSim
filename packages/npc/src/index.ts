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

// Wiring
export { registerNpcInvariants } from './invariants.ts';
export { NPC_SAVE_MODULE_ID, NPC_SAVE_MODULE_VERSION, installPeople, npcSaveModule } from './save.ts';
