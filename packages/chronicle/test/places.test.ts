import { describe, expect, it } from 'vitest';
import {
  PLACES_HEADER,
  PlaceRegister,
  formatPlaceLine,
  parsePlaceLine,
  placeSlug,
} from '@rpgsim/chronicle';
import { type EntityId, EntityKind, makeEntityId } from '@rpgsim/sim-core';

/**
 * The places file: the half of the read model that turns `location:3` into
 * somewhere a reader can picture.
 */

const place = (index: number): EntityId => makeEntityId(EntityKind.Location, index);
const npc = (index: number): EntityId => makeEntityId(EntityKind.Npc, index);

const green = { id: place(0), name: 'The Green', type: 'square', access: 'public' };
const cottage = (index: number, lane = 'Mill Lane') => ({
  id: place(index),
  name: `A cottage on ${lane}`,
  type: 'dwelling',
  access: 'private',
});

describe('naming a place', () => {
  it('files a place under its name without the article', () => {
    expect(placeSlug('The Green')).toBe('green');
    expect(placeSlug('A cottage on Mill Lane')).toBe('cottage-on-mill-lane');
    expect(placeSlug('An Orchard')).toBe('orchard');
  });

  it('keeps a name that does not begin with an article', () => {
    expect(placeSlug('Church Lane')).toBe('church-lane');
    expect(placeSlug('Oakhanger Wood')).toBe('oakhanger-wood');
  });

  it('does not mistake a word that merely starts with one for an article', () => {
    // `the-` is a prefix of `theodric-`, and stripping it would file the
    // Theodric barn under `odric-barn`.
    expect(placeSlug('Theodric Barn')).toBe('theodric-barn');
    expect(placeSlug('Anvil Yard')).toBe('anvil-yard');
    expect(placeSlug('Abbey Field')).toBe('abbey-field');
  });

  it('strips punctuation inside a word rather than splitting on it', () => {
    expect(placeSlug("St Ealdwin's")).toBe('st-ealdwins');
  });

  it('falls back rather than handing out an empty handle', () => {
    expect(placeSlug('   ')).toBe('place');
    expect(placeSlug('...')).toBe('place');
    // A place actually called `The` keeps it: the article is only dropped when
    // there is a name behind it, so nothing here can strip its way to nothing.
    expect(placeSlug('The')).toBe('the');
  });
});

describe('the places file', () => {
  it('hands out a slug when a place is first written down', () => {
    const register = new PlaceRegister();
    expect(register.add(green).slug).toBe('green');
    expect(register.size).toBe(1);
  });

  it('numbers places that would share a slug, in the order they were built', () => {
    const register = new PlaceRegister();
    expect(register.add(cottage(1)).slug).toBe('cottage-on-mill-lane');
    expect(register.add(cottage(2)).slug).toBe('cottage-on-mill-lane-2');
    expect(register.add(cottage(3)).slug).toBe('cottage-on-mill-lane-3');
  });

  it('writes a place once: adding it again returns the line already held', () => {
    const register = new PlaceRegister();
    const first = register.add(green);
    const again = register.add({ ...green, name: 'Somewhere Else' });
    expect(again).toBe(first);
    expect(again.name).toBe('The Green');
    expect(register.size).toBe(1);
  });

  it('refuses anything that is not a place', () => {
    const register = new PlaceRegister();
    expect(() => register.add({ ...green, id: npc(0) })).toThrow(/holds places/);
    expect(() => register.add({ ...green, id: 'nonsense' as EntityId })).toThrow(/entity id/);
  });

  it('finds a place by id and by slug', () => {
    const register = new PlaceRegister();
    register.add(green);
    expect(register.find(place(0))?.name).toBe('The Green');
    expect(register.findBySlug('green')?.id).toBe(place(0));
    expect(register.find(place(9))).toBeUndefined();
    expect(register.findBySlug('nowhere')).toBeUndefined();
    expect(register.has(place(0))).toBe(true);
    expect(register.has(place(9))).toBe(false);
  });

  it('throws on an id it has never heard of rather than rendering it', () => {
    const register = new PlaceRegister();
    register.add(green);
    expect(() => register.require(place(9))).toThrow(/no record of this place/);
    expect(register.require(place(0)).name).toBe('The Green');
  });

  it('knows where anybody could have been watching', () => {
    const register = new PlaceRegister();
    register.add(green);
    register.add(cottage(1));
    expect(register.isPublic(place(0))).toBe(true);
    expect(register.isPublic(place(1))).toBe(false);
    // An unknown place is not quietly public. It is an error.
    expect(() => register.isPublic(place(9))).toThrow(/no record of this place/);
  });

  it('keeps places in the order they were built', () => {
    const register = new PlaceRegister();
    register.add(cottage(2));
    register.add(green);
    register.add(cottage(1));
    expect(register.records().map((p) => p.id)).toEqual([place(2), place(0), place(1)]);
  });
});

describe('the places file on disk', () => {
  const round = (text: string): PlaceRegister => PlaceRegister.parse(text);

  it('survives a round trip through its own text', () => {
    const register = new PlaceRegister();
    register.add(green);
    register.add(cottage(1));
    register.add(cottage(2));

    const text = [PLACES_HEADER, ...register.records().map(formatPlaceLine)].join('\n');
    const reopened = round(text);

    expect(reopened.size).toBe(3);
    expect(reopened.records()).toEqual(register.records());
  });

  it('keeps allocating where the file left off', () => {
    const register = new PlaceRegister();
    register.add(cottage(1));
    register.add(cottage(2));
    const text = [PLACES_HEADER, ...register.records().map(formatPlaceLine)].join('\n');

    // The point of reading slugs back off the lines: no counter to persist, so
    // no counter to get out of step with the file it is counting.
    const reopened = round(text);
    expect(reopened.add(cottage(3)).slug).toBe('cottage-on-mill-lane-3');
  });

  it('reads an empty or header-only file as an empty register', () => {
    expect(round('').size).toBe(0);
    expect(round(`${PLACES_HEADER}\n`).size).toBe(0);
  });

  it('reads a file written with Windows line endings', () => {
    const line = formatPlaceLine({ ...green, slug: 'green' });
    expect(round(`${PLACES_HEADER}\r\n${line}\r\n`).findBySlug('green')?.name).toBe('The Green');
  });

  it('refuses a damaged line rather than guessing at it', () => {
    expect(() => parsePlaceLine('green\tlocation:0\tThe Green\tsquare')).toThrow();
    // A cell with nothing in it is written `-`, and read back as a missing fact.
    expect(() => parsePlaceLine('green\t-\tThe Green\tsquare\tpublic')).toThrow(/required cell/);
    expect(() => parsePlaceLine('green\tlocation:0\t-\tsquare\tpublic')).toThrow(/required cell/);
    expect(() => parsePlaceLine('green\t\tThe Green\tsquare\tpublic')).toThrow(/entity id/);
    expect(() => parsePlaceLine('green\tnonsense\tThe Green\tsquare\tpublic')).toThrow(/entity id/);
  });

  it('refuses a file that names one place twice', () => {
    const line = formatPlaceLine({ ...green, slug: 'green' });
    expect(() => round(`${PLACES_HEADER}\n${line}\n${line}\n`)).toThrow(/share a slug/);

    const other = formatPlaceLine({ ...green, slug: 'elsewhere' });
    expect(() => round(`${PLACES_HEADER}\n${line}\n${other}\n`)).toThrow(/already in the places/);
  });
});
