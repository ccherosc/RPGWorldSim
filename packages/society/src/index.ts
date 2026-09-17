// Households
export {
  HOUSEHOLD_ROLES,
  HouseholdMemberSchema,
  HouseholdRole,
  HouseholdSchema,
  headOf,
  isHouseholdRole,
  isMember,
  makeHousehold,
  memberIds,
  membersWithRole,
  roleOf,
  withHousehold,
} from './household.ts';
export type { Household, HouseholdInit, HouseholdMember, HouseholdRoleName } from './household.ts';

// Descent
export {
  MIN_PARENT_AGE_GAP,
  PARENT_ABSENCES,
  ParentAbsence,
  ParentRefSchema,
  ParentageSchema,
  absentParent,
  hasLivingRecordedParent,
  knownParent,
  knownParentsOf,
  makeParentage,
} from './kinship.ts';
export type { Parentage, ParentAbsenceName, ParentRef } from './kinship.ts';

// Generation
export {
  APPRENTICE_AGE,
  AgeRangeSchema,
  DEFAULT_HOUSEHOLD_TEMPLATES,
  HouseholdTemplateSchema,
  MAX_FOUNDING_AGE,
  MAX_RESIDENT_CHILD_AGE,
  RESIDENT_PARENT_AGE_GAP,
  generateHouseholdPlan,
  validateHouseholdTemplates,
} from './generate.ts';
export type {
  AgeRange,
  GenerateHouseholdPlanOptions,
  HouseholdPlan,
  HouseholdTemplate,
  PlannedMember,
  PlannedParent,
} from './generate.ts';

// The register
export { SocietyRegister, SocietySnapshotShape } from './register.ts';
export type { SocietySnapshot } from './register.ts';
export { HouseholdOrigin, HouseholdSystem, SocietyEvent } from './system.ts';
export type {
  FoundHouseholdOptions,
  GenerateHouseholdOptions,
  HouseholdOriginName,
  SocietyEventName,
} from './system.ts';

// Wiring
export { registerSocietyInvariants } from './invariants.ts';
export {
  SOCIETY_SAVE_MODULE_ID,
  SOCIETY_SAVE_MODULE_VERSION,
  installSociety,
  societySaveModule,
} from './save.ts';
