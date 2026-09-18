import type { PersonRecord, Post, Tie } from '@rpgsim/chronicle';
import { el, lines, picture, tag } from '../html.ts';
import type { Built, Chrome } from './shell.ts';
import { ageOn, dateOf, face, issueFile, label, links, prose, rootFor, sheet } from './shell.ts';

/**
 * The roll of the village, and a page for every soul on it.
 *
 * A person's page is assembled out of four separate things that each knows only
 * part of them: the record knows their name, sex, birth and family; the casting
 * knows which drawn face stands in for them; the persona book knows how they
 * come across; and the archive knows what they have written. None of those four
 * is allowed to invent the others, which is why a person with no persona simply
 * has a shorter page rather than a made-up one.
 *
 * Ages are worked out on the newest published day, not on a real date. A reader
 * coming back in a year should see the village as old as the village is, not as
 * old as the world outside it.
 */

const HERE = 'people/index.html';

/** `hargrave` read back as `The Hargraves`. Nothing else in the site guesses. */
const titled = (slug: string): string =>
  `The ${slug.charAt(0).toUpperCase()}${slug.slice(1)}${slug.endsWith('s') ? '' : 's'}`;

const SEXES: ReadonlyMap<string, string> = new Map([
  ['m', 'man'],
  ['f', 'woman'],
]);

/** `woman`, `girl`, `boy` -- what the record can say and no more. */
function describe(chrome: Chrome, person: PersonRecord): string {
  const age = ageOn(person, chrome.today.key);
  const band = chrome.village.casting.bandFor(age);
  const sex = SEXES.get(person.sex) ?? person.sex;
  return `${age}, ${band} ${sex}`;
}

/** One card on the roll. */
function card(chrome: Chrome, person: PersonRecord, root: string): string {
  return tag(
    'a',
    lines([
      face(chrome, person, root),
      tag(
        'div',
        lines([
          el('strong', person.name),
          el('span', describe(chrome, person), { class: 'note' }),
        ]),
        { class: 'card-words' },
      ),
    ]),
    { class: 'card', href: `${root}people/${person.slug}.html` },
  );
}

/** Everybody, grouped by family name, families in alphabetical order. */
export function peopleRoll(chrome: Chrome): Built {
  const path = HERE;
  const root = rootFor(path);
  const page = chrome.publication.page('people');

  const byFamily = new Map<string, PersonRecord[]>();
  for (const person of chrome.village.people) {
    const key = person.family ?? '';
    const kept = byFamily.get(key);
    if (kept === undefined) byFamily.set(key, [person]);
    else kept.push(person);
  }

  const named = [...byFamily.keys()].filter((one) => one !== '').sort();
  const houses = named.map((slug) => {
    const family = chrome.village.community.findFamily(slug);
    const members = byFamily.get(slug) ?? [];
    return tag(
      'section',
      lines([
        el('h2', titled(slug)),
        family === undefined ? '' : el('p', family.standing),
        family === undefined ? '' : el('p', family.reputation, { class: 'note' }),
        tag('div', members.map((person) => card(chrome, person, root)).join('\n'), {
          class: 'roll',
        }),
      ]),
      { class: 'passage house' },
    );
  });

  const loose = byFamily.get('') ?? [];
  const unnamed =
    loose.length === 0
      ? ''
      : tag(
          'section',
          lines([
            el('h2', 'No family name'),
            el(
              'p',
              'The record has not tied these people to a household, so it will not give them a surname.',
            ),
            tag('div', loose.map((person) => card(chrome, person, root)).join('\n'), {
              class: 'roll',
            }),
          ]),
          { class: 'passage house' },
        );

  return sheet(chrome, {
    path,
    here: HERE,
    title: page.title,
    description: page.lead,
    body: lines([
      tag('div', lines([label('Who lives here'), el('h1', page.title), el('p', page.lead, { class: 'lead' })]), {
        class: 'opening',
      }),
      el(
        'p',
        `${chrome.village.people.length} people in ${named.length} families, as of ${chrome.today.long}.`,
        { class: 'tally' },
      ),
      picture({ ...chrome.publication.image('lane'), root, wide: true }),
      ...page.sections.map((section) => prose(chrome, section, root)),
      ...houses,
      unnamed,
    ]),
  });
}

const TIE_WORDS: ReadonlyMap<string, string> = new Map([
  ['kin', 'Kin'],
  ['marriage', 'Married'],
  ['apprentice', 'Apprenticeship'],
  ['friendship', 'Friend'],
  ['rivalry', 'Rival'],
  ['courtship', 'Courting'],
  ['debt', 'Debt'],
  ['grudge', 'Grudge'],
]);

/** The other end of a tie, whoever it is. */
function other(tie: Tie, slug: string): string {
  const [first, second] = tie.between;
  return first === slug ? second : first;
}

/** One person, everything four sources can honestly say about them. */
export function personPage(chrome: Chrome, person: PersonRecord): Built {
  const path = `people/${person.slug}.html`;
  const root = rootFor(path);
  const persona = chrome.village.personas.find(person.slug);
  const family = person.family === null ? undefined : chrome.village.community.findFamily(person.family);
  const ties = chrome.village.community.tiesFor(person.slug);
  const born = dateOf(chrome, person.born);

  const written: { post: Post; key: string }[] = [];
  for (const issue of chrome.village.issues) {
    for (const post of issue.posts) {
      if (post.author.slug === person.slug) written.push({ post, key: issue.day.key });
    }
  }

  const known = tag(
    'section',
    lines([
      el('h2', 'What the record knows'),
      tag(
        'dl',
        lines([
          el('dt', 'Age'),
          el('dd', describe(chrome, person)),
          el('dt', 'Born'),
          el('dd', born.long),
          el('dt', 'Family'),
          el('dd', person.family === null ? 'None recorded' : titled(person.family)),
          el('dt', 'Slug'),
          el('dd', person.slug),
        ]),
        { class: 'ledger' },
      ),
    ]),
    { class: 'passage' },
  );

  const howTheyCome =
    persona === undefined
      ? ''
      : tag(
          'section',
          lines([
            el('h2', 'How they come across'),
            el('p', persona.look),
            el('p', persona.voice),
            el('p', persona.tell),
            el('h3', 'Habits'),
            tag('ul', persona.habits.map((one) => el('li', one)).join('\n'), { class: 'plain' }),
            el('h3', 'Cares about'),
            tag('ul', persona.cares.map((one) => el('li', one)).join('\n'), { class: 'plain' }),
            persona.trade === null ? '' : el('p', `Trade: ${persona.trade}. Not simulated yet.`, { class: 'note' }),
          ]),
          { class: 'passage' },
        );

  const house =
    family === undefined
      ? ''
      : tag(
          'section',
          lines([el('h2', titled(family.family)), el('p', family.standing), el('p', family.reputation)]),
          { class: 'passage' },
        );

  const connected =
    ties.length === 0
      ? ''
      : tag(
          'section',
          lines([
            el('h2', 'Who they know'),
            tag(
              'ul',
              ties
                .map((tie) => {
                  const them = other(tie, person.slug);
                  const who = chrome.village.record.people.findBySlug(them);
                  const word = TIE_WORDS.get(tie.kind) ?? tie.kind;
                  const name =
                    who === undefined
                      ? el('span', them)
                      : el('a', who.name, { href: `${root}people/${them}.html` });
                  return tag(
                    'li',
                    lines([el('span', word, { class: 'label' }), name, el('span', tie.note, { class: 'note' })]),
                  );
                })
                .join('\n'),
              { class: 'stack' },
            ),
          ]),
          { class: 'passage' },
        );

  const wrote =
    written.length === 0
      ? tag(
          'section',
          lines([
            el('h2', 'What they have written'),
            el(
              'p',
              'The rota has not called on them yet, or the days it did they had nothing they could honestly report.',
            ),
          ]),
          { class: 'passage' },
        )
      : tag(
          'section',
          lines([
            el('h2', 'What they have written'),
            links(
              [...written].reverse().map(({ post, key }) => ({
                href: `${root}blog/${issueFile(key)}`,
                label: dateOf(chrome, key).short,
                note: post.lines[0]?.text ?? '',
              })),
            ),
          ]),
          { class: 'passage' },
        );

  return sheet(chrome, {
    path,
    here: HERE,
    title: person.name,
    description: `${person.name} of ${chrome.village.community.village}: ${describe(chrome, person)}.`,
    body: lines([
      tag(
        'div',
        lines([
          face(chrome, person, root),
          label('One of the village'),
          el('h1', person.name),
          el('p', describe(chrome, person), { class: 'lead' }),
        ]),
        { class: 'opening portrait-opening' },
      ),
      known,
      house,
      howTheyCome,
      connected,
      wrote,
      tag('nav', el('a', 'Back to the roll', { href: `${root}people/index.html` }), {
        class: 'turning',
      }),
    ]),
  });
}

