// The village's memory: what is worth remembering, and where it is kept.
//
// Reads the durable event archive and writes plain text. Nothing here is part
// of the simulation: `sim-core` must never import this package, and this
// package never advances a clock, draws from an RNG or changes world state.

// What is worth remembering
export { SignificanceSchema, isNotable, weightOf } from './significance.ts';
export type { SignificanceConfig } from './significance.ts';

// The format both files share
export { EMPTY, cell, formatRow, isSkippable, parseRow } from './table.ts';

// Everybody who has ever existed
export {
  PEOPLE_FILE,
  PEOPLE_HEADER,
  PeopleRegister,
  familySlug,
  formatPersonLine,
  parsePersonLine,
  slugStem,
} from './people.ts';
export type { PersonRecord } from './people.ts';

// One archived day, distilled
export { ANNALS_COLUMNS, ANNALS_HEADER, distil, formatAnnalLine } from './annals.ts';
export type { AnnalLine, DistilOptions, DistilledDay } from './annals.ts';

// The record on disk
export { ANNALS_DIRECTORY, AnnalsStore, listAnnalYears, yearOf } from './annals-store.ts';
export type { AnnalsStoreOptions } from './annals-store.ts';

// The faces
export {
  AGE_BANDS,
  PORTRAIT_ID,
  PORTRAIT_SEXES,
  PortraitAtlasSchema,
  PortraitCatalog,
  PortraitCellSchema,
  parsePortraitId,
} from './portraits.ts';
export type { AgeBand, Portrait, PortraitAtlas, PortraitCell, PortraitSex } from './portraits.ts';

// Who wears which face
export {
  AgeBandRuleSchema,
  Casting,
  CastingSchema,
  CastingTakeSchema,
  portraitSexOf,
  yearsBetween,
} from './casting.ts';
export type {
  CastingConfig,
  CastingMismatch,
  CastingReport,
  CastingShortage,
  CastingTake,
  UncastPerson,
} from './casting.ts';

// How they come across
export { PersonaBook, PersonaBookSchema, PersonaSchema } from './persona.ts';
export type { Persona, PersonaBookConfig } from './persona.ts';

// What the families are to each other
export {
  Community,
  CommunitySchema,
  FAMILY_KINDS,
  FamilySchema,
  TIE_KINDS,
  TieSchema,
} from './community.ts';
export type { CommunityConfig, Family, Tie, TieKind } from './community.ts';
