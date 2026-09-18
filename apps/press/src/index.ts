// The press: everything the village has recorded, turned into a static website.
//
// Reads two directories and `data/`, writes HTML. It never advances a clock,
// never draws from an RNG, and never touches world state -- so the site is a
// pure function of the archive, the record and the wording files, and the same
// three inputs give the same site twice.

export { Publication, PublicationSchema, partsOf, villageDate } from './publication.ts';
export type {
  Page,
  PublicationConfig,
  Section,
  SiteImage,
  VillageDate,
} from './publication.ts';

export { DATA_ROOT, loadPublication } from './data.ts';

export {
  FROZEN_FILE,
  FrozenHistorySchema,
  checkFrozen,
  frozenPath,
  loadFrozenHistory,
  writeFrozenHistory,
} from './freeze.ts';
export type { FreezeCheck, FreezeReport, FrozenHistory } from './freeze.ts';

export { civilDays, daysBetween, daysToRun } from './schedule.ts';

export { attrs, el, indent, lines, p, page, picture, tag, text } from './html.ts';
export type { NavLink, Picture, Shell } from './html.ts';

export { latestOf, postersOf, readVillage } from './issue.ts';
export type { Issue, ReadVillageOptions, Village } from './issue.ts';

export { ASSET_ROOT, buildSite, listFiles, renderSite } from './site.ts';
export type { BuildSiteOptions, BuiltSite } from './site.ts';

export { WAYS, rootFor, sheet } from './pages/shell.ts';
export type { Built, Chrome, Sheet } from './pages/shell.ts';

export { main, parseArgs } from './cli.ts';
