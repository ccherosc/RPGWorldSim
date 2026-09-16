import { describe, expect, it } from 'vitest';
import { EntityKind, makeEntityId } from '@rpgsim/sim-core';
import {
  Access,
  BuildingType,
  LocationType,
  MAX_CONDITION,
  makeBuilding,
  makeLocation,
} from '../src/location.ts';

/**
 * Places and buildings, as values.
 *
 * These are almost entirely refusal tests. A location is written once at
 * worldgen and read for the rest of the world's life, so a bad field does not
 * announce itself — it sits there until a villager walks into a building with
 * capacity zero and the simulation quietly decides nobody can ever go home.
 * sim-core rule 10 says invalid state is reported, never absorbed, and the
 * cheapest place to report it is at construction.
 */

const loc = (n: number) => makeEntityId(EntityKind.Location, n);
const npc = (n: number) => makeEntityId(EntityKind.Npc, n);

const square = () =>
  makeLocation({
    id: loc(0),
    name: 'The Green',
    type: LocationType.Square,
    coordinate: { x: 0, y: 0 },
  });

describe('makeLocation', () => {
  it('defaults to a public, unbounded, unowned place', () => {
    expect(square()).toEqual({
      id: 'location:0',
      name: 'The Green',
      type: 'square',
      coordinate: { x: 0, y: 0 },
      capacity: null,
      access: 'public',
      permitted: [],
      owner: null,
      region: null,
    });
  });

  it('keeps every field it is given', () => {
    const cottage = makeLocation({
      id: loc(3),
      name: 'Hale Cottage',
      type: LocationType.Dwelling,
      coordinate: { x: -40, y: 115 },
      capacity: 5,
      access: Access.Private,
      permitted: [npc(2), npc(1)],
      owner: npc(1),
      region: makeEntityId(EntityKind.Region, 0),
    });

    expect(cottage.capacity).toBe(5);
    expect(cottage.access).toBe('private');
    expect(cottage.owner).toBe('npc:1');
    expect(cottage.region).toBe('region:0');
    expect(cottage.coordinate).toEqual({ x: -40, y: 115 });
  });

  it('refuses a location with no id, name or type', () => {
    expect(() => makeLocation({ id: 'not an id' as never, name: 'x', type: 'square', coordinate: { x: 0, y: 0 } })).toThrow(
      /not a valid entity id/,
    );
    expect(() => makeLocation({ id: loc(0), name: '', type: 'square', coordinate: { x: 0, y: 0 } })).toThrow(
      /name must not be empty/,
    );
    expect(() => makeLocation({ id: loc(0), name: 'x', type: '', coordinate: { x: 0, y: 0 } })).toThrow(
      /type must not be empty/,
    );
  });

  // Coordinates end up in the state hash. A float that a later refactor rounds
  // differently would change the hash of a world in which nothing moved.
  it('refuses non-integer coordinates', () => {
    expect(() =>
      makeLocation({ id: loc(0), name: 'x', type: 'square', coordinate: { x: 1.5, y: 0 } }),
    ).toThrow(/integer/);
    expect(() =>
      makeLocation({ id: loc(0), name: 'x', type: 'square', coordinate: { x: 0, y: Number.NaN } }),
    ).toThrow(/integer/);
  });

  it('refuses a capacity that is not a positive integer', () => {
    for (const capacity of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        makeLocation({ id: loc(0), name: 'x', type: 'square', coordinate: { x: 0, y: 0 }, capacity }),
      ).toThrow(/capacity/);
    }
  });

  // Infinity is the obvious way to spell "unbounded" and it is a trap: canonical
  // JSON refuses non-finite numbers, so a location with infinite capacity would
  // build fine and then make the whole world unsaveable. `null` is the spelling.
  it('refuses Infinity as a capacity and accepts null instead', () => {
    expect(() =>
      makeLocation({
        id: loc(0),
        name: 'x',
        type: 'square',
        coordinate: { x: 0, y: 0 },
        capacity: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/capacity/);
    expect(
      makeLocation({ id: loc(0), name: 'x', type: 'square', coordinate: { x: 0, y: 0 }, capacity: null })
        .capacity,
    ).toBeNull();
  });

  it('refuses a permitted list on a public location, where it would never be read', () => {
    expect(() =>
      makeLocation({
        id: loc(0),
        name: 'x',
        type: 'square',
        coordinate: { x: 0, y: 0 },
        permitted: [npc(1)],
      }),
    ).toThrow(/public location cannot have a permitted list/);
  });

  it('sorts the permitted list numerically and refuses duplicates', () => {
    const cottage = makeLocation({
      id: loc(0),
      name: 'x',
      type: 'dwelling',
      coordinate: { x: 0, y: 0 },
      access: Access.Private,
      permitted: [npc(10), npc(2), npc(9)],
    });
    // Not ['npc:10', 'npc:2', 'npc:9'] — a plain string sort would order it that
    // way and make two identical households diff as different.
    expect(cottage.permitted).toEqual(['npc:2', 'npc:9', 'npc:10']);

    expect(() =>
      makeLocation({
        id: loc(0),
        name: 'x',
        type: 'dwelling',
        coordinate: { x: 0, y: 0 },
        access: Access.Private,
        permitted: [npc(1), npc(1)],
      }),
    ).toThrow(/duplicate/);
  });

  it('is frozen, so a caller cannot edit a place out from under the map', () => {
    const place = square();
    expect(Object.isFrozen(place)).toBe(true);
    expect(Object.isFrozen(place.coordinate)).toBe(true);
    expect(Object.isFrozen(place.permitted)).toBe(true);
  });
});

describe('makeBuilding', () => {
  it('defaults to sound condition, unowned and empty', () => {
    expect(
      makeBuilding({ id: makeEntityId(EntityKind.Building, 0), name: 'The Mill', type: BuildingType.Mill, location: loc(4) }),
    ).toEqual({
      id: 'building:0',
      name: 'The Mill',
      type: 'mill',
      location: 'location:4',
      owner: null,
      residents: [],
      condition: MAX_CONDITION,
    });
  });

  it('refuses a condition outside its range or with a fractional part', () => {
    for (const condition of [-1, 101, 50.5]) {
      expect(() =>
        makeBuilding({
          id: makeEntityId(EntityKind.Building, 0),
          name: 'x',
          type: 'cottage',
          location: loc(0),
          condition,
        }),
      ).toThrow(/condition/);
    }
  });

  it('refuses an interior that is not an entity id', () => {
    expect(() =>
      makeBuilding({
        id: makeEntityId(EntityKind.Building, 0),
        name: 'x',
        type: 'cottage',
        location: 'nowhere' as never,
      }),
    ).toThrow(/location is not a valid entity id/);
  });

  it('sorts residents numerically and refuses duplicates', () => {
    const cottage = makeBuilding({
      id: makeEntityId(EntityKind.Building, 0),
      name: 'x',
      type: 'cottage',
      location: loc(0),
      residents: [npc(12), npc(3)],
    });
    expect(cottage.residents).toEqual(['npc:3', 'npc:12']);

    expect(() =>
      makeBuilding({
        id: makeEntityId(EntityKind.Building, 0),
        name: 'x',
        type: 'cottage',
        location: loc(0),
        residents: [npc(3), npc(3)],
      }),
    ).toThrow(/duplicate/);
  });
});
