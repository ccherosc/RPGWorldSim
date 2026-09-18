import { el, lines, picture, tag } from '../html.ts';
import type { Built, Chrome } from './shell.ts';
import { dateOf, label, links, prose, rootFor, sheet } from './shell.ts';

/**
 * How the village works, and the ledger of what it is honest about.
 *
 * The last section is the one worth keeping right. It prints the seed, the
 * first village day, the span of the archive and the freeze, because those four
 * facts are what let a reader check any other claim on the site -- and because
 * a project that publishes its own gaps is harder to catch out than one that
 * does not mention them.
 */

const ABOUT = 'about.html';

export function aboutPage(chrome: Chrome): Built {
  const root = rootFor(ABOUT);
  const page = chrome.publication.page('about');
  const first = chrome.village.issues[0];
  const from = dateOf(chrome, first?.day.key ?? chrome.today.key);
  const frozen = chrome.publication.config.frozenThrough;

  const ledger = tag(
    'section',
    lines([
      el('h2', 'The particulars'),
      tag(
        'dl',
        lines([
          el('dt', 'The starting word'),
          el('dd', chrome.village.worldSeed),
          el('dt', 'First village day'),
          el('dd', from.full),
          el('dt', 'Newest village day'),
          el('dd', chrome.today.full),
          el('dt', 'Days published'),
          el('dd', String(chrome.village.issues.length)),
          el('dt', 'Souls on the record'),
          el('dd', String(chrome.village.people.length)),
          el('dt', 'Places on the record'),
          el('dd', String(chrome.village.record.places.size)),
          el('dt', 'Families named'),
          el('dd', String(chrome.village.community.familyCount)),
          el('dt', 'Faces drawn'),
          el('dd', String(chrome.village.portraits.all().length)),
          el('dt', 'Held back'),
          el('dd', frozen === null ? 'Nothing. Every day the village has lived is here.' : `Everything after ${dateOf(chrome, frozen).short}`),
        ]),
        { class: 'ledger' },
      ),
    ]),
    { class: 'passage' },
  );

  return sheet(chrome, {
    path: ABOUT,
    here: ABOUT,
    title: page.title,
    description: page.lead,
    body: lines([
      tag(
        'div',
        lines([label('The workings'), el('h1', page.title), el('p', page.lead, { class: 'lead' })]),
        { class: 'opening' },
      ),
      picture({ ...chrome.publication.image('window'), root, wide: true }),
      ...page.sections.map((section) => prose(chrome, section, root)),
      ledger,
      tag(
        'section',
        lines([
          el('h2', 'Where to look next'),
          links([
            { href: `${root}paper/archive.html`, label: 'Every issue of the Chronicle' },
            { href: `${root}blog/archive.html`, label: 'Every day the villagers wrote' },
            { href: `${root}people/index.html`, label: 'Everybody who lives here' },
            { href: `${root}map.html`, label: 'The map' },
          ]),
        ]),
        { class: 'passage' },
      ),
    ]),
  });
}
