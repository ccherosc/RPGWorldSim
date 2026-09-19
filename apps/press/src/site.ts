import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert } from '@rpgsim/shared';
import { type Village, latestOf, readVillage } from './issue.ts';
import { loadPublication } from './data.ts';
import { villageDate } from './publication.ts';
import type { Publication, VillageTally } from './publication.ts';
import { aboutPage } from './pages/about.ts';
import { blogArchive, blogDay, blogLatest } from './pages/blog.ts';
import { homePage } from './pages/home.ts';
import { paperArchive, paperIssue, paperLatest } from './pages/paper.ts';
import { peopleRoll, personPage } from './pages/people.ts';
import { mapPage, townePage } from './pages/towne.ts';
import type { Built, Chrome } from './pages/shell.ts';

/**
 * The whole site, built in memory and then written out.
 *
 * Built first and written second on purpose. A generator that writes as it goes
 * leaves half a site behind when a page throws, and half a site is worse than
 * none: the pages that did get written look finished. Here, either every page
 * assembled or nothing was touched.
 *
 * Nothing about the machine that ran this reaches the output. The pages are a
 * function of the archive, the record and `data/`, which is what makes the site
 * reproducible -- and it is also a privacy property, since the alternative is a
 * public page carrying somebody's home directory in a build stamp.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** `<repo>/assets/site`, the images and the stylesheet, resolved from this module. */
export const ASSET_ROOT = resolve(HERE, '..', '..', '..', 'assets', 'site');

export interface BuildSiteOptions {
  readonly archive: string;
  readonly annals: string;
  /** Where the site is written. Emptied first. */
  readonly out: string;
  readonly dataRoot?: string;
  readonly assetRoot?: string;
  readonly allowIncomplete?: boolean;
}

export interface BuiltSite {
  readonly pages: readonly Built[];
  readonly assets: readonly string[];
  readonly village: Village;
  readonly publication: Publication;
}

/** Every page of the site, assembled but not yet on disk. */
export function renderSite(chrome: Chrome): readonly Built[] {
  const pages: Built[] = [homePage(chrome), townePage(chrome), mapPage(chrome), aboutPage(chrome)];

  pages.push(paperLatest(chrome), paperArchive(chrome));
  pages.push(blogLatest(chrome), blogArchive(chrome));
  for (let at = 0; at < chrome.village.issues.length; at += 1) {
    pages.push(paperIssue(chrome, at), blogDay(chrome, at));
  }

  pages.push(peopleRoll(chrome));
  for (const person of chrome.village.people) pages.push(personPage(chrome, person));

  const seen = new Set<string>();
  for (const built of pages) {
    assert(!seen.has(built.path), 'two pages want the same file', { path: built.path });
    seen.add(built.path);
  }
  return pages;
}

export function buildSite(options: BuildSiteOptions): BuiltSite {
  const publication = loadPublication(options.dataRoot);
  const village = readVillage({
    archive: options.archive,
    annals: options.annals,
    publication,
    dataRoot: options.dataRoot,
    allowIncomplete: options.allowIncomplete,
  });

  const latest = latestOf(village);
  // The copy gets its counts here, once, from the village that was just read.
  // Every page below this line is looking at the same numbers as every other.
  const counted = publication.counting(tallyOf(village));
  const chrome: Chrome = {
    publication: counted,
    village,
    latest,
    today: villageDate(latest.day.key, village.calendar),
  };

  const pages = renderSite(chrome);

  const assetRoot = options.assetRoot ?? ASSET_ROOT;
  const assets = listFiles(assetRoot);
  assert(assets.length > 0, 'there are no site assets to copy', { assetRoot });

  // Emptied rather than merged: a page renamed in the generator would otherwise
  // stay on the site for ever, and a stale page is indistinguishable from a
  // current one to a reader.
  rmSync(options.out, { recursive: true, force: true });
  for (const built of pages) {
    const path = join(options.out, built.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, built.html, 'utf8');
  }
  for (const relative of assets) {
    const path = join(options.out, 'assets', relative);
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(join(assetRoot, relative), path);
  }
  // GitHub Pages runs Jekyll over the output unless told not to, and Jekyll
  // drops every directory whose name starts with an underscore. Nothing here
  // starts with one today; the file costs nothing and removes the trap.
  writeFileSync(join(options.out, '.nojekyll'), '', 'utf8');

  return { pages, assets, village, publication: counted };
}

/**
 * The three counts the prose is allowed to state.
 *
 * Families are counted the way the People page groups them, off
 * `PersonRecord.family`, so the sentence and the list under it can never
 * disagree. Somebody with no family name is nobody's family, and is left out of
 * the count rather than gathered into an imaginary twenty-first one.
 */
export function tallyOf(village: Village): VillageTally {
  const families = new Set<string>();
  for (const person of village.people) {
    if (person.family !== null) families.add(person.family);
  }
  return { people: village.people.length, households: village.households, families: families.size };
}

/** Every file under a directory, relative, with forward slashes, sorted. */
export function listFiles(root: string): readonly string[] {
  const out: string[] = [];
  const walk = (at: string, prefix: string): void => {
    const entries = readdirSync(at).sort();
    for (const name of entries) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
      else out.push(`${prefix}${name}`);
    }
  };
  walk(root, '');
  return out;
}
