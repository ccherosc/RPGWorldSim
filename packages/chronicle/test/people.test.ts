import { describe, expect, it } from 'vitest';
import {
  PEOPLE_HEADER,
  PeopleRegister,
  type PersonRecord,
  familySlug,
  formatPersonLine,
  parsePersonLine,
  slugStem,
} from '@rpgsim/chronicle';
import { type EntityId, makeEntityId, EntityKind } from '@rpgsim/sim-core';

const npc = (index: number): EntityId => makeEntityId(EntityKind.Npc, index);

function person(index: number, name: string, family: string | null = null): Omit<PersonRecord, 'slug'> {
  return { id: npc(index), name, sex: 'female', born: '1160-03-02', family };
}

describe('turning a name into a handle', () => {
  it('uses the whole name, so a household is not four numbered strangers', () => {
    expect(slugStem('Jocelin Netherby')).toBe('jocelin-netherby');
    expect(slugStem('Agnes Hargrave')).toBe('agnes-hargrave');
  });

  it('strips punctuation and case but keeps every word', () => {
    expect(slugStem("  Rob   O'Tomlin  ")).toBe('rob-otomlin');
    expect(slugStem('Æthel the Younger')).toBe('thel-the-younger');
  });

  it('never returns an empty handle', () => {
    // Two people sharing an empty slug would be two people the annals cannot
    // tell apart, which is worse than an ugly name.
    expect(slugStem('???')).toBe('person');
    expect(slugStem('')).toBe('person');
  });

  it('names a family by its surname alone', () => {
    expect(familySlug('Netherby')).toBe('netherby');
    expect(familySlug('Jocelin Netherby')).toBe('netherby');
  });
});

describe('handing out handles', () => {
  it('suffixes a taken handle rather than displacing the person who has it', () => {
    const register = new PeopleRegister();
    const first = register.add(person(0, 'Agnes Hargrave'));
    const second = register.add(person(1, 'Agnes Hargrave'));
    const third = register.add(person(2, 'Agnes Hargrave'));

    expect(first.slug).toBe('agnes-hargrave');
    expect(second.slug).toBe('agnes-hargrave-2');
    expect(third.slug).toBe('agnes-hargrave-3');
    // The first Agnes keeps hers. That is the whole point of a suffix.
    expect(register.require(npc(0)).slug).toBe('agnes-hargrave');
  });

  it('writes a person down once', () => {
    const register = new PeopleRegister();
    const first = register.add(person(0, 'Agnes Hargrave'));
    const again = register.add(person(0, 'Agnes Hargrave'));

    expect(again).toBe(first);
    expect(register.size).toBe(1);
  });

  it('refuses to name somebody it has never heard of', () => {
    const register = new PeopleRegister();
    expect(() => register.require(npc(9))).toThrow(/no record of this person/);
  });

  it('refuses anything that is not a person', () => {
    const register = new PeopleRegister();
    const household = makeEntityId(EntityKind.Household, 0);
    expect(() => register.add({ ...person(0, 'Agnes Hargrave'), id: household })).toThrow(
      /holds people/,
    );
  });
});

describe('the file, read back', () => {
  it('round-trips a line without losing a fact', () => {
    const record: PersonRecord = { ...person(3, 'Agnes Hargrave', 'hargrave'), slug: 'agnes-hargrave' };
    expect(parsePersonLine(formatPersonLine(record))).toEqual(record);
  });

  it('reads an absent family back as absent, not as a dash', () => {
    const record: PersonRecord = { ...person(3, 'Agnes Hargrave', null), slug: 'agnes-hargrave' };
    const line = formatPersonLine(record);
    expect(line.split('\t')[5]).toBe('-');
    expect(parsePersonLine(line).family).toBeNull();
  });

  it('keeps allocating where the file left off', () => {
    // The point of writing the slug into the file: a register reopened tomorrow
    // needs no counter to persist and no counter to get out of step with.
    const written = new PeopleRegister();
    written.add(person(0, 'Agnes Hargrave'));
    written.add(person(1, 'Agnes Hargrave'));
    const text = [PEOPLE_HEADER, ...written.records().map(formatPersonLine), ''].join('\n');

    const reopened = PeopleRegister.parse(text);
    expect(reopened.size).toBe(2);
    expect(reopened.add(person(2, 'Agnes Hargrave')).slug).toBe('agnes-hargrave-3');
  });

  it('refuses a row that does not have the columns it should', () => {
    expect(() => parsePersonLine('agnes\tnpc:1\tAgnes Hargrave')).toThrow(/wrong number of columns/);
  });

  it('refuses to write a value that would break the format', () => {
    const record: PersonRecord = {
      ...person(3, 'Agnes\tHargrave', null),
      slug: 'agnes-hargrave',
    };
    expect(() => formatPersonLine(record)).toThrow(/may not contain a tab/);
  });
});
