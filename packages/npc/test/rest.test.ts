import { describe, expect, it } from 'vitest';
import {
  EntityKind,
  Rng,
  type SimEvent,
  Simulation,
  TICKS_PER_DAY,
  type Tick,
  dateTimeToTick,
  hours,
  makeEntityId,
  minutes,
} from '@rpgsim/sim-core';
import {
  Access,
  LocationType,
  type TravelSystem,
  type WorldMap,
  installTravel,
  installWorld,
  makeLocation,
} from '@rpgsim/world';
import { makePerson } from '../src/person.ts';
import { installPeople } from '../src/save.ts';
import { RestEvent, RestSystem, installRest } from '../src/rest.ts';
import {
  DEFAULT_ROUTINE_BANDS,
  MIN_WAKING_TICKS,
  ROUTINE_JITTER,
  ROUTINE_ROLE_SHIFTS,
  type RoutineBand,
  at,
  generateRoutine,
  isWakingTime,
  jitter,
  makeRoutine,
  nextTickOfDay,
  routineBandFor,
  validateRoutineBands,
} from '../src/routine.ts';

/**
 * The daily cycle, adversarially.
 *
 * Three families of failure are worth the effort here, and they are not the
 * ones a happy-path test finds.
 *
 * *The cycle stops.* Somebody ends a day holding no alarm, or two, and the
 * world keeps hashing correctly while one villager sleeps for a year. Every
 * test that runs time forward therefore audits the whole population's pending
 * transitions on the way past, rather than checking the end state.
 *
 * *Sleep is claimed rather than reached.* Bedtime is a decision to go home, not
 * an arrival, so the interesting cases are all the ones where the walk home is
 * long, interrupted, or impossible. A villager who falls asleep standing in the
 * mill is a directive 7 violation that no type can catch.
 *
 * *A save loses the future.* A pending rise is state. The persistence test
 * compares an interrupted run against an uninterrupted one event for event,
 * because a hash computed from an incomplete save agrees with itself.
 */

const npc = (n: number) => makeEntityId(EntityKind.Npc, n);
const loc = (n: number) => makeEntityId(EntityKind.Location, n);

const GREEN = loc(0);
const LANE = loc(1);
const COTTAGE = loc(2);
const MILL = loc(3);
const ISLE = loc(4);

const GREEN_LANE = minutes(20);
const LANE_COTTAGE = minutes(20);
const GREEN_MILL = minutes(20);

/** Midsummer, midnight: the whole village is in bed and the day is ahead. */
const MIDNIGHT = dateTimeToTick({ year: 1200, month: 7, day: 15 });

/**
 * A village where home is three legs from work.
 *
 * The distance is the point. A one-hop village lets "went to bed" and "bedtime
 * arrived" happen on the same tick, which would hide every ordering bug in this
 * file. An hour of walking between the mill and the cottage means the gap
 * between the two is always visible, and the isle — connected to nothing —
 * gives an honest way to strand somebody.
 */
function village(map: WorldMap): WorldMap {
  map.addLocation(
    makeLocation({
      id: GREEN,
      name: 'The Green',
      type: LocationType.Square,
      coordinate: { x: 0, y: 0 },
    }),
  );
  map.addLocation(
    makeLocation({
      id: LANE,
      name: 'Mill Lane',
      type: LocationType.Street,
      coordinate: { x: 20, y: 0 },
    }),
  );
  map.addLocation(
    makeLocation({
      id: COTTAGE,
      name: 'Hale Cottage',
      type: LocationType.Dwelling,
      coordinate: { x: 40, y: 0 },
      capacity: 20,
      access: Access.Public,
    }),
  );
  map.addLocation(
    makeLocation({
      id: MILL,
      name: 'The Mill',
      type: LocationType.Workshop,
      coordinate: { x: -20, y: 0 },
      capacity: 20,
    }),
  );
  map.addLocation(
    makeLocation({
      id: ISLE,
      name: 'The Isle',
      type: LocationType.Boundary,
      coordinate: { x: 900, y: 0 },
    }),
  );

  map.connect(GREEN, LANE, GREEN_LANE);
  map.connect(LANE, COTTAGE, LANE_COTTAGE);
  map.connect(GREEN, MILL, GREEN_MILL);
  return map;
}

interface World {
  readonly sim: Simulation;
  readonly map: WorldMap;
  readonly travel: TravelSystem;
  readonly rest: RestSystem;
  readonly events: (type: string) => SimEvent[];
  /** Enrol a person of this age, living in the cottage, standing where you say. */
  readonly settle: (id: ReturnType<typeof npc>, age: number, standingIn?: ReturnType<typeof loc>) => void;
}

function world(seed = 'world-zero', startTick: Tick = MIDNIGHT): World {
  // A fortnight of twelve villagers is roughly 2,400 events, and the default
  // retained window is 2,000 — so `events()` would quietly answer with the tail
  // of the run and a test counting wakings would see the last eleven days of a
  // fourteen-day run as though the first three had never happened. Keep the
  // whole history for the duration of a test.
  const sim = new Simulation({ seed, startTick, eventLog: { retain: 200_000 } });
  const map = installWorld(sim);
  village(map);
  const travel = installTravel(sim, map);
  const people = installPeople(sim);
  const rest = installRest(sim, people.population, map, travel);
  return {
    sim,
    map,
    travel,
    rest,
    events: (type) => sim.log.byType(type, 10_000),
    settle: (id, age, standingIn = COTTAGE) => {
      people.add(
        makePerson({
          id,
          givenName: 'Edric',
          familyName: 'Hale',
          sex: 'male',
          culture: 'anglian',
          birth: { year: 1200 - age, month: 3, day: 4 },
          home: COTTAGE,
        }),
      );
      map.place(id, standingIn);
    },
  };
}

/** Everything the invariant registry objects to, excluding the isle's disconnection. */
const troubles = (sim: Simulation): string[] =>
  sim
    .checkInvariants()
    .violations.filter((v) => v.invariantId !== 'world.graph-is-connected')
    .map((v) => `${v.invariantId}: ${v.message}`);

/**
 * Run forward, auditing the invariants at every scheduled event on the way.
 *
 * Checking only at the end would pass a world that spent a fortnight broken and
 * happened to be tidy on the last tick — and every interesting failure here is
 * transient by nature, because the gap between "bedtime fired" and "asleep in
 * bed" is exactly where the cycle can be left holding nothing.
 */
function runAudited(w: World, ticks: number): string[] {
  const stopAt = w.sim.tick + ticks;
  const seen: string[] = [];
  while (w.sim.step(stopAt)) {
    for (const trouble of troubles(w.sim)) if (!seen.includes(trouble)) seen.push(trouble);
  }
  return seen;
}

// --- the habit ------------------------------------------------------------

describe('routine bands', () => {
  it('ships a table that validates', () => {
    expect(() => validateRoutineBands(DEFAULT_ROUTINE_BANDS)).not.toThrow();
  });

  it('leaves every band at least the minimum waking day, worst case', () => {
    const worstShift = Math.max(...Object.values(ROUTINE_ROLE_SHIFTS));
    for (const band of DEFAULT_ROUTINE_BANDS) {
      const latestRise = band.rise.max + worstShift + ROUTINE_JITTER;
      const earliestBed = band.bed.min - ROUTINE_JITTER;
      expect(earliestBed - latestRise).toBeGreaterThanOrEqual(MIN_WAKING_TICKS);
    }
  });

  it('refuses a table with a gap in it', () => {
    const gapped: RoutineBand[] = [
      { name: 'child', maxAge: 13, rise: { min: at(6), max: at(7) }, bed: { min: at(20), max: at(21) } },
      {
        name: 'rest',
        maxAge: Number.MAX_SAFE_INTEGER,
        rise: { min: at(5), max: at(6) },
        bed: { min: at(20), max: at(21) },
      },
    ];
    expect(() => validateRoutineBands(gapped)).not.toThrow();

    const overlapping = [gapped[0] as RoutineBand, { ...(gapped[1] as RoutineBand), maxAge: 10 }];
    expect(() => validateRoutineBands(overlapping)).toThrow();
  });

  it('refuses a table whose last band does not catch every age', () => {
    const finite: RoutineBand[] = [
      { name: 'all', maxAge: 99, rise: { min: at(6), max: at(7) }, bed: { min: at(20), max: at(21) } },
    ];
    expect(() => validateRoutineBands(finite)).toThrow();
  });

  it('refuses a rise that jitter could push before midnight', () => {
    const early: RoutineBand[] = [
      {
        name: 'all',
        maxAge: Number.MAX_SAFE_INTEGER,
        rise: { min: minutes(5), max: minutes(30) },
        bed: { min: at(20), max: at(21) },
      },
    ];
    expect(() => validateRoutineBands(early)).toThrow();
  });

  it('refuses a bed that jitter could push past midnight', () => {
    const late: RoutineBand[] = [
      {
        name: 'all',
        maxAge: Number.MAX_SAFE_INTEGER,
        rise: { min: at(5), max: at(6) },
        bed: { min: at(23, 30), max: at(23, 50) },
      },
    ];
    expect(() => validateRoutineBands(late)).toThrow();
  });

  it('refuses a day too short to be awake in', () => {
    const cramped: RoutineBand[] = [
      {
        name: 'all',
        maxAge: Number.MAX_SAFE_INTEGER,
        rise: { min: at(10), max: at(11) },
        bed: { min: at(16), max: at(17) },
      },
    ];
    expect(() => validateRoutineBands(cramped)).toThrow();
  });

  it('bands by age, inclusively at the boundary', () => {
    expect(routineBandFor(0).name).toBe('child');
    expect(routineBandFor(13).name).toBe('child');
    expect(routineBandFor(14).name).toBe('youth');
    expect(routineBandFor(24).name).toBe('youth');
    expect(routineBandFor(25).name).toBe('adult');
    expect(routineBandFor(59).name).toBe('adult');
    expect(routineBandFor(60).name).toBe('elder');
    expect(routineBandFor(104).name).toBe('elder');
  });
});

describe('generating a habit', () => {
  const rng = () => Rng.forStream('world-zero', 'routines');

  it('costs exactly two draws, whatever the role', () => {
    const plain = rng();
    generateRoutine(plain, { age: 30 });
    expect(plain.draws).toBe(2);

    const shifted = rng();
    generateRoutine(shifted, { age: 30, role: 'apprentice' });
    expect(shifted.draws).toBe(2);
  });

  it('applies the role as arithmetic, not as a third draw', () => {
    // Same stream position, same underlying numbers: the only difference
    // between these two people is the shift, which is what lets a household
    // assign roles without reshuffling everybody generated afterwards.
    const plain = generateRoutine(rng(), { age: 30 });
    const early = generateRoutine(rng(), { age: 30, role: 'apprentice' });
    expect(early.rise).toBe(plain.rise + (ROUTINE_ROLE_SHIFTS.apprentice as number));
    expect(early.bed).toBe(plain.bed);
  });

  it('ignores a role it does not recognise rather than guessing', () => {
    const plain = generateRoutine(rng(), { age: 30 });
    const odd = generateRoutine(rng(), { age: 30, role: 'reeve-of-the-hundred' });
    expect(odd).toEqual(plain);
  });

  it('stays inside the band, for every age and every role', () => {
    const r = Rng.forStream('world-zero', 'sweep');
    for (const role of [...Object.keys(ROUTINE_ROLE_SHIFTS), 'unknown']) {
      for (let age = 0; age <= 95; age++) {
        const band = routineBandFor(age);
        const shift = ROUTINE_ROLE_SHIFTS[role] ?? 0;
        const routine = generateRoutine(r, { age, role });
        expect(routine.rise).toBeGreaterThanOrEqual(band.rise.min + shift);
        expect(routine.rise).toBeLessThanOrEqual(band.rise.max + shift);
        expect(routine.bed).toBeGreaterThanOrEqual(band.bed.min);
        expect(routine.bed).toBeLessThanOrEqual(band.bed.max);
        expect(routine.bed).toBeGreaterThan(routine.rise);
      }
    }
  });

  it('refuses a habit that runs backwards', () => {
    expect(() => makeRoutine({ rise: at(21), bed: at(6) })).toThrow();
    expect(() => makeRoutine({ rise: at(6), bed: at(6) })).toThrow();
    expect(() => makeRoutine({ rise: at(6), bed: TICKS_PER_DAY })).toThrow();
  });
});

describe('clock arithmetic', () => {
  it('drifts by at most the jitter, and costs one draw', () => {
    const r = Rng.forStream('world-zero', 'jitter');
    for (let i = 0; i < 200; i++) {
      const before = r.draws;
      const drifted = jitter(r, at(6));
      expect(r.draws).toBe(before + 1);
      expect(Math.abs(drifted - at(6))).toBeLessThanOrEqual(ROUTINE_JITTER);
    }
  });

  it('clamps drift into the day rather than wrapping it', () => {
    // Staying inside the day is not the whole claim, and on its own it is a
    // claim `mod` also satisfies — wrapping midnight lands on 23:59, which is
    // a perfectly legal time of day and the wrong side of the clock. The
    // property that separates the two is *nearness*: a clamped hour is always
    // within the drift of the hour asked for, and a wrapped one is a day away
    // from it. A bed time that wrapped past midnight would turn the waking
    // window inside out and the villager would never sleep again.
    const r = Rng.forStream('world-zero', 'jitter');
    for (let i = 0; i < 200; i++) {
      const early = jitter(r, 0);
      expect(early).toBeGreaterThanOrEqual(0);
      expect(early).toBeLessThanOrEqual(ROUTINE_JITTER);

      const late = jitter(r, TICKS_PER_DAY - 1);
      expect(late).toBeLessThan(TICKS_PER_DAY);
      expect(late).toBeGreaterThanOrEqual(TICKS_PER_DAY - 1 - ROUTINE_JITTER);
    }
  });

  it('finds the next occurrence strictly after the tick given', () => {
    expect(nextTickOfDay(MIDNIGHT, at(6))).toBe(MIDNIGHT + at(6));
    expect(nextTickOfDay(MIDNIGHT + at(6), at(20))).toBe(MIDNIGHT + at(20));
    expect(nextTickOfDay(MIDNIGHT + at(20), at(6))).toBe(MIDNIGHT + TICKS_PER_DAY + at(6));
  });

  it('never returns the tick it was given', () => {
    // A rise firing on the instant somebody went to bed is a villager who
    // never sleeps, and the loop is tight enough to hang a run.
    expect(nextTickOfDay(MIDNIGHT + at(6), at(6))).toBe(MIDNIGHT + TICKS_PER_DAY + at(6));
    expect(nextTickOfDay(MIDNIGHT, 0)).toBe(MIDNIGHT + TICKS_PER_DAY);
  });

  it('counts the waking window from rise up to, but not including, bed', () => {
    const routine = makeRoutine({ rise: at(6), bed: at(21) });
    expect(isWakingTime(routine, MIDNIGHT + at(5, 59))).toBe(false);
    expect(isWakingTime(routine, MIDNIGHT + at(6))).toBe(true);
    expect(isWakingTime(routine, MIDNIGHT + at(20, 59))).toBe(true);
    expect(isWakingTime(routine, MIDNIGHT + at(21))).toBe(false);
    expect(isWakingTime(routine, MIDNIGHT)).toBe(false);
  });
});

// --- the cycle ------------------------------------------------------------

describe('joining the cycle', () => {
  it('starts a villager asleep when the world starts at midnight', () => {
    const w = world();
    w.settle(npc(0), 30);
    const rest = w.rest.begin(npc(0));

    expect(rest.asleep).toBe(true);
    expect(rest.nextKind).toBe('rise');
    expect(rest.nextAt).toBe(MIDNIGHT + rest.routine.rise);
    expect(troubles(w.sim)).toEqual([]);
  });

  it('starts a villager awake when the world starts in the afternoon', () => {
    const w = world('world-zero', MIDNIGHT + at(14));
    w.settle(npc(0), 30);
    const rest = w.rest.begin(npc(0));

    expect(rest.asleep).toBe(false);
    expect(rest.nextKind).toBe('bed');
    expect(rest.nextAt).toBe(MIDNIGHT + rest.routine.bed);
  });

  it('does not drift the founding transition, so nobody is founded into a lost day', () => {
    // Drift is +/- 20 minutes. Founding somebody a minute after their stated
    // bedtime and drifting it would schedule tomorrow's bed, leaving them awake
    // for twenty-four hours on the first day of the world.
    const probe = world('world-zero', MIDNIGHT);
    probe.settle(npc(0), 30);
    const bed = probe.rest.begin(npc(0)).routine.bed;

    const w = world('world-zero', MIDNIGHT + bed - 60);
    w.settle(npc(0), 30);
    const rest = w.rest.begin(npc(0));
    expect(rest.asleep).toBe(false);
    expect(rest.nextAt).toBe(MIDNIGHT + bed);
    expect(rest.nextAt - w.sim.tick).toBe(60);
  });

  it('refuses to enrol the same person twice', () => {
    const w = world();
    w.settle(npc(0), 30);
    w.rest.begin(npc(0));
    expect(() => w.rest.begin(npc(0))).toThrow();
  });

  it('refuses somebody with no home', () => {
    const sim = new Simulation({ seed: 'world-zero', startTick: MIDNIGHT });
    const map = installWorld(sim);
    village(map);
    const travel = installTravel(sim, map);
    const people = installPeople(sim);
    const rest = installRest(sim, people.population, map, travel);
    people.add(
      makePerson({
        id: npc(0),
        givenName: 'Nobody',
        familyName: 'Atall',
        sex: 'female',
        culture: 'anglian',
        birth: { year: 1170, month: 3, day: 4 },
      }),
    );
    map.place(npc(0), GREEN);
    expect(() => rest.begin(npc(0))).toThrow();
  });

  it('refuses to enrol a sleeper who is not in their own home', () => {
    // The alternative is teleporting them into bed, which is the silent
    // correction sim-core rule 10 forbids. Placing people is worldgen's job.
    const w = world();
    w.settle(npc(0), 30, MILL);
    expect(() => w.rest.begin(npc(0))).toThrow();
  });
});

describe('a day', () => {
  it('wakes, works, walks home and sleeps, in that order', () => {
    const w = world();
    w.settle(npc(0), 30);
    const rest = w.rest.begin(npc(0), { dayDestination: MILL });

    expect(runAudited(w, TICKS_PER_DAY)).toEqual([]);

    const woke = w.events(RestEvent.Woke);
    const turning = w.events(RestEvent.TurningIn);
    const abed = w.events(RestEvent.WentToBed);
    expect(woke).toHaveLength(1);
    expect(turning).toHaveLength(1);
    expect(abed).toHaveLength(1);

    expect(woke[0]?.tick).toBe(MIDNIGHT + rest.routine.rise);
    // Bed is a departure, not an arrival: sleep is strictly later, by the
    // length of the walk. If these two ticks are ever equal, somebody has
    // started teleporting home.
    expect(turning[0]?.tick).toBeLessThan(abed[0]?.tick as number);
    expect(abed[0]?.tick as number).toBeGreaterThanOrEqual(
      (turning[0]?.tick as number) + GREEN_MILL + GREEN_LANE + LANE_COTTAGE,
    );
    expect(abed[0]?.location).toBe(COTTAGE);
    expect(w.map.locationOf(npc(0))).toBe(COTTAGE);
    expect(w.rest.isAsleep(npc(0))).toBe(true);
  });

  it('holds tonight as its next change before the morning journey starts', () => {
    // Read from inside `travel.departed`, which fires synchronously from the
    // rise handler. Scheduling the walk out first and the bedtime afterwards
    // looks identical by the end of the day, and leaves this instant with the
    // record pointing at the rise that has just fired: an alarm in the past,
    // and a villager whose next change of state is a thing that already
    // happened. Anything reading the cycle during a departure — a WHY?
    // explanation, the observer, an invariant sweep — sees that instead.
    const w = world();
    w.settle(npc(0), 30);
    w.rest.begin(npc(0), { dayDestination: MILL });

    const seen: { kind: string; ahead: boolean }[] = [];
    w.sim.subscribe('travel.departed', () => {
      const record = w.rest.require(npc(0));
      seen.push({ kind: record.nextKind, ahead: record.nextAt > w.sim.tick });
    });

    w.sim.runUntil(MIDNIGHT + (w.rest.routineOf(npc(0))?.rise as number) + 1);

    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0]).toEqual({ kind: 'bed', ahead: true });
  });

  it('spends the whole day at home when there is nowhere to go', () => {
    const w = world();
    w.settle(npc(0), 30);
    w.rest.begin(npc(0));

    expect(runAudited(w, TICKS_PER_DAY)).toEqual([]);
    expect(w.events(RestEvent.TurningIn)).toHaveLength(0);
    expect(w.events(RestEvent.WentToBed)).toHaveLength(1);
    // Already home, so bedtime and sleep are the same instant. That is the one
    // case where they may coincide, and it is why the test above needs a mill.
    // The hour itself drifts: the founding transition is the stated one, every
    // transition after it is drawn within `ROUTINE_JITTER` of the habit.
    const slept = w.events(RestEvent.WentToBed)[0]?.tick as number;
    const stated = MIDNIGHT + (w.rest.routineOf(npc(0))?.bed as number);
    expect(Math.abs(slept - stated)).toBeLessThanOrEqual(ROUTINE_JITTER);
  });

  it('keeps turning for a fortnight without losing anybody', () => {
    const w = world();
    for (let i = 0; i < 12; i++) w.settle(npc(i), 8 + i * 7);
    for (let i = 0; i < 12; i++) w.rest.begin(npc(i), { dayDestination: MILL });

    expect(runAudited(w, TICKS_PER_DAY * 14)).toEqual([]);

    // Fourteen risings and fourteen bedtimes each, give or take the one the
    // run ends in the middle of. A villager who fell out of the cycle would
    // show here as a count in the single digits.
    for (let i = 0; i < 12; i++) {
      const rose = w.events(RestEvent.Woke).filter((e) => e.actors.includes(npc(i)));
      const slept = w.events(RestEvent.WentToBed).filter((e) => e.actors.includes(npc(i)));
      expect(rose.length).toBeGreaterThanOrEqual(13);
      expect(slept.length).toBeGreaterThanOrEqual(13);
      expect(Math.abs(rose.length - slept.length)).toBeLessThanOrEqual(1);
    }
    expect(w.events(RestEvent.CouldNotRest)).toHaveLength(0);
  });

  it('holds exactly one pending transition through every tick of a week', () => {
    const w = world();
    for (let i = 0; i < 6; i++) w.settle(npc(i), 10 + i * 12);
    for (let i = 0; i < 6; i++) w.rest.begin(npc(i), { dayDestination: MILL });

    const stopAt = w.sim.tick + TICKS_PER_DAY * 7;
    let steps = 0;
    while (w.sim.step(stopAt)) {
      steps++;
      for (const id of w.rest.ids()) {
        const record = w.rest.require(id);
        expect(w.sim.scheduler.isPending(record.next)).toBe(true);
        // Equal is legitimate: two villagers can share a bedtime, and one of
        // them is always the second to be processed.
        expect(record.nextAt).toBeGreaterThanOrEqual(w.sim.tick);
        expect(record.nextKind).toBe(record.asleep ? 'rise' : 'bed');
      }
    }
    expect(steps).toBeGreaterThan(100);
  });
});

describe('bedtime while out of doors', () => {
  it('interrupts a journey and sends them home from wherever it stops', () => {
    const w = world();
    w.settle(npc(0), 30);
    const rest = w.rest.begin(npc(0));

    // Wake them, then set out for the mill one minute before bedtime, so the
    // bed handler fires with a journey already in flight. The interrupt stops
    // them at the next node rather than in the middle of a road, which is the
    // only place the map can put anybody.
    //
    // Tonight's bedtime is read off the record rather than off the habit,
    // because it drifted when they woke. Aiming at the stated hour instead put
    // this test a quarter of an hour after they were already in bed, which is a
    // different scenario wearing this one's name.
    w.sim.runUntil(MIDNIGHT + rest.routine.rise + 1);
    const tonight = w.rest.require(npc(0)).nextAt;
    w.sim.runUntil(tonight - 60);
    expect(w.rest.isAsleep(npc(0))).toBe(false);
    expect(w.map.locationOf(npc(0))).toBe(COTTAGE);
    expect(w.travel.begin(npc(0), MILL).started).toBe(true);
    expect(w.travel.isTravelling(npc(0))).toBe(true);

    // Six hours: long enough for the interruption and the walk home, short
    // enough that tomorrow night's bedtime is not part of the story.
    expect(runAudited(w, hours(6))).toEqual([]);

    const turning = w.events(RestEvent.TurningIn);
    expect(turning.length).toBeGreaterThanOrEqual(1);
    expect(turning[0]?.data).toMatchObject({ interrupted: true });
    expect(w.sim.log.byType('travel.blocked', 10).length).toBeGreaterThanOrEqual(1);

    const abed = w.events(RestEvent.WentToBed);
    expect(abed).toHaveLength(1);
    expect(abed[0]?.location).toBe(COTTAGE);
    expect(w.map.locationOf(npc(0))).toBe(COTTAGE);
  });

  it('says so out loud when there is no way home, and tries again tomorrow', () => {
    const w = world();
    w.settle(npc(0), 30);
    const rest = w.rest.begin(npc(0), { dayDestination: MILL });

    // Strand them on the isle after they have woken. Nothing connects to it, so
    // the walk home is not merely slow, it is impossible.
    w.sim.runUntil(MIDNIGHT + rest.routine.rise + 1);
    // `abandon` rather than `map.remove`: they set out for the mill the instant
    // they woke, so they are holding a reserved seat there, and taking somebody
    // off the map without giving the seat back is its own bug.
    expect(w.travel.abandon(npc(0))).toBe(true);
    w.map.place(npc(0), ISLE);

    runAudited(w, TICKS_PER_DAY);

    const stuck = w.events(RestEvent.CouldNotRest);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.data).toMatchObject({ reason: 'no-route', standingIn: ISLE });
    expect(w.events(RestEvent.WentToBed)).toHaveLength(0);
    // Awake, not asleep in the open air — and still holding a transition.
    expect(w.rest.isAsleep(npc(0))).toBe(false);
    const record = w.rest.require(npc(0));
    // And no longer claiming to be on their way. `headingHome` is what makes
    // `onArrival` act, so a villager who gave up while still flagged would
    // hijack the next arrival that happened to concern them — and the record
    // would be describing a journey that nobody is making, which is a lie the
    // save would carry to disk.
    expect(record.headingHome).toBe(false);
    expect(record.nextKind).toBe('bed');
    expect(record.nextAt).toBeGreaterThanOrEqual(w.sim.tick);
    expect(w.sim.scheduler.isPending(record.next)).toBe(true);
  });
});

describe('leaving the cycle', () => {
  it('cancels the pending transition when somebody is removed', () => {
    const sim = new Simulation({ seed: 'world-zero', startTick: MIDNIGHT });
    const map = installWorld(sim);
    village(map);
    const travel = installTravel(sim, map);
    const people = installPeople(sim);
    const rest = installRest(sim, people.population, map, travel);
    people.add(
      makePerson({
        id: npc(0),
        givenName: 'Edric',
        familyName: 'Hale',
        sex: 'male',
        culture: 'anglian',
        birth: { year: 1170, month: 3, day: 4 },
        home: COTTAGE,
      }),
    );
    map.place(npc(0), COTTAGE);
    const record = rest.begin(npc(0));

    people.remove(npc(0), 'died');

    expect(rest.get(npc(0))).toBeUndefined();
    expect(sim.scheduler.isPending(record.next)).toBe(false);
    // The alarm would otherwise fire into a handler that cannot find them,
    // hours after the death that should have silenced it.
    expect(() => sim.runFor(TICKS_PER_DAY * 2)).not.toThrow();
  });

  it('shrugs at a removal for somebody who was never in the cycle', () => {
    const w = world();
    expect(w.rest.forget(npc(9))).toBe(false);
    expect(w.rest.forget(undefined)).toBe(false);
  });
});

describe('the invariants', () => {
  it('catches a sleeper who is not in their own home', () => {
    const w = world();
    w.settle(npc(0), 30);
    w.rest.begin(npc(0));
    expect(troubles(w.sim)).toEqual([]);

    w.map.remove(npc(0));
    w.map.place(npc(0), GREEN);
    expect(troubles(w.sim).join(' ')).toContain('npc.sleeper-is-at-home');
  });

  it('catches a cycle whose next change has gone missing', () => {
    const w = world();
    w.settle(npc(0), 30);
    const record = w.rest.begin(npc(0));
    w.sim.cancel(record.next);
    expect(troubles(w.sim).join(' ')).toContain('npc.rest-has-a-next-change');
  });
});

// --- persistence ----------------------------------------------------------

describe('saving the cycle', () => {
  /** Rebuild the same wiring around a fresh simulation, then load into it. */
  function reload(envelope: ReturnType<Simulation['save']>): World {
    const sim = new Simulation({ seed: 'world-zero', startTick: MIDNIGHT });
    const map = installWorld(sim);
    const travel = installTravel(sim, map);
    const people = installPeople(sim);
    const rest = installRest(sim, people.population, map, travel);
    sim.load(envelope);
    return {
      sim,
      map,
      travel,
      rest,
      events: (type) => sim.log.byType(type, 10_000),
      settle: () => {
        throw new Error('not for a reloaded world');
      },
    };
  }

  it('continues a run exactly where it left off', () => {
    const straight = world();
    for (let i = 0; i < 5; i++) straight.settle(npc(i), 9 + i * 15);
    for (let i = 0; i < 5; i++) straight.rest.begin(npc(i), { dayDestination: MILL });
    straight.sim.runFor(TICKS_PER_DAY * 4);
    const uninterrupted = straight.sim.hash();

    const broken = world();
    for (let i = 0; i < 5; i++) broken.settle(npc(i), 9 + i * 15);
    for (let i = 0; i < 5; i++) broken.rest.begin(npc(i), { dayDestination: MILL });
    // Mid-afternoon on the second day: some are walking, some are at the mill,
    // and the save has to carry all of it.
    broken.sim.runFor(TICKS_PER_DAY + at(15));
    const resumed = reload(broken.sim.save());
    resumed.sim.runFor(TICKS_PER_DAY * 4 - (TICKS_PER_DAY + at(15)));

    expect(resumed.sim.tick).toBe(straight.sim.tick);
    expect(resumed.sim.hash()).toBe(uninterrupted);
    expect(troubles(resumed.sim)).toEqual([]);

    // The hash is computed from the save, so a symmetric omission is invisible
    // to it. Compare the lived history instead.
    const shape = (w: World, type: string) =>
      w.events(type).map((e) => `${e.tick}:${e.actors.join(',')}`);
    for (const type of [RestEvent.Woke, RestEvent.WentToBed, RestEvent.TurningIn]) {
      expect(shape(resumed, type).slice(-20)).toEqual(shape(straight, type).slice(-20));
    }
  });

  it('writes the cycle in sorted order, whatever order people joined in', () => {
    // Enrolled backwards on purpose. A save that walked the live map instead of
    // the sorted id list would come out in arrival order, which hashes
    // differently for two worlds holding identical villagers — and arrival
    // order is exactly the thing that changes when worldgen is reordered or a
    // villager is enrolled late. Determinism rule 5.
    const w = world();
    for (const i of [2, 0, 1]) w.settle(npc(i), 20 + i * 10);
    for (const i of [2, 0, 1]) w.rest.begin(npc(i));

    const block = w.sim.save().modules.rest as unknown as {
      data: { resting: { npc: string }[] };
    };
    expect(block.data.resting.map((r) => r.npc)).toEqual(['npc:0', 'npc:1', 'npc:2']);
  });

  it('refuses a save whose habit runs backwards', () => {
    const w = world();
    w.settle(npc(0), 30);
    w.rest.begin(npc(0));
    const envelope = w.sim.save();
    const block = envelope.modules.rest as unknown as { version: number; data: { resting: Record<string, unknown>[] } };
    (block.data.resting[0] as Record<string, unknown>).routine = { rise: at(21), bed: at(6) };
    expect(() => reload(envelope)).toThrow();
  });

  it('refuses a save whose sleeper is standing somewhere else', () => {
    const w = world();
    w.settle(npc(0), 30);
    w.rest.begin(npc(0));
    const envelope = w.sim.save();
    const world_ = envelope.modules.world as unknown as {
      data: { occupancy: { entity: string; location: string }[] };
    };
    for (const entry of world_.data.occupancy) {
      if (entry.entity === npc(0)) entry.location = GREEN;
    }
    expect(() => reload(envelope)).toThrow();
  });

  it('refuses a save whose state and pending transition disagree', () => {
    const w = world();
    w.settle(npc(0), 30);
    w.rest.begin(npc(0));
    const envelope = w.sim.save();
    const block = envelope.modules.rest as unknown as { data: { resting: Record<string, unknown>[] } };
    (block.data.resting[0] as Record<string, unknown>).nextKind = 'bed';
    expect(() => reload(envelope)).toThrow();
  });
});
