import { assert } from '@rpgsim/shared';

/**
 * Counts, written the way the site writes them.
 *
 * The prose on this site spells its numbers out — `eighty-six souls`, not `86
 * souls` — because it is written to be read aloud and a numeral in the middle of
 * a sentence reads like a form. That was fine while somebody typed the words in
 * by hand, and typing them in by hand is exactly the fault this file exists to
 * remove: a caption saying `twenty-four households` is a claim about the village
 * that nothing checks, and it stays on the page being wrong for as long as it
 * takes a person to notice. The first birth would have made four sentences false
 * at once.
 *
 * So the copy now carries `{households}` and the record fills it. Which means
 * the record has to be able to say `twenty-four`, and that is all this is.
 *
 * Deliberately small. British forms — `one hundred and six`, not `one hundred
 * six` — and a hard ceiling, because a village of ten thousand is a different
 * project and should say so loudly rather than quietly printing digits.
 */

const ONES: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS: readonly string[] = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

/** The largest count this will spell. A village past it has outgrown the prose. */
export const MOST_IN_WORDS = 9999;

/** `24` becomes `twenty-four`. Lower case; the caller capitalises if it must. */
export function inWords(count: number): string {
  assert(Number.isSafeInteger(count) && count >= 0, 'a count must be a whole number', { count });
  assert(count <= MOST_IN_WORDS, 'that is too large a number for the site to spell', { count });

  if (count < 20) return ONES[count] as string;
  if (count < 100) {
    const tens = TENS[Math.floor(count / 10)] as string;
    const rest = count % 10;
    return rest === 0 ? tens : `${tens}-${ONES[rest] as string}`;
  }
  if (count < 1000) {
    const hundreds = `${ONES[Math.floor(count / 100)] as string} hundred`;
    const rest = count % 100;
    return rest === 0 ? hundreds : `${hundreds} and ${inWords(rest)}`;
  }

  const thousands = `${inWords(Math.floor(count / 1000))} thousand`;
  const rest = count % 1000;
  if (rest === 0) return thousands;
  // `one thousand and six`, but `one thousand, one hundred and six`. The comma
  // is what stops the second one reading as a single number said badly.
  return rest < 100 ? `${thousands} and ${inWords(rest)}` : `${thousands}, ${inWords(rest)}`;
}

/** `twenty-four` becomes `Twenty-four`. For a count that opens a sentence. */
export function capitalised(words: string): string {
  return words.length === 0 ? words : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}
