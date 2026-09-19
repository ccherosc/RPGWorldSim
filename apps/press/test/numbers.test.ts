import { describe, expect, it } from 'vitest';
import { MOST_IN_WORDS, capitalised, inWords } from '@rpgsim/press';

/**
 * Counts, spelled the way the site spells them.
 *
 * Worth real tests rather than a glance, because every one of these ends up in
 * a sentence a reader is supposed to believe, and the failures are all quiet
 * ones: `twenty` where `twenty-one` belonged, `one hundred six` in a paragraph
 * written in English, a hyphen in the wrong half of `eighty-six`.
 */

describe('spelling a count', () => {
  it('writes the small ones out', () => {
    expect(inWords(0)).toBe('zero');
    expect(inWords(1)).toBe('one');
    expect(inWords(9)).toBe('nine');
  });

  it('knows the teens are their own words and not ten-and-something', () => {
    expect(inWords(10)).toBe('ten');
    expect(inWords(11)).toBe('eleven');
    expect(inWords(13)).toBe('thirteen');
    expect(inWords(19)).toBe('nineteen');
  });

  it('hyphenates a two-part ten', () => {
    expect(inWords(20)).toBe('twenty');
    expect(inWords(24)).toBe('twenty-four');
    expect(inWords(86)).toBe('eighty-six');
    expect(inWords(99)).toBe('ninety-nine');
  });

  it('puts an “and” in a hundred, the way it is said aloud', () => {
    expect(inWords(100)).toBe('one hundred');
    expect(inWords(101)).toBe('one hundred and one');
    expect(inWords(115)).toBe('one hundred and fifteen');
    expect(inWords(940)).toBe('nine hundred and forty');
  });

  it('gets the thousands right, commas and all', () => {
    // The long-term village is a thousand people, so this is not hypothetical.
    expect(inWords(1000)).toBe('one thousand');
    expect(inWords(1006)).toBe('one thousand and six');
    expect(inWords(1106)).toBe('one thousand, one hundred and six');
    expect(inWords(9999)).toBe('nine thousand, nine hundred and ninety-nine');
  });

  it('says so rather than printing digits when the village outgrows it', () => {
    // A silent fallback to `10000` would put a numeral in the middle of prose
    // written to be read aloud, on the one day nobody is watching the copy.
    expect(() => inWords(MOST_IN_WORDS + 1)).toThrow();
  });

  it('refuses a count that is not a count', () => {
    expect(() => inWords(-1)).toThrow();
    expect(() => inWords(2.5)).toThrow();
  });

  it('capitalises only the first letter, leaving a hyphen alone', () => {
    expect(capitalised(inWords(24))).toBe('Twenty-four');
    expect(capitalised(inWords(86))).toBe('Eighty-six');
    expect(capitalised('')).toBe('');
  });
});
