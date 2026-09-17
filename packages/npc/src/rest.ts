import { type JsonValue, assert } from '@rpgsim/shared';
import {
  type EntityId,
  type InvariantViolation,
  Priority,
  RngStream,
  type SaveModule,
  type ScheduledEventId,
  type SimEvent,
  type Simulation,
  type Tick,
  compareEntityIds,
  isEntityId,
  violation,
} from '@rpgsim/sim-core';
import type { TravelSystem, WorldMap } from '@rpgsim/world';
import { z } from 'zod';
import { ageInYears } from './person.ts';
import type { Population } from './population.ts';
import {
  type Routine,
  type RoutineBand,
  RoutineSchema,
  generateRoutine,
  isWakingTime,
  jitter,
  makeRoutine,
  nextTickOfDay,
  tickOfDayTomorrow,
} from './routine.ts';

/**
 * The daily cycle: sleeping, waking, and going home when the light goes.
 *
 * The thinnest behaviour in the project, and deliberately so. Nothing here
 * chooses anything — a villager rises because the hour came round, not because
 * rising scored better than staying in bed. What it buys is the whole stack
 * exercised end to end: a habit rolled from a seed, an hour scheduled, the hour
 * arriving, a journey begun, the journey costing real ticks, the arrival
 * noticed, a fact emitted, and all of it surviving a save and a reload. Phase 4
 * replaces the habit with utility scoring and should be able to leave every
 * other part of that chain standing.
 *
 * **Exactly one pending transition per person, always.** Waking schedules
 * tonight's bed; going to bed schedules tomorrow's rise. That is the whole
 * reason "nobody sleeps two nights without waking" is a property of the machine
 * rather than a hope — a sleeper with no pending rise is a state
 * `npc.rest-has-a-next-change` finds, and no path through this file can leave
 * somebody holding two alarms or none.
 *
 * **Falling asleep is not instant, because getting home is not.** Bedtime does
 * not put anybody to bed; it starts them walking, and they lie down when they
 * arrive, which may be an hour of simulated time later. That is directive 7
 * applied to the most ordinary action in the village, and it is why this system
 * listens for `travel.arrived` instead of assuming.
 */

/** Facts this system announces. `npc.woke` is named in ARCHITECTURE.md. */
export const RestEvent = {
  Woke: 'npc.woke',
  /** They are in bed. The day is over for them. */
  WentToBed: 'npc.went-to-bed',
  /** The hour came and they are not home. They are on their way. */
  TurningIn: 'npc.turning-in',
  /**
   * The hour came and they cannot get home at all.
   *
   * Emitted rather than swallowed or quietly fixed. A villager who cannot reach
   * their own bed is standing somewhere the map cannot route out of, or has no
   * home to route to, and both are things the `WHY?` view should be able to say
   * out loud. They stay up and try again at tomorrow night's hour.
   */
  CouldNotRest: 'npc.could-not-rest',
} as const;

export type RestEventName = (typeof RestEvent)[keyof typeof RestEvent];

/** Scheduled-event kinds. Handlers are registered by the constructor. */
export const RISE_EVENT = 'npc.rest.rise';
export const BED_EVENT = 'npc.rest.bed';

export const RestKind = { Rise: 'rise', Bed: 'bed' } as const;
export type RestKindName = (typeof RestKind)[keyof typeof RestKind];

const EntityIdSchema = z.string().refine(isEntityId, { message: 'not a valid entity id' });

/**
 * One person's place in the daily cycle.
 *
 * `next` is a live scheduler handle and it is saved with the record, because
 * determinism rule 8 says future state is persisted: a sleeper reloaded without
 * their pending rise is a villager who never wakes again, and every hash in the
 * save would agree that nothing was wrong.
 */
export interface Rest {
  readonly npc: EntityId;
  readonly routine: Routine;
  readonly asleep: boolean;
  /**
   * True from the moment bedtime sends them home until they lie down.
   *
   * The flag exists because the walk home is interruptible and arrival is
   * asynchronous. Without it, `travel.arrived` cannot tell somebody coming home
   * to sleep from somebody arriving anywhere else for any other reason.
   */
  readonly headingHome: boolean;
  /** Where they spend the day. `null` keeps them at home, which is slice 5's default. */
  readonly dayDestination: EntityId | null;
  readonly next: ScheduledEventId;
  readonly nextAt: Tick;
  readonly nextKind: RestKindName;
}

const RestRecordSchema = z
  .object({
    npc: EntityIdSchema,
    routine: RoutineSchema,
    asleep: z.boolean(),
    headingHome: z.boolean(),
    dayDestination: EntityIdSchema.nullable(),
    next: z.number().int().positive(),
    nextAt: z.number().int().nonnegative(),
    nextKind: z.enum([RestKind.Rise, RestKind.Bed]),
  })
  .strict();

export const RestSnapshotShape = z.object({ resting: z.array(RestRecordSchema) }).strict();

export const REST_SAVE_MODULE_ID = 'rest';

/** 1 — a habit, a state, a pending transition and a daytime destination. */
export const REST_SAVE_MODULE_VERSION = 1;

export interface BeginRestOptions {
  /** Their place in the household, which shifts how early they rise. */
  readonly role?: string;
  /** Where they go when they wake. Omitted or `null` keeps them at home. */
  readonly dayDestination?: EntityId | null;
  readonly bands?: readonly RoutineBand[];
  readonly shifts?: Readonly<Record<string, number>>;
}

interface RestPayload extends Record<string, JsonValue> {
  readonly npc: EntityId;
}

/**
 * When the next transition is due.
 *
 * `Stated` is the founding transition: the habit's own hour, undrifted, so that
 * reading the clock and scheduling against it cannot disagree. `Next` is the
 * ordinary case. `Tomorrow` is the standing fallback given to somebody walking
 * home, which has to skip the rest of tonight even though tonight's hour may
 * technically still be ahead of them — see `tickOfDayTomorrow`.
 */
const Timing = { Stated: 'stated', Next: 'next', Tomorrow: 'tomorrow' } as const;
type TimingName = (typeof Timing)[keyof typeof Timing];

export class RestSystem {
  private resting = new Map<EntityId, Rest>();

  constructor(
    private readonly sim: Simulation,
    private readonly population: Population,
    private readonly map: WorldMap,
    private readonly travel: TravelSystem,
  ) {
    sim.on<RestPayload>(RISE_EVENT, (_sim, event) => {
      this.onRise(event.payload.npc);
    });
    sim.on<RestPayload>(BED_EVENT, (_sim, event) => {
      this.onBed(event.payload.npc);
    });

    // Loosely coupled on purpose. This system starts journeys by calling
    // `TravelSystem`, but learns they finished by reading the event log, so a
    // later system that moves somebody for its own reasons — a cart, a
    // constable, a flood — does not have to know this one exists.
    sim.subscribe('travel.arrived', (event) => {
      this.onArrival(event);
    });
    sim.subscribe('npc.removed', (event) => {
      this.forget(readId(event, 'npc'));
    });
  }

  // --- queries --------------------------------------------------------------

  /** Everybody in the cycle, in id order (determinism rule 5). */
  ids(): EntityId[] {
    return [...this.resting.keys()].sort(compareEntityIds);
  }

  get count(): number {
    return this.resting.size;
  }

  get(npc: EntityId): Rest | undefined {
    return this.resting.get(npc);
  }

  require(npc: EntityId): Rest {
    const rest = this.resting.get(npc);
    assert(rest !== undefined, 'that person is not in the daily cycle', { npc });
    return rest;
  }

  has(npc: EntityId): boolean {
    return this.resting.has(npc);
  }

  isAsleep(npc: EntityId): boolean {
    return this.resting.get(npc)?.asleep === true;
  }

  /** Everyone asleep right now, in id order. */
  sleepers(): EntityId[] {
    return this.ids().filter((npc) => this.isAsleep(npc));
  }

  routineOf(npc: EntityId): Routine | undefined {
    return this.resting.get(npc)?.routine;
  }

  // --- entering and leaving the cycle ---------------------------------------

  /**
   * Hand somebody a habit and put them in the cycle.
   *
   * Two draws from `RngStream.Routines` for the habit itself; the first
   * transition is then scheduled at the stated hour with **no** drift. That is
   * not tidiness. Drift runs up to twenty minutes either way, so a drifted
   * first bedtime can land in the past, `nextTickOfDay` would find tomorrow's
   * instead, and a villager founded at dusk would stay awake for a day and a
   * night. Scheduling against the same hour the clock was read against closes
   * that window rather than papering over it.
   *
   * Whether they begin the world asleep or awake is read off the clock rather
   * than passed in, so a village founded at midnight is a village in bed. A
   * person who begins asleep must already be standing in their own home: this
   * refuses rather than moving them, because placing people is worldgen's job,
   * and a system that quietly teleported somebody into bed would be exactly the
   * silent correction sim-core rule 10 forbids.
   */
  begin(npc: EntityId, options: BeginRestOptions = {}): Rest {
    assert(!this.resting.has(npc), 'that person is already in the daily cycle', { npc });
    const person = this.population.require(npc);
    assert(person.home !== null, 'somebody with no home cannot keep a routine', { npc });

    const routine = generateRoutine(this.sim.random(RngStream.Routines), {
      age: ageInYears(person.birth, this.sim.now()),
      ...(options.role !== undefined ? { role: options.role } : {}),
      ...(options.bands !== undefined ? { bands: options.bands } : {}),
      ...(options.shifts !== undefined ? { shifts: options.shifts } : {}),
    });

    const awake = isWakingTime(routine, this.sim.tick);
    if (!awake) {
      assert(
        this.map.locationOf(npc) === person.home,
        'somebody joining the cycle asleep must already be in their own home',
        { npc, home: person.home, standingIn: this.map.locationOf(npc) ?? null },
      );
    }

    this.set(npc, {
      npc,
      routine,
      asleep: !awake,
      headingHome: false,
      dayDestination: options.dayDestination ?? null,
      ...this.scheduleNext(npc, awake ? RestKind.Bed : RestKind.Rise, routine, Timing.Stated),
    });
    return this.require(npc);
  }

  /**
   * Take somebody out of the cycle — death, or removal from play.
   *
   * Cancelling the pending transition is the point. A rise left sitting in the
   * scheduler for somebody who no longer exists fires into a handler that
   * cannot find them, at some hour hundreds of ticks away from the cause.
   */
  forget(npc: EntityId | undefined): boolean {
    if (npc === undefined) return false;
    const rest = this.resting.get(npc);
    if (rest === undefined) return false;
    this.sim.cancel(rest.next);
    this.resting.delete(npc);
    return true;
  }

  // --- the cycle ------------------------------------------------------------

  /** The rise handler. They are up, and the day's movement starts here. */
  private onRise(npc: EntityId): void {
    const rest = this.require(npc);
    assert(rest.asleep, 'a rise fired for somebody who was already awake', { npc });

    const at = this.map.locationOf(npc);
    this.set(npc, { ...rest, asleep: false, headingHome: false });
    this.sim.emit({
      type: RestEvent.Woke,
      actors: [npc],
      ...(at !== undefined ? { location: at } : {}),
      data: { npc, rise: rest.routine.rise },
    });

    // Tonight's bedtime is scheduled before the journey out, so that a refused
    // journey still leaves them holding exactly one transition. A villager who
    // could not set out this morning still has to go to bed tonight.
    this.reschedule(npc, RestKind.Bed);

    if (rest.dayDestination !== null && at !== rest.dayDestination) {
      this.travel.begin(npc, rest.dayDestination);
    }
  }

  /**
   * The bed handler. Sends them home; does not put them to bed.
   *
   * Three cases, and the third is the one worth reading: somebody already on
   * the road is *interrupted* rather than redirected, because `TravelSystem`
   * runs one journey at a time and stops people at the next real place rather
   * than between two of them. Their arrival there is what starts the walk home,
   * over in `onArrival`.
   *
   * Anybody who has to walk is given **tomorrow night's bedtime** before they
   * set out. The walk home is asynchronous, so without it they would spend the
   * whole journey holding a transition that has already fired — a real gap that
   * `npc.rest-has-a-next-change` found the first time this ran. Tomorrow's bed
   * is also the right fallback on its own terms: somebody who never reaches
   * their door tries again at the next honest opportunity rather than standing
   * in the lane for good. Reaching the door cancels it in `sleep`.
   */
  private onBed(npc: EntityId): void {
    const rest = this.require(npc);
    assert(!rest.asleep, 'a bedtime fired for somebody already asleep', { npc });
    const home = this.homeOf(npc);

    if (this.map.locationOf(npc) === home && !this.travel.isTravelling(npc)) {
      this.sleep(npc, home);
      return;
    }

    this.set(npc, { ...rest, headingHome: true });
    this.reschedule(npc, RestKind.Bed, Timing.Tomorrow);

    if (this.travel.isTravelling(npc)) {
      const stoppingAt = this.travel.interrupt(npc, 'bedtime');
      this.sim.emit({
        type: RestEvent.TurningIn,
        actors: [npc],
        data: { npc, home, interrupted: true, stoppingAt: stoppingAt ?? null },
      });
      return;
    }

    this.walkHome(npc, home);
  }

  /**
   * Arrival, filtered down to the people it concerns.
   *
   * Only a *final* arrival matters. A traveller crossing the green on the way
   * to the mill passes through it, and `travel.arrived` fires for that leg too;
   * acting on it would start a second journey from the middle of the first.
   */
  private onArrival(event: SimEvent): void {
    const npc = readId(event, 'traveller');
    if (npc === undefined) return;
    const rest = this.resting.get(npc);
    if (rest === undefined || !rest.headingHome) return;
    if (readFlag(event, 'final') !== true) return;

    const home = this.homeOf(npc);
    if (this.map.locationOf(npc) === home) {
      this.sleep(npc, home);
      return;
    }
    this.walkHome(npc, home);
  }

  /**
   * Start the walk home, or say out loud why they are staying up.
   *
   * Schedules nothing. Every caller reaches here with tomorrow night's bedtime
   * already pending — `onBed` sets it before the first step of the walk, and
   * `onArrival` is a later step of that same walk. Rescheduling here would
   * spend a draw from `RngStream.NpcDecisions` for every leg a traveller
   * happens to need, so that lengthening one road would reshuffle every
   * decision made afterwards anywhere in the world.
   */
  private walkHome(npc: EntityId, home: EntityId): void {
    const outcome = this.travel.begin(npc, home);
    if (outcome.started) {
      this.sim.emit({
        type: RestEvent.TurningIn,
        actors: [npc],
        data: { npc, home, interrupted: false, arrivesAt: outcome.journey.legArrivesAt },
      });
      return;
    }

    if (outcome.reason === 'already-there') {
      // The map and the journey disagreed for an instant. Either way they are
      // standing in their own house, which is all that going to bed requires.
      this.sleep(npc, home);
      return;
    }

    const rest = this.require(npc);
    this.set(npc, { ...rest, headingHome: false });
    this.sim.emit({
      type: RestEvent.CouldNotRest,
      actors: [npc],
      data: {
        npc,
        home,
        reason: outcome.reason,
        standingIn: this.map.locationOf(npc) ?? null,
        tryingAgainAt: this.require(npc).nextAt,
      },
    });
  }

  /** Lie down. The only place `asleep` becomes true after `begin`. */
  private sleep(npc: EntityId, home: EntityId): void {
    const rest = this.require(npc);
    this.set(npc, { ...rest, asleep: true, headingHome: false });
    this.reschedule(npc, RestKind.Rise);
    this.sim.emit({
      type: RestEvent.WentToBed,
      actors: [npc],
      location: home,
      data: { npc, bed: rest.routine.bed, wakingAt: this.require(npc).nextAt },
    });
  }

  // --- internals ------------------------------------------------------------

  private set(npc: EntityId, rest: Rest): void {
    this.resting.set(npc, Object.freeze(rest));
  }

  /**
   * Swap the pending transition for the next one.
   *
   * Cancels before scheduling. Leaving the old handle live would give one
   * person two alarms, which is half of what `npc.rest-has-a-next-change`
   * exists to catch; cancelling a transition that has already fired is a cheap
   * no-op, so the ordering costs nothing.
   */
  private reschedule(npc: EntityId, kind: RestKindName, timing: TimingName = Timing.Next): void {
    const rest = this.require(npc);
    this.sim.cancel(rest.next);
    this.set(npc, { ...rest, ...this.scheduleNext(npc, kind, rest.routine, timing) });
  }

  /**
   * Put one transition in the scheduler.
   *
   * `Priority.Decision` rather than `Physiology`, although sleeping is nearer
   * the latter. This habit is a placeholder for the utility scoring that
   * replaces it in Phase 4, and that scoring belongs in the decision band;
   * claiming the band now means the replacement does not renumber the event
   * order of every world saved before it.
   */
  private scheduleNext(
    npc: EntityId,
    kind: RestKindName,
    routine: Routine,
    timing: TimingName,
  ): Pick<Rest, 'next' | 'nextAt' | 'nextKind'> {
    const base = kind === RestKind.Rise ? routine.rise : routine.bed;
    const timeOfDay =
      timing === Timing.Stated ? base : jitter(this.sim.random(RngStream.NpcDecisions), base);
    const at =
      timing === Timing.Tomorrow
        ? tickOfDayTomorrow(this.sim.tick, timeOfDay)
        : nextTickOfDay(this.sim.tick, timeOfDay);
    const next = this.sim.scheduleAt<RestPayload>(
      at,
      kind === RestKind.Rise ? RISE_EVENT : BED_EVENT,
      { npc },
      Priority.Decision,
    );
    return { next, nextAt: at, nextKind: kind };
  }

  private homeOf(npc: EntityId): EntityId {
    const home = this.population.require(npc).home;
    assert(home !== null, 'somebody in the daily cycle has lost their home', { npc });
    return home;
  }

  // --- persistence ----------------------------------------------------------

  save(): JsonValue {
    return {
      resting: this.ids().map((npc) => {
        const rest = this.require(npc);
        return {
          npc: rest.npc,
          routine: { rise: rest.routine.rise, bed: rest.routine.bed },
          asleep: rest.asleep,
          headingHome: rest.headingHome,
          dayDestination: rest.dayDestination,
          next: rest.next,
          nextAt: rest.nextAt,
          nextKind: rest.nextKind,
        };
      }),
    } as unknown as JsonValue;
  }

  /**
   * Rebuild the cycle from a save.
   *
   * Every habit goes back through `makeRoutine`, so a save carrying somebody who
   * turns in before they get up is refused at load rather than becoming a
   * villager who never sleeps. Nothing here touches the map: `rest` sorts before
   * `travel` and `world`, so no location exists yet, and everything that
   * compares a sleeper against a place lives in `verify`.
   */
  restore(data: JsonValue): void {
    const result = RestSnapshotShape.safeParse(data);
    assert(result.success, 'rest save block failed validation', {
      issues: result.success
        ? []
        : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });

    const loaded = new Map<EntityId, Rest>();
    for (const raw of result.data.resting) {
      const npc = raw.npc as EntityId;
      assert(!loaded.has(npc), 'the same person is in the saved cycle twice', { npc });
      assert(
        raw.nextKind === (raw.asleep ? RestKind.Rise : RestKind.Bed),
        'a saved transition does not match the state it was saved in',
        { npc, asleep: raw.asleep, nextKind: raw.nextKind },
      );
      assert(
        !(raw.asleep && raw.headingHome),
        'somebody was saved asleep and on their way home at once',
        { npc },
      );
      loaded.set(
        npc,
        Object.freeze({
          npc,
          routine: makeRoutine(raw.routine),
          asleep: raw.asleep,
          headingHome: raw.headingHome,
          dayDestination: raw.dayDestination as EntityId | null,
          next: raw.next,
          nextAt: raw.nextAt,
          nextKind: raw.nextKind,
        }),
      );
    }
    this.resting = loaded;
  }

  /**
   * Check a loaded cycle against the rest of the loaded world.
   *
   * Three facts written by three save modules have to agree: the scheduler is
   * holding the pending transition (`core`), the person still exists and still
   * has that home (`npc`), and a sleeper is standing in it (`world`). If any of
   * them disagrees the save is half-written or hand-edited, and this is the last
   * moment at which noticing is cheap.
   */
  private verifyAgainstWorld(): void {
    for (const npc of this.ids()) {
      const rest = this.require(npc);
      assert(
        this.sim.scheduler.isPending(rest.next),
        'a saved routine points at a transition the scheduler does not have',
        { npc, next: rest.next, nextAt: rest.nextAt },
      );
      const home = this.population.require(npc).home;
      assert(home !== null, 'somebody in a saved cycle has no home', { npc });
      if (rest.asleep) {
        assert(this.map.locationOf(npc) === home, 'a saved sleeper is not in their own home', {
          npc,
          home,
          standingIn: this.map.locationOf(npc) ?? null,
        });
      }
    }
  }

  saveModule(): SaveModule {
    return {
      id: REST_SAVE_MODULE_ID,
      version: REST_SAVE_MODULE_VERSION,
      save: (): JsonValue => this.save(),
      load: (data: JsonValue): void => {
        this.restore(data);
      },
      verify: (): void => {
        this.verifyAgainstWorld();
      },
    };
  }
}

/** `event.data[key]`, if it is there and is an entity id. */
function readId(event: SimEvent, key: string): EntityId | undefined {
  const data = event.data as Record<string, unknown> | null | undefined;
  const value = data === null || data === undefined ? undefined : data[key];
  return typeof value === 'string' && isEntityId(value) ? value : undefined;
}

function readFlag(event: SimEvent, key: string): boolean | undefined {
  const data = event.data as Record<string, unknown> | null | undefined;
  const value = data === null || data === undefined ? undefined : data[key];
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * The rules the daily cycle obeys.
 *
 * Each one is a way the cycle can stop turning: a sleeper nobody will ever
 * wake, a person asleep in the middle of the road, or a habit that describes a
 * day running backwards.
 */
export function registerRestInvariants(
  sim: Simulation,
  population: Population,
  map: WorldMap,
  travel: TravelSystem,
  rest: RestSystem,
): void {
  sim.registerInvariant({
    id: 'npc.sleeper-is-at-home',
    description: 'Everyone asleep is in their own dwelling, and not on the road.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const npc of rest.sleepers()) {
        const home = population.get(npc)?.home ?? null;
        if (home === null) {
          violations.push(
            violation('npc.sleeper-is-at-home', 'somebody is asleep with no home to be in', { npc }),
          );
        } else if (map.locationOf(npc) !== home) {
          violations.push(
            violation('npc.sleeper-is-at-home', 'somebody is asleep away from their own home', {
              npc,
              home,
              standingIn: map.locationOf(npc) ?? null,
            }),
          );
        }
        // The Time rule from testing.md: sleeping and walking are exclusive
        // activities, and somebody doing both is the overlap that rule is for.
        if (travel.isTravelling(npc)) {
          violations.push(
            violation('npc.sleeper-is-at-home', 'somebody is asleep and travelling at once', {
              npc,
              headedFor: travel.destinationOf(npc) ?? null,
            }),
          );
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'npc.rest-has-a-next-change',
    description:
      'Everyone in the cycle holds exactly one pending transition, not in the past, of the right kind.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const npc of rest.ids()) {
        const record = rest.require(npc);
        if (!sim.scheduler.isPending(record.next)) {
          violations.push(
            violation(
              'npc.rest-has-a-next-change',
              'somebody in the cycle has no pending transition',
              { npc, next: record.next, nextKind: record.nextKind },
            ),
          );
        }
        // `<`, not `<=`. Two villagers can share a bedtime, and the moment
        // after the first one's fires the second is still holding a transition
        // due on this very tick. Demanding the future outright would report a
        // violation every time two people went to bed together.
        if (record.nextAt < sim.tick) {
          violations.push(
            violation('npc.rest-has-a-next-change', 'a pending transition is in the past', {
              npc,
              nextAt: record.nextAt,
              tick: sim.tick,
            }),
          );
        }
        // A sleeper waiting on another bedtime is the shape of "slept through a
        // whole day", caught on the evening before it would have happened.
        const expected = record.asleep ? RestKind.Rise : RestKind.Bed;
        if (record.nextKind !== expected) {
          violations.push(
            violation(
              'npc.rest-has-a-next-change',
              'a pending transition does not match the state',
              { npc, asleep: record.asleep, nextKind: record.nextKind, expected },
            ),
          );
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'npc.routine-is-coherent',
    description: 'Every habit describes a day that runs forwards inside one calendar day.',
    check: () =>
      rest
        .ids()
        .filter((npc) => {
          const routine = rest.require(npc).routine;
          return routine.bed <= routine.rise;
        })
        .map((npc) =>
          violation('npc.routine-is-coherent', 'somebody turns in before they get up', {
            npc,
            routine: rest.require(npc).routine,
          }),
        ),
  });
}

/**
 * Attach the daily cycle to a simulation: handlers, persistence and invariants.
 *
 * Nobody is put in the cycle here. Who keeps what hours depends on households,
 * which depend on worldgen, which lives in the app (slice 6).
 * `RestSystem.begin` is the door in.
 */
export function installRest(
  sim: Simulation,
  population: Population,
  map: WorldMap,
  travel: TravelSystem,
): RestSystem {
  const rest = new RestSystem(sim, population, map, travel);
  sim.registerSaveModule(rest.saveModule());
  registerRestInvariants(sim, population, map, travel, rest);
  return rest;
}
