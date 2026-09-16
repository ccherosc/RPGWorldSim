import {
  type Brand,
  type JsonObject,
  type JsonValue,
  assert,
  isJsonObject,
} from '@rpgsim/shared';

/**
 * A globally unique, stable identifier of the form `kind:number`, for example
 * `npc:42` or `household:7`.
 *
 * Ids are allocated from per-kind monotonic counters held in world state, so
 * they are deterministic (the same seed allocates the same ids in the same
 * order) and they survive save/load. An id is never reused, even after the
 * entity it names is destroyed, so a dangling reference in an old memory or
 * event can always be recognised as dangling rather than silently resolving to
 * a different entity.
 */
export type EntityId = Brand<string, 'EntityId'>;

/**
 * Known entity kinds.
 *
 * `EntityKind` stays a plain string so later phases can add kinds without
 * touching sim-core, but the constants below are the canonical spellings and
 * should be used instead of string literals.
 */
export const EntityKind = {
  Npc: 'npc',
  Household: 'household',
  Building: 'building',
  Location: 'location',
  Region: 'region',
  Item: 'item',
  Stack: 'stack',
  Field: 'field',
  Animal: 'animal',
  Business: 'business',
  Memory: 'memory',
  Goal: 'goal',
  Relationship: 'relationship',
  Contract: 'contract',
} as const;

export type EntityKindName = (typeof EntityKind)[keyof typeof EntityKind] | (string & {});

const ID_SEPARATOR = ':';
const KIND_PATTERN = /^[a-z][a-z0-9_]*$/;

export function makeEntityId(kind: EntityKindName, index: number): EntityId {
  assert(KIND_PATTERN.test(kind), 'entity kind must be lower_snake_case', { kind });
  assert(Number.isSafeInteger(index) && index >= 0, 'entity index must be a non-negative integer', {
    index,
  });
  return `${kind}${ID_SEPARATOR}${index}` as EntityId;
}

export function entityKindOf(id: EntityId): string {
  const separator = id.indexOf(ID_SEPARATOR);
  assert(separator > 0, 'malformed entity id', { id });
  return id.slice(0, separator);
}

export function entityIndexOf(id: EntityId): number {
  const separator = id.indexOf(ID_SEPARATOR);
  assert(separator > 0, 'malformed entity id', { id });
  const index = Number(id.slice(separator + 1));
  assert(Number.isSafeInteger(index) && index >= 0, 'malformed entity id', { id });
  return index;
}

export function isEntityId(value: unknown): value is EntityId {
  if (typeof value !== 'string') return false;
  const separator = value.indexOf(ID_SEPARATOR);
  if (separator <= 0) return false;
  if (!KIND_PATTERN.test(value.slice(0, separator))) return false;
  const index = Number(value.slice(separator + 1));
  return Number.isSafeInteger(index) && index >= 0;
}

/**
 * Sort comparator giving a stable, human-sensible ordering: by kind, then by
 * numeric index. Lexicographic string sort would order `npc:10` before `npc:9`,
 * which makes diffing two saves unnecessarily painful.
 */
export function compareEntityIds(a: EntityId, b: EntityId): number {
  const kindA = entityKindOf(a);
  const kindB = entityKindOf(b);
  if (kindA !== kindB) return kindA < kindB ? -1 : 1;
  return entityIndexOf(a) - entityIndexOf(b);
}

export interface IdGeneratorSnapshot {
  readonly counters: Record<string, number>;
}

/** Allocates entity ids from per-kind monotonic counters. */
export class IdGenerator {
  private readonly counters = new Map<string, number>();

  next(kind: EntityKindName): EntityId {
    const index = this.counters.get(kind) ?? 0;
    this.counters.set(kind, index + 1);
    return makeEntityId(kind, index);
  }

  /** How many ids of this kind have ever been allocated. */
  allocated(kind: EntityKindName): number {
    return this.counters.get(kind) ?? 0;
  }

  save(): IdGeneratorSnapshot {
    const counters: Record<string, number> = {};
    for (const kind of [...this.counters.keys()].sort()) {
      counters[kind] = this.counters.get(kind) as number;
    }
    return { counters };
  }

  /**
   * Restore counters. Counters may only move forwards: rewinding one would let
   * the generator hand out an id that an existing entity already holds.
   */
  restore(snapshot: IdGeneratorSnapshot): void {
    this.counters.clear();
    for (const [kind, count] of Object.entries(snapshot.counters)) {
      assert(
        Number.isSafeInteger(count) && count >= 0,
        'id counter must be a non-negative integer',
        { kind, count },
      );
      this.counters.set(kind, count);
    }
  }

  toJson(): JsonObject {
    return { counters: { ...this.save().counters } };
  }

  static fromJson(value: JsonValue): IdGeneratorSnapshot {
    assert(isJsonObject(value), 'id generator snapshot must be an object');
    const raw = value['counters'];
    assert(isJsonObject(raw), 'id generator snapshot is missing counters');
    const counters: Record<string, number> = {};
    for (const [kind, count] of Object.entries(raw)) {
      assert(typeof count === 'number', 'id counter must be a number', { kind });
      counters[kind] = count;
    }
    return { counters };
  }
}
