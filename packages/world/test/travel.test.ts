import { describe, expect, it } from 'vitest';
import {
  type EntityId,
  EntityKind,
  type SimEvent,
  Simulation,
  makeEntityId,
} from '@rpgsim/sim-core';
import { Access, LocationType, makeLocation } from '../src/location.ts';
import { WorldMap } from '../src/map.ts';
import { installWorld } from '../src/save.ts';
import { type Journey, TRAVEL_SAVE_MODULE_ID, TravelSystem, installTravel } from '../src/travel.ts';

/**
 * Movement, adversarially.
 *
 * PHASE_1.md calls this "the first system that can violate Prime Directive 7",
 * and the violations it is worried about are all variations on one thing: a
 * person who stops being anywhere. Travel is the only code in the world that
 * takes someone off the map on purpose, so every test here is ultimately asking
 * whether that person came back.
 *
 * The second theme is time. A walk that finishes early, finishes twice, or
 * finishes without having started is a broken world that still hashes fine, so
 * the timing assertions check the tick before arrival as well as the tick of it.
 */

const loc = (n: number) => makeEntityId(EntityKind.Location, n);
const npc = (n: number) => makeEntityId(EntityKind.Npc, n);

const SQUARE = loc(0);
const STREET = loc(1);
const COTTAGE = loc(2);
const TAVERN = loc(3);
const ISLE = loc(4);
const VESTRY = loc(5);

const SQUARE_TO_STREET = 30;
const STREET_TO_COTTAGE = 20;
const SQUARE_TO_TAVERN = 50;
const STREET_TO_VESTRY = 15;

/**
 * A village with a two-leg walk in it.
 *
 * The cottage is reachable only through the street, so `SQUARE → COTTAGE` is a
 * journey with an intermediate stop — the case a single-hop implementation gets
 * wrong. The isle is connected to nothing, which is the only honest way to test
 * a refused route. The tavern holds two, so the last seat can be fought over.
 * The vestry is private and also two legs away, so a traveller can be turned
 * away at a door they had to walk to first.
 */
function village(): WorldMap {
  const map = new WorldMap();
  map.addLocation(
    makeLocation({ id: SQUARE, name: 'The Green', type: LocationType.Square, coordinate: { x: 0, y: 0 } }),
  );
  map.addLocation(
    makeLocation({ id: STREET, name: 'Mill Road', type: LocationType.Street, coordinate: { x: 30, y: 0 } }),
  );
  map.addLocation(
    makeLocation({
      id: COTTAGE,
      name: 'Hale Cottage',
      type: LocationType.Dwelling,
      coordinate: { x: 55, y: 20 },
      capacity: 3,
    }),
  );
  map.addLocation(
    makeLocation({
      id: VESTRY,
      name: 'The Vestry',
      type: LocationType.Church,
      coordinate: { x: 30, y: 40 },
      capacity: 2,
      access: Access.Private,
      owner: npc(0),
      permitted: [npc(1)],
    }),
  );
  map.addLocation(
    makeLocation({ id: TAVERN, name: 'The Boar', type: LocationType.Tavern, coordinate: { x: 20, y: -30 }, capacity: 2 }),
  );
  map.addLocation(
    makeLocation({ id: ISLE, name: 'The Isle', type: LocationType.Boundary, coordinate: { x: 900, y: 0 } }),
  );

  map.connect(SQUARE, STREET, SQUARE_TO_STREET);
  map.connect(STREET, COTTAGE, STREET_TO_COTTAGE);
  map.connect(SQUARE, TAVERN, SQUARE_TO_TAVERN);
  map.connect(STREET, VESTRY, STREET_TO_VESTRY);
  return map;
}

interface World {
  readonly sim: Simulation;
  readonly map: WorldMap;
  readonly travel: TravelSystem;
  /** Every event of a type, in the order it was recorded. */
  readonly events: (type: string) => SimEvent[];
}

/**
 * A world with the isle deliberately left unconnected.
 *
 * `world.graph-is-connected` therefore reports one violation in every test
 * here, which is correct and is why these tests never assert an empty report —
 * they assert that no *travel* or *occupancy* invariant fired.
 */
function world(seed = 'world-zero'): World {
  const sim = new Simulation({ seed });
  const map = installWorld(sim);
  const travel = installTravel(sim, map);
  return { sim, map, travel, events: (type) => sim.log.byType(type, 1000) };
}

/** A village, wired, with `who` standing in the square. */
function departing(who: EntityId = npc(0), seed = 'world-zero'): World {
  const w = world(seed);
  w.map.restore(village().save());
  w.map.place(who, SQUARE);
  return w;
}

/** Violations from every invariant except the deliberately broken connectivity one. */
const troubles = (sim: Simulation): string[] =>
  sim
    .checkInvariants()
    .violations.filter((v) => v.invariantId !== 'world.graph-is-connected')
    .map((v) => `${v.invariantId}: ${v.message}`);

describe('setting out', () => {
  it('leaves the origin and takes a seat at the next place', () => {
    const { sim, map, travel } = departing();
    const outcome = travel.begin(npc(0), COTTAGE);

    expect(outcome.started).toBe(true);
    // Off the map entirely: not in the square they left, not yet in the street.
    expect(map.isPlaced(npc(0))).toBe(false);
    expect(map.occupantsOf(SQUARE)).toEqual([]);
    expect(map.occupantsOf(STREET)).toEqual([]);
    expect(map.reservationOf(npc(0))).toBe(STREET);
    expect(travel.isTravelling(npc(0))).toBe(true);
    expect(travel.destinationOf(npc(0))).toBe(COTTAGE);
    expect(troubles(sim)).toEqual([]);
  });

  it('emits travel.departed naming the leg, not the journey', () => {
    const { travel, events } = departing();
    travel.begin(npc(0), COTTAGE);

    const departed = events('travel.departed');
    expect(departed).toHaveLength(1);
    expect(departed[0]?.data).toMatchObject({
      traveller: 'npc:0',
      from: SQUARE,
      to: STREET,
      destination: COTTAGE,
      cost: SQUARE_TO_STREET,
      arrivesAt: SQUARE_TO_STREET,
    });
    expect(departed[0]?.location).toBe(SQUARE);
  });

  it('is not a journey when the traveller is already there', () => {
    const { travel, events } = departing();
    const outcome = travel.begin(npc(0), SQUARE);

    expect(outcome).toEqual({ started: false, reason: 'already-there' });
    expect(travel.isTravelling(npc(0))).toBe(false);
    // Neither a departure nor a refusal: nothing happened, so nothing is said.
    expect(events('travel.departed')).toHaveLength(0);
    expect(events('travel.blocked')).toHaveLength(0);
  });
});

describe('arriving', () => {
  it('arrives at the tick the edge costs, and not one tick sooner', () => {
    const { sim, map, travel } = departing();
    travel.begin(npc(0), STREET);

    sim.runUntil(SQUARE_TO_STREET - 1);
    expect(map.isPlaced(npc(0))).toBe(false);
    expect(travel.isTravelling(npc(0))).toBe(true);

    sim.runUntil(SQUARE_TO_STREET);
    expect(map.locationOf(npc(0))).toBe(STREET);
    expect(travel.isTravelling(npc(0))).toBe(false);
    expect(map.reservationOf(npc(0))).toBeUndefined();
  });

  it('walks a two-leg route through the place in between', () => {
    const { sim, map, travel, events } = departing();
    travel.begin(npc(0), COTTAGE);

    // At the tick the first leg ends the traveller reaches the street and walks
    // straight on, so they are on the road again in the same tick rather than
    // standing there. What makes the pass-through observable is the recorded
    // arrival, not a pause: the street is somewhere they were, at a known tick.
    sim.runUntil(SQUARE_TO_STREET);
    expect(travel.isTravelling(npc(0))).toBe(true);
    expect(travel.journeyOf(npc(0))?.leg).toBe(1);
    expect(map.reservationOf(npc(0))).toBe(COTTAGE);

    sim.runUntil(SQUARE_TO_STREET + STREET_TO_COTTAGE);
    expect(map.locationOf(npc(0))).toBe(COTTAGE);
    expect(travel.isTravelling(npc(0))).toBe(false);

    expect(events('travel.departed').map((e) => e.data)).toMatchObject([
      { from: SQUARE, to: STREET },
      { from: STREET, to: COTTAGE },
    ]);
    expect(events('travel.arrived').map((e) => e.data)).toMatchObject([
      { at: STREET, final: false, travelled: SQUARE_TO_STREET },
      { at: COTTAGE, final: true, travelled: SQUARE_TO_STREET + STREET_TO_COTTAGE },
    ]);
  });

  it('takes exactly the route cost, no more and no less', () => {
    const { sim, map, travel } = departing();
    const route = map.findRoute(SQUARE, COTTAGE);
    travel.begin(npc(0), COTTAGE);

    sim.runUntil((route?.cost ?? 0) - 1);
    expect(map.locationOf(npc(0))).not.toBe(COTTAGE);
    sim.runUntil(route?.cost ?? 0);
    expect(map.locationOf(npc(0))).toBe(COTTAGE);
  });

  it('leaves a clean world at every tick of a journey', () => {
    const { sim, map, travel } = departing();
    travel.begin(npc(0), COTTAGE);

    for (let tick = 0; tick <= SQUARE_TO_STREET + STREET_TO_COTTAGE; tick++) {
      sim.runUntil(tick);
      expect(troubles(sim), `tick ${tick}`).toEqual([]);
      // The heart of it: at no tick is the traveller in two states or neither.
      const placed = map.isPlaced(npc(0));
      const walking = travel.isTravelling(npc(0));
      expect(placed !== walking, `tick ${tick}: placed=${placed} walking=${walking}`).toBe(true);
    }
  });
});

describe('refusals', () => {
  it('refuses a destination that does not exist', () => {
    const { map, travel, events } = departing();
    const outcome = travel.begin(npc(0), loc(99));

    expect(outcome).toMatchObject({ started: false, reason: 'unknown-destination' });
    expect(map.locationOf(npc(0))).toBe(SQUARE);
    expect(events('travel.blocked')[0]?.data).toMatchObject({ reason: 'unknown-destination' });
  });

  it('refuses a destination with no road to it', () => {
    const { map, travel, events } = departing();
    const outcome = travel.begin(npc(0), ISLE);

    expect(outcome).toMatchObject({ started: false, reason: 'no-route' });
    expect(map.locationOf(npc(0))).toBe(SQUARE);
    expect(events('travel.blocked')[0]?.data).toMatchObject({ reason: 'no-route', origin: SQUARE });
  });

  it('refuses a traveller who is not on the map at all', () => {
    const { travel } = departing();
    const outcome = travel.begin(npc(7), TAVERN);

    expect(outcome).toMatchObject({ started: false, reason: 'not-placed' });
    expect(travel.isTravelling(npc(7))).toBe(false);
  });

  it('refuses a second journey while the first is under way', () => {
    const { travel, events } = departing();
    travel.begin(npc(0), COTTAGE);
    const outcome = travel.begin(npc(0), TAVERN);

    expect(outcome).toMatchObject({ started: false, reason: 'already-travelling' });
    expect(travel.destinationOf(npc(0))).toBe(COTTAGE);
    expect(events('travel.blocked')[0]?.data).toMatchObject({ headedFor: COTTAGE });
  });

  it('refuses a door the traveller is not permitted through, and leaves them where they were', () => {
    const { sim, map, travel, events } = departing(npc(5));
    map.remove(npc(5));
    map.place(npc(5), STREET); // one step from the vestry door

    const outcome = travel.begin(npc(5), VESTRY);

    expect(outcome).toMatchObject({ started: false, reason: 'forbidden' });
    expect(map.locationOf(npc(5))).toBe(STREET);
    expect(map.reservationOf(npc(5))).toBeUndefined();
    expect(travel.isTravelling(npc(5))).toBe(false);
    expect(events('travel.blocked')[0]?.data).toMatchObject({ reason: 'forbidden', to: VESTRY });
    expect(troubles(sim)).toEqual([]);
  });

  /**
   * Nobody is refused for a door they have not reached yet.
   *
   * A villager who cannot enter the vestry can still walk to its door, and
   * finding that out when they get there is both physically true and better
   * material than a journey that never happened. Pre-checking the destination
   * at departure would also be knowledge the traveller may not have, which
   * Prime Directive 5 does not allow the simulation to hand them for free.
   */
  it('lets a traveller walk to a door that will be shut, and turns them away at it', () => {
    const { sim, map, travel, events } = departing(npc(5));
    const outcome = travel.begin(npc(5), VESTRY);

    expect(outcome.started).toBe(true);

    sim.runUntil(SQUARE_TO_STREET + STREET_TO_VESTRY);

    expect(map.locationOf(npc(5))).toBe(STREET);
    expect(travel.isTravelling(npc(5))).toBe(false);
    expect(map.reservationOf(npc(5))).toBeUndefined();
    expect(events('travel.blocked').at(-1)?.data).toMatchObject({
      reason: 'forbidden',
      from: STREET,
      to: VESTRY,
    });
    expect(troubles(sim)).toEqual([]);
  });

  it('refuses a full room and leaves the traveller standing where they were', () => {
    const { sim, map, travel, events } = departing();
    map.place(npc(1), TAVERN);
    map.place(npc(2), TAVERN); // capacity 2, now full

    const outcome = travel.begin(npc(0), TAVERN);

    expect(outcome).toMatchObject({ started: false, reason: 'full' });
    expect(map.locationOf(npc(0))).toBe(SQUARE);
    expect(events('travel.blocked')[0]?.data).toMatchObject({
      reason: 'full',
      capacity: 2,
      occupancy: 2,
    });
    expect(troubles(sim)).toEqual([]);
  });

  it('refuses a partly-walked journey at the leg it cannot take, leaving the traveller at the last place', () => {
    const { sim, map, travel, events } = departing();
    // Two already inside; the cottage holds three, so there is room when the
    // journey begins and none by the time the second leg is due. The seat is
    // only taken one leg ahead, so the far end of a long walk is genuinely
    // unreserved while the traveller is still on the first leg.
    map.place(npc(1), COTTAGE);
    map.place(npc(2), COTTAGE);
    travel.begin(npc(0), COTTAGE);
    map.place(npc(3), COTTAGE); // the third body fills it while npc:0 walks

    sim.runUntil(SQUARE_TO_STREET + STREET_TO_COTTAGE);

    // Stopped in the street: a real place, with a real name, not nowhere.
    expect(map.locationOf(npc(0))).toBe(STREET);
    expect(travel.isTravelling(npc(0))).toBe(false);
    expect(map.reservationOf(npc(0))).toBeUndefined();
    expect(events('travel.blocked').at(-1)?.data).toMatchObject({ reason: 'full', to: COTTAGE });
    expect(troubles(sim)).toEqual([]);
  });
});

describe('the held seat', () => {
  it('keeps a third party out of the room a traveller is walking to', () => {
    const { map, travel } = departing();
    map.place(npc(1), TAVERN); // one of two seats taken

    travel.begin(npc(0), TAVERN); // npc:0 takes the second, from the road
    const gatecrasher = map.canEnter(npc(2), TAVERN);

    expect(gatecrasher).toMatchObject({ allowed: false, reason: 'full' });
    expect(map.occupancyOf(TAVERN)).toBe(1);
    expect(map.reservationsAt(TAVERN)).toEqual(['npc:0']);
  });

  it('means a walk to a room that fills up behind you still ends in that room', () => {
    const { sim, map, travel } = departing();
    map.place(npc(1), TAVERN);
    travel.begin(npc(0), TAVERN);

    // Someone tries to take the seat mid-walk and is refused, precisely because
    // it is held. Without the reservation npc:0 would arrive to a full room.
    expect(map.canEnter(npc(2), TAVERN).allowed).toBe(false);

    sim.runUntil(SQUARE_TO_TAVERN);
    expect(map.occupantsOf(TAVERN)).toEqual(['npc:0', 'npc:1']);
    expect(troubles(sim)).toEqual([]);
  });

  it('gives the last seat to whoever set out first', () => {
    const { map, travel } = departing();
    map.place(npc(1), TAVERN);
    map.place(npc(2), SQUARE);

    expect(travel.begin(npc(0), TAVERN).started).toBe(true);
    expect(travel.begin(npc(2), TAVERN)).toMatchObject({ started: false, reason: 'full' });
    expect(map.locationOf(npc(2))).toBe(SQUARE);
  });

  it('gives the seat back when the traveller is taken off the road', () => {
    const { sim, map, travel } = departing();
    travel.begin(npc(0), TAVERN);
    expect(map.reservationCountAt(TAVERN)).toBe(1);

    expect(travel.abandon(npc(0))).toBe(true);

    expect(map.reservationCountAt(TAVERN)).toBe(0);
    expect(travel.isTravelling(npc(0))).toBe(false);
    expect(map.isPlaced(npc(0))).toBe(false);
    // The cancelled arrival must not fire later and resurrect them.
    sim.runUntil(SQUARE_TO_TAVERN * 2);
    expect(map.isPlaced(npc(0))).toBe(false);
    expect(troubles(sim)).toEqual([]);
  });
});

describe('interruption', () => {
  it('stops the traveller at the next place, not in the middle of a road', () => {
    const { sim, map, travel, events } = departing();
    travel.begin(npc(0), COTTAGE);

    const stopAt = travel.interrupt(npc(0), 'changed their mind');
    expect(stopAt).toBe(STREET);
    // Still walking the leg they were on: you cannot stop where there is
    // nowhere to stand.
    expect(map.isPlaced(npc(0))).toBe(false);

    sim.runUntil(SQUARE_TO_STREET);
    expect(map.locationOf(npc(0))).toBe(STREET);
    expect(travel.isTravelling(npc(0))).toBe(false);

    expect(events('travel.blocked')[0]?.data).toMatchObject({
      reason: 'changed their mind',
      stoppingAt: STREET,
      abandoned: COTTAGE,
    });
    expect(events('travel.arrived').at(-1)?.data).toMatchObject({ at: STREET, final: true });
    expect(troubles(sim)).toEqual([]);
  });

  it('does nothing to a traveller already on their last leg', () => {
    const { sim, map, travel, events } = departing();
    travel.begin(npc(0), STREET);

    expect(travel.interrupt(npc(0))).toBe(STREET);
    expect(events('travel.blocked')).toHaveLength(0);

    sim.runUntil(SQUARE_TO_STREET);
    expect(map.locationOf(npc(0))).toBe(STREET);
  });

  it('reports that someone standing still was not travelling', () => {
    const { travel } = departing();
    expect(travel.interrupt(npc(0))).toBeUndefined();
    expect(travel.abandon(npc(0))).toBe(false);
  });
});

/**
 * Causality, which is the whole reason the event stream is worth keeping.
 *
 * `docs/CHRONICLE.md` asks that every sentence a chronicle prints trace back to
 * an event, and a trace is only as good as the `causes` links it walks. A pile
 * of departures and arrivals that all mention the same traveller is not a
 * chain; two of them at the same minute cannot be told apart.
 */
describe('the causal chain', () => {
  it('links every leg of a walk to the one before it', () => {
    const w = departing();
    const reason = w.sim.emit({ type: 'test.decided', actors: [npc(0)], data: {} });
    w.travel.begin(npc(0), COTTAGE, [reason.id]);
    w.sim.runUntil(SQUARE_TO_STREET + STREET_TO_COTTAGE);

    const departures = w.events('travel.departed');
    const arrivals = w.events('travel.arrived');
    expect(departures).toHaveLength(2);
    expect(arrivals).toHaveLength(2);

    // decision -> out of the square -> into the street -> out of the street ->
    // into the cottage. Read backwards from the last arrival, the trace answers
    // "why is this person standing in the cottage" without guessing.
    expect(departures[0]?.causes).toEqual([reason.id]);
    expect(arrivals[0]?.causes).toEqual([departures[0]?.id]);
    expect(departures[1]?.causes).toEqual([arrivals[0]?.id]);
    expect(arrivals[1]?.causes).toEqual([departures[1]?.id]);

    expect(w.sim.log.trace(arrivals[1]?.id as number).map((step) => step.event.type)).toEqual([
      'travel.arrived',
      'travel.departed',
      'travel.arrived',
      'travel.departed',
      'test.decided',
    ]);
  });

  it('gives a refusal the same cause the attempt had', () => {
    const w = departing();
    const reason = w.sim.emit({ type: 'test.decided', actors: [npc(0)], data: {} });
    w.travel.begin(npc(0), ISLE, [reason.id]);

    // A refused action is as informative as a successful one, and it is only
    // informative if it says what was being attempted.
    expect(w.events('travel.blocked')[0]?.causes).toEqual([reason.id]);
  });

  /**
   * The link survives a save, because it has to.
   *
   * The arrival cites the departure that started the leg, and the departure
   * happened before the save. If the journey did not carry that id across the
   * boundary the resumed world would emit an arrival citing nothing, which is a
   * different event from the one the uninterrupted run emits -- determinism
   * rule 8, caught by the hash rather than by inspection.
   */
  it('still cites the departure after a reload in the middle of the leg', () => {
    const straight = departing();
    straight.travel.begin(npc(0), COTTAGE);

    const resumed = world();
    straight.sim.runUntil(10);
    resumed.sim.load(straight.sim.save());

    const departed = resumed.sim.log.byType('travel.departed', 10)[0];
    expect(resumed.travel.journeyOf(npc(0))?.departure).toBe(departed?.id);

    resumed.sim.runUntil(SQUARE_TO_STREET);
    expect(resumed.sim.log.byType('travel.arrived', 10)[0]?.causes).toEqual([departed?.id]);
  });
});

describe('persistence', () => {
  it('reloads a traveller mid-walk and lands them at the same tick', () => {
    const { sim, travel } = departing();
    travel.begin(npc(0), COTTAGE);
    sim.runUntil(10); // on the road, first leg

    const reloadedSim = new Simulation({ seed: 'world-zero' });
    const reloadedMap = installWorld(reloadedSim);
    const reloadedTravel = installTravel(reloadedSim, reloadedMap);
    reloadedSim.load(sim.save());

    expect(reloadedSim.hash()).toBe(sim.hash());
    expect(reloadedTravel.isTravelling(npc(0))).toBe(true);
    expect(reloadedTravel.journeyOf(npc(0))).toEqual(travel.journeyOf(npc(0)));
    expect(reloadedMap.reservationOf(npc(0))).toBe(STREET);
    expect(() => reloadedSim.validateHandlers()).not.toThrow();

    reloadedSim.runUntil(SQUARE_TO_STREET + STREET_TO_COTTAGE);
    sim.runUntil(SQUARE_TO_STREET + STREET_TO_COTTAGE);
    expect(reloadedMap.locationOf(npc(0))).toBe(COTTAGE);
    expect(reloadedSim.hash()).toBe(sim.hash());
  });

  /**
   * The check hash equality cannot perform on itself: an omitted field hashes
   * consistently with its own omission. Comparing an interrupted run against an
   * uninterrupted one is the testing rule's persistence recipe, and it is the
   * only way a missing journey field shows up.
   */
  it('continues a saved journey exactly as an unsaved one continues', () => {
    const straight = departing();
    straight.travel.begin(npc(0), COTTAGE);

    const interrupted = departing();
    interrupted.travel.begin(npc(0), COTTAGE);
    interrupted.sim.runUntil(15);

    const resumed = world();
    resumed.sim.load(interrupted.sim.save());

    straight.sim.runUntil(200);
    resumed.sim.runUntil(200);

    expect(resumed.map.locationOf(npc(0))).toBe(COTTAGE);
    expect(resumed.sim.hash()).toBe(straight.sim.hash());
  });

  it('refuses a saved traveller whose seat was not saved with them', () => {
    const { sim, travel } = departing();
    travel.begin(npc(0), COTTAGE);

    const envelope = sim.save();
    const worldBlock = envelope.modules['world'] as { version: number; data: { reservations: unknown[] } };
    worldBlock.data.reservations = [];

    const reloaded = new Simulation({ seed: 'world-zero' });
    const reloadedMap = installWorld(reloaded);
    installTravel(reloaded, reloadedMap);

    expect(() => reloaded.load(envelope)).toThrow(/not holding a seat/);
  });

  it('refuses a saved journey that has walked past the end of its own route', () => {
    const { sim, travel } = departing();
    travel.begin(npc(0), COTTAGE);

    const envelope = sim.save();
    const block = envelope.modules[TRAVEL_SAVE_MODULE_ID] as {
      version: number;
      data: { journeys: { leg: number }[] };
    };
    (block.data.journeys[0] as { leg: number }).leg = 5;

    const reloaded = new Simulation({ seed: 'world-zero' });
    const reloadedMap = installWorld(reloaded);
    installTravel(reloaded, reloadedMap);

    expect(() => reloaded.load(envelope)).toThrow(/walked off the end/);
  });

  it('refuses a structurally broken travel block', () => {
    const { sim, travel } = departing();
    travel.begin(npc(0), COTTAGE);

    const envelope = sim.save();
    const block = envelope.modules[TRAVEL_SAVE_MODULE_ID] as { version: number; data: unknown };
    block.data = { journeys: [{ traveller: 'npc:0', path: ['location:0'] }] };

    const reloaded = new Simulation({ seed: 'world-zero' });
    const reloadedMap = installWorld(reloaded);
    installTravel(reloaded, reloadedMap);

    expect(() => reloaded.load(envelope)).toThrow(/travel save block failed validation/);
  });

  /**
   * A version 1 world predates travel, so it cannot have had anyone on the
   * road. The empty list is not a guess about what it meant.
   */
  it('loads a world saved before travel existed', () => {
    const { sim } = departing();
    const envelope = sim.save();
    const block = envelope.modules['world'] as { version: number; data: Record<string, unknown> };
    block.version = 1;
    delete block.data['reservations'];

    const reloaded = new Simulation({ seed: 'world-zero' });
    const reloadedMap = installWorld(reloaded);
    installTravel(reloaded, reloadedMap);
    reloaded.load(envelope);

    expect(reloadedMap.locationOf(npc(0))).toBe(SQUARE);
    expect(reloadedMap.reservingEntities()).toEqual([]);
  });
});

describe('determinism', () => {
  it('walks the same route at the same ticks from the same seed', () => {
    const run = (): { hash: string; ticks: number[] } => {
      const w = departing();
      w.travel.begin(npc(0), COTTAGE);
      w.sim.runUntil(500);
      return {
        hash: w.sim.hash(),
        ticks: w.events('travel.arrived').map((e) => e.tick),
      };
    };
    const a = run();
    const b = run();
    expect(b).toEqual(a);
    expect(a.ticks).toEqual([SQUARE_TO_STREET, SQUARE_TO_STREET + STREET_TO_COTTAGE]);
  });

  /**
   * Not `['npc:10', 'npc:2']`.
   *
   * This list is the order journeys are written to the save and the order the
   * invariants walk them, so a plain string sort would make two identical
   * worlds save different bytes depending on who set out first — determinism
   * rule 5, in the one place travel can break it.
   */
  it('lists travellers in numeric id order, not the order they set out', () => {
    const { map, travel } = departing();
    map.place(npc(10), SQUARE);
    map.place(npc(2), SQUARE);

    travel.begin(npc(10), TAVERN);
    travel.begin(npc(2), STREET);
    travel.begin(npc(0), STREET);

    expect(travel.travellers()).toEqual(['npc:0', 'npc:2', 'npc:10']);
    const saved = travel.save() as { journeys: { traveller: string }[] };
    expect(saved.journeys.map((j) => j.traveller)).toEqual(['npc:0', 'npc:2', 'npc:10']);
  });

  it('orders two arrivals in the same tick the same way every time', () => {
    const order = (): string[] => {
      const w = departing();
      w.map.place(npc(1), SQUARE);
      // Same origin, same edge, same tick: only the scheduler's tie-break
      // decides who steps into the street first.
      w.travel.begin(npc(1), STREET);
      w.travel.begin(npc(0), STREET);
      w.sim.runUntil(SQUARE_TO_STREET);
      return w.events('travel.arrived').map((e) => String(e.data && (e.data as { traveller: string }).traveller));
    };
    expect(order()).toEqual(order());
    expect(order()).toEqual(['npc:1', 'npc:0']);
  });
});

/**
 * Invariants with teeth.
 *
 * Each of these reaches past the API, because the API refuses to produce the
 * broken state. An invariant that has never been seen to fire is an invariant
 * nobody has proven works.
 */
describe('invariants notice a broken journey', () => {
  interface TravelInternals {
    journeys: Map<EntityId, Journey>;
  }
  const guts = (travel: TravelSystem): TravelInternals => travel as unknown as TravelInternals;

  const firing = (sim: Simulation, id: string): string[] =>
    sim.checkInvariants().violations.filter((v) => v.invariantId === id).map((v) => v.message);

  it('catches a traveller who is also standing somewhere', () => {
    const { sim, map, travel } = departing();
    travel.begin(npc(0), COTTAGE);
    (map as unknown as { placement: Map<EntityId, EntityId> }).placement.set(npc(0), SQUARE);

    expect(firing(sim, 'travel.traveller-is-on-the-road')).toContain(
      'a traveller is also standing somewhere',
    );
  });

  it('catches a traveller walking towards a seat they do not hold', () => {
    const { sim, map, travel } = departing();
    travel.begin(npc(0), COTTAGE);
    map.releaseReservation(npc(0));

    expect(firing(sim, 'travel.traveller-is-on-the-road')).toContain(
      'a traveller is not holding a seat at the node they are walking to',
    );
  });

  it('catches a seat held for nobody', () => {
    const { sim, map } = departing();
    map.reserve(npc(9), TAVERN); // reserved without a journey behind it

    expect(firing(sim, 'travel.no-seat-without-a-traveller')).toContain(
      'a seat is held for someone who is not travelling',
    );
  });

  it('catches a leg that would finish sooner than the road allows', () => {
    const { sim, travel } = departing();
    travel.begin(npc(0), COTTAGE);
    const journey = travel.journeyOf(npc(0)) as Journey;
    guts(travel).journeys.set(npc(0), { ...journey, legArrivesAt: journey.legDepartedAt + 1 });

    expect(firing(sim, 'travel.arrival-cannot-precede-departure')).toContain(
      'a leg does not take as long as the edge it walks',
    );
  });

  it('catches a leg that arrives before it departs', () => {
    const { sim, travel } = departing();
    travel.begin(npc(0), COTTAGE);
    const journey = travel.journeyOf(npc(0)) as Journey;
    guts(travel).journeys.set(npc(0), { ...journey, legArrivesAt: journey.legDepartedAt - 5 });

    expect(firing(sim, 'travel.arrival-cannot-precede-departure')).toContain(
      'a leg arrives no later than it departed',
    );
  });

  it('catches a leg that departed before its own journey began', () => {
    const { sim, travel } = departing();
    travel.begin(npc(0), COTTAGE);
    const journey = travel.journeyOf(npc(0)) as Journey;
    guts(travel).journeys.set(npc(0), { ...journey, startedAt: journey.legDepartedAt + 10 });

    expect(firing(sim, 'travel.arrival-cannot-precede-departure')).toContain(
      'a leg departed before the journey began',
    );
  });

  it('catches a room overfilled by the people walking to it', () => {
    const { sim, map } = departing();
    map.place(npc(1), TAVERN);
    map.place(npc(2), TAVERN);
    (map as unknown as { reservations: Map<EntityId, EntityId> }).reservations.set(npc(3), TAVERN);
    (map as unknown as { reserved: Map<EntityId, Set<EntityId>> }).reserved.get(TAVERN)?.add(npc(3));

    expect(firing(sim, 'world.occupancy-within-capacity')).toContain('a location is over capacity');
  });
});
