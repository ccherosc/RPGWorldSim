/**
 * Turning strings into HTML without letting a string become markup by accident.
 *
 * Everything the site prints is either prose out of `publication.json` or a
 * name out of the village record, and the village invents its own names. A
 * cottage called `A cottage on Church Lane` is harmless; a future template that
 * puts an apostrophe or an angle bracket in a name is not, and the failure mode
 * of forgetting to escape one is a broken page rather than an error. So there
 * is exactly one way to put text on a page here -- `text()` -- and it always
 * escapes.
 *
 * There is no templating library and no client-side JavaScript. The site is a
 * few thousand lines of static HTML that has to still open in ten years, which
 * rules out a build chain, and it has to be readable with scripting off, which
 * rules out rendering in the browser.
 */

const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

/** Prose, safe to put anywhere in a document body or an attribute value. */
export function text(value: string): string {
  let out = '';
  for (const char of value) out += ESCAPES.get(char) ?? char;
  return out;
}

/** `class="x" href="y"`, with undefined and empty values dropped. */
export function attrs(pairs: Readonly<Record<string, string | number | undefined>>): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(pairs)) {
    if (value === undefined || value === '') continue;
    parts.push(`${name}="${text(String(value))}"`);
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

/** An element with already-rendered children. Nothing here escapes `inner`. */
export function tag(
  name: string,
  inner: string,
  pairs: Readonly<Record<string, string | number | undefined>> = {},
): string {
  return `<${name}${attrs(pairs)}>${inner}</${name}>`;
}

/** An element whose only content is prose, escaped on the way in. */
export function el(
  name: string,
  content: string,
  pairs: Readonly<Record<string, string | number | undefined>> = {},
): string {
  return tag(name, text(content), pairs);
}

export const p = (content: string): string => el('p', content);

export const lines = (parts: readonly string[]): string => parts.filter((one) => one !== '').join('\n');

/** An indented block, so the generated source is readable by a person. */
export function indent(depth: number, body: string): string {
  const pad = '  '.repeat(depth);
  return body
    .split('\n')
    .map((one) => (one === '' ? one : pad + one))
    .join('\n');
}

/** An element whose children go on their own indented lines. */
const block = (name: string, inner: string): string =>
  tag(name, `\n${indent(1, inner)}\n`);

export interface Picture {
  /** The image stem, as named in `publication.json` and in `assets/site/images`. */
  readonly name: string;
  readonly alt: string;
  readonly caption?: string;
  /** Relative depth of the page below the site root, for the `src` prefix. */
  readonly root: string;
  /** Rendered at full width rather than inset. */
  readonly wide?: boolean;
  /** Told to the browser so it can load the small file on a phone. */
  readonly eager?: boolean;
}

/**
 * One illustration, with the small file offered to small screens.
 *
 * Two files are shipped for every picture: 1600 pixels wide and 800. A phone
 * that downloads the 1600 wastes most of it, and `srcset` is the only way to
 * say so that works with no JavaScript. Everything below the fold is
 * `loading="lazy"`, which is the whole of the site's performance strategy.
 */
export function picture(image: Picture): string {
  const base = `${image.root}assets/images/${image.name}`;
  const img = `<img${attrs({
    src: `${base}.webp`,
    srcset: `${base}-small.webp 800w, ${base}.webp 1600w`,
    sizes: image.wide ? '100vw' : '(min-width: 48rem) 40rem, 100vw',
    alt: image.alt,
    loading: image.eager === true ? undefined : 'lazy',
    decoding: 'async',
  })}>`;
  const caption = image.caption === undefined ? '' : el('figcaption', image.caption);
  return tag('figure', lines([img, caption]), { class: image.wide === true ? 'plate wide' : 'plate' });
}

export interface NavLink {
  readonly href: string;
  readonly label: string;
  /** Marked as the page the reader is on. */
  readonly here?: boolean;
}

export interface Shell {
  /** Appears in the browser tab and as the page's own heading. */
  readonly title: string;
  /** The `<meta name="description">`, one sentence. */
  readonly description: string;
  readonly masthead: string;
  readonly tagline: string;
  /** `Restday, Blossom 30, in the year of our Lord 1200` */
  readonly dateline: string;
  readonly nav: readonly NavLink[];
  readonly footer: readonly string[];
  /** `` for the site root, `../` for a page one directory down. */
  readonly root: string;
  readonly body: string;
}

/**
 * The document every page is poured into.
 *
 * The masthead, the date and the navigation are identical on every page and are
 * written once here, so a page cannot disagree with the rest of the site about
 * what day it is.
 */
export function page(shell: Shell): string {
  const nav = shell.nav
    .map((link) =>
      el('a', link.label, {
        href: `${shell.root}${link.href}`,
        'aria-current': link.here === true ? 'page' : undefined,
      }),
    )
    .join('\n');

  const head = lines([
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    el('title', `${shell.title} — ${shell.masthead}`),
    `<meta name="description" content="${text(shell.description)}">`,
    `<meta name="color-scheme" content="light">`,
    `<link rel="stylesheet" href="${shell.root}assets/style.css">`,
    `<link rel="icon" href="${shell.root}assets/seal.svg" type="image/svg+xml">`,
  ]);

  const banner = tag(
    'header',
    lines([
      tag('a', el('span', shell.masthead, { class: 'masthead' }), {
        href: `${shell.root}index.html`,
        class: 'crest',
      }),
      el('p', shell.tagline, { class: 'tagline' }),
      el('p', shell.dateline, { class: 'dateline' }),
    ]),
    { class: 'banner' },
  );

  // Every word of the footer comes from `publication.json`. The only English
  // written into this module is the skip link, which is navigation furniture
  // rather than content; a sentence about the village in the generator is a
  // sentence nobody but a programmer can correct.
  const footer = tag('footer', tag('div', shell.footer.map(p).join('\n'), { class: 'colophon' }), {
    class: 'foot',
  });

  return lines([
    '<!doctype html>',
    '<html lang="en">',
    block('head', head),
    block(
      'body',
      lines([
        '<a class="skip" href="#main">Skip to the page</a>',
        banner,
        tag('nav', tag('div', nav, { class: 'wrap' }), { class: 'ways' }),
        tag('main', shell.body, { id: 'main' }),
        footer,
      ]),
    ),
    '</html>',
    '',
  ]);
}
