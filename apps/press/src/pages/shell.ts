import { yearsBetween } from '@rpgsim/chronicle';
import type { PersonRecord } from '@rpgsim/chronicle';
import { el, lines, page, picture, tag, text } from '../html.ts';
import type { NavLink } from '../html.ts';
import type { Publication, Section, VillageDate } from '../publication.ts';
import { villageDate } from '../publication.ts';
import type { Issue, Village } from '../issue.ts';

/**
 * The furniture every page shares, and the two things every page needs.
 *
 * A page builder gets a `Chrome` and returns a `Built`. It does not know where
 * on disk it will land, what the other pages are called, or how deep its own
 * directory is -- `site.ts` tells it, so there is one place that knows the
 * shape of the tree and one place that can get a link wrong.
 */

export interface Chrome {
  readonly publication: Publication;
  readonly village: Village;
  /** The newest published day. Every page's dateline. */
  readonly today: VillageDate;
  readonly latest: Issue;
}

export interface Built {
  /** Path below the site root, using forward slashes. */
  readonly path: string;
  readonly html: string;
}

/** Every page of the site, in the order the navigation lists them. */
export const WAYS: readonly NavLink[] = [
  { href: 'index.html', label: 'Welcome' },
  { href: 'paper/index.html', label: 'The Chronicle' },
  { href: 'blog/index.html', label: 'The Villagers' },
  { href: 'people/index.html', label: 'The People' },
  { href: 'towne.html', label: 'The Towne' },
  { href: 'map.html', label: 'The Map' },
  { href: 'about.html', label: 'About' },
];

/** `''` at the root, `'../'` one directory down, and so on. */
export const rootFor = (path: string): string => '../'.repeat(path.split('/').length - 1);

export interface Sheet {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  /** Which navigation entry to mark as the current page. */
  readonly here: string;
  readonly body: string;
}

/** Wrap a page body in the site's document. */
export function sheet(chrome: Chrome, spec: Sheet): Built {
  const root = rootFor(spec.path);
  return {
    path: spec.path,
    html: page({
      title: spec.title,
      description: spec.description,
      masthead: chrome.publication.masthead,
      tagline: chrome.publication.tagline,
      dateline: chrome.today.full,
      nav: WAYS.map((way) => (way.href === spec.here ? { ...way, here: true } : way)),
      footer: chrome.publication.footer,
      root,
      body: spec.body,
    }),
  };
}

/** The title block at the top of a page body. */
export const opening = (title: string, lead: string): string =>
  tag('div', lines([el('h1', title), el('p', lead, { class: 'lead' })]), { class: 'opening' });

/** One prose section out of `publication.json`, with its illustration if it has one. */
export function prose(chrome: Chrome, section: Section, root: string): string {
  const words = lines([el('h2', section.heading), ...section.body.map((one) => el('p', one))]);
  if (section.image === undefined) return tag('section', words, { class: 'passage' });
  const image = chrome.publication.image(section.image);
  return tag('section', lines([words, picture({ ...image, root })]), {
    class: 'passage illustrated',
  });
}

/** `1200-04-30` as a file name inside `paper/` or `blog/`. */
export const issueFile = (key: string): string => `${key}.html`;

/** A small caps label above a block. */
export const label = (words: string): string => el('p', words, { class: 'label' });

/** A list of links, one per line. */
export function links(items: readonly { href: string; label: string; note?: string }[]): string {
  const rows = items.map((item) =>
    tag(
      'li',
      lines([
        el('a', item.label, { href: item.href }),
        item.note === undefined ? '' : el('span', item.note, { class: 'note' }),
      ]),
    ),
  );
  return tag('ul', rows.join('\n'), { class: 'stack' });
}

/** How old somebody was on a given village day. */
export const ageOn = (person: PersonRecord, key: string): number => yearsBetween(person.born, key);

/** `Blossom 30, 1200` for any day key, in this village's calendar. */
export const dateOf = (chrome: Chrome, key: string): VillageDate =>
  villageDate(key, chrome.village.calendar);

/** A person's face, or nothing if the casting has not given them one. */
export function face(chrome: Chrome, person: PersonRecord, root: string): string {
  const id = chrome.village.casting.portraitFor(person.slug, chrome.today.key);
  if (id === undefined) return '';
  return `<img${[
    ` src="${text(`${root}assets/faces/${id}.webp`)}"`,
    ` alt="${text(`A drawn portrait standing in for ${person.name}`)}"`,
    ' width="200" height="200" loading="lazy" decoding="async" class="face"',
  ].join('')}>`;
}

/** `people/gilbert-hollis.html`, from wherever the reader is standing. */
export const personHref = (root: string, slug: string): string => `${root}people/${slug}.html`;
