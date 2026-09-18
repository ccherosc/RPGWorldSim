import type { PlaceRecord } from '@rpgsim/chronicle';
import { PUBLIC } from '@rpgsim/chronicle';
import { el, lines, picture, tag } from '../html.ts';
import type { Built, Chrome } from './shell.ts';
import { label, opening, prose, rootFor, sheet } from './shell.ts';

/**
 * The village as a list of places, and the map as a picture of them.
 *
 * The table is generated from the record, not written out, which is the only
 * way it can stay right: the village gained twenty-four cottages during
 * worldgen and will gain more, and a hand-written list would be wrong by the
 * end of the first month.
 *
 * Cottage names are not unique -- two dozen of them read `A cottage on Church
 * Lane` -- so the table counts the repeats instead of printing two dozen
 * identical rows. A page that listed them all would be honest and unreadable.
 */

const TOWNE = 'towne.html';
const MAP = 'map.html';

/**
 * The kinds of place, in the order a reader would walk through them, and what
 * to call each of them in a heading.
 *
 * The keys are the record's own words. A kind the record grows that is not
 * listed here still appears on the page -- under its raw name, at the bottom --
 * because a new kind of place going missing from the site would be worse than a
 * new kind of place looking untidy on it.
 */
const KINDS: readonly (readonly [string, string])[] = [
  ['square', 'The green'],
  ['street', 'Lanes'],
  ['road', 'Roads out'],
  ['boundary', 'The edge of the village'],
  ['church', 'The church'],
  ['tavern', 'The tavern'],
  ['workshop', 'Workshops'],
  ['dwelling', 'Cottages'],
  ['field', 'Fields'],
  ['pasture', 'Pasture'],
  ['woodland', 'Woodland'],
  ['water', 'Water'],
];

const ORDER: readonly string[] = KINDS.map(([type]) => type);
const HEADINGS: ReadonlyMap<string, string> = new Map(KINDS);

/** The kind of place a cottage is. Left off the map's legend: they share a name. */
const DWELLING = 'dwelling';

const rankOf = (type: string): number => {
  const at = ORDER.indexOf(type);
  return at === -1 ? ORDER.length : at;
};

const headingFor = (type: string, count: number): string =>
  `${HEADINGS.get(type) ?? type} (${count})`;

interface Group {
  readonly type: string;
  readonly places: readonly PlaceRecord[];
}

/** Places by kind, kinds in walking order, then anything unexpected after. */
function grouped(places: readonly PlaceRecord[]): readonly Group[] {
  const byType = new Map<string, PlaceRecord[]>();
  for (const place of places) {
    const kept = byType.get(place.type);
    if (kept === undefined) byType.set(place.type, [place]);
    else kept.push(place);
  }
  const types = [...byType.keys()].sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b));
  return types.map((type) => ({ type, places: byType.get(type) ?? [] }));
}

/** Identical names collapsed into one row with a count. */
function rows(places: readonly PlaceRecord[]): string {
  const tally = new Map<string, { place: PlaceRecord; count: number }>();
  for (const place of places) {
    const seen = tally.get(place.name);
    if (seen === undefined) tally.set(place.name, { place, count: 1 });
    else seen.count += 1;
  }
  const out: string[] = [];
  for (const [name, { place, count }] of tally) {
    out.push(
      tag(
        'tr',
        lines([
          el('th', count === 1 ? name : `${name} (${count} of them)`, { scope: 'row' }),
          el('td', place.access === PUBLIC ? 'Anyone may go in' : 'Private'),
        ]),
      ),
    );
  }
  return out.join('\n');
}

export function townePage(chrome: Chrome): Built {
  const root = rootFor(TOWNE);
  const page = chrome.publication.page('towne');
  const places = chrome.village.record.places.records();
  const groups = grouped(places);

  const tables = groups.map((group) =>
    tag(
      'section',
      lines([
        el('h2', headingFor(group.type, group.places.length)),
        tag('table', tag('tbody', rows(group.places)), { class: 'places' }),
      ]),
      { class: 'passage' },
    ),
  );

  return sheet(chrome, {
    path: TOWNE,
    here: TOWNE,
    title: page.title,
    description: page.lead,
    body: lines([
      opening(page.title, page.lead),
      picture({ ...chrome.publication.image('mill'), root, wide: true }),
      el('p', `${places.length} places, as of ${chrome.today.long}.`, { class: 'tally' }),
      ...page.sections.map((section) => prose(chrome, section, root)),
      tag(
        'section',
        lines([
          el('h2', 'Every place in the village'),
          el(
            'p',
            'Straight out of the record. A place appears here the moment the simulation creates it.',
          ),
        ]),
        { class: 'passage' },
      ),
      ...tables,
      tag('nav', el('a', 'See the map', { href: `${root}${MAP}` }), { class: 'turning' }),
    ]),
  });
}

/**
 * The map, given the whole page, with the named places listed beside it.
 *
 * The map is a drawing and the list is the record, so they are labelled as two
 * different kinds of thing. A reader who finds a building on the map that is
 * not in the list has found an artist's flourish, not a bug, and the caption in
 * `publication.json` says so.
 */
export function mapPage(chrome: Chrome): Built {
  const root = rootFor(MAP);
  const image = chrome.publication.image('map');
  const named = chrome.village.record.places
    .records()
    .filter((place) => place.type !== DWELLING)
    .sort((a, b) => rankOf(a.type) - rankOf(b.type) || a.name.localeCompare(b.name));

  const legend = named
    .map((place) => tag('li', lines([el('strong', place.name), el('span', place.type, { class: 'note' })])))
    .join('\n');

  return sheet(chrome, {
    path: MAP,
    here: MAP,
    title: 'The Map',
    description: image.caption,
    body: lines([
      tag('div', lines([label('Drawn from the village file'), el('h1', 'The Map')]), {
        class: 'opening',
      }),
      picture({ ...image, root, wide: true, eager: true }),
      tag(
        'section',
        lines([
          el('h2', 'The named places'),
          el(
            'p',
            'The cottages are left off this list because they all have the same name. Everything else the village knows by name is here.',
          ),
          tag('ul', legend, { class: 'stack legend' }),
        ]),
        { class: 'passage' },
      ),
      tag('nav', el('a', 'Read about the towne', { href: `${root}${TOWNE}` }), { class: 'turning' }),
    ]),
  });
}
