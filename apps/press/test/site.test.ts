import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { glanceOf } from '@rpgsim/chronicle';
import { main as sim } from '@rpgsim/simulator';
import { text } from '../src/html.ts';
import { villageDate } from '../src/publication.ts';
import { buildSite, listFiles } from '../src/site.ts';
import type { BuiltSite } from '../src/site.ts';

/**
 * The whole site, built from a real village, checked as a website.
 *
 * The three questions here cannot be answered by unit tests, and each of them
 * is a way the site could be badly wrong while every other test passed.
 *
 * **Does it leak?** `docs/CHRONICLE.md` is explicit: the site publishes world
 * state, never repository state, secrets, or anything about the machine that
 * ran it. That is a promise about output, so it is tested against the output --
 * every text file, scanned for this repository's path, this user's home
 * directory, anything email-shaped and the value of every environment variable
 * the build could see. It passes today because nothing reads a clock or an
 * environment; the point of the test is the day somebody adds a build stamp.
 *
 * **Do the links work?** There is no server and no link checker in the way, so
 * a renamed page is a 404 nobody finds until a reader does. Every `href`,
 * `src` and `srcset` candidate on every page is resolved against the files
 * actually written.
 *
 * **Are the numbers true?** Every figure on a paper page is recomputed here by
 * calling `glanceOf` on the day again, and every `§id` beside a sentence is
 * checked against the ids of the events that day actually produced. A page that
 * cites an event that does not exist is fiction wearing a citation.
 *
 * Six days rather than thirty: the questions above are about shape, and six
 * days give an archive with a middle, a first page with no previous issue and a
 * last page with no next one. Nothing here touches the repository's own archive.
 */

const DAYS = 6;
const SEED = 'world-zero';

let root: string;
let site: BuiltSite;
let out: string;
let files: readonly string[];
let archive: string;

/** Page bodies by their path below the site root, forward slashes. */
const pages = new Map<string, string>();

const TEXT = /\.(html|css|svg|json|txt|xml)$/;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'press-site-'));
  archive = join(root, 'archive');
  const annals = join(root, 'annals');
  out = join(root, 'site');

  const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    expect(sim(['run', '--seed', SEED, '--days', String(DAYS), '--every', '0', '--archive', archive])).toBe(0);
    expect(sim(['annals', '--archive', archive, '--annals', annals])).toBe(0);
  } finally {
    quiet.mockRestore();
  }

  site = buildSite({ archive, annals, out });
  files = listFiles(out);
  for (const built of site.pages) pages.set(built.path, built.html);
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const html = (path: string): string => {
  const found = pages.get(path);
  expect(found, path).toBeDefined();
  return found as string;
};

/** Everything between tags, with entities left alone. */
const stripped = (markup: string): string => markup.replace(/<[^>]*>/g, ' ');

describe('the shape of the site', () => {
  it('writes one page for every day the village lived', () => {
    expect(site.village.issues).toHaveLength(DAYS);
    for (const issue of site.village.issues) {
      expect(pages.has(`paper/${issue.day.key}.html`), issue.day.key).toBe(true);
      expect(pages.has(`blog/${issue.day.key}.html`), issue.day.key).toBe(true);
    }
  });

  it('writes the landing pages the navigation points at', () => {
    for (const path of [
      'index.html',
      'about.html',
      'towne.html',
      'map.html',
      'paper/index.html',
      'paper/archive.html',
      'blog/index.html',
      'blog/archive.html',
      'people/index.html',
    ]) {
      expect(pages.has(path), path).toBe(true);
    }
  });

  it('writes one page for every person on the record, and no more', () => {
    const people = [...pages.keys()].filter(
      (path) => path.startsWith('people/') && path !== 'people/index.html',
    );
    expect(people).toHaveLength(site.village.people.length);
    for (const person of site.village.people) {
      expect(pages.has(`people/${person.slug}.html`), person.slug).toBe(true);
    }
  });

  it('puts every page and every asset on disk, and nothing else', () => {
    // The generator builds in memory and writes afterwards, so a page that was
    // built and not written -- or written and not built -- is a real bug.
    const written = new Set(files);
    for (const path of pages.keys()) expect(written.has(path), path).toBe(true);
    for (const asset of site.assets) expect(written.has(`assets/${asset}`), asset).toBe(true);
    expect(files).toHaveLength(pages.size + site.assets.length + 1);
    expect(written.has('.nojekyll')).toBe(true);
  });

  it('empties the output before writing, so a renamed page cannot linger', () => {
    // A stale page is indistinguishable from a current one to a reader, so the
    // output is emptied rather than merged. Planted here on purpose: a
    // generator that merged would leave this file sitting on the live site.
    const stale = join(out, 'paper', 'ghost.html');
    writeFileSync(stale, '<p>a page that no longer exists</p>', 'utf8');
    expect(statSync(stale).isFile()).toBe(true);

    buildSite({ archive, annals: join(root, 'annals'), out });
    expect(() => statSync(stale)).toThrow();
    expect(listFiles(out)).toEqual(files);
  });

  it('gives every page a title, one first-level heading and the same dateline', () => {
    // Every page carries the newest published day, so no page can disagree
    // with the rest of the site about what day it is.
    const newest = site.village.issues[DAYS - 1]?.day.key as string;
    const dateline = villageDate(newest, site.village.calendar).full;
    expect(dateline).toContain('in the year of our Lord');

    for (const [path, body] of pages) {
      expect(body.startsWith('<!doctype html>'), path).toBe(true);
      expect([...body.matchAll(/<h1[ >]/g)], path).toHaveLength(1);
      expect(body, path).toMatch(/<title>[^<]+<\/title>/);
      expect(/<p class="dateline">([^<]+)<\/p>/.exec(body)?.[1], path).toBe(dateline);
      expect([...body.matchAll(/aria-current="page"/g)].length, path).toBe(1);
    }
  });
});

describe('what the site must never publish', () => {
  /** Every text file on the site, as one body per file. */
  const texts = (): readonly (readonly [string, string])[] =>
    files.filter((file) => TEXT.test(file)).map((file) => [file, readFileSync(join(out, file), 'utf8')] as const);

  const scan = (needles: readonly (readonly [string, string])[]): void => {
    const found: string[] = [];
    for (const [file, body] of texts()) {
      for (const [what, needle] of needles) {
        if (needle.length === 0) continue;
        if (body.toLowerCase().includes(needle.toLowerCase())) found.push(`${file}: ${what}`);
      }
    }
    expect(found).toEqual([]);
  };

  it('scans something, so a passing scan means something', () => {
    const scanned = texts();
    expect(scanned.length).toBeGreaterThan(20);
    expect(scanned.some(([file]) => file.endsWith('.html'))).toBe(true);
    expect(scanned.some(([file]) => file.endsWith('.css'))).toBe(true);
  });

  it('never names the repository, the checkout or the build machine', () => {
    const repo = resolve(dirname(new URL(import.meta.url).pathname.slice(1)), '..', '..', '..');
    scan([
      ['the repository path', repo],
      ['the repository path, posix', repo.split('\\').join('/')],
      ['the home directory', homedir()],
      ['the home directory, posix', homedir().split('\\').join('/')],
      ['the temporary directory', tmpdir()],
      ['node_modules', 'node_modules'],
      ['a windows drive path', 'C:\\'],
    ]);
  });

  it('never carries an environment value', () => {
    // Any of these could arrive on a page through a build stamp or a stray
    // interpolation, and a public page carrying a CI token is the worst version
    // of that mistake. Short values are skipped: they collide with prose.
    const needles: [string, string][] = [];
    for (const [name, value] of Object.entries(process.env)) {
      if (value === undefined || value.length < 8) continue;
      needles.push([`$${name}`, value]);
    }
    expect(needles.length).toBeGreaterThan(5);
    scan(needles);
  });

  it('never carries anything shaped like an email address', () => {
    const shaped = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    for (const [file, body] of texts()) {
      const match = shaped.exec(body);
      expect(match?.[0], file).toBeUndefined();
    }
  });

  it('asks nothing of any other machine', () => {
    for (const [file, body] of texts()) {
      if (file.endsWith('.svg')) continue;
      expect(body, file).not.toContain('http://');
      expect(body, file).not.toContain('https://');
      expect(body, file).not.toContain('<script');
      expect(body, file).not.toContain('@import');
    }
  });

  it('does print the seed, which is world state and the point', () => {
    // Named so the allowance above is deliberate rather than an oversight: the
    // seed is the one string a reader needs to rebuild the village themselves.
    expect(html('about.html')).toContain(SEED);
    expect(site.village.worldSeed).toBe(SEED);
  });
});

describe('the links', () => {
  /** Every local reference on a page, as a path relative to the site root. */
  function targets(path: string, body: string): readonly string[] {
    const from = posix.dirname(path);
    const out: string[] = [];
    const add = (raw: string): void => {
      if (raw.startsWith('#') || raw.startsWith('mailto:')) return;
      const [bare] = raw.split('#');
      out.push(posix.normalize(posix.join(from, bare ?? raw)));
    };
    for (const match of body.matchAll(/(?:href|src)="([^"]+)"/g)) add(match[1] as string);
    for (const match of body.matchAll(/srcset="([^"]+)"/g)) {
      for (const candidate of (match[1] as string).split(',')) {
        const [url] = candidate.trim().split(/\s+/);
        if (url !== undefined && url.length > 0) add(url);
      }
    }
    return out;
  }

  it('points every reference at a file that exists', () => {
    const written = new Set(files);
    const broken: string[] = [];
    let checked = 0;
    for (const [path, body] of pages) {
      for (const target of targets(path, body)) {
        checked += 1;
        if (!written.has(target)) broken.push(`${path} -> ${target}`);
      }
    }
    expect(checked).toBeGreaterThan(pages.size * 5);
    expect(broken).toEqual([]);
  });

  it('never climbs above the site root', () => {
    for (const [path, body] of pages) {
      for (const target of targets(path, body)) {
        expect(target.startsWith('..'), `${path} -> ${target}`).toBe(false);
      }
    }
  });

  it('is reachable: every page is linked from at least one other page', () => {
    const linked = new Set<string>();
    for (const [path, body] of pages) for (const target of targets(path, body)) linked.add(target);
    const orphans = [...pages.keys()].filter((path) => !linked.has(path));
    expect(orphans).toEqual([]);
  });

  it('links each issue to its neighbours and nowhere else', () => {
    const keys = site.village.issues.map((issue) => issue.day.key);
    for (let at = 0; at < keys.length; at += 1) {
      for (const where of ['paper', 'blog']) {
        const body = html(`${where}/${keys[at]}.html`);
        const prev = at === 0 ? undefined : `${where}/${keys[at - 1]}.html`;
        const next = at === keys.length - 1 ? undefined : `${where}/${keys[at + 1]}.html`;
        expect(body.includes('rel="prev"'), `${where} ${keys[at]} prev`).toBe(prev !== undefined);
        expect(body.includes('rel="next"'), `${where} ${keys[at]} next`).toBe(next !== undefined);
        if (prev !== undefined) expect(body).toContain(`href="../${prev}"`);
        if (next !== undefined) expect(body).toContain(`href="../${next}"`);
      }
    }
  });

  it('lists every issue on the archive pages', () => {
    for (const where of ['paper', 'blog']) {
      const body = html(`${where}/archive.html`);
      for (const issue of site.village.issues) {
        expect(body, `${where} ${issue.day.key}`).toContain(`href="../${where}/${issue.day.key}.html"`);
      }
    }
  });

  it('uses every illustration it ships', () => {
    const used = new Set<string>();
    for (const body of pages.values()) {
      for (const match of body.matchAll(/assets\/images\/([a-z0-9-]+)\.webp/g)) {
        used.add((match[1] as string).replace(/-small$/, ''));
      }
    }
    for (const image of site.publication.config.images) {
      expect(used.has(image.name), image.name).toBe(true);
    }
  });
});

describe('the numbers and the citations', () => {
  /** The six figures out of a paper page's glance table, by row heading. */
  function tally(body: string): Record<string, number> {
    const table = /<table class="glance">([\s\S]*?)<\/table>/.exec(body);
    expect(table).not.toBeNull();
    const out: Record<string, number> = {};
    for (const row of (table?.[1] as string).matchAll(
      /<th scope="row">([^<]+)<\/th>\s*<td>(\d+)<\/td>/g,
    )) {
      out[row[1] as string] = Number(row[2]);
    }
    return out;
  }

  it('prints the figures the day actually produced, on every issue', () => {
    for (const issue of site.village.issues) {
      // Recomputed by calling `glanceOf` on the day again rather than reading
      // back `issue.paper.glance`, so a page that printed the wrong field --
      // families where places belongs -- fails here.
      const truth = glanceOf(issue.day);
      const printed = tally(html(`paper/${issue.day.key}.html`));
      expect(printed, issue.day.key).toEqual({
        Souls: truth.souls,
        Families: truth.families,
        Places: truth.places,
        Abed: truth.abed,
        Journeys: truth.journeys,
        'Turned away': truth.refused,
      });
    }
  });

  it('shows the newest day on the paper index and the welcome page', () => {
    // Weaker than it reads, and worth knowing why: every day of Phase 1
    // produces the identical Glance, because nobody is born, nobody dies and
    // everybody walks the same round. So a page that printed the *first* day's
    // figures instead of the newest would pass this until births land.
    const newest = site.village.issues[DAYS - 1];
    const truth = glanceOf((newest as { day: Parameters<typeof glanceOf>[0] }).day);
    expect(tally(html('paper/index.html'))).toEqual(tally(html(`paper/${newest?.day.key}.html`)));

    const counts = /<ul class="counts">([\s\S]*?)<\/ul>/.exec(html('index.html'));
    const shown = [...(counts?.[1] as string).matchAll(/<strong>(\d+)<\/strong>\s*<span>([^<]+)<\/span>/g)];
    expect(Object.fromEntries(shown.map((one) => [one[2] as string, Number(one[1])]))).toEqual({
      souls: truth.souls,
      families: truth.families,
      places: truth.places,
      'journeys walked': truth.journeys,
      'turned away at the door': truth.refused,
    });
  });

  /** Every `§id` group on a page, in the order they appear. */
  const citations = (body: string): readonly (readonly number[])[] =>
    [...body.matchAll(/<span class="cite">([^<]*)<\/span>/g)].map((one) =>
      (one[1] as string).split(' ').map((id) => Number(id.replace('§', ''))),
    );

  it('prints beside each sentence the exact events that sentence rests on', () => {
    // Not "an id that exists": the ids run in sequence across the whole day, so
    // an off-by-one lands on a real event most of the time and a test that only
    // asked whether the id was real would pass. The list has to match.
    let stories = 0;
    for (const issue of site.village.issues) {
      const wanted = (issue.paper.review ?? [])
        .map((one) => one.sources)
        .filter((sources) => sources.length > 0);
      expect(citations(html(`paper/${issue.day.key}.html`)), issue.day.key).toEqual(wanted);
      stories += wanted.length;

      const said = issue.posts
        .flatMap((post) => post.lines.map((one) => one.sources))
        .filter((sources) => sources.length > 0);
      expect(citations(html(`blog/${issue.day.key}.html`)), issue.day.key).toEqual(said);
      stories += said.length;
    }
    expect(stories).toBeGreaterThan(DAYS);
  });

  it('cites only events the day really produced', () => {
    // The honesty check behind the one above: a citation is worth nothing if
    // the chronicle can hand the page an id the archive does not contain.
    for (const issue of site.village.issues) {
      const real = new Set(issue.day.events.map((event) => event.id));
      expect(real.size).toBeGreaterThan(0);
      for (const where of ['paper', 'blog']) {
        const body = html(`${where}/${issue.day.key}.html`);
        const cited = [...body.matchAll(/§(\d+)/g)].map((one) => Number(one[1]));
        expect(cited.length, `${where} ${issue.day.key}`).toBeGreaterThan(0);
        for (const id of cited) {
          expect(real.has(id), `${where} ${issue.day.key} cites §${id}`).toBe(true);
        }
      }
    }
  });

  it('counts the places it lists', () => {
    const body = html('towne.html');
    const total = site.village.record.places.size;
    expect(body).toContain(`${total} places, as of`);

    let listed = 0;
    for (const row of body.matchAll(/<th scope="row">([^<]*)<\/th>/g)) {
      const repeats = /\((\d+) of them\)$/.exec(row[1] as string);
      listed += repeats === null ? 1 : Number(repeats[1]);
    }
    expect(listed).toBe(total);
  });

  it('leaves the cottages off the map legend and keeps everything else on it', () => {
    // Two dozen places are all called `A cottage on Church Lane`, so a legend
    // that listed them would be two dozen identical lines and nothing else.
    const legend = /<ul class="stack legend">([\s\S]*?)<\/ul>/.exec(html('map.html'));
    const names = [...(legend?.[1] as string).matchAll(/<strong>([^<]+)<\/strong>/g)].map(
      (one) => one[1] as string,
    );
    const places = site.village.record.places.records();
    // Escaped on the way in, which is not incidental: the village already
    // named a church `St Ealdwin's`, so the apostrophe is being handled here
    // against a real name rather than a hypothetical one.
    expect(names.sort()).toEqual(
      places
        .filter((place) => place.type !== 'dwelling')
        .map((place) => text(place.name))
        .sort(),
    );
    expect(names).toContain('St Ealdwin&#39;s');
    expect(names.length).toBeLessThan(places.length);
    expect(names.length).toBeGreaterThan(5);
  });

  it('agrees with itself about how many days there are', () => {
    expect(html('about.html')).toContain(`<dt>Days published</dt>\n  <dd>${DAYS}</dd>`);
    expect(html('paper/archive.html')).toContain(`${DAYS} issues`);
  });
});

describe('the markup', () => {
  it('escapes every ampersand it prints', () => {
    // A bare '&' is the visible end of a missing escape, and the village names
    // its own places, so the next name with an '&' in it must not open a hole.
    for (const [path, body] of pages) {
      const bare = [...body.matchAll(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g)];
      expect(bare.map((one) => body.slice(one.index, (one.index ?? 0) + 20)), path).toEqual([]);
    }
  });

  it('leaves no stray angle bracket in the text of a page', () => {
    for (const [path, body] of pages) {
      expect(stripped(body), path).not.toContain('<');
      expect(stripped(body), path).not.toContain('>');
    }
  });

  it('closes every element it opens', () => {
    const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source']);
    for (const [path, body] of pages) {
      const stack: string[] = [];
      for (const match of body.matchAll(/<(\/?)([a-z0-9]+)[^>]*>/g)) {
        const [, closing, name] = match as unknown as [string, string, string];
        if (name === '!doctype' || VOID.has(name)) continue;
        if (closing === '') stack.push(name);
        else expect(stack.pop(), `${path}: </${name}>`).toBe(name);
      }
      expect(stack, path).toEqual([]);
    }
  });

  it('names a language and a character set on every page', () => {
    for (const [path, body] of pages) {
      expect(body, path).toContain('<html lang="en">');
      expect(body, path).toContain('<meta charset="utf-8">');
    }
  });

  it('gives every image alt text', () => {
    for (const [path, body] of pages) {
      for (const img of body.matchAll(/<img[^>]*>/g)) {
        expect(img[0], path).toMatch(/ alt="[^"]/);
      }
    }
  });
});

describe('building twice', () => {
  it('gives byte-identical pages, because nothing here reads a clock', () => {
    const again = buildSite({ archive, annals: join(root, 'annals'), out: join(root, 'again') });
    expect(again.pages.map((one) => one.path)).toEqual(site.pages.map((one) => one.path));
    for (let at = 0; at < again.pages.length; at += 1) {
      expect(again.pages[at]?.html, again.pages[at]?.path).toBe(site.pages[at]?.html);
    }
  });
});
