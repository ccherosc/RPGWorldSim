import { el, lines, picture, tag } from '../html.ts';
import type { Built, Chrome } from './shell.ts';
import { dateOf, face, issueFile, label, links, prose, rootFor, sheet } from './shell.ts';

/**
 * The welcome page: the village, the day, and the way in to everything else.
 *
 * Whatever is on this page has to be true on any day the site is generated, so
 * nothing here is chosen by hand. The stories are the newest issue's, the faces
 * are whoever wrote today, and the counts come off the newest paper. On a quiet
 * day the page is shorter, which is the correct behaviour.
 */

const HOME = 'index.html';

export function homePage(chrome: Chrome): Built {
  const root = rootFor(HOME);
  const page = chrome.publication.page('home');
  const hero = chrome.publication.image('hero');
  const glance = chrome.latest.paper.glance;
  const stories = (chrome.latest.paper.review ?? []).slice(0, 3);

  const banner = tag(
    'div',
    lines([
      picture({ ...hero, root, wide: true, eager: true }),
      tag(
        'div',
        lines([
          el('h1', page.title),
          el('p', page.lead, { class: 'lead' }),
          tag(
            'p',
            lines([
              el('a', 'Read today’s Chronicle', { href: `${root}paper/index.html`, class: 'go' }),
              el('a', 'Meet the people', { href: `${root}people/index.html`, class: 'go quiet' }),
            ]),
            { class: 'doors' },
          ),
        ]),
        { class: 'hero-words' },
      ),
    ]),
    { class: 'hero' },
  );

  const numbers = tag(
    'section',
    lines([
      label('The village today'),
      el('h2', chrome.today.full),
      tag(
        'ul',
        lines([
          tag('li', lines([el('strong', String(glance.souls)), el('span', 'souls')])),
          tag('li', lines([el('strong', String(glance.families)), el('span', 'families')])),
          tag('li', lines([el('strong', String(glance.places)), el('span', 'places')])),
          tag('li', lines([el('strong', String(glance.journeys)), el('span', 'journeys walked')])),
          tag('li', lines([el('strong', String(glance.refused)), el('span', 'turned away at the door')])),
        ]),
        { class: 'counts' },
      ),
    ]),
    { class: 'passage figures' },
  );

  const today =
    stories.length === 0
      ? ''
      : tag(
          'section',
          lines([
            el('h2', 'What happened today'),
            tag(
              'div',
              stories
                .map((one) =>
                  tag(
                    'article',
                    lines([
                      el('p', one.text),
                      el('span', one.sources.map((id) => `§${id}`).join(' '), { class: 'cite' }),
                    ]),
                    { class: 'story' },
                  ),
                )
                .join('\n'),
              { class: 'review' },
            ),
            links([
              {
                href: `${root}paper/index.html`,
                label: `The whole issue for ${chrome.today.short}`,
              },
              { href: `${root}paper/archive.html`, label: 'Every issue ever printed' },
            ]),
          ]),
          { class: 'passage' },
        );

  const voices =
    chrome.latest.posts.length === 0
      ? ''
      : tag(
          'section',
          lines([
            el('h2', 'Who wrote today'),
            tag(
              'div',
              chrome.latest.posts
                .map((post) =>
                  tag(
                    'a',
                    lines([
                      face(chrome, post.author, root),
                      tag(
                        'div',
                        lines([
                          el('strong', post.author.name),
                          el('span', post.lines[0]?.text ?? '', { class: 'note' }),
                        ]),
                        { class: 'card-words' },
                      ),
                    ]),
                    { class: 'card wide-card', href: `${root}blog/${issueFile(chrome.latest.day.key)}` },
                  ),
                )
                .join('\n'),
              { class: 'roll' },
            ),
            links([
              { href: `${root}blog/index.html`, label: 'Read the villagers' },
              { href: `${root}blog/archive.html`, label: 'Every day they have written' },
            ]),
          ]),
          { class: 'passage' },
        );

  const map = tag(
    'section',
    lines([
      el('h2', 'Where all this happens'),
      picture({ ...chrome.publication.image('map'), root }),
      links([
        { href: `${root}map.html`, label: 'See the map full size' },
        { href: `${root}towne.html`, label: 'Every place in the village' },
      ]),
    ]),
    { class: 'passage' },
  );

  const start = dateOf(chrome, chrome.village.issues[0]?.day.key ?? chrome.today.key);
  const since = el(
    'p',
    `The village has been running since ${start.long}. One day here passes for each day out there.`,
    { class: 'tally' },
  );

  return sheet(chrome, {
    path: HOME,
    here: HOME,
    title: page.title,
    description: page.lead,
    body: lines([
      banner,
      numbers,
      since,
      ...page.sections.map((section) => prose(chrome, section, root)),
      today,
      voices,
      map,
      links([{ href: `${root}about.html`, label: 'How the village works' }]),
    ]),
  });
}
