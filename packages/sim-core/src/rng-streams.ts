import { assert, type JsonObject, type JsonValue, isJsonObject } from '@rpgsim/shared';
import { Rng, type RngState } from './rng.ts';

/**
 * Well-known stream names.
 *
 * Streams exist so that unrelated random processes do not couple. If weather
 * and NPC decisions shared one stream, adding a single extra weather roll would
 * shift every subsequent decision in the world and make bisecting a behaviour
 * change effectively impossible.
 *
 * New subsystems should add a name here rather than reusing an existing one.
 */
export const RngStream = {
  /** World generation: terrain, buildings, founding population. */
  Worldgen: 'worldgen',
  /** Per-NPC action selection noise (the "controlled random variation" term). */
  NpcDecisions: 'npc_decisions',
  /** Trait, skill and appearance rolls when a person is created. */
  NpcGeneration: 'npc_generation',
  /** Weather and seasonal variation. */
  Weather: 'weather',
  /** Births, fertility, aging, natural death. */
  Demographics: 'demographics',
  /** Illness onset, injury severity, recovery. */
  Health: 'health',
  /** Combat resolution. */
  Combat: 'combat',
  /** Production yields, spoilage, tool wear. */
  Economy: 'economy',
  /** Gossip spread, rumour distortion, social encounter selection. */
  Social: 'social',
  /** Crop growth, animal behaviour, foraging. */
  Ecology: 'ecology',
  /** Reserved for tests and scratch work; never used by simulation systems. */
  Scratch: 'scratch',
} as const;

export type RngStreamName = (typeof RngStream)[keyof typeof RngStream] | (string & {});

export interface RngStreamsSnapshot {
  readonly worldSeed: string;
  readonly streams: Record<string, RngState>;
}

/**
 * Lazily-created collection of named RNG streams derived from one world seed.
 *
 * Streams are created on first use, so a save only carries the streams that
 * have actually been drawn from. A stream that has never been used is
 * indistinguishable from one created fresh from the world seed, which keeps
 * saves small without affecting replay.
 */
export class RngStreams {
  private readonly streams = new Map<string, Rng>();

  constructor(readonly worldSeed: string) {
    assert(worldSeed.length > 0, 'World seed must be a non-empty string');
  }

  /** Get (or lazily create) the stream with this name. */
  stream(name: RngStreamName): Rng {
    let rng = this.streams.get(name);
    if (rng === undefined) {
      rng = Rng.forStream(this.worldSeed, name);
      this.streams.set(name, rng);
    }
    return rng;
  }

  /** Names of every stream that has been touched, sorted for canonical output. */
  activeStreamNames(): string[] {
    return [...this.streams.keys()].sort();
  }

  save(): RngStreamsSnapshot {
    const streams: Record<string, RngState> = {};
    for (const name of this.activeStreamNames()) {
      streams[name] = (this.streams.get(name) as Rng).save();
    }
    return { worldSeed: this.worldSeed, streams };
  }

  static load(snapshot: RngStreamsSnapshot): RngStreams {
    const instance = new RngStreams(snapshot.worldSeed);
    for (const [name, state] of Object.entries(snapshot.streams)) {
      instance.streams.set(name, Rng.fromState(state));
    }
    return instance;
  }

  /** Restore into an existing instance, replacing all stream state. */
  restore(snapshot: RngStreamsSnapshot): void {
    assert(
      snapshot.worldSeed === this.worldSeed,
      'Refusing to restore RNG state from a different world seed',
      { expected: this.worldSeed, received: snapshot.worldSeed },
    );
    this.streams.clear();
    for (const [name, state] of Object.entries(snapshot.streams)) {
      this.streams.set(name, Rng.fromState(state));
    }
  }

  toJson(): JsonObject {
    const snapshot = this.save();
    const streams: JsonObject = {};
    for (const [name, state] of Object.entries(snapshot.streams)) {
      streams[name] = { s0: state.s0, s1: state.s1, s2: state.s2, s3: state.s3, draws: state.draws };
    }
    return { worldSeed: snapshot.worldSeed, streams };
  }

  static fromJson(value: JsonValue): RngStreamsSnapshot {
    assert(isJsonObject(value), 'RNG snapshot must be an object');
    const worldSeed = value['worldSeed'];
    const rawStreams = value['streams'];
    assert(typeof worldSeed === 'string', 'RNG snapshot is missing worldSeed');
    assert(isJsonObject(rawStreams), 'RNG snapshot is missing streams');

    const streams: Record<string, RngState> = {};
    for (const [name, raw] of Object.entries(rawStreams)) {
      assert(isJsonObject(raw), `RNG stream "${name}" is malformed`);
      streams[name] = {
        s0: numberField(raw, 's0', name),
        s1: numberField(raw, 's1', name),
        s2: numberField(raw, 's2', name),
        s3: numberField(raw, 's3', name),
        draws: numberField(raw, 'draws', name),
      };
    }
    return { worldSeed, streams };
  }
}

function numberField(raw: JsonObject, key: string, streamName: string): number {
  const value = raw[key];
  assert(
    typeof value === 'number' && Number.isSafeInteger(value),
    `RNG stream "${streamName}" field "${key}" must be an integer`,
    { value },
  );
  return value;
}
