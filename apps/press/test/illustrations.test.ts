import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublication } from '../src/data.ts';
import { ASSET_ROOT } from '../src/site.ts';

/**
 * The declared size of every illustration, checked against the file itself.
 *
 * `publication.json` states each picture's pixel width and height, and
 * `picture()` prints them on the `<img>` so a browser can reserve the right
 * shape before the file arrives. Nothing about the page looks wrong when those
 * numbers are wrong -- the stylesheet still draws the picture correctly -- so
 * the only symptom of a stale number is text jumping as the page loads, which
 * is invisible in a screenshot and invisible in a diff. It needs a test.
 *
 * So the numbers live in the data file, where a person can read them, and this
 * reads the actual bytes on disk and refuses to agree unless they match. The
 * day somebody re-exports an illustration at a different size, this fails and
 * names it.
 *
 * The second check is the one that is easy to miss. Every picture ships twice,
 * at 1600 and at 800, behind one `srcset`. The browser reserves space from the
 * declared ratio and then loads whichever file its screen asks for, so if the
 * two files are not the same shape the reserved hole is wrong for one of them
 * and the picture is drawn very slightly squashed. A tolerance is allowed
 * because a resizer rounds to whole pixels -- `map-small` is 800x600 against a
 * parent of 1449x1086, which is 0.07% out and could not be otherwise -- but a
 * genuine crop is a different shape by percent, not by hundredths.
 */

/** How far two files behind one `srcset` may differ in shape. */
const RATIO_TOLERANCE = 0.005;

/**
 * The pixel size of a WebP file, read from its header.
 *
 * Deliberately not a general decoder: it reads the four bytes that say which
 * flavour of WebP this is and then the handful of bytes that flavour keeps its
 * dimensions in. A file it does not recognise throws rather than guessing,
 * because a guess here would be a test that passes while measuring nothing.
 *
 * Layouts, all little-endian, all offsets from the start of the file:
 *   0..3   'RIFF'      8..11  'WEBP'      12..15  the first chunk's name
 *   'VP8 ' lossy:     width  = 14 bits at 26, height = 14 bits at 28
 *   'VP8L' lossless:  14 bits each, packed from bit 0 of byte 21, minus one
 *   'VP8X' extended:  24 bits each at 24 and 27, minus one
 */
function webpSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 4).toString('latin1'), 'not a RIFF file').toBe('RIFF');
  expect(bytes.subarray(8, 12).toString('latin1'), 'not a WEBP file').toBe('WEBP');

  const chunk = bytes.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ') {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    const packed = bytes.readUInt32LE(21);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === 'VP8X') {
    const at = (offset: number): number =>
      bytes.readUInt8(offset) | (bytes.readUInt8(offset + 1) << 8) | (bytes.readUInt8(offset + 2) << 16);
    return { width: at(24) + 1, height: at(27) + 1 };
  }
  throw new Error(`unknown WebP chunk '${chunk}'`);
}

const sizeOf = (name: string): { width: number; height: number } =>
  webpSize(readFileSync(join(ASSET_ROOT, 'images', `${name}.webp`)));

describe('the illustrations the site ships', () => {
  const images = loadPublication().config.images;

  it('reads its own header format', () => {
    // The reader is the instrument, so it is checked against a number that was
    // established independently of it before either check below is trusted.
    expect(sizeOf('hero')).toEqual({ width: 1600, height: 900 });
  });

  it('declares the size every file actually is', () => {
    const declared = images.map((image) => ({
      name: image.name,
      width: image.width,
      height: image.height,
    }));
    const actual = images.map((image) => ({ name: image.name, ...sizeOf(image.name) }));
    expect(declared).toEqual(actual);
  });

  it('ships a small file the same shape as the large one', () => {
    for (const image of images) {
      const small = sizeOf(`${image.name}-small`);
      const drift = Math.abs(small.width / small.height - image.width / image.height);
      expect(drift / (image.width / image.height), image.name).toBeLessThan(RATIO_TOLERANCE);
    }
  });

  it('has a file behind every picture the pages can ask for', () => {
    // `Publication` already refuses a section naming an illustration that is
    // not listed. This is the other half: an illustration that is listed but
    // was never shipped, which renders as a broken image rather than an error.
    for (const image of images) {
      expect(() => sizeOf(image.name), image.name).not.toThrow();
      expect(() => sizeOf(`${image.name}-small`), `${image.name}-small`).not.toThrow();
    }
  });
});
