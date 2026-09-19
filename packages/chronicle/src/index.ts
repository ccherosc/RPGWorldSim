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
  yearsBetween,
} from './people.ts';
export type { PersonRecord } from './people.ts';

// Everywhere that exists
export {
  PLACES_FILE,
  PLACES_HEADER,
  PUBLIC,
  PlaceRegister,
  formatPlaceLine,
  parsePlaceLine,
  placeSlug,
} from './places.ts';
export type { PlaceRecord } from './places.ts';

// One archived day, distilled
export { ANNALS_COLUMNS, ANNALS_HEADER, distil, formatAnnalLine } from './annals.ts';
export type { AnnalLine, DistilOptions, DistilledDay } from './annals.ts';

// The record on disk
export { ANNALS_DIRECTORY, AnnalsStore, listAnnalYears, yearOf } from './annals-store.ts';
export type { AnnalsStoreOptions } from './annals-store.ts';

// One day of the archive, indexed the way the press reads it
export { ChronicleDay } from './day.ts';
export type { ChronicleDayOptions } from './day.ts';

// How newsworthy a thing that happened is
export { ScoringSchema, compareNewsworthiness, rank, scoreOf } from './score.ts';
export type { Newsworthiness, ScoringConfig } from './score.ts';

// What goes on the page, and who writes it
export {
  SelectionSchema,
  lastPostedWithin,
  rankCandidates,
  select,
  selectHeadlines,
  selectPosters,
} from './select.ts';
export type { Candidate, Edition, PublishedDay, SelectOptions, SelectionConfig } from './select.ts';

// Where everybody was, and when
export { Whereabouts } from './witness.ts';
export type { Stay } from './witness.ts';

// Turning an event into a sentence
export { TemplateSchema, eligible, listOf, midSentence, namesOf, placeOf, render } from './wording.ts';
export type { Template, WordingContext } from './wording.ts';

// Who belongs to whom
export { Kinfolk } from './kin.ts';

// The villagers, in their own words
export { TemplateBookSchema, householdVoice, writePost, writePosts } from './post.ts';
export type { HouseholdVoice, Post, PostLine, PostOptions, TemplateBook } from './post.ts';

// The Towne Publication
export { PaperBookSchema, glanceOf, reviewOf, writePaper } from './paper.ts';
export type { Glance, Paper, PaperBook, PaperOptions, Story } from './paper.ts';

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
