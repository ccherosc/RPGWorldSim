import { type JsonValue, assert } from '@rpgsim/shared';
import {
  type EntityId,
  type InvariantViolation,
  Priority,
  type SaveModule,
  type ScheduledEventId,
  type Simulation,
  type Tick,
  compareEntityIds,
  isEntityId,
  violation,
} from '@rpgsim/sim-core';
import { z } from 'zod';
import { EntityIdSchema } from './location.ts';
import type { EntryRefusalReason, WorldMap } from './map.ts';

/**
 * Movement: getting somewhere takes time.
 *
 * Prime Directive 7 says a physical action respects location and travel time,
 * and this is the system that makes that true rather than aspirational. Nobody
 * changes location except through here, and here always costs ticks.
 *
 * **A journey is walked leg by leg, not in one jump.** PHASE_1.md sketched a
 * single arrival at `now + routeCost`; walking each edge separately costs the
 * same total, and buys three things worth more than the simplicity: a traveller
 * genuinely passes through the places between, so an observer can see them on
 * Mill Road; a long walk can be interrupted at the next crossroads instead of
 * only at its end; and wherever a traveller ends up, it is a real location they
 * are standing in.
 *
 * **Departure takes the seat at the far end.** The traveller belongs to no
 * location while walking, but `map.reserve` holds their room at the next node.
 * That is what makes arrival total: it cannot fail for want of space, so there
 * is no case in which somebody finishes a walk and has nowhere to be.
 */

/** The scheduled-event kind that lands a traveller at the next node. */
export const TRAVEL_ARRIVAL_EVENT = 'world.travel.arrive';

/** Why a journey did not start, or did not continue. */
export const TravelRefusal = {
  /** The traveller is not on the map — unborn, dead, or removed. */
  NotPlaced: 'not-placed',
  /** Already on the road. One journey at a time. */
  AlreadyTravelling: 'already-travelling',
  /** No such place. */
  UnknownDestination: 'unknown-destination',
  /** The map has no path from here to there. */
  NoRoute: 'no-route',
} as const;

export type TravelRefusalReason =
  | (typeof TravelRefusal)[keyof typeof TravelRefusal]
  | EntryRefusalReason;

export type TravelOutcome =
  | { readonly started: true; readonly journey: Journey }
  /** Already standing at the destination. Not a refusal, and not a journey. */
  | { readonly started: false; readonly reason: 'already-there' }
  | {
      readonly started: false;
      readonly reason: TravelRefusalReason;
      readonly details: Readonly<Record<string, unknown>>;
    };

/**
 * Someone on the road.
 *
 * `path` is the whole route including both ends, and `leg` is the index of the
 * edge being walked: from `path[leg]` to `path[leg + 1]`. The arrival handle is
 * saved with the journey because a pending scheduled event is future state and
 * determinism rule 8 says future state is persisted — a journey that reloaded
 * without its handle would be a traveller nobody could ever stop.
 */
export interface Journey {
  readonly traveller: EntityId;
  readonly path: readonly EntityId[];
  readonly leg: number;
  /** Tick the whole journey began. */
  readonly startedAt: Tick;
  /** Tick the current leg began. */
  readonly legDepartedAt: Tick;
  /** Tick the current leg ends. */
  readonly legArrivesAt: Tick;
  /** Total cost of the route in ticks, fixed when the journey started. */
  readonly totalCost: number;
  readonly arrival: ScheduledEventId;
}

interface ArrivalPayload extends Record<string, JsonValue> {
  readonly traveller: EntityId;
}

export const TRAVEL_SAVE_MODULE_ID = 'travel';
export const TRAVEL_SAVE_MODULE_VERSION = 1;

const JourneySchema = z.object({
  traveller: EntityIdSchema,
  path: z.array(EntityIdSchema).min(2),
  leg: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(),
  legDepartedAt: z.number().int().nonnegative(),
  legArrivesAt: z.number().int().nonnegative(),
  totalCost: z.number().int().positive(),
  arrival: z.number().int().positive(),
});

const TravelSnapshotShape = z.object({ journeys: z.array(JourneySchema) });

export class TravelSystem {
  private journeys = new Map<EntityId, Journey>();

  constructor(
    private readonly sim: Simulation,
    private readonly map: WorldMap,
  ) {
    sim.on<ArrivalPayload>(TRAVEL_ARRIVAL_EVENT, (_sim, event) => {
      this.arrive(event.payload.traveller);
    });
  }

  // --- queries --------------------------------------------------------------

  isTravelling(entity: EntityId): boolean {
    return this.journeys.has(entity);
  }

  journeyOf(entity: EntityId): Journey | undefined {
    return this.journeys.get(entity);
  }

  /** Everyone on the road, in id order. */
  travellers(): EntityId[] {
    return [...this.journeys.keys()].sort(compareEntityIds);
  }

  /** Where a traveller is headed in the end, not the next node. */
  destinationOf(entity: EntityId): EntityId | undefined {
    const journey = this.journeys.get(entity);
    return journey === undefined ? undefined : journey.path[journey.path.length - 1];
  }

  // --- the journey ----------------------------------------------------------

  /**
   * Set out for a destination.
   *
   * Refusals are returned rather than thrown: a villager who cannot get into
   * the tavern has not encountered a bug, they have encountered a full tavern,
   * and the difference matters to every caller. Each refusal also emits
   * `travel.blocked`, because PHASE_1.md section 3 is explicit that a refused
   * action is as informative as a successful one — it is what the `WHY?` view
   * reads to explain why a villager did something else instead.
   */
  begin(traveller: EntityId, destination: EntityId): TravelOutcome {
    assert(isEntityId(traveller), 'not a valid entity id', { traveller });

    if (this.journeys.has(traveller)) {
      return this.refuse(traveller, destination, TravelRefusal.AlreadyTravelling, {
        headedFor: this.destinationOf(traveller) ?? null,
      });
    }

    const origin = this.map.locationOf(traveller);
    if (origin === undefined) {
      return this.refuse(traveller, destination, TravelRefusal.NotPlaced, {});
    }
    if (!this.map.hasLocation(destination)) {
      return this.refuse(traveller, destination, TravelRefusal.UnknownDestination, { origin });
    }
    if (origin === destination) return { started: false, reason: 'already-there' };

    const route = this.map.findRoute(origin, destination);
    if (route === undefined) {
      return this.refuse(traveller, destination, TravelRefusal.NoRoute, { origin });
    }

    return this.departLeg(traveller, route.path, 0, this.sim.tick, route.cost);
  }

  /**
   * Stop at the next node rather than at the end of the route.
   *
   * Travel is not interrupted mid-edge, because there is nowhere to stand in
   * the middle of an edge: a person between the green and the mill is not
   * anywhere the map can name. Truncating the route honours the interruption at
   * the next place they reach, which is the earliest moment at which "stopped"
   * is a state the world can represent.
   *
   * Returns the node they will stop at, or `undefined` if they were not
   * travelling.
   */
  interrupt(traveller: EntityId, reason = 'interrupted'): EntityId | undefined {
    const journey = this.journeys.get(traveller);
    if (journey === undefined) return undefined;

    const stopAt = journey.path[journey.leg + 1] as EntityId;
    const abandoned = journey.path[journey.path.length - 1] as EntityId;
    if (stopAt === abandoned) return stopAt;

    this.journeys.set(traveller, {
      ...journey,
      path: journey.path.slice(0, journey.leg + 2),
    });
    this.sim.emit({
      type: 'travel.blocked',
      actors: [traveller],
      location: stopAt,
      data: { traveller, reason, stoppingAt: stopAt, abandoned },
    });
    return stopAt;
  }

  /**
   * Take a traveller off the road immediately — death, or removal from play.
   *
   * The held seat is given back and the arrival is cancelled. The traveller is
   * left placed nowhere, which is what "no longer in the world" means; what
   * happens next belongs to the caller.
   */
  abandon(traveller: EntityId): boolean {
    const journey = this.journeys.get(traveller);
    if (journey === undefined) return false;
    this.sim.cancel(journey.arrival);
    this.map.releaseReservation(traveller);
    this.journeys.delete(traveller);
    return true;
  }

  // --- internals ------------------------------------------------------------

  /**
   * Leave `path[leg]` for `path[leg + 1]`.
   *
   * `canEnter` is the graceful gate: it turns a full room or a shut door into a
   * returned refusal while the traveller is still standing where they started.
   * `reserve` then asks the same question again and throws if the answer has
   * changed, which it cannot here — the two calls are adjacent. The seat is
   * taken before the traveller steps off the map rather than after, so that if
   * the two ever do disagree, the failure leaves them in the place they were
   * rather than in no place at all.
   */
  private departLeg(
    traveller: EntityId,
    path: readonly EntityId[],
    leg: number,
    startedAt: Tick,
    totalCost: number,
  ): TravelOutcome {
    const from = path[leg] as EntityId;
    const to = path[leg + 1] as EntityId;
    const destination = path[path.length - 1] as EntityId;

    const entry = this.map.canEnter(traveller, to);
    if (!entry.allowed) {
      this.journeys.delete(traveller);
      return this.refuse(traveller, destination, entry.reason, { ...entry.details, from, to });
    }

    const cost = this.map.travelCost(from, to);
    assert(cost !== undefined, 'a route used an edge that does not exist', { from, to });

    this.map.reserve(traveller, to);
    this.map.remove(traveller);

    const arrival = this.sim.schedule<ArrivalPayload>(
      cost,
      TRAVEL_ARRIVAL_EVENT,
      { traveller },
      Priority.Movement,
    );

    const journey: Journey = {
      traveller,
      path,
      leg,
      startedAt,
      legDepartedAt: this.sim.tick,
      legArrivesAt: this.sim.tick + cost,
      totalCost,
      arrival,
    };
    this.journeys.set(traveller, journey);

    this.sim.emit({
      type: 'travel.departed',
      actors: [traveller],
      location: from,
      data: { traveller, from, to, destination, cost, arrivesAt: journey.legArrivesAt },
    });

    return { started: true, journey };
  }

  /** The arrival handler. Lands the traveller, then either stops or walks on. */
  private arrive(traveller: EntityId): void {
    const journey = this.journeys.get(traveller);
    assert(journey !== undefined, 'an arrival fired for someone who is not travelling', {
      traveller,
    });

    const at = this.map.settle(traveller);
    const from = journey.path[journey.leg] as EntityId;
    const destination = journey.path[journey.path.length - 1] as EntityId;
    const final = journey.leg >= journey.path.length - 2;

    this.sim.emit({
      type: 'travel.arrived',
      actors: [traveller],
      location: at,
      data: { traveller, at, from, final, destination, travelled: this.sim.tick - journey.startedAt },
    });

    if (final) {
      this.journeys.delete(traveller);
      return;
    }

    this.departLeg(traveller, journey.path, journey.leg + 1, journey.startedAt, journey.totalCost);
  }

  private refuse(
    traveller: EntityId,
    destination: EntityId,
    reason: TravelRefusalReason,
    details: Readonly<Record<string, unknown>>,
  ): TravelOutcome {
    const at = this.map.locationOf(traveller);
    this.sim.emit({
      type: 'travel.blocked',
      actors: [traveller],
      ...(at !== undefined ? { location: at } : {}),
      data: { traveller, destination, reason, ...(details as Record<string, JsonValue>) },
    });
    return { started: false, reason, details };
  }

  // --- persistence ----------------------------------------------------------

  save(): JsonValue {
    return {
      journeys: this.travellers().map((id) => {
        const journey = this.journeys.get(id) as Journey;
        return { ...journey, path: [...journey.path] };
      }),
    } as unknown as JsonValue;
  }

  /**
   * Rebuild the road from a save.
   *
   * Only the journeys themselves, and only the checks that need nothing but
   * the journey. The map has *not* been restored yet — modules load in sorted
   * id order and `travel` sorts before `world` — so everything that compares a
   * journey against the map lives in `verifySeats`, which the registry runs
   * once the whole envelope is in.
   */
  restore(data: JsonValue): void {
    const result = TravelSnapshotShape.safeParse(data);
    assert(result.success, 'travel save block failed validation', {
      issues: result.success ? [] : result.error.issues,
    });

    this.journeys = new Map();
    for (const journey of result.data.journeys) {
      const traveller = journey.traveller as EntityId;
      const path = journey.path as EntityId[];
      assert(journey.leg + 1 < path.length, 'a saved journey has walked off the end of its route', {
        traveller,
        leg: journey.leg,
        legs: path.length - 1,
      });
      this.journeys.set(traveller, { ...journey, traveller, path });
    }
  }

  /**
   * Check a loaded world's travellers against the loaded map.
   *
   * A journey and a held seat are two halves of one fact, written by two save
   * modules. If they disagree, somebody edited a save or a build wrote a
   * half-finished one, and the traveller involved is about to arrive somewhere
   * that was not expecting them — or to walk forever. Refusing here is the last
   * moment at which that is cheap to notice.
   */
  private verifySeats(): void {
    for (const [traveller, journey] of this.journeys) {
      const next = journey.path[journey.leg + 1];
      assert(
        this.map.reservationOf(traveller) === next,
        'a saved traveller is not holding a seat at the node they are walking to',
        { traveller, holding: this.map.reservationOf(traveller) ?? null, expected: next ?? null },
      );
      assert(!this.map.isPlaced(traveller), 'a saved traveller is also standing somewhere', {
        traveller,
        standingIn: this.map.locationOf(traveller) ?? null,
      });
    }

    for (const entity of this.map.reservingEntities()) {
      assert(this.journeys.has(entity), 'a saved seat is held for somebody who is not travelling', {
        entity,
        at: this.map.reservationOf(entity) ?? null,
      });
    }
  }

  saveModule(): SaveModule {
    return {
      id: TRAVEL_SAVE_MODULE_ID,
      version: TRAVEL_SAVE_MODULE_VERSION,
      save: (): JsonValue => this.save(),
      load: (data: JsonValue): void => {
        this.restore(data);
      },
      verify: (): void => {
        this.verifySeats();
      },
    };
  }
}

/**
 * The rules movement obeys.
 *
 * Every one of these is a way for a person to stop being anywhere, which is the
 * failure this whole system is arranged around preventing.
 */
export function registerTravelInvariants(
  sim: Simulation,
  map: WorldMap,
  travel: TravelSystem,
): void {
  sim.registerInvariant({
    id: 'travel.traveller-is-on-the-road',
    description: 'Everyone travelling is off the map, holding the seat they are walking to.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const traveller of travel.travellers()) {
        const journey = travel.journeyOf(traveller) as Journey;
        const next = journey.path[journey.leg + 1];

        if (map.isPlaced(traveller)) {
          violations.push(
            violation('travel.traveller-is-on-the-road', 'a traveller is also standing somewhere', {
              traveller,
              standingIn: map.locationOf(traveller) ?? null,
            }),
          );
        }
        if (map.reservationOf(traveller) !== next) {
          violations.push(
            violation(
              'travel.traveller-is-on-the-road',
              'a traveller is not holding a seat at the node they are walking to',
              { traveller, holding: map.reservationOf(traveller) ?? null, expected: next ?? null },
            ),
          );
        }
      }
      return violations;
    },
  });

  sim.registerInvariant({
    id: 'travel.no-seat-without-a-traveller',
    description: 'Nobody holds a seat without being on their way to it.',
    check: () =>
      map
        .reservingEntities()
        .filter((entity) => !travel.isTravelling(entity))
        .map((entity) =>
          violation('travel.no-seat-without-a-traveller', 'a seat is held for someone who is not travelling', {
            entity,
            at: map.reservationOf(entity) ?? null,
          }),
        ),
  });

  sim.registerInvariant({
    id: 'travel.arrival-cannot-precede-departure',
    description: 'A leg arrives after it departs, never before, and never for free.',
    check: () => {
      const violations: InvariantViolation[] = [];
      for (const traveller of travel.travellers()) {
        const journey = travel.journeyOf(traveller) as Journey;
        const from = journey.path[journey.leg] as EntityId;
        const to = journey.path[journey.leg + 1] as EntityId;
        const cost = map.travelCost(from, to);

        if (journey.legArrivesAt <= journey.legDepartedAt) {
          violations.push(
            violation(
              'travel.arrival-cannot-precede-departure',
              'a leg arrives no later than it departed',
              { traveller, departedAt: journey.legDepartedAt, arrivesAt: journey.legArrivesAt },
            ),
          );
        }
        if (journey.legDepartedAt < journey.startedAt) {
          violations.push(
            violation(
              'travel.arrival-cannot-precede-departure',
              'a leg departed before the journey began',
              { traveller, startedAt: journey.startedAt, departedAt: journey.legDepartedAt },
            ),
          );
        }
        // The full cost of the edge, not a tick less. This is the check that
        // catches a future "hurry up" shortcut quietly halving a walk.
        if (cost !== journey.legArrivesAt - journey.legDepartedAt) {
          violations.push(
            violation(
              'travel.arrival-cannot-precede-departure',
              'a leg does not take as long as the edge it walks',
              {
                traveller,
                from,
                to,
                edgeCost: cost ?? null,
                legCost: journey.legArrivesAt - journey.legDepartedAt,
              },
            ),
          );
        }
      }
      return violations;
    },
  });
}

/** Attach movement to a simulation: handler, persistence and invariants. */
export function installTravel(sim: Simulation, map: WorldMap): TravelSystem {
  const travel = new TravelSystem(sim, map);
  sim.registerSaveModule(travel.saveModule());
  registerTravelInvariants(sim, map, travel);
  return travel;
}

/** Whether a value is a structurally valid travel save block. */
export function isTravelSnapshot(data: unknown): boolean {
  return TravelSnapshotShape.safeParse(data).success;
}
