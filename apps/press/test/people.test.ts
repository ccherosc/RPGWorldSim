import { describe, expect, it } from 'vitest';
import { sentence } from '../src/pages/people.ts';

/**
 * The one piece of the person page that is a text function rather than a page.
 *
 * `site.test.ts` checks what the finished pages say, which is the right place
 * to catch a person described as `7, child female`. It cannot catch this,
 * because the thing to catch is a judgement about real data it has no way to
 * count: whether `a, b and c` was built from three phrases or is simply what
 * one phrase looked like. A persona's `cares` can be the single entry `Her
 * chores, described at length`, comma and all, so a page cannot be asked
 * whether a comma it found was a join.
 *
 * So the joiner is asked directly, with the three list lengths the persona
 * book actually holds -- eighty-odd threes, ten twos and eight ones.
 */

describe('reading a list back as a sentence', () => {
  it('joins three phrases the way somebody would say them', () => {
    expect(sentence(['Takes', 'climbs', 'refuses to be carried'])).toBe(
      'Takes, climbs and refuses to be carried.',
    );
  });

  it('puts no comma between two', () => {
    expect(sentence(['Laps', 'faces she knows'])).toBe('Laps and faces she knows.');
  });

  it('leaves one phrase alone but still ends it', () => {
    expect(sentence(['Is carried everywhere'])).toBe('Is carried everywhere.');
  });

  it('does not mistake a comma inside a phrase for a join', () => {
    // The real entry this is taken from. A single phrase stays single: it
    // gains a full stop and nothing else, and in particular no `and`.
    expect(sentence(['Her chores, described at length'])).toBe('Her chores, described at length.');
  });

  it('says nothing when there is nothing to say', () => {
    // The schema refuses an empty list, so this cannot arrive from the persona
    // book. It is here because a function that returns a bare full stop when
    // it is handed nothing is a function that will one day print one.
    expect(sentence([])).toBe('');
  });
});
