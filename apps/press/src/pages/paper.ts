import type { Glance, Story } from '@rpgsim/chronicle';
import { el, lines, picture, tag } from '../html.ts';
import type { Built, Chrome } from './shell.ts';
import { dateOf, issueFile, label, links, opening, rootFor, sheet } from './shell.ts';
import type { Issue } from '../issue.ts';

/**
 * The Towne Publication, one page a day, plus the shelf they sit on.
 *
 * Nothing on these pages is composed here. `writePaper` in the chronicle has
 * already decided what the day's stories are and what the day's numbers were;
 * this turns that object into HTML and puts the event ids beside each sentence.
 *
 * The ids are the point. A story that cannot name the numbered events it stands
 * on is a story somebody made up, and printing them where a reader can see them
 * is what stops the page from quietly becoming fiction.
 */

const HERE = 'paper/index.html';

/** `§40213` -- the events a sentence rests on, printed next to it. */
const cite = (sources: readonly number[]): string =>
  sources.length === 0 ? '' : el('span', sources.map((id) => `§${id}`).join(' '), { class: 'cite' });

function story(one: Story): string {
  const also =
    one.alsoToday <= 0 ? '' : el('span', `and ${one.alsoToday} more of the same`, { class: 'also' });
  return tag(
    'article',
    lines([el('p', one.text), tag('p', lines([cite(one.sources), also]), { class: 'apparatus' })]),
    { class: 'story' },
  );
}

/** The six counts, as a table rather than a paragraph, because they are a table. */
function glance(numbers: Glance): string {
  const rows: readonly (readonly [string, number, string])[] = [
    ['Souls', numbers.souls, 'people the record knows of'],
    ['Families', numbers.families, 'family names among them'],
    ['Places', numbers.places, 'places in the village'],
    ['Abed', numbers.abed, 'in bed when the day ended'],
    ['Journeys', numbers.journeys, 'walks finished at their destination'],
    ['Turned away', numbers.refused, 'arrivals at somewhere already full'],
  ];
  const body = rows
    .map(([name, value, why]) =>
      tag('tr', lines([el('th', name, { scope: 'row' }), el('td', String(value)), el('td', why)])),
    )
    .join('\n');
  return tag(
    'section',
    lines([
      el('h2', 'The village at a glance'),
      tag('table', tag('tbody', body), { class: 'glance' }),
    ]),
    { class: 'passage' },
  );
}

/**
 * The note at the foot of every issue naming what the paper cannot tell you.
 *
 * It is generated, it is long, and it is the most honest thing on the site, so
 * it is printed in full rather than summarised or folded away.
 */
const colophon = (note: readonly string[] | undefined): string =>
  note === undefined || note.length === 0
    ? ''
    : tag(
        'section',
        lines([el('h2', 'What this page cannot tell you'), ...note.map((one) => el('p', one))]),
        { class: 'passage colophon-note' },
      );

interface Neighbours {
  readonly earlier?: Issue;
  readonly later?: Issue;
}

/** Yesterday and tomorrow, where they exist. Reading the run is the point. */
function turning(chrome: Chrome, root: string, near: Neighbours): string {
  const parts: string[] = [];
  if (near.earlier !== undefined) {
    parts.push(
      el('a', `← ${dateOf(chrome, near.earlier.day.key).short}`, {
        href: `${root}paper/${issueFile(near.earlier.day.key)}`,
        rel: 'prev',
      }),
    );
  }
  parts.push(el('a', 'All issues', { href: `${root}paper/archive.html` }));
  if (near.later !== undefined) {
    parts.push(
      el('a', `${dateOf(chrome, near.later.day.key).short} →`, {
        href: `${root}paper/${issueFile(near.later.day.key)}`,
        rel: 'next',
      }),
    );
  }
  return tag('nav', parts.join('\n'), { class: 'turning', 'aria-label': 'Other issues' });
}

function body(chrome: Chrome, issue: Issue, root: string, near: Neighbours): string {
  const when = dateOf(chrome, issue.day.key);
  const review = issue.paper.review ?? [];
  const wrote = issue.posts.map((post) => ({
    href: `${root}people/${post.author.slug}.html`,
    label: post.author.name,
  }));

  const inReview =
    review.length === 0
      ? tag(
          'section',
          lines([
            el('h2', 'The day in review'),
            el('p', chrome.publication.page('paper').lead),
          ]),
          { class: 'passage' },
        )
      : tag('section', lines([el('h2', 'The day in review'), ...review.map(story)]), {
          class: 'passage review',
        });

  return lines([
    tag(
      'div',
      lines([
        label('The Towne Publication'),
        el('h1', when.full),
        el('p', issue.paper.dateline, { class: 'lead' }),
      ]),
      { class: 'opening' },
    ),
    picture({ ...chrome.publication.image('market'), root, wide: true }),
    inReview,
    glance(issue.paper.glance),
    wrote.length === 0
      ? ''
      : tag(
          'section',
          lines([
            el('h2', 'Who wrote today'),
            el(
              'p',
              'The villagers below kept their own notes on this day. Their posts are on the blog.',
            ),
            // The list is the five people and nothing else. The blog link used
            // to be a sixth row of it, indented and ruled exactly like a name,
            // which read as a villager called "Read the day on the blog" -- and
            // the list is a roster, so anything standing in it is claiming to be
            // somebody. A way off the page is not somebody.
            links(wrote),
            tag('p', el('a', 'Read the day on the blog', {
              href: `${root}blog/${issueFile(issue.day.key)}`,
            })),
          ]),
          { class: 'passage' },
        ),
    colophon(issue.paper.colophon),
    turning(chrome, root, near),
  ]);
}

const neighboursOf = (chrome: Chrome, at: number): Neighbours => ({
  earlier: chrome.village.issues[at - 1],
  later: chrome.village.issues[at + 1],
});

/** One dated issue, at `paper/1200-04-30.html`. */
export function paperIssue(chrome: Chrome, at: number): Built {
  const issue = chrome.village.issues[at] as Issue;
  const path = `paper/${issueFile(issue.day.key)}`;
  const when = dateOf(chrome, issue.day.key);
  return sheet(chrome, {
    path,
    here: HERE,
    title: `The Chronicle, ${when.short}`,
    description: `The Towne Publication for ${when.long}: the day in review and the village at a glance.`,
    body: body(chrome, issue, rootFor(path), neighboursOf(chrome, at)),
  });
}

/** The newest issue, at `paper/index.html`, so the navigation has one target. */
export function paperLatest(chrome: Chrome): Built {
  const at = chrome.village.issues.length - 1;
  return sheet(chrome, {
    path: HERE,
    here: HERE,
    title: chrome.publication.page('paper').title,
    description: chrome.publication.page('paper').lead,
    body: body(chrome, chrome.latest, rootFor(HERE), neighboursOf(chrome, at)),
  });
}

/** Every issue there has ever been, newest first. */
export function paperArchive(chrome: Chrome): Built {
  const path = 'paper/archive.html';
  const root = rootFor(path);
  const page = chrome.publication.page('paper');

  const byYear = new Map<number, Issue[]>();
  for (const issue of chrome.village.issues) {
    const year = dateOf(chrome, issue.day.key).year;
    const kept = byYear.get(year);
    if (kept === undefined) byYear.set(year, [issue]);
    else kept.push(issue);
  }

  const years = [...byYear.keys()].sort((a, b) => b - a);
  const shelves = years.map((year) => {
    const kept = [...(byYear.get(year) ?? [])].reverse();
    return tag(
      'section',
      lines([
        el('h2', `In the year of our Lord ${year}`),
        links(
          kept.map((issue) => {
            const when = dateOf(chrome, issue.day.key);
            const count = (issue.paper.review ?? []).length;
            return {
              href: `${root}paper/${issueFile(issue.day.key)}`,
              label: `${when.monthName} ${when.day}`,
              note: count === 1 ? '1 story' : `${count} stories`,
            };
          }),
        ),
      ]),
      { class: 'passage' },
    );
  });

  const tally =
    chrome.village.issues.length === 1
      ? '1 issue, for the one day the village has lived.'
      : `${chrome.village.issues.length} issues, one for each day the village has lived.`;

  return sheet(chrome, {
    path,
    here: HERE,
    title: 'Every issue',
    description: `Every issue of ${chrome.publication.masthead} published so far.`,
    body: lines([opening('Every issue', page.lead), el('p', tally, { class: 'tally' }), ...shelves]),
  });
}
