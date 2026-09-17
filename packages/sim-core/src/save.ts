import { type JsonObject, type JsonValue, assert, canonicalStringify, fnv1a64Hex } from '@rpgsim/shared';
import { z } from 'zod';

/** Bump only for changes to the envelope itself, not to module payloads. */
export const SAVE_FORMAT = 'rpgsim.save';
export const SAVE_FORMAT_VERSION = 1;

export const SaveModuleBlockSchema = z.object({
  version: z.number().int().nonnegative(),
  data: z.unknown(),
});

export const SaveEnvelopeSchema = z.object({
  format: z.literal(SAVE_FORMAT),
  formatVersion: z.number().int().positive(),
  engineVersion: z.string(),
  /** Wall-clock time of the save. Excluded from the state hash on purpose. */
  createdAt: z.string(),
  seed: z.string().min(1),
  tick: z.number().int().nonnegative(),
  modules: z.record(SaveModuleBlockSchema),
});

export type SaveEnvelope = {
  format: typeof SAVE_FORMAT;
  formatVersion: number;
  engineVersion: string;
  createdAt: string;
  seed: string;
  tick: number;
  modules: Record<string, { version: number; data: JsonValue }>;
};

/**
 * One independently-versioned slice of world state.
 *
 * Each package owns its own module (`core`, later `world`, `npc`, `economy`,
 * ...) and migrates its own payload. CLAUDE.md directive 16 asks for backward
 * compatibility where practical, and per-module versioning is what makes that
 * affordable: adding a field to NPC state bumps only the `npc` module and
 * leaves every other module's saved bytes untouched.
 */
export interface SaveModule {
  readonly id: string;
  readonly version: number;
  save(): JsonValue;
  load(data: JsonValue, version: number): void;
  /**
   * Upgrade an older payload to the current `version`.
   * Required if a save written by an older version should still load.
   */
  migrate?(data: JsonValue, fromVersion: number): JsonValue;
  /**
   * Cross-module checks, run once every block in the envelope has loaded.
   *
   * Modules load in sorted id order, so a module cannot inspect another's
   * state during its own `load` — `travel` loads before `world` and would be
   * reading a map that is still empty. Anything a module wants to assert about
   * a *neighbour's* state belongs here, where the whole world exists. Throw to
   * refuse the save; sim-core rule 10 prefers a refused load to a world that
   * quietly disagrees with itself.
   */
  verify?(): void;
}

/**
 * Collects the save modules that make up a world.
 *
 * Modules are serialized in sorted id order so the envelope is canonical: two
 * runs that registered modules in a different order still produce byte-identical
 * saves and identical state hashes.
 */
export class SaveRegistry {
  private readonly modules = new Map<string, SaveModule>();

  register(module: SaveModule): void {
    assert(!this.modules.has(module.id), 'a save module with this id is already registered', {
      id: module.id,
    });
    this.modules.set(module.id, module);
  }

  has(id: string): boolean {
    return this.modules.has(id);
  }

  ids(): string[] {
    return [...this.modules.keys()].sort();
  }

  save(context: { engineVersion: string; seed: string; tick: number; createdAt?: string }): SaveEnvelope {
    const modules: Record<string, { version: number; data: JsonValue }> = {};
    for (const id of this.ids()) {
      const module = this.modules.get(id) as SaveModule;
      modules[id] = { version: module.version, data: module.save() };
    }
    return {
      format: SAVE_FORMAT,
      formatVersion: SAVE_FORMAT_VERSION,
      engineVersion: context.engineVersion,
      createdAt: context.createdAt ?? new Date().toISOString(),
      seed: context.seed,
      tick: context.tick,
      modules,
    };
  }

  /**
   * Load every registered module from an envelope.
   *
   * Unknown module blocks are ignored: a save written by a build that had an
   * extra package must still load in a build that does not. Missing blocks are
   * an error, because a module silently keeping its constructed-from-nothing
   * state would resume the world from a state that never existed.
   */
  load(envelope: SaveEnvelope): void {
    assert(envelope.format === SAVE_FORMAT, 'not a simulation save file', {
      format: envelope.format,
    });
    assert(
      envelope.formatVersion <= SAVE_FORMAT_VERSION,
      'save was written by a newer engine and cannot be read',
      { saveVersion: envelope.formatVersion, engineVersion: SAVE_FORMAT_VERSION },
    );

    for (const id of this.ids()) {
      const module = this.modules.get(id) as SaveModule;
      const block = envelope.modules[id];
      assert(block !== undefined, 'save is missing a required module', {
        moduleId: id,
        present: Object.keys(envelope.modules).sort(),
      });

      let data = block.data;
      let version = block.version;
      if (version !== module.version) {
        assert(
          version < module.version,
          'save module is newer than this build and cannot be read',
          { moduleId: id, saveVersion: version, moduleVersion: module.version },
        );
        assert(module.migrate !== undefined, 'save module needs migration but provides none', {
          moduleId: id,
          from: version,
          to: module.version,
        });
        data = module.migrate(data, version);
        version = module.version;
      }
      module.load(data, version);
    }

    // Second pass: now that every module holds its own state, let them check
    // each other. Same sorted order, so which module reports a mutual
    // inconsistency first is deterministic.
    for (const id of this.ids()) {
      (this.modules.get(id) as SaveModule).verify?.();
    }
  }
}

/**
 * Stable fingerprint of world state.
 *
 * This is the primary tool for proving and debugging determinism. Two runs from
 * the same seed must produce the same hash at the same tick; when they do not,
 * hashing at intervals bisects the first divergent tick in log time.
 *
 * `createdAt` is excluded because it is wall-clock time and has nothing to do
 * with simulated state. `engineVersion` is excluded so that a version bump
 * alone does not look like a behavioural change.
 */
export function hashEnvelope(envelope: SaveEnvelope): string {
  const hashable: JsonObject = {
    formatVersion: envelope.formatVersion,
    seed: envelope.seed,
    tick: envelope.tick,
    modules: Object.fromEntries(
      Object.keys(envelope.modules)
        .sort()
        .map((id) => {
          const block = envelope.modules[id] as { version: number; data: JsonValue };
          return [id, { version: block.version, data: block.data }];
        }),
    ),
  };
  return fnv1a64Hex(canonicalStringify(hashable));
}

/** Canonical bytes of a save, for writing to disk. */
export function serializeEnvelope(envelope: SaveEnvelope): string {
  return canonicalStringify(envelope as unknown as JsonValue);
}

export function parseEnvelope(text: string): SaveEnvelope {
  const parsed: unknown = JSON.parse(text);
  const result = SaveEnvelopeSchema.safeParse(parsed);
  assert(result.success, 'save file failed validation', {
    issues: result.success ? [] : result.error.issues.map((issue) => issue.message),
  });
  return result.data as SaveEnvelope;
}

/** Where saves live. Kept abstract so SQLite can replace JSON files later. */
export interface SaveStore {
  write(key: string, envelope: SaveEnvelope): void;
  read(key: string): SaveEnvelope | undefined;
  list(): string[];
  delete(key: string): boolean;
}

/** In-process store. Used by tests and by mid-run save/reload checks. */
export class MemorySaveStore implements SaveStore {
  private readonly entries = new Map<string, string>();

  write(key: string, envelope: SaveEnvelope): void {
    // Serialized rather than held by reference, so a later mutation of live
    // state cannot retroactively alter an already-written save.
    this.entries.set(key, serializeEnvelope(envelope));
  }

  read(key: string): SaveEnvelope | undefined {
    const text = this.entries.get(key);
    return text === undefined ? undefined : parseEnvelope(text);
  }

  list(): string[] {
    return [...this.entries.keys()].sort();
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }
}
