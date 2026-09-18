import { describe, expect, it } from 'vitest';
import {
  PortraitAtlasSchema,
  PortraitCatalog,
  parsePortraitId,
  type PortraitAtlas,
  type PortraitCell,
} from '../src/index.ts';

/**
 * The catalog's whole job is to be additive: a new sheet is a new file and is
 * never a change to an existing one. The tests that matter are the ones that
 * would fail if an id could shift or collide, because that is the failure that
 * silently hands a villager a stranger's face.
 */

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

describe('the portrait catalog', () => {
  it('names a portrait by the sheet and the square printed on it', () => {
    const catalog = new PortraitCatalog([atlas('P04', { C3: cell() })]);
    expect(catalog.all().map((portrait) => portrait.id)).toEqual(['P04-C3']);
    expect(catalog.require('P04-C3').atlas).toBe('P04');
  });

  it('keeps every sheet it is given rather than the last one', () => {
    const catalog = new PortraitCatalog([
      atlas('P01', { A1: cell(), B2: cell() }),
      atlas('P02', { A1: cell() }),
    ]);
    expect(catalog.size).toBe(3);
    expect(catalog.all().map((portrait) => portrait.id)).toEqual(['P01-A1', 'P01-B2', 'P02-A1']);
  });

  it('lists cells in sheet order and then in cell order, whatever order the file held them', () => {
    // The listing decides which face a proposal reaches for first. Determinism
    // rule 5 forbids leaning on a key order that is not itself deterministic,
    // and a JSON object hands its keys back in insertion order -- so sorting
    // here is what makes two runs over the same data propose the same casting.
    const catalog = new PortraitCatalog([atlas('P01', { C3: cell(), A1: cell(), B2: cell() })]);
    expect(catalog.all().map((portrait) => portrait.id)).toEqual(['P01-A1', 'P01-B2', 'P01-C3']);
  });

  it('refuses two sheets that claim the same square', () => {
    expect(() => new PortraitCatalog([atlas('P01', { A1: cell() }), atlas('P01', { A1: cell() })]))
      .toThrow(/same portrait/);
  });

  it('throws on an id nothing holds, naming it', () => {
    const catalog = new PortraitCatalog([atlas('P01', { A1: cell() })]);
    expect(catalog.find('P09-A1')).toBeUndefined();
    expect(catalog.has('P09-A1')).toBe(false);
    expect(() => catalog.require('P09-A1')).toThrow(/P09-A1/);
  });

  it('matches on the sex and the life stage, not on either alone', () => {
    // Two separate mutations hide here: dropping the sex test, and dropping the
    // band test. Each on its own would still return a plausible-looking list,
    // so the fixture makes all four combinations exist.
    const catalog = new PortraitCatalog([
      atlas('P01', {
        A1: cell({ sex: 'f', band: 'child' }),
        A2: cell({ sex: 'f', band: 'elder' }),
        A3: cell({ sex: 'm', band: 'child' }),
        A4: cell({ sex: 'm', band: 'elder' }),
      }),
    ]);
    expect(catalog.matching('f', 'child').map((portrait) => portrait.id)).toEqual(['P01-A1']);
    expect(catalog.matching('m', 'elder').map((portrait) => portrait.id)).toEqual(['P01-A4']);
    expect(catalog.matching('m', 'infant')).toEqual([]);
  });

  it('counts the supply by sex and life stage', () => {
    const catalog = new PortraitCatalog([
      atlas('P01', {
        A1: cell({ sex: 'm', band: 'child' }),
        A2: cell({ sex: 'm', band: 'child' }),
        A3: cell({ sex: 'f', band: 'child' }),
      }),
    ]);
    expect(catalog.tally().get('child/m')).toBe(2);
    expect(catalog.tally().get('child/f')).toBe(1);
    expect(catalog.tally().get('child/x')).toBeUndefined();
  });
});

describe('what a sheet file must look like', () => {
  it('fills in an empty prop list, so a cell holding nothing can stay short', () => {
    const parsed = PortraitAtlasSchema.parse({
      atlas: 'P01',
      source: 'a sheet',
      cells: { A1: { sex: 'f', band: 'adult', look: 'dark hair', mood: 'calm', setting: 'village' } },
    });
    expect(parsed.cells['A1']?.props).toEqual([]);
  });

  it('refuses a square that is not on an eight-by-five sheet', () => {
    const sheet = (name: string) => ({
      atlas: 'P01',
      source: 'a sheet',
      cells: { [name]: { sex: 'f', band: 'adult', look: 'x', mood: 'y', setting: 'z' } },
    });
    expect(PortraitAtlasSchema.safeParse(sheet('A1')).success).toBe(true);
    expect(PortraitAtlasSchema.safeParse(sheet('I1')).success).toBe(false);
    expect(PortraitAtlasSchema.safeParse(sheet('A6')).success).toBe(false);
    expect(PortraitAtlasSchema.safeParse(sheet('A0')).success).toBe(false);
  });

  it('refuses a life stage or a sex it does not have a word for', () => {
    const base = { look: 'x', mood: 'y', setting: 'z' };
    const sheet = (over: object) => ({
      atlas: 'P01',
      source: 'a sheet',
      cells: { A1: { ...base, sex: 'f', band: 'adult', ...over } },
    });
    expect(PortraitAtlasSchema.safeParse(sheet({ band: 'middle-aged' })).success).toBe(false);
    expect(PortraitAtlasSchema.safeParse(sheet({ sex: 'other' })).success).toBe(false);
  });
});

describe('reading a portrait id', () => {
  it('splits the sheet from the square', () => {
    expect(parsePortraitId('P04-C3')).toEqual({ atlas: 'P04', cell: 'C3' });
  });

  it('refuses anything that is not one', () => {
    for (const bad of ['P4-C3', 'P04C3', 'P04-I3', 'P04-C6', 'p04-c3', '', 'P04-C3 ']) {
      expect(() => parsePortraitId(bad)).toThrow(/P04-C3/);
    }
  });
});
