import type { Post } from '@rpgsim/chronicle';
import { el, lines, picture, tag } from '../html.ts';
import type { Built, Chrome } from './shell.ts';
import { ageOn, dateOf, face, issueFile, label, links, opening, rootFor, sheet } from './shell.ts';
import type { Issue } from '../issue.ts';

/**
 * The villagers in their own words, a day at a time.
 *
 * Every line here was written by `writePost`, which refuses to let anybody
 * mention something they were not standing next to when it happened. That rule
 * is invisible on the page and is the reason a post is sometimes two lines
 * long: the villager genuinely had nothing else to report.
 *
 * Nobody is padded out and nobody is substituted. If the rota picked five
 * people and two of them had a dull day, the day shows three posts.
 */

const HERE = 'blog/index.html';

const cite = (sources: readonly number[]): string =>
  sources.length === 0 ? '' : el('span', sources.map((id) => `§${id}`).join(' '), { class: 'cite' });

/** One villager's day: who they are, then what they said, then the ids. */
function entry(chrome: Chrome, post: Post, root: string): string {
  const persona = chrome.village.personas.find(post.author.slug);
  const age = ageOn(post.author, post.day);
  const family = post.author.family === null ? undefined : chrome.village.community.findFamily(post.author.family);

  const who = lines([
    face(chrome, post.author, root),
    tag(
      'div',
      lines([
        tag('h2', el('a', post.author.name, { href: `${root}people/${post.author.slug}.html` })),
        el('p', `${age} years old`, { class: 'standing' }),
        family === undefined ? '' : el('p', family.standing, { class: 'standing' }),
        persona === undefined ? '' : el('p', persona.voice, { class: 'voice' }),
      ]),
      { class: 'who' },
    ),
  ]);

  const said = post.lines
    .map((one) => tag('p', lines([el('span', one.text, { class: 'said' }), cite(one.sources)])))
    .join('\n');

  return tag('article', lines([tag('header', who, { class: 'byline' }), tag('div', said, { class: 'saying' })]), {
    class: 'post',
  });
}

interface Neighbours {
  readonly earlier?: Issue;
  readonly later?: Issue;
}

function turning(chrome: Chrome, root: string, near: Neighbours): string {
  const parts: string[] = [];
  if (near.earlier !== undefined) {
    parts.push(
      el('a', `← ${dateOf(chrome, near.earlier.day.key).short}`, {
        href: `${root}blog/${issueFile(near.earlier.day.key)}`,
        rel: 'prev',
      }),
    );
  }
  parts.push(el('a', 'All days', { href: `${root}blog/archive.html` }));
  if (near.later !== undefined) {
    parts.push(
      el('a', `${dateOf(chrome, near.later.day.key).short} →`, {
        href: `${root}blog/${issueFile(near.later.day.key)}`,
        rel: 'next',
      }),
    );
  }
  return tag('nav', parts.join('\n'), { class: 'turning', 'aria-label': 'Other days' });
}

function body(chrome: Chrome, issue: Issue, root: string, near: Neighbours): string {
  const when = dateOf(chrome, issue.day.key);
  const quiet = issue.posts.length === 0;

  return lines([
    tag(
      'div',
      lines([
        label('From the village'),
        el('h1', when.full),
        el('p', chrome.publication.page('blog').lead, { class: 'lead' }),
      ]),
      { class: 'opening' },
    ),
    picture({ ...chrome.publication.image('chickens'), root, wide: true }),
    quiet
      ? tag(
          'section',
          lines([
            el('h2', 'Nobody wrote today'),
            el(
              'p',
              'Everybody the rota asked had a day they could not honestly say anything about. That happens, and the page is left short rather than filled.',
            ),
          ]),
          { class: 'passage' },
        )
      : tag('div', issue.posts.map((post) => entry(chrome, post, root)).join('\n'), { class: 'posts' }),
    tag(
      'section',
      lines([
        el('h2', 'The same day in the paper'),
        // A cross-reference and not a list. Set as one it was a heading above a
        // single row with a rule under it, which is the shape of a table that
        // lost the rest of itself: a reader counts rows, and one row asks where
        // the others went.
        tag('p', el('a', `The Chronicle for ${when.short}`, {
          href: `${root}paper/${issueFile(issue.day.key)}`,
        })),
      ]),
      { class: 'passage' },
    ),
    turning(chrome, root, near),
  ]);
}

const neighboursOf = (chrome: Chrome, at: number): Neighbours => ({
  earlier: chrome.village.issues[at - 1],
  later: chrome.village.issues[at + 1],
});

/** One day of posts, at `blog/1200-04-30.html`. */
export function blogDay(chrome: Chrome, at: number): Built {
  const issue = chrome.village.issues[at] as Issue;
  const path = `blog/${issueFile(issue.day.key)}`;
  const when = dateOf(chrome, issue.day.key);
  return sheet(chrome, {
    path,
    here: HERE,
    title: `The Villagers, ${when.short}`,
    description: `What the people of ${chrome.village.community.village} wrote about ${when.long}.`,
    body: body(chrome, issue, rootFor(path), neighboursOf(chrome, at)),
  });
}

/** The newest day of posts, at `blog/index.html`. */
export function blogLatest(chrome: Chrome): Built {
  const at = chrome.village.issues.length - 1;
  return sheet(chrome, {
    path: HERE,
    here: HERE,
    title: chrome.publication.page('blog').title,
    description: chrome.publication.page('blog').lead,
    body: body(chrome, chrome.latest, rootFor(HERE), neighboursOf(chrome, at)),
  });
}

/** Every day anybody wrote on, newest first, with who wrote. */
export function blogArchive(chrome: Chrome): Built {
  const path = 'blog/archive.html';
  const root = rootFor(path);
  const page = chrome.publication.page('blog');

  const byYear = new Map<number, Issue[]>();
  for (const issue of chrome.village.issues) {
    const year = dateOf(chrome, issue.day.key).year;
    const kept = byYear.get(year);
    if (kept === undefined) byYear.set(year, [issue]);
    else kept.push(issue);
  }

  const shelves = [...byYear.keys()]
    .sort((a, b) => b - a)
    .map((year) => {
      const kept = [...(byYear.get(year) ?? [])].reverse();
      return tag(
        'section',
        lines([
          el('h2', `In the year of our Lord ${year}`),
          links(
            kept.map((issue) => {
              const when = dateOf(chrome, issue.day.key);
              const names = issue.posts.map((post) => post.author.name).join(', ');
              return {
                href: `${root}blog/${issueFile(issue.day.key)}`,
                label: `${when.monthName} ${when.day}`,
                note: names === '' ? 'nobody wrote' : names,
              };
            }),
          ),
        ]),
        { class: 'passage' },
      );
    });

  const total = chrome.village.issues.reduce((sum, issue) => sum + issue.posts.length, 0);

  return sheet(chrome, {
    path,
    here: HERE,
    title: 'Every day',
    description: `Every day the people of ${chrome.village.community.village} have written about.`,
    body: lines([
      opening('Every day', page.lead),
      el('p', `${total} posts across ${chrome.village.issues.length} days.`, { class: 'tally' }),
      ...shelves,
    ]),
  });
}
