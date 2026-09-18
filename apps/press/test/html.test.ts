import { describe, expect, it } from 'vitest';
import { attrs, el, indent, lines, p, page, picture, tag, text } from '../src/html.ts';

/**
 * The escaping layer, on its own.
 *
 * Everything else in the press is tested against a real village, which is the
 * right way to catch a wrong number but the wrong way to catch a missing
 * escape: the village does not currently invent a name with an angle bracket in
 * it, so a hole here would pass every page test in the suite and then open the
 * first time a template gains an apostrophe. So the dangerous characters are
 * fed in directly.
 *
 * `tag` deliberately does not escape its children -- it takes markup -- and
 * that asymmetry with `el` is the one thing in this module that can be misused.
 * It is asserted rather than trusted.
 */

const NASTY = `<script>alert("x") & 'done'</script>`;

describe('escaping', () => {
  it('escapes all five characters that can change the meaning of a document', () => {
    expect(text(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('escapes the ampersand before it escapes anything else', () => {
    // A naive implementation that replaced '<' first and '&' second would turn
    // '<' into '&lt;' and then into '&amp;lt;', and the page would print the
    // entity instead of the bracket.
    expect(text('<')).toBe('&lt;');
    expect(text('&lt;')).toBe('&amp;lt;');
  });

  it('leaves ordinary prose exactly as it was', () => {
    const plain = 'Walter Barrow owes for a winter of fish.';
    expect(text(plain)).toBe(plain);
  });

  it('cannot produce a tag from prose, however the prose is shaped', () => {
    const out = el('p', NASTY);
    expect(out.startsWith('<p>')).toBe(true);
    expect(out.endsWith('</p>')).toBe(true);
    expect(out.slice(3, -4)).not.toContain('<');
    expect(out.slice(3, -4)).not.toContain('>');
  });

  it('escapes attribute values, so a quote cannot end the attribute', () => {
    expect(attrs({ href: 'a"b' })).toBe(' href="a&quot;b"');
    expect(attrs({ title: NASTY })).not.toContain('<');
  });

  it('passes markup through tag and prose through el', () => {
    expect(tag('div', '<b>bold</b>')).toBe('<div><b>bold</b></div>');
    expect(el('div', '<b>bold</b>')).toBe('<div>&lt;b&gt;bold&lt;/b&gt;</div>');
  });
});

describe('attributes', () => {
  it('drops undefined and empty values rather than printing them', () => {
    // `aria-current` is passed as undefined on six pages out of seven, and an
    // empty one would tell a screen reader every link is the current page.
    expect(attrs({ class: 'x', 'aria-current': undefined, rel: '' })).toBe(' class="x"');
  });

  it('renders nothing at all when every value is absent', () => {
    expect(attrs({ a: undefined })).toBe('');
    expect(tag('p', 'x', { a: undefined })).toBe('<p>x</p>');
  });

  it('keeps numbers, including zero', () => {
    expect(attrs({ width: 0 })).toBe(' width="0"');
  });

  it('keeps the order they were written in', () => {
    expect(attrs({ b: '1', a: '2' })).toBe(' b="1" a="2"');
  });
});

describe('joining', () => {
  it('drops empty parts so an absent block leaves no blank line', () => {
    expect(lines(['a', '', 'b'])).toBe('a\nb');
  });

  it('keeps whitespace-only parts, which are deliberate', () => {
    expect(lines(['a', ' ', 'b'])).toBe('a\n \nb');
  });

  it('indents every line of a block except the empty ones', () => {
    expect(indent(1, 'a\n\nb')).toBe('  a\n\n  b');
  });

  it('wraps prose in a paragraph', () => {
    expect(p('hi')).toBe('<p>hi</p>');
  });
});

describe('pictures', () => {
  const image = { name: 'mill', alt: 'A mill', root: '../' };

  it('offers the small file to small screens', () => {
    const out = picture(image);
    expect(out).toContain('src="../assets/images/mill.webp"');
    expect(out).toContain('srcset="../assets/images/mill-small.webp 800w, ../assets/images/mill.webp 1600w"');
  });

  it('defers everything that is not asked for eagerly', () => {
    expect(picture(image)).toContain('loading="lazy"');
    expect(picture({ ...image, eager: true })).not.toContain('loading=');
  });

  it('omits the caption element when there is no caption', () => {
    expect(picture(image)).not.toContain('figcaption');
    expect(picture({ ...image, caption: 'A mill on the water' })).toContain(
      '<figcaption>A mill on the water</figcaption>',
    );
  });

  it('always carries alt text, because every picture here is decoration of a fact', () => {
    expect(picture(image)).toContain('alt="A mill"');
  });
});

describe('the document', () => {
  const shell = {
    title: 'The Map',
    description: 'A drawing of the village.',
    masthead: 'The Pennycroft Chronicle',
    tagline: 'A simulation of medieval life, with a twist',
    dateline: 'Restday, Blossom 30, in the year of our Lord 1200',
    nav: [
      { href: 'index.html', label: 'Welcome' },
      { href: 'map.html', label: 'The Map', here: true },
    ],
    footer: ['Pennycroft is a simulation.'],
    root: '',
    body: '<p>body</p>',
  };

  const html = page(shell);

  it('opens with a doctype and closes the document', () => {
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('names the page and the site in the title', () => {
    expect(html).toContain('<title>The Map — The Pennycroft Chronicle</title>');
  });

  it('marks exactly one navigation link as the current page', () => {
    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1);
  });

  it('asks for no scripts and no third-party resources', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('puts a skip link ahead of the banner, pointing at the main element', () => {
    expect(html.indexOf('class="skip"')).toBeLessThan(html.indexOf('class="banner"'));
    expect(html).toContain('href="#main"');
    expect(html).toContain('<main id="main">');
  });

  it('prints the dateline once, where every page shares it', () => {
    expect([...html.matchAll(/class="dateline"/g)]).toHaveLength(1);
    expect(html).toContain('Restday, Blossom 30, in the year of our Lord 1200');
  });

  it('prefixes every local reference with the page depth', () => {
    const deep = page({ ...shell, root: '../' });
    expect(deep).toContain('href="../assets/style.css"');
    expect(deep).toContain('href="../index.html"');
  });

  it('writes no English of its own into the footer', () => {
    // Every footer word comes from `publication.json`; the generator adding a
    // sentence here would be a sentence nobody but a programmer can correct.
    const footer = html.slice(html.indexOf('<footer'));
    expect(footer).toContain('Pennycroft is a simulation.');
    expect(footer.replace(/<[^>]*>/g, '').trim()).toBe('Pennycroft is a simulation.');
  });

  it('gives each paragraph of the footer its own paragraph', () => {
    const two = page({ ...shell, footer: ['One.', 'Two.'] });
    expect(two).toContain('<p>One.</p>\n  <p>Two.</p>');
  });

  it('escapes the shell strings too', () => {
    const nasty = page({ ...shell, title: NASTY, description: NASTY, dateline: NASTY });
    const head = nasty.slice(0, nasty.indexOf('</head>'));
    expect(head).not.toContain('<script');
  });
});
