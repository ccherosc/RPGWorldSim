import {
  type CalendarConfig,
  type EntityId,
  EntityKind,
  RngStream,
  Simulation,
  dateTimeToTick,
  violation,
} from '@rpgsim/sim-core';
import {
  type NameBook,
  type PeopleSystem,
  type RestSystem,
  type TraitDistribution,
  type TraitName,
  TRAIT_NAMES,
  installPeople,
  installRest,
  routineBandsFromJson,
} from '@rpgsim/npc';
import { type HouseholdSystem, installSociety, memberIds, roleOf } from '@rpgsim/society';
import {
  Access,
  type Building,
  LocationType,
  type TravelSystem,
  type WorldMap,
  installTravel,
  installWorld,
  makeBuilding,
  makeLocation,
  withBuilding,
  withLocation,
} from '@rpgsim/world';
import type { VillageConfig } from './village-schema.ts';
import type { WorldFactory } from './verify.ts';

/**
 * World Zero: the village, built from `data/world/village.json`.
 *
 * This is the world the project is actually about, and the one `verify` now
 * runs against by default. `ProbeWorld` stays as a fast regression probe for
 * the kernel itself; it exercises properties this world does not yet have
 * (cancellation storms, several colliding priorities), and deleting it would
 * lose that coverage the day this world stops exercising them.
 *
 * **Slugs live only in here.** The data file names places by slug, this class
 * keeps a slug-to-id table for the length of one `populate()` call, and nothing
 * downstream ever sees a slug. Ids are allocated by `sim.newId` in the order
 * the arrays are written, which is why the order of every array in
 * `village.json` is part of what a seed means.
 *
 * **Nothing here reads a file.** The config arrives already parsed, so the same
 * config and the same seed build the same village whatever is on disk
 * (determinism rule 4). `loadVillage` is the boundary.
 */

export interface VillageWorldOptions {
  readonly seed: string;
  readonly config: VillageConfig;
  readonly names: NameBook;
  /** Defaults to the built-in calendar; the CLI loads it from `data/`. */
  readonly calendar?: CalendarConfig;
  readonly retainEvents?: number;
}

export class VillageWorld {
  readonly sim: Simulation;
  readonly map: WorldMap;
  readonly travel: TravelSystem;
  readonly people: PeopleSystem;
  readonly households: HouseholdSystem;
  readonly rest: RestSystem;

  private readonly config: VillageConfig;
  private readonly names: NameBook;

  constructor(options: VillageWorldOptions) {
    this.config = options.config;
    this.names = options.names;

    this.sim = new Simulation({
      seed: options.seed,
      startTick: dateTimeToTick(options.config.start, options.calendar),
      ...(options.calendar !== undefined ? { calendar: options.calendar } : {}),
      ...(options.retainEvents !== undefined ? { eventLog: { retain: options.retainEvents } } : {}),
    });

    // Install order is load order's business, not ours -- `SaveRegistry` loads
    // modules in sorted id order regardless of how they were registered. This
    // order is the dependency order: a map before the travel that reads it,
    // people before the households that move them in, rest last because it
    // needs all four.
    this.map = installWorld(this.sim);
    this.travel = installTravel(this.sim, this.map);
    this.people = installPeople(this.sim);
    this.households = installSociety(this.sim, this.people);
    this.rest = installRest(this.sim, this.people.population, this.map, this.travel);

    this.registerInvariants();
  }

  /**
   * Build the village. Never call this on a world about to be loaded from a
   * save: the save already holds every place, person and pending alarm.
   */
  populate(): this {
    const places = this.buildPlaces();
    const cottages = this.buildDwellings(places);
    this.buildStructures(places);
    this.settle(cottages, places);
    this.announce();
    return this;
  }

  /**
   * The village's own first line: `world.generated`.
   *
   * Last rather than first, because the counts it carries do not exist until
   * worldgen has finished, and an opening record that had to be corrected
   * afterwards would not be a record. It shares its tick with every founding
   * event, so a reader that wants the founding in order reads by event id.
   *
   * It carries the seed on purpose. Everything else in the archive is an
   * observation about the village; this is the one line that says which village
   * it is, and it is what lets a rebuilt archive be checked against the one it
   * claims to reproduce.
   */
  private announce(): void {
    this.sim.emit({
      type: 'world.generated',
      data: {
        seed: this.sim.seed,
        village: this.config.name,
        opened: this.config.start,
        people: this.population,
        households: this.households.register.householdCount,
        places: this.map.locationCount,
      },
    });
  }

  get population(): number {
    return this.people.population.count;
  }

  /** Cheap, human-readable state summary for the CLI and for eyeball debugging. */
  summary(): string {
    const asleep = this.people.population
      .ids()
      .filter((npc) => this.rest.isAsleep(npc)).length;
    return [
      `${this.sim.format()}`,
      `people=${this.population}`,
      `households=${this.households.register.householdCount}`,
      `places=${this.map.locationCount}`,
      `asleep=${asleep}`,
      `travelling=${this.travel.travellers().length}`,
      `events=${this.sim.eventsProcessed}`,
    ].join('  ');
  }

  // --- building it ----------------------------------------------------------

  /**
   * The authored places: the green, the lanes, the church, the fields.
   *
   * Written out one by one rather than generated, because these are the places
   * that give the village its shape and a shape nobody chose is a shape nobody
   * can tune. The cottages are the opposite case and are dealt with below.
   */
  private buildPlaces(): Map<string, EntityId> {
    const places = new Map<string, EntityId>();
    for (const place of this.config.places) {
      const id = this.sim.newId(EntityKind.Location);
      places.set(place.slug, id);
      this.map.addLocation(
        makeLocation({
          id,
          name: place.name,
          type: place.type,
          coordinate: place.coordinate,
          ...(place.capacity !== undefined ? { capacity: place.capacity } : {}),
          ...(place.access !== undefined ? { access: place.access } : {}),
        }),
      );
      this.record(id);
    }

    for (const road of this.config.roads) {
      this.map.connect(this.slug(places, road.from), this.slug(places, road.to), road.cost);
    }

    return places;
  }

  /**
   * `place.created`: the village saying, once, that somewhere exists.
   *
   * Directive 8 asks every significant state change to emit an event, and a
   * place coming into being is the one every other event depends on -- all of
   * them happen somewhere. Without this the archive names each of eighty-six
   * people and merely numbers thirty-eight places, so anything reading it back
   * would have to map `location:3` onto the third entry of `village.json` by
   * counting. That is an assumption about the order worldgen ran in dressed up
   * as a fact, and it silently becomes wrong the day a system allocates an id
   * earlier -- which is the same trap the press side avoids by keying on slugs.
   *
   * Read back out of the map rather than copied from the config, so the event
   * reports what the place *is* once `makeLocation` has applied its defaults,
   * not what the file happened to ask for. The cottages go through here too,
   * which is why it takes an id and not a config entry: they are built from
   * arithmetic and have no config entry to take.
   */
  private record(id: EntityId): void {
    const place = this.map.location(id);
    this.sim.emit({
      type: 'place.created',
      location: id,
      data: {
        place: id,
        name: place.name,
        type: place.type,
        access: place.access,
      },
    });
  }

  /**
   * The cottages: a count, dealt round-robin along the lanes.
   *
   * Nobody wants to write twenty-four near-identical objects by hand, and
   * nobody wants to read them. What the data file states is the part that
   * matters -- how many, on which lanes, how far back from the road -- and the
   * arithmetic that turns that into coordinates lives here where it can be
   * tested.
   *
   * Each one is named for the family that ends up in it, which happens later in
   * `settle`; until then it is "A cottage on Mill Lane", because a building with
   * no name at all reads as a bug in every event it appears in.
   */
  private buildDwellings(places: Map<string, EntityId>): Building[] {
    const spec = this.config.dwellings;
    const rng = this.sim.random(RngStream.Worldgen);
    const cottages: Building[] = [];

    for (let i = 0; i < spec.count; i++) {
      const laneSlug = spec.lanes[i % spec.lanes.length] as string;
      const lane = this.map.location(this.slug(places, laneSlug));

      // Down the lane, alternating sides. Integer arithmetic throughout: a
      // coordinate is a position on a map, not a measurement, and floating
      // point here would be a rounding difference waiting to become a hash
      // difference.
      const along = Math.floor(i / spec.lanes.length) + 1;
      const side = i % 2 === 0 ? 1 : -1;

      const location = this.sim.newId(EntityKind.Location);
      this.map.addLocation(
        makeLocation({
          id: location,
          name: `A cottage on ${lane.name}`,
          type: LocationType.Dwelling,
          coordinate: {
            x: lane.coordinate.x + spec.spacing * along,
            y: lane.coordinate.y + spec.spacing * side,
          },
          capacity: spec.capacity,
          access: Access.Private,
        }),
      );
      this.record(location);
      this.map.connect(lane.id, location, spec.walkFromLane);

      const building = makeBuilding({
        id: this.sim.newId(EntityKind.Building),
        name: `A cottage on ${lane.name}`,
        type: spec.type,
        location,
        condition: rng.nextIntInclusive(spec.condition.min, spec.condition.max),
      });
      this.map.addBuilding(building);
      cottages.push(building);
    }

    return cottages;
  }

  private buildStructures(places: Map<string, EntityId>): void {
    for (const structure of this.config.structures) {
      this.map.addBuilding(
        makeBuilding({
          id: this.sim.newId(EntityKind.Building),
          name: structure.name,
          type: structure.type,
          location: this.slug(places, structure.place),
          ...(structure.condition !== undefined ? { condition: structure.condition } : {}),
        }),
      );
    }
  }

  /**
   * Fill the cottages: a household apiece, moved in and put on a routine.
   *
   * One household per cottage, in order, so that the cottage a family lives in
   * is a function of the seed and not of how the loop happened to run. A
   * village with more households than roofs is refused rather than housing two
   * families under one, which directive 6 would call inventing a dwelling.
   */
  private settle(cottages: readonly Building[], places: Map<string, EntityId>): void {
    const population = this.config.population;
    if (population.households > cottages.length) {
      throw new Error(
        `village.json asks for ${population.households} households and ${cottages.length} cottages`,
      );
    }

    const traits = expandTraits(population.traits);
    const bands = routineBandsFromJson(population.routineBands);
    const shifts = Object.fromEntries(population.roleShifts.map((s) => [s.role, s.shift]));
    const destinations = population.dayDestinations.map((slug) => this.slug(places, slug));
    const rng = this.sim.random(RngStream.Worldgen);

    for (let i = 0; i < population.households; i++) {
      const cottage = cottages[i] as Building;
      const household = this.households.generate({
        dwelling: cottage.location,
        names: this.names,
        templates: population.templates,
        traits,
      });

      const family = memberIds(household);
      const head = family[0] ?? null;

      // The house takes the family's name now that there is a family in it.
      // `replaceBuilding` refuses a change of location, which is the one thing
      // that must not move: the interior is what every `home` field points at.
      this.map.replaceBuilding(
        withBuilding(cottage, {
          name: `${household.name} Cottage`,
          owner: head,
          residents: family,
        }),
      );

      // And the family takes the right to walk into it. A cottage is private,
      // and a private place with an empty `permitted` list refuses everybody --
      // including the people who live there, which is what the first run of
      // this builder discovered by being unable to put anybody indoors. The
      // list cannot be written when the cottage is built, because the family
      // that goes in it does not exist until now.
      this.map.replaceLocation(
        withLocation(this.map.location(cottage.location), {
          name: `${household.name} Cottage`,
          owner: head,
          permitted: family,
        }),
      );

      for (const npc of family) {
        this.map.place(npc, cottage.location);
        this.rest.begin(npc, {
          ...(roleOf(household, npc) !== undefined
            ? { role: roleOf(household, npc) as string }
            : {}),
          dayDestination: rng.pick(destinations),
          bands,
          shifts,
        });
      }
    }
  }

  private slug(places: Map<string, EntityId>, slug: string): EntityId {
    const id = places.get(slug);
    if (id === undefined) {
      throw new Error(`village.json refers to a place "${slug}" that it never defines`);
    }
    return id;
  }

  // --- invariants -----------------------------------------------------------

  /**
   * The check that needed two packages to exist before it could be written.
   *
   * `@rpgsim/society` knows a household has a dwelling; `@rpgsim/world` knows
   * what a building is. Neither depends on the other and neither should, so
   * this check belongs to whoever assembles both -- which is this class. It was
   * deferred out of slice 4 for exactly that reason.
   */
  private registerInvariants(): void {
    this.sim.registerInvariant({
      id: 'world.dwelling-is-a-real-building',
      description: 'Every household lives inside the interior of a building that exists.',
      check: () => {
        const interiors = new Set(this.map.buildingsInOrder().map((b) => b.location));
        return this.households.register
          .all()
          .filter((household) => !interiors.has(household.dwelling))
          .map((household) =>
            violation(
              'world.dwelling-is-a-real-building',
              'a household lives somewhere that is not the inside of any building',
              { household: household.id, dwelling: household.dwelling },
            ),
          );
      },
    });
  }
}

/**
 * One bell curve, stated for every trait.
 *
 * The generator takes a per-trait map and falls back to its own default for
 * anything missing. Writing all twelve out means the village's own curve is
 * what every trait is rolled from, rather than eleven of them silently using
 * the package default because somebody added a trait and not a line of data.
 */
function expandTraits(
  distribution: TraitDistribution,
): Partial<Record<TraitName, TraitDistribution>> {
  const traits: Partial<Record<TraitName, TraitDistribution>> = {};
  for (const name of TRAIT_NAMES) traits[name] = distribution;
  return traits;
}

/** Convenience for the common "new world, ready to run" case. */
export function createVillageWorld(options: VillageWorldOptions): VillageWorld {
  return new VillageWorld(options).populate();
}

/** Rebuild the wiring for a world that is about to be loaded from a save. */
export function attachVillageWorld(options: VillageWorldOptions): VillageWorld {
  return new VillageWorld(options);
}

/**
 * The village as `verify` wants it.
 *
 * The config and the name book are read once, by whoever builds the factory,
 * and shared by every world it makes. That is deliberate: re-reading the files
 * per world would make the acceptance checks compare four worlds built from
 * whatever was on disk at four different moments, which is a way to have
 * "identical replay" quietly mean nothing.
 */
export function villageWorldFactory(options: Omit<VillageWorldOptions, 'seed'>): WorldFactory {
  return {
    label: 'village',
    create: (seed, beforePopulating) => {
      const world = attachVillageWorld({ ...options, seed });
      beforePopulating?.(world);
      return world.populate();
    },
    attach: (seed) => attachVillageWorld({ ...options, seed }),
  };
}
