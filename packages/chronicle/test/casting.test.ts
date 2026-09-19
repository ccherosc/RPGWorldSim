import { EntityKind, makeEntityId } from '@rpgsim/sim-core';
import { describe, expect, it } from 'vitest';
import {
  Casting,
  PortraitCatalog,
  portraitSexOf,
  yearsBetween,
  type AgeBandRule,
  type CastingConfig,
  type PersonRecord,
  type PortraitAtlas,
  type PortraitCell,
} from '../src/index.ts';

/**
 * Casting is a join between two files that are each edited by hand, so nearly
 * every test here is aimed at a way the join can be quietly wrong: a face worn
 * by the wrong person, a date boundary off by a day, a shortage that reports
 * faces which are already taken.
 */

const BANDS: AgeBandRule[] = [
  { name: 'infant', from: 0 },
  { name: 'child', from: 3 },
  { name: 'youth', from: 13 },
  { name: 'adult', from: 20 },
];

const cell = (over: Partial<PortraitCell> = {}): PortraitCell => ({
  sex: 'f',
  band: 'adult',
  look: 'dark hair',
  mood: 'calm',
  props: [],
  setting: 'village',
  ...over,
});

const atlas = (name: string, cells: Record<string, PortraitCell>): PortraitAtlas => ({
  atlas: name,
  source: `Portrait Atlas ${name}`,
  cells,
});

let nextId = 0;
const person = (slug: string, sex: string, born: string): PersonRecord => ({
  slug,
  id: makeEntityId(EntityKind.Npc, nextId++),
  name: slug,
  sex,
  born,
  family: null,
});

const casting = (cast: CastingConfig['cast']): Casting => new Casting({ bands: BANDS, cast });

describe('reading the casting file', () => {
  it('takes a bare portrait id to mean "this face, from the beginning"', () => {
    const cast = casting({ 'winifred-barrow': 'P03-F4' });
    expect(cast.portraitFor('winifred-barrow', '1200-04-01')).toBe('P03-F4');
    expect(cast.portraitFor('winifred-barrow', '0001-01-01')).toBe('P03-F4');
  });

  it('gives an uncast person no face rather than an error', () => {
    // A village gains people faster than anyone draws them. A newborn with no
    // portrait has to read as a blank space on the page, not a crash.
    expect(casting({}).portraitFor('somebody-new', '1200-04-01')).toBeUndefined();
  });

  it('uses the latest face dated on or before the day', () => {
    const cast = casting({
      'alice-vane': [
        { from: '1200-01-01', portrait: 'P01-A1' },
        { from: '1210-01-01', portrait: 'P01-A2' },
        { from: '1240-01-01', portrait: 'P01-A3' },
      ],
    });
    expect(cast.portraitFor('alice-vane', '1205-06-06')).toBe('P01-A1');
    expect(cast.portraitFor('alice-vane', '1220-06-06')).toBe('P01-A2');
    expect(cast.portraitFor('alice-vane', '1250-06-06')).toBe('P01-A3');
  });

  it('starts a take on the day it names, not the day after', () => {
    // `from` is inclusive. Flipping the comparison would move every growing-up
    // by one day, which nothing else in the system would ever notice.
    const cast = casting({
      'alice-vane': [
        { from: '1200-01-01', portrait: 'P01-A1' },
        { from: '1210-01-01', portrait: 'P01-A2' },
      ],
    });
    expect(cast.portraitFor('alice-vane', '1209-12-30')).toBe('P01-A1');
    expect(cast.portraitFor('alice-vane', '1210-01-01')).toBe('P01-A2');
  });

  it('gives no face for a day before the first take', () => {
    const cast = casting({ 'alice-vane': [{ from: '1210-01-01', portrait: 'P01-A2' }] });
    expect(cast.portraitFor('alice-vane', '1205-01-01')).toBeUndefined();
  });

  it('refuses takes listed out of order', () => {
    expect(() =>
      casting({
        'alice-vane': [
          { from: '1210-01-01', portrait: 'P01-A2' },
          { from: '1200-01-01', portrait: 'P01-A1' },
        ],
      }),
    ).toThrow(/out of order/);
  });

  it('refuses age bands that do not start at zero or do not ascend', () => {
    const withBands = (bands: AgeBandRule[]) => () =>
      new Casting({ bands, cast: {} });
    expect(withBands([{ name: 'child', from: 3 }])).toThrow(/start at zero/);
    expect(
      withBands([
        { name: 'infant', from: 0 },
        { name: 'child', from: 3 },
        { name: 'youth', from: 3 },
      ]),
    ).toThrow(/ascend/);
  });

  it('lists everybody cast, and every face used, in a fixed order', () => {
    const cast = casting({
      'zoe-vane': 'P01-A1',
      'adela-vane': [
        { from: '1200-01-01', portrait: 'P01-A3' },
        { from: '1210-01-01', portrait: 'P01-A2' },
      ],
    });
    expect(cast.size).toBe(2);
    expect(cast.slugs()).toEqual(['adela-vane', 'zoe-vane']);
    // Both takes count as used: a face reserved for later is not free now.
    expect(cast.portraitsUsed()).toEqual(['P01-A1', 'P01-A2', 'P01-A3']);
  });
});

describe('which life stage an age falls in', () => {
  it('puts each age in the last band that has begun', () => {
    const cast = casting({});
    expect(cast.bandFor(0)).toBe('infant');
    expect(cast.bandFor(2)).toBe('infant');
    expect(cast.bandFor(3)).toBe('child');
    expect(cast.bandFor(12)).toBe('child');
    expect(cast.bandFor(13)).toBe('youth');
    expect(cast.bandFor(19)).toBe('youth');
    expect(cast.bandFor(20)).toBe('adult');
    expect(cast.bandFor(99)).toBe('adult');
  });
});

describe('counting how old somebody is', () => {
  it('counts whole years between two dates', () => {
    expect(yearsBetween('1160-03-02', '1200-03-02')).toBe(40);
  });

  it('does not count the year whose birthday has not come round yet', () => {
    // This is the bug that first showed up in the real data: four villagers
    // were cast a band too old because the ages had been figured by subtracting
    // years and ignoring the month.
    expect(yearsBetween('1188-06-10', '1200-06-09')).toBe(11);
    expect(yearsBetween('1188-06-10', '1200-06-10')).toBe(12);
    expect(yearsBetween('1188-06-10', '1200-06-11')).toBe(12);
  });

  it('calls somebody born today nought, not minus something', () => {
    expect(yearsBetween('1200-04-01', '1200-04-01')).toBe(0);
    expect(yearsBetween('1201-04-01', '1200-04-01')).toBe(0);
  });

  it('refuses something that is not a date', () => {
    expect(() => yearsBetween('1200-04', '1200-04-01')).toThrow(/YYYY-MM-DD/);
    expect(() => yearsBetween('later-04-01', '1200-04-01')).toThrow(/year/);
  });
});

describe('translating what the record calls a sex', () => {
  it('reads both spellings, in any case', () => {
    expect(portraitSexOf('male')).toBe('m');
    expect(portraitSexOf('M')).toBe('m');
    expect(portraitSexOf(' female ')).toBe('f');
    expect(portraitSexOf('f')).toBe('f');
  });

  it('refuses anything else instead of guessing', () => {
    // Guessing would cast somebody wrong, and the only symptom would be a face
    // on a page nobody thought to check.
    for (const bad of ['', 'man', 'unknown', 'fem']) {
      expect(() => portraitSexOf(bad)).toThrow(/does not know that sex/);
    }
  });
});

describe('checking the casting against the record', () => {
  const catalog = new PortraitCatalog([
    atlas('P01', {
      A1: cell({ sex: 'f', band: 'adult' }),
      A2: cell({ sex: 'm', band: 'adult' }),
      A3: cell({ sex: 'f', band: 'child' }),
      A4: cell({ sex: 'm', band: 'child' }),
      A5: cell({ sex: 'f', band: 'adult' }),
    }),
  ]);

  it('counts who has a face, who has not, and what is spare', () => {
    const cast = casting({ 'a-one': 'P01-A1' });
    const report = cast.report(
      [person('a-one', 'female', '1170-01-01'), person('b-two', 'male', '1170-01-01')],
      catalog,
      '1200-04-01',
    );
    expect(report.cast).toBe(1);
    expect(report.uncast).toEqual([
      { slug: 'b-two', name: 'b-two', sex: 'm', band: 'adult' },
    ]);
    expect(report.unused).toEqual(['P01-A2', 'P01-A3', 'P01-A4', 'P01-A5']);
  });

  it('tells a wrong sex apart from a wrong life stage', () => {
    const cast = casting({ 'a-one': 'P01-A2', 'b-two': 'P01-A3' });
    const report = cast.report(
      [
        person('a-one', 'female', '1170-01-01'), // adult woman wearing an adult man
        person('b-two', 'female', '1170-01-01'), // adult woman wearing a girl
      ],
      catalog,
      '1200-04-01',
    );
    expect(report.mismatched).toEqual([
      { slug: 'a-one', portrait: 'P01-A2', wanted: 'adult/f', got: 'adult/m' },
      { slug: 'b-two', portrait: 'P01-A3', wanted: 'adult/f', got: 'child/f' },
    ]);
  });

  it('says nothing when everybody matches', () => {
    const cast = casting({ 'a-one': 'P01-A1', 'b-two': 'P01-A4' });
    const report = cast.report(
      [person('a-one', 'female', '1170-01-01'), person('b-two', 'male', '1194-01-01')],
      catalog,
      '1200-04-01',
    );
    expect(report.mismatched).toEqual([]);
    expect(report.shortages).toEqual([]);
  });

  it('counts a shortage against free faces, not against every face of that kind', () => {
    // Two adult women need faces. There are three adult-woman portraits, but
    // two are already worn, so there is exactly one to give and that is a
    // shortage of one -- not a comfortable surplus.
    const cast = casting({ 'worn-one': 'P01-A1', 'worn-two': 'P01-A5' });
    const report = cast.report(
      [
        person('worn-one', 'female', '1170-01-01'),
        person('worn-two', 'female', '1170-01-01'),
        person('bare-one', 'female', '1170-01-01'),
        person('bare-two', 'female', '1170-01-01'),
      ],
      catalog,
      '1200-04-01',
    );
    expect(report.shortages).toEqual([{ band: 'adult', sex: 'f', needed: 2, available: 0 }]);
  });

  it('reports no shortage when there are just enough free faces', () => {
    const cast = casting({});
    const report = cast.report([person('bare-one', 'male', '1194-01-01')], catalog, '1200-04-01');
    expect(report.uncast).toHaveLength(1);
    expect(report.shortages).toEqual([]);
  });

  it('throws if the casting points at a face no sheet holds', () => {
    const cast = casting({ 'a-one': 'P09-A1' });
    expect(() => cast.report([person('a-one', 'female', '1170-01-01')], catalog, '1200-04-01'))
      .toThrow(/P09-A1/);
  });

  it('ages people against the day it is asked about', () => {
    const cast = casting({});
    const child = [person('a-one', 'male', '1194-01-01')];
    expect(cast.report(child, catalog, '1200-04-01').uncast[0]?.band).toBe('child');
    expect(cast.report(child, catalog, '1220-04-01').uncast[0]?.band).toBe('adult');
  });
});

describe('proposing faces for the people who have none', () => {
  const catalog = new PortraitCatalog([
    atlas('P01', {
      A1: cell({ sex: 'f', band: 'adult' }),
      A2: cell({ sex: 'f', band: 'adult' }),
      A3: cell({ sex: 'm', band: 'child' }),
    }),
  ]);

  it('fills the blanks and leaves everybody else alone', () => {
    const cast = casting({ 'a-one': 'P01-A2' });
    const proposals = cast.propose(
      [person('a-one', 'female', '1170-01-01'), person('b-two', 'female', '1170-01-01')],
      catalog,
      '1200-04-01',
    );
    expect([...proposals]).toEqual([['b-two', 'P01-A1']]);
  });

  it('never hands out a face somebody is already wearing', () => {
    const cast = casting({ 'a-one': 'P01-A1' });
    const proposals = cast.propose(
      [
        person('a-one', 'female', '1170-01-01'),
        person('b-two', 'female', '1170-01-01'),
        person('c-three', 'female', '1170-01-01'),
      ],
      catalog,
      '1200-04-01',
    );
    // One free adult-woman face, two bare women: one gets it, one waits.
    expect([...proposals]).toEqual([['b-two', 'P01-A2']]);
  });

  it('skips somebody with no matching face rather than giving them a wrong one', () => {
    const cast = casting({});
    const proposals = cast.propose([person('a-one', 'female', '1199-01-01')], catalog, '1200-04-01');
    expect(proposals.size).toBe(0);
  });

  it('proposes the same answer twice running, whatever order the people arrive in', () => {
    const cast = casting({});
    const people = [person('b-two', 'female', '1170-01-01'), person('a-one', 'female', '1170-01-01')];
    const forwards = cast.propose(people, catalog, '1200-04-01');
    const backwards = cast.propose([...people].reverse(), catalog, '1200-04-01');
    expect([...forwards]).toEqual([...backwards]);
    expect([...forwards]).toEqual([
      ['a-one', 'P01-A1'],
      ['b-two', 'P01-A2'],
    ]);
  });

  it('changes nothing about the casting itself', () => {
    // A proposal is a suggestion printed for a person to paste. If it mutated
    // the casting in memory, a `cast --propose` run would disagree with the
    // file on disk and nobody would be told.
    const cast = casting({ 'a-one': 'P01-A1' });
    cast.propose(
      [person('a-one', 'female', '1170-01-01'), person('b-two', 'female', '1170-01-01')],
      catalog,
      '1200-04-01',
    );
    expect(cast.slugs()).toEqual(['a-one']);
    expect(cast.portraitFor('b-two', '1200-04-01')).toBeUndefined();
  });
});
