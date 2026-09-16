import { describe, expect, it } from 'vitest';
import {
  EntityKind,
  IdGenerator,
  compareEntityIds,
  entityIndexOf,
  entityKindOf,
  isEntityId,
  makeEntityId,
} from '../src/ids.ts';
import type { EntityId } from '../src/ids.ts';

/**
 * Entity identity.
 *
 * Ids are the one thing every other system holds a reference to — an event's
 * actors, a memory's subject, an inventory's owner — so an id that is wrong,
 * reused or accepted when it should have been refused corrupts everything
 * downstream and does it silently. These tests are mostly about refusal.
 */

describe('makeEntityId', () => {
  it('builds kind:index ids', () => {
    expect(makeEntityId(EntityKind.Npc, 0)).toBe('npc:0');
    expect(makeEntityId(EntityKind.Household, 7)).toBe('household:7');
    expect(makeEntityId('custom_kind', 3)).toBe('custom_kind:3');
  });

  // Regression. `RegExp.test` coerces its argument, so `KIND_PATTERN.test(undefined)`
  // tests the string "undefined" and passes, which produced a valid-looking
  // `undefined:0` id from a kind that was never supplied. A kind can arrive
  // undefined at runtime from a data file, a save file, or JS calling in
  // untypechecked, and sim-core rule 10 forbids absorbing that silently.
  it('refuses a non-string kind instead of coercing it', () => {
    const missing = undefined as unknown as string;
    expect(() => makeEntityId(missing, 0)).toThrow(/entity kind must be a string/);
    expect(() => makeEntityId(null as unknown as string, 0)).toThrow(/must be a string/);
    expect(() => makeEntityId(42 as unknown as string, 0)).toThrow(/must be a string/);
    expect(() => makeEntityId({} as unknown as string, 0)).toThrow(/must be a string/);
  });

  it('refuses kinds that are not lower_snake_case', () => {
    for (const kind of ['', 'Npc', 'NPC', 'npc-kind', 'npc kind', '1npc', '_npc', 'npc:sub', 'ñpc']) {
      expect(() => makeEntityId(kind, 0)).toThrow(/lower_snake_case/);
    }
  });

  it('refuses indices that are not non-negative safe integers', () => {
    for (const index of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => makeEntityId(EntityKind.Npc, index)).toThrow(/non-negative integer/);
    }
  });

  it('accepts index zero and the largest safe index', () => {
    expect(makeEntityId(EntityKind.Npc, 0)).toBe('npc:0');
    expect(makeEntityId(EntityKind.Npc, Number.MAX_SAFE_INTEGER)).toBe(
      `npc:${Number.MAX_SAFE_INTEGER}`,
    );
  });
});

describe('reading an id back', () => {
  it('round-trips kind and index', () => {
    const id = makeEntityId(EntityKind.Building, 1234);
    expect(entityKindOf(id)).toBe('building');
    expect(entityIndexOf(id)).toBe(1234);
  });

  it('refuses malformed ids rather than guessing', () => {
    for (const bad of ['npc', ':5', 'npc:', 'npc:abc', 'npc:-1', 'npc:1.5', '']) {
      expect(() => entityIndexOf(bad as EntityId)).toThrow(/entity id/);
    }
  });

  // Regression. These all used to parse, because `Number` accepts far more than
  // an identifier should: `Number('')` is 0, `Number(' 5 ')` is 5,
  // `Number('0x10')` is 16, `Number('1e3')` is 1000. Each one resolved a
  // malformed id to a real but *different* entity — silently, which is the one
  // outcome worse than an error. Leading zeros are refused for the same reason:
  // `npc:007` and `npc:7` must not be two spellings of one entity, or comparing
  // ids as strings stops working.
  it('refuses index forms that Number would happily coerce', () => {
    for (const bad of ['npc:', 'npc: 5', 'npc:5 ', 'npc:0x10', 'npc:1e3', 'npc:+5', 'npc:007']) {
      expect(() => entityIndexOf(bad as EntityId)).toThrow(/malformed entity id/);
      expect(isEntityId(bad)).toBe(false);
    }
  });

  it('refuses an index beyond safe integer range instead of rounding it', () => {
    // Number('9007199254740993') rounds to 9007199254740992 — a different entity.
    expect(() => entityIndexOf('npc:9007199254740993' as EntityId)).toThrow(/safe integer/);
    expect(isEntityId('npc:9007199254740993')).toBe(false);
  });

  it('recognises valid ids and rejects everything else', () => {
    expect(isEntityId('npc:0')).toBe(true);
    expect(isEntityId('custom_kind:99')).toBe(true);
    for (const bad of ['npc', 'Npc:1', 'npc:-1', 'npc:x', '', ':1', 5, null, undefined, {}]) {
      expect(isEntityId(bad)).toBe(false);
    }
  });

  it('agrees with makeEntityId on every id it produces', () => {
    for (const kind of [EntityKind.Npc, EntityKind.Household, 'custom_kind']) {
      for (const index of [0, 1, 9, 10, 999, Number.MAX_SAFE_INTEGER]) {
        const id = makeEntityId(kind, index);
        expect(isEntityId(id)).toBe(true);
        expect(entityKindOf(id)).toBe(kind);
        expect(entityIndexOf(id)).toBe(index);
      }
    }
  });
});

describe('compareEntityIds', () => {
  it('orders by kind, then numerically by index', () => {
    const ids: EntityId[] = [
      makeEntityId(EntityKind.Npc, 10),
      makeEntityId(EntityKind.Household, 2),
      makeEntityId(EntityKind.Npc, 9),
      makeEntityId(EntityKind.Npc, 1),
      makeEntityId(EntityKind.Household, 10),
    ];
    expect([...ids].sort(compareEntityIds)).toEqual([
      'household:2',
      'household:10',
      'npc:1',
      'npc:9',
      'npc:10',
    ]);
  });

  // The whole reason the comparator exists: a plain string sort puts npc:10
  // before npc:9, which makes two saves diff as though everything moved.
  it('does not fall back to lexicographic order', () => {
    const lexicographic = ['npc:1', 'npc:10', 'npc:9'] as EntityId[];
    expect([...lexicographic].sort(compareEntityIds)).toEqual(['npc:1', 'npc:9', 'npc:10']);
  });

  it('is a consistent total order', () => {
    const a = makeEntityId(EntityKind.Npc, 1);
    const b = makeEntityId(EntityKind.Npc, 2);
    expect(compareEntityIds(a, a)).toBe(0);
    expect(Math.sign(compareEntityIds(a, b))).toBe(-Math.sign(compareEntityIds(b, a)));
  });
});

describe('IdGenerator', () => {
  it('allocates monotonically from zero, per kind', () => {
    const ids = new IdGenerator();
    expect(ids.next(EntityKind.Npc)).toBe('npc:0');
    expect(ids.next(EntityKind.Npc)).toBe('npc:1');
    expect(ids.next(EntityKind.Item)).toBe('item:0');
    expect(ids.next(EntityKind.Npc)).toBe('npc:2');
    expect(ids.allocated(EntityKind.Npc)).toBe(3);
    expect(ids.allocated(EntityKind.Item)).toBe(1);
    expect(ids.allocated(EntityKind.Animal)).toBe(0);
  });

  it('allocates the same sequence for the same calls', () => {
    const script = (ids: IdGenerator): EntityId[] => [
      ids.next(EntityKind.Npc),
      ids.next(EntityKind.Household),
      ids.next(EntityKind.Npc),
      ids.next(EntityKind.Building),
    ];
    expect(script(new IdGenerator())).toEqual(script(new IdGenerator()));
  });

  it('never reuses an id, so a dangling reference stays recognisably dangling', () => {
    const ids = new IdGenerator();
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(ids.next(EntityKind.Npc));
    expect(seen.size).toBe(500);

    // Simulate the entity being destroyed and another created in its place.
    const replacement = ids.next(EntityKind.Npc);
    expect(seen.has(replacement)).toBe(false);
  });

  it('survives save and restore without handing out a used id', () => {
    const ids = new IdGenerator();
    const before = [ids.next(EntityKind.Npc), ids.next(EntityKind.Npc), ids.next(EntityKind.Item)];

    const restored = new IdGenerator();
    restored.restore(ids.save());
    const after = [restored.next(EntityKind.Npc), restored.next(EntityKind.Item)];

    expect(after).toEqual(['npc:2', 'item:1']);
    for (const id of after) expect(before).not.toContain(id);
  });

  it('serialises counters in sorted order so saves are canonical', () => {
    const ids = new IdGenerator();
    ids.next(EntityKind.Npc);
    ids.next(EntityKind.Animal);
    ids.next(EntityKind.Household);

    expect(Object.keys(ids.save().counters)).toEqual(['animal', 'household', 'npc']);
  });

  it('round-trips through JSON', () => {
    const ids = new IdGenerator();
    ids.next(EntityKind.Npc);
    ids.next(EntityKind.Npc);
    ids.next(EntityKind.Field);

    const restored = new IdGenerator();
    restored.restore(IdGenerator.fromJson(ids.toJson()));
    expect(restored.save()).toEqual(ids.save());
  });

  it('refuses a malformed snapshot', () => {
    expect(() => IdGenerator.fromJson(null)).toThrow(/must be an object/);
    expect(() => IdGenerator.fromJson({})).toThrow(/missing counters/);
    expect(() => IdGenerator.fromJson({ counters: { npc: 'many' } })).toThrow(/must be a number/);
    expect(() => new IdGenerator().restore({ counters: { npc: -1 } })).toThrow(
      /non-negative integer/,
    );
    expect(() => new IdGenerator().restore({ counters: { npc: 1.5 } })).toThrow(
      /non-negative integer/,
    );
  });

  it('restores an empty snapshot as a fresh generator', () => {
    const ids = new IdGenerator();
    ids.next(EntityKind.Npc);
    ids.restore({ counters: {} });
    expect(ids.next(EntityKind.Npc)).toBe('npc:0');
  });
});
