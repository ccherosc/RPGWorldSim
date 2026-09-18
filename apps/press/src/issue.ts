import {
  AnnalsStore,
  type Candidate,
  Casting,
  ChronicleDay,
  Community,
  type Edition,
  type Paper,
  PersonaBook,
  type PersonRecord,
  PortraitCatalog,
  type Post,
  type PublishedDay,
  Whereabouts,
  select,
  writePaper,
  writePosts,
} from '@rpgsim/chronicle';
import {
  type ArchiveManifest,
  type CalendarConfig,
  readArchiveManifest,
  readEventDay,
} from '@rpgsim/sim-core';
import {
  loadCalendar,
  loadCasting,
  loadCommunity,
  loadPaper,
  loadPersonas,
  loadPortraits,
  loadScoring,
  loadSelection,
  loadTemplates,
} from '@rpgsim/simulator';
import { assert } from '@rpgsim/shared';
import type { Publication } from './publication.ts';

/**
 * Reading a run of the village back as a stack of finished issues.
 *
 * The site is not a view onto a live simulation. It is printed from two things
 * left on disk by two earlier commands: the day archive (`sim run`) and the
 * distilled record (`sim annals`). This module turns those into the only shape
 * the pages know about -- one `Issue` per published day, already selected,
 * already written.
 *
 * The order matters and is the reason this is a single pass rather than a
 * per-day function the pages could call. `select` will not choose today's
 * writers without knowing who wrote on the days before, so the rota has to be
 * built forwards from the village's first day, exactly as it was built when the
 * day was new. Generating one page in isolation would give that page a
 * different set of writers than the archive page lists, and nothing would
 * notice.
 */

export interface Issue {
  readonly day: ChronicleDay;
  readonly edition: Edition;
  readonly paper: Paper;
  readonly posts: readonly Post[];
  readonly whereabouts: Whereabouts;
}

export interface Village {
  readonly calendar: CalendarConfig;
  readonly record: AnnalsStore;
  readonly issues: readonly Issue[];
  readonly casting: Casting;
  readonly portraits: PortraitCatalog;
  readonly personas: PersonaBook;
  readonly community: Community;
  /** Everybody the record knows, oldest first. */
  readonly people: readonly PersonRecord[];
  /** The word the whole village was built from. Printed in every colophon. */
  readonly worldSeed: string;
}

export interface ReadVillageOptions {
  /** Where `sim run --archive` wrote its days. */
  readonly archive: string;
  /** Where `sim annals --annals` wrote the record. */
  readonly annals: string;
  readonly publication: Publication;
  readonly dataRoot?: string;
  /**
   * Publish from an archive the run never closed.
   *
   * Off by default. A manifest is rewritten as each day lands, so an archive is
   * readable while it is still being written and "there is a manifest" does not
   * mean "the run finished". Printing a paper from the day a simulation died in
   * the middle of would produce a page that looks ordinary and is not.
   */
  readonly allowIncomplete?: boolean;
}

/** The writers a day chose, in the order the rota put them. */
export const postersOf = (edition: Edition): readonly string[] =>
  edition.posters.map((one: Candidate) => one.person.slug);

export function readVillage(options: ReadVillageOptions): Village {
  const root = options.dataRoot;
  const calendar = root === undefined ? loadCalendar() : loadCalendar(root);
  const scoring = root === undefined ? loadScoring() : loadScoring(root);
  const selection = root === undefined ? loadSelection() : loadSelection(root);
  const templates = root === undefined ? loadTemplates() : loadTemplates(root);
  const book = root === undefined ? loadPaper() : loadPaper(root);

  // The village's name comes from the families file, not from the masthead:
  // `community.json` is the one data file that already names the village for
  // the simulation's own purposes, so the paper's dateline and the site's
  // prose cannot drift apart by one of them being renamed.
  const community = new Community(root === undefined ? loadCommunity() : loadCommunity(root));

  const record = new AnnalsStore({ root: options.annals });
  const found = readArchiveManifest(options.archive);
  assert(found !== undefined, 'there is no archive to publish from', {
    archive: options.archive,
  });
  const manifest = found as ArchiveManifest;
  assert(
    manifest.complete || options.allowIncomplete === true,
    'that run never finished, so its last day may be half a day',
    { archive: options.archive },
  );

  const entries = manifest.days;
  assert(entries.length > 0, 'the archive has no days in it', { archive: options.archive });
  assert(record.places.size > 0, 'the record has no places, so it was never distilled', {
    annals: options.annals,
  });

  const published: PublishedDay[] = [];
  const issues: Issue[] = [];
  for (const entry of entries) {
    const day = new ChronicleDay({
      key: entry.key,
      events: readEventDay(options.archive, entry.key),
      people: record.people,
      places: record.places,
    });
    const edition = select({ day, scoring, selection, published });
    // The rota advances for every day the village lived, published or not.
    // Freezing the site must not change who writes when the freeze lifts.
    published.push({ key: day.key, posters: postersOf(edition) });
    if (!options.publication.publishes(day.key)) continue;

    const whereabouts = new Whereabouts(day);
    issues.push({
      day,
      edition,
      whereabouts,
      posts: writePosts(edition.posters, {
        day,
        whereabouts,
        scoring,
        templates,
        worldSeed: manifest.seed,
      }),
      paper: writePaper({
        day,
        headlines: edition.headlines,
        book,
        village: community.village,
        worldSeed: manifest.seed,
        calendar,
      }),
    });
  }

  assert(issues.length > 0, 'every day of the village is frozen, so there is nothing to publish', {
    frozenThrough: options.publication.config.frozenThrough,
  });

  return {
    calendar,
    record,
    worldSeed: manifest.seed,
    issues,
    community,
    casting: new Casting(root === undefined ? loadCasting() : loadCasting(root)),
    portraits: new PortraitCatalog(root === undefined ? loadPortraits() : loadPortraits(root)),
    personas: new PersonaBook(root === undefined ? loadPersonas() : loadPersonas(root)),
    people: record.people.records(),
  };
}

/** The newest published day. What the site means by "today". */
export const latestOf = (village: Village): Issue => {
  const last = village.issues[village.issues.length - 1];
  assert(last !== undefined, 'a village with no issues has no latest day', {});
  return last as Issue;
};
