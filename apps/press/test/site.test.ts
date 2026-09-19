import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { glanceOf, yearsBetween } from '@rpgsim/chronicle';
import { loadSelection, main as sim } from '@rpgsim/simulator';
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

/** Any tag: group 1 is the slash of a closing tag, group 2 the element name. */
const TAG = /<(\/?)([a-z0-9]+)[^>]*>/g;

/** Elements that never close, so they never open a level of nesting. */
const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source']);

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
      'turned away': truth.refused,
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

  it('never prints a tag as words a reader can see', () => {
    // The other half of the test above, and the one that actually fired. There
    // are two helpers: `el` escapes its content, because a village that names a
    // place `The Hare & Mug` must not be able to open a hole in the page, and
    // `tag` does not, because its content is already markup. Hand a finished
    // `<a>` to `el` and the escaping does exactly what it promises -- the link
    // is printed, correctly escaped, as the visible sentence `<a
    // href="../blog/1200-04-30.html">Read the day on the blog</a>`.
    //
    // Nothing above sees it. The markup is well-formed, every tag closes, the
    // stray-bracket test finds `&lt;` rather than `<`, and the link checker has
    // no link to check because there is no longer a link. It is only wrong to a
    // reader, so it is caught by reading: an escaped angle bracket with a tag
    // name behind it is a tag that should have been markup.
    for (const [path, body] of pages) {
      const printed = [...body.matchAll(/&lt;[/]?[a-z]+[ &>]/g)];
      expect(printed.map((one) => body.slice(one.index, (one.index ?? 0) + 50)), path).toEqual([]);
    }
  });

  it('closes every element it opens', () => {
    for (const [path, body] of pages) {
      const stack: string[] = [];
      for (const match of body.matchAll(TAG)) {
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

  it('keeps an illustrated section to two children, so a heading cannot be stranded', () => {
    // `.passage.illustrated` is a two-column grid, and a grid lays out the
    // *children* of the element it is set on. A section whose children are a
    // heading, two paragraphs and a figure therefore fills those columns in
    // reading order -- heading top-left, first sentence top-right, a hole
    // under the heading -- which is what the page did before the words were
    // wrapped. Nothing about that is a CSS bug and nothing in the stylesheet
    // can fix it, so the rule belongs to the markup: exactly two children, the
    // reading column and the picture.
    const OPEN = /<section class="passage illustrated">/g;
    let seen = 0;
    for (const [path, body] of pages) {
      for (const open of body.matchAll(OPEN)) {
        seen += 1;
        const children: string[] = [];
        let depth = 0;
        for (const match of body.slice((open.index ?? 0) + open[0].length).matchAll(TAG)) {
          const [, closing, name] = match as unknown as [string, string, string];
          if (VOID.has(name)) continue;
          if (closing !== '') {
            if (depth === 0) break; // the section's own closing tag
            depth -= 1;
          } else {
            if (depth === 0) children.push(name);
            depth += 1;
          }
        }
        expect(children, `${path}: section at ${open.index}`).toEqual(['div', 'figure']);
      }
    }
    expect(seen, 'no page has an illustrated section, so this scanned nothing').toBe(7);
  });
});

describe('the sentences', () => {
  it('never sets a capitalised article inside a sentence', () => {
    // `Abed at A cottage on Bridge Row.` -- eighty-five times, on the day this
    // was written. The record names a place as a whole noun phrase, article and
    // all, because that is what a heading and a table row want, and every one of
    // those lines was a true sentence about a real event. Nothing else could have
    // caught it: the fault is in the seam between a stored name and a sentence,
    // and no test of either half looks at the join.
    //
    // `packages/chronicle` tests the seam itself, one wording at a time. This
    // asks the finished pages, which is the only place the other way it happens
    // shows up -- somebody typing `Market day on The Green.` into a caption by
    // hand, which is exactly what the first run of this scan found, twice.
    //
    // Attributes are scanned as well as text. An `alt` line and a page
    // description are prose a reader can meet, and they are assembled by the same
    // code from the same names.
    //
    // Every tag ends a sentence, including an inline one. Reading across tags
    // instead was tried and is worse: the navigation is four links in a row, so
    // dropping the `<a>`s reads the menu as the sentence `Welcome The Chronicle
    // The Villagers The People` and the scan accuses the nav bar. Breaking
    // everywhere costs a sentence with a link in the middle of it, and the
    // sentences this is aimed at have no markup inside them -- a villager's post
    // is one text run inside one `span`, a paper story is one text run inside one
    // paragraph -- so nothing this was written for is read in halves.

    // A title the village gave something keeps its capital wherever it sits:
    // `every issue of The Pennycroft Chronicle`. Taken from the record rather
    // than spelt out here, so renaming the paper does not need this edited.
    const titles = [site.publication.masthead];

    const MID = /[a-z,;:)] (?:A|An|The) [A-Za-z]/;
    const READS = /[a-z] [a-z]/;

    // The shape, checked against the lines that prompted it before it is turned
    // on the site. A scan like this is a trap and not an assertion: once the
    // fault is fixed, narrowing the shape to half of what it should catch
    // changes nothing about a clean site, so nothing below would notice. These
    // five sentences notice.
    expect(MID.test('Abed at A cottage on Bridge Row.')).toBe(true);
    expect(MID.test('Market day on The Green.')).toBe(true);
    expect(MID.test('a lane, The Green and a mill')).toBe(true);
    expect(MID.test('Abed at a cottage on Bridge Row.')).toBe(false);
    expect(MID.test('The Green. Warm enough.')).toBe(false);

    // An exception has to be a name and not a word, or it excuses the fault
    // everywhere: `The` on this list turns the whole scan off.
    for (const title of titles) expect(title, 'not a whole name').toMatch(/^(?:A|An|The) \S+ /);
    let scanned = 0;
    let described = 0;
    let summarised = 0;
    for (const [path, body] of pages) {
      const alt = [...body.matchAll(/ alt="([^"]*)"/g)].map((one) => one[1] as string);
      const summary = [...body.matchAll(/ content="([^"]*)"/g)].map((one) => one[1] as string);
      described += alt.filter((one) => READS.test(one)).length;
      summarised += summary.filter((one) => READS.test(one)).length;
      for (const chunk of [...body.split(/<[^>]*>/), ...alt, ...summary]) {
        let words = chunk.replace(/\s+/g, ' ').trim();
        for (const title of titles) words = words.split(title).join(' ');
        if (READS.test(words)) scanned += 1;
        const found = MID.exec(words);
        const context =
          found === null ? undefined : words.slice(Math.max(0, found.index - 40), found.index + 40);
        expect(context, path).toBeUndefined();
      }
    }
    // Counted as well as scanned, and the two halves counted apart. Tag-stripping
    // that went wrong would hand this loop nothing to read and every assertion
    // above would pass; and nothing on the site has this fault in an attribute
    // today, so without a count of its own the attribute half could quietly read
    // nothing and no mutant would ever prove otherwise.
    expect(scanned, 'no prose anywhere, so this scanned nothing').toBeGreaterThan(pages.size * 5);
    expect(described, 'no alt text was read').toBeGreaterThan(pages.size);
    expect(summarised, 'no page description was read').toBeGreaterThanOrEqual(pages.size);
  });
});

describe('how the site writes about people', () => {
  /** An age band and a recorded sex, printed side by side and untranslated. */
  const RAW = /\d+, (infant|child|youth|young|adult|older|elder) (male|female)/;

  it('never prints an age band or the record spelling of sex', () => {
    // Both are the site's own working vocabulary and neither is English. The
    // bands are art direction for the portrait sheets and `female` is how the
    // people file spells it, and side by side they read `7, child female` --
    // which is what stood under every name on this site until the lookup
    // meant to translate them was found to be keyed on `m` and `f`, values
    // the record has never used. Nothing failed, because nothing looked.
    for (const [path, body] of pages) {
      expect(body.match(RAW)?.[0], path).toBeUndefined();
    }
  });

  it('gives every person a description a reader would say out loud', () => {
    const people = [...pages].filter(([path]) => path.startsWith('people/') && path !== 'people/index.html');
    expect(people.length, 'no person pages to check').toBeGreaterThan(20);
    // `[1-9]\d*` rather than `\d+`, which is the other half of this test: an
    // age of nought is a real age -- Walter Webb was born inside the last
    // village year -- and `0, a boy` reads as a form nobody filled in. The
    // youngest people on the roll are described without a number instead.
    const SAID = /<p class="lead">(?:[1-9]\d*, a (?:boy|girl|young man|young woman|man|woman)|a baby (?:boy|girl))<\/p>/;
    for (const [path, body] of people) {
      expect(body, path).toMatch(SAID);
    }
  });

  it('sets out habits and cares as the sentences they were written as', () => {
    // The persona book stores each of them split on its commas, which is why
    // the first phrase carries a capital and none of the rest do. Printed as
    // separate lines they read as fragments of something cut in half. Joined
    // back up each one is a sentence, and a sentence ends like one.
    const asked = /<h3>(Habits|Cares about)<\/h3>/g;
    const written = /<h3>(Habits|Cares about)<\/h3>\s*<p>([^<]+)<\/p>/g;
    let seen = 0;
    for (const [path, body] of pages) {
      for (const match of body.matchAll(written)) {
        seen += 1;
        const [, heading, words] = match as unknown as [string, string, string];
        expect(words, `${path}: ${heading}`).toMatch(/[^,]\.$/);
      }
      // Counted as well as matched: a page that went back to setting these out
      // as a list would match nothing here and pass a test that only counted
      // what it found.
      expect([...body.matchAll(written)], `${path}: a heading with no sentence under it`).toHaveLength(
        [...body.matchAll(asked)].length,
      );
    }
    expect(seen, 'no persona described anywhere, so this scanned nothing').toBeGreaterThan(40);
  });

  it('keeps the website out of the record it prints', () => {
    // A person's page is named after their slug, so the slug is in the URL of
    // every link to them and cannot be scanned for. What it must not be is a
    // row in `What the record knows`, beside their birth and their family, as
    // though the village had given them a file name.
    for (const [path, body] of pages) {
      expect(body, path).not.toContain('<dt>Slug</dt>');
    }
  });

  it('never lets the persona prose state an age, because the record states it', () => {
    // Every persona was written against a drawn face, so every `look` line
    // ended by saying how old the face looked -- `Red braids, freckles, eyes
    // wide and guileless. Eight.` The record says it too, worked out from a
    // birth date on the newest published day, and it said `7, a girl` two
    // inches above. Fifty-seven of the eighty-six pages printed two different
    // ages, every one of them off by exactly one, and the disagreement was
    // going to spread to all of them and then keep growing: the village ages a
    // day per real day and a sentence in a JSON file does not.
    //
    // Directive 12 settles which one is wrong. The record is authoritative and
    // the persona book is advisory, so the prose is what gives way. It says
    // what somebody looks like and the record says how old they are.
    //
    // Counts survive, which is why this does not simply ban number words:
    // `Four sons.`, `three teeth` and `one eyebrow up` are facts about a
    // person that do not rot. Two things separate those from an age.
    //
    // A count in this book is always small -- nobody has thirteen of anything
    // -- so any number from thirteen up is an age wherever it sits, which is
    // what catches `Forty-two, always at the water` and would catch it woven
    // anywhere else in the sentence. Below thirteen a count and an age look
    // alike, so what is banned there is the shapes only an age is written in:
    // a number opening a sentence, a number handed straight to `and`, the
    // spelled-out `four years old`, and a comparison against one, which is
    // where `much older than seven` was hiding in a `voice` line.
    const SECTION = /<h2>How they come across<\/h2>([\s\S]*?)<\/section>/g;
    const SMALL =
      '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
    const BIG =
      '(?:thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen' +
      '|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)';
    const AGE = [
      `\\b(${BIG})\\b`,
      `^(${SMALL})[.,]`,
      `^(${SMALL}) and\\b`,
      `\\b(${SMALL}|${BIG})[- ]years?[- ]old\\b`,
      `\\b(?:older|younger|more) than (${SMALL}|${BIG})\\b`,
    ];
    const shapes = AGE.map((one) => new RegExp(one, 'i'));

    let seen = 0;
    for (const [path, body] of pages) {
      for (const [, inner] of body.matchAll(SECTION)) {
        seen += 1;
        // Read as prose, not as markup: `<p>` between two sentences is a
        // sentence boundary, and a shape is only an age if it opens one.
        const words = (inner as string).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        for (const sentence of words.split(/(?<=\.) /)) {
          for (const shape of shapes) {
            expect(shape.exec(sentence.trim())?.[1], `${path}: ${sentence}`).toBeUndefined();
          }
        }
      }
    }
    // Counted as well as scanned: a page that stopped printing the persona at
    // all would satisfy every check above without anybody noticing.
    expect(seen, 'no persona prose anywhere, so this scanned nothing').toBeGreaterThan(80);
  });
});

describe('who the site lets write', () => {
  const { writingAge } = loadSelection();
  const latest = (): string => {
    const last = site.village.issues[site.village.issues.length - 1];
    expect(last).toBeDefined();
    return (last as { day: { key: string } }).day.key;
  };

  it('has small children in the village, so the rest of this is not vacuous', () => {
    const young = site.village.people.filter(
      (person) => yearsBetween(person.born, latest()) < writingAge,
    );
    expect(young.length).toBeGreaterThan(5);
  });

  it('gives a byline to nobody too young to have written it', () => {
    // The rota is tested where the rota lives. This is the other end of the
    // pipe: a poster is not only a post, they are a name under `Who wrote
    // today` and a byline on their own page, and this is the last place the
    // rule can be checked before a reader sees it.
    let bylines = 0;
    for (const issue of site.village.issues) {
      for (const candidate of issue.edition.posters) {
        expect(
          yearsBetween(candidate.person.born, issue.day.key),
          `${candidate.person.slug} on ${issue.day.key}`,
        ).toBeGreaterThanOrEqual(writingAge);
      }
      for (const post of issue.posts) {
        expect(
          yearsBetween(post.author.born, issue.day.key),
          `${post.author.slug} on ${issue.day.key}`,
        ).toBeGreaterThanOrEqual(writingAge);
        bylines++;
      }
    }
    expect(bylines).toBeGreaterThan(DAYS);
  });

  it('still gets the little ones onto a page, in a parent’s words', () => {
    // Keeping children off the rota takes a quarter of the village out of the
    // blog, and this is the sentence that says it did not take them out of the
    // site. Checked against the printed markup rather than against the post,
    // because a line that never reached a page is a line nobody reads.
    const mentions = site.village.issues
      .flatMap((issue) => issue.posts)
      .flatMap((post) => post.lines)
      .filter((line) => line.about !== undefined);

    expect(mentions.length).toBeGreaterThan(0);
    for (const line of mentions) {
      const printed = [...pages.values()].some((body) => body.includes(text(line.text)));
      expect(printed, line.text).toBe(true);
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
