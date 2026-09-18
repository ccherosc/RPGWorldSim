import { describe, expect, it } from 'vitest';
import {
  Community,
  PersonaBook,
  PersonaBookSchema,
  CommunitySchema,
  type Persona,
  type Tie,
} from '../src/index.ts';

/**
 * Two hand-written files, checked the same way: does every slug in them name
 * somebody the record actually holds, and does everybody the record holds have
 * an entry? Both failures are invisible on the page — a misspelled slug simply
 * shows nothing — so the checks are the point.
 */

const persona = (over: Partial<Persona> = {}): Persona => ({
  look: 'a wide, weathered face',
  voice: 'short sentences, and fewer of them than you expect',
  tell: 'looks at the door before answering',
  habits: ['up before anyone else'],
  cares: ['the weather'],
  trade: null,
  ...over,
});

describe('the persona book', () => {
  it('finds a persona by the same slug the blog prints', () => {
    const book = new PersonaBook({ personas: { 'walter-barrow': persona({ trade: 'ploughman' }) } });
    expect(book.size).toBe(1);
    expect(book.find('walter-barrow')?.trade).toBe('ploughman');
    expect(book.require('walter-barrow').tell).toBe('looks at the door before answering');
  });

  it('lists its people in a fixed order, whatever order the file held them', () => {
    const book = new PersonaBook({
      personas: { 'zoe-vane': persona(), 'adela-vane': persona(), 'maud-dyer': persona() },
    });
    expect(book.slugs()).toEqual(['adela-vane', 'maud-dyer', 'zoe-vane']);
  });

  it('throws for a villager nobody has written, naming them', () => {
    // The caller that needs a voice cannot invent one, and a missing persona
    // should be caught at load rather than halfway through composing a post.
    const book = new PersonaBook({ personas: {} });
    expect(book.find('walter-barrow')).toBeUndefined();
    expect(() => book.require('walter-barrow')).toThrow(/walter-barrow/);
  });

  it('names the villagers who still have no persona', () => {
    const book = new PersonaBook({ personas: { 'walter-barrow': persona() } });
    expect(book.missingFor(['walter-barrow', 'maud-dyer', 'adela-vane'])).toEqual([
      'adela-vane',
      'maud-dyer',
    ]);
    expect(book.missingFor(['walter-barrow'])).toEqual([]);
  });

  it('names personas written for somebody who does not exist', () => {
    const book = new PersonaBook({
      personas: { 'walter-barrow': persona(), 'walter-barow': persona() },
    });
    expect(book.strayFor(['walter-barrow'])).toEqual(['walter-barow']);
    expect(book.strayFor(['walter-barrow', 'walter-barow'])).toEqual([]);
  });
});

describe('what a persona file must hold', () => {
  it('defaults the trade to none, for a family whose name implies no work', () => {
    const parsed = PersonaBookSchema.parse({
      personas: {
        'peter-underhill': {
          look: 'thin',
          voice: 'questions',
          tell: 'stares past you',
          habits: ['counts the stars'],
          cares: ['the sky'],
        },
      },
    });
    expect(parsed.personas['peter-underhill']?.trade).toBeNull();
  });

  it('refuses a persona with no habits or no cares', () => {
    // An empty list is the shape a half-written entry takes, and it would read
    // as a villager with nothing to post about rather than as a mistake.
    const entry = (over: object) => ({
      personas: {
        'a-one': {
          look: 'x',
          voice: 'y',
          tell: 'z',
          habits: ['w'],
          cares: ['v'],
          ...over,
        },
      },
    });
    expect(PersonaBookSchema.safeParse(entry({})).success).toBe(true);
    expect(PersonaBookSchema.safeParse(entry({ habits: [] })).success).toBe(false);
    expect(PersonaBookSchema.safeParse(entry({ cares: [] })).success).toBe(false);
    expect(PersonaBookSchema.safeParse(entry({ tell: '' })).success).toBe(false);
  });
});

const tie = (kind: Tie['kind'], one: string, other: string): Tie => ({
  kind,
  between: [one, other],
  note: `${one} and ${other}`,
});

const community = (families: string[], ties: Tie[]) => ({
  village: 'Pennycroft',
  families: families.map((family) => ({
    family,
    kind: 'trade' as const,
    trade: family,
    standing: 'a house in the village',
    reputation: 'known for something',
  })),
  ties,
});

describe('the community', () => {
  it('finds a family by the name the record spells', () => {
    const village = new Community(community(['brewer', 'dyer'], []));
    expect(village.familyCount).toBe(2);
    expect(village.findFamily('brewer')?.trade).toBe('brewer');
    expect(village.findFamily('netherby')).toBeUndefined();
  });

  it('lists families in a fixed order', () => {
    const village = new Community(community(['webb', 'brewer', 'miller'], []));
    expect(village.families().map((family) => family.family)).toEqual([
      'brewer',
      'miller',
      'webb',
    ]);
  });

  it('refuses the same family listed twice', () => {
    expect(() => new Community(community(['brewer', 'brewer'], []))).toThrow(/twice/);
  });

  it('shows a tie at both of its ends', () => {
    // A tie stored at one end only is half a relationship: one villager knows
    // about the grudge and the other does not.
    const grudge = tie('grudge', 'matilda-netherby', 'wilmot-milburn');
    const village = new Community(community(['netherby'], [grudge]));
    expect(village.tieCount).toBe(1);
    expect(village.tiesFor('matilda-netherby')).toEqual([grudge]);
    expect(village.tiesFor('wilmot-milburn')).toEqual([grudge]);
    expect(village.tiesFor('nobody-here')).toEqual([]);
  });

  it('keeps every tie a person has, in file order', () => {
    const first = tie('friendship', 'walter-barrow', 'aldric-pike');
    const second = tie('debt', 'walter-barrow', 'cedric-miller');
    const village = new Community(community(['barrow'], [first, second]));
    expect(village.tiesFor('walter-barrow')).toEqual([first, second]);
  });

  it('refuses a tie from somebody to themselves', () => {
    expect(() => new Community(community(['barrow'], [tie('kin', 'walter-barrow', 'walter-barrow')])))
      .toThrow(/two different people/);
  });

  it('names everybody any tie mentions, once each, in order', () => {
    const village = new Community(
      community(
        ['barrow'],
        [tie('debt', 'walter-barrow', 'aldric-pike'), tie('grudge', 'walter-barrow', 'agnes-salter')],
      ),
    );
    expect(village.slugsNamed()).toEqual(['agnes-salter', 'aldric-pike', 'walter-barrow']);
  });

  it('names ties pointing at somebody the record has never heard of', () => {
    const village = new Community(
      community(['barrow'], [tie('debt', 'walter-barrow', 'aldric-pyke')]),
    );
    expect(village.strayFor(['walter-barrow', 'aldric-pike'])).toEqual(['aldric-pyke']);
    expect(village.strayFor(['walter-barrow', 'aldric-pyke'])).toEqual([]);
  });
});

describe('what a community file must hold', () => {
  it('refuses a kind of family or a kind of tie it has no word for', () => {
    const base = community(['brewer'], []);
    expect(
      CommunitySchema.safeParse({
        ...base,
        families: [{ ...base.families[0], kind: 'noble' }],
      }).success,
    ).toBe(false);
    expect(
      CommunitySchema.safeParse({
        ...base,
        ties: [{ kind: 'nemesis', between: ['a-one', 'b-two'], note: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('refuses a tie that does not join exactly two people', () => {
    const base = community(['brewer'], []);
    const withBetween = (between: unknown) =>
      CommunitySchema.safeParse({ ...base, ties: [{ kind: 'kin', between, note: 'x' }] }).success;
    expect(withBetween(['a-one', 'b-two'])).toBe(true);
    expect(withBetween(['a-one'])).toBe(false);
    expect(withBetween(['a-one', 'b-two', 'c-three'])).toBe(false);
  });

  it('allows a village with families and no ties, but not the other way round', () => {
    expect(CommunitySchema.safeParse(community(['brewer'], [])).success).toBe(true);
    expect(CommunitySchema.safeParse(community([], [])).success).toBe(false);
  });
});
