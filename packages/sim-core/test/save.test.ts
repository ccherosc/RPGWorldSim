import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  JsonFileSaveStore,
  MemorySaveStore,
  SAVE_FORMAT,
  SAVE_FORMAT_VERSION,
  type SaveEnvelope,
  type SaveModule,
  SaveRegistry,
  hashEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from '@rpgsim/sim-core';
import type { JsonObject, JsonValue } from '@rpgsim/shared';

/** A save module backed by a plain mutable box, for exercising the registry. */
function box(id: string, version: number, state: { value: JsonValue }): SaveModule {
  return {
    id,
    version,
    save: () => state.value,
    load: (data) => {
      state.value = data;
    },
  };
}

function envelope(overrides: Partial<SaveEnvelope> = {}): SaveEnvelope {
  return {
    format: SAVE_FORMAT,
    formatVersion: SAVE_FORMAT_VERSION,
    engineVersion: '0.0.0-test',
    createdAt: '2000-01-01T00:00:00.000Z',
    seed: 'test-seed',
    tick: 0,
    modules: {},
    ...overrides,
  };
}

describe('SaveRegistry', () => {
  it('serializes modules in sorted id order regardless of registration order', () => {
    const forward = new SaveRegistry();
    forward.register(box('alpha', 1, { value: 1 }));
    forward.register(box('zulu', 1, { value: 2 }));

    const backward = new SaveRegistry();
    backward.register(box('zulu', 1, { value: 2 }));
    backward.register(box('alpha', 1, { value: 1 }));

    const context = { engineVersion: 'v', seed: 's', tick: 5, createdAt: 'fixed' };
    expect(forward.ids()).toEqual(['alpha', 'zulu']);
    expect(serializeEnvelope(forward.save(context))).toBe(
      serializeEnvelope(backward.save(context)),
    );
  });

  it('round-trips module state', () => {
    const source = { value: { hp: 7, name: 'Aldric' } as JsonValue };
    const registry = new SaveRegistry();
    registry.register(box('npc', 1, source));
    const saved = registry.save({ engineVersion: 'v', seed: 's', tick: 0 });

    const target = { value: null as JsonValue };
    const loader = new SaveRegistry();
    loader.register(box('npc', 1, target));
    loader.load(saved);

    expect(target.value).toEqual({ hp: 7, name: 'Aldric' });
  });

  it('rejects a duplicate module id', () => {
    const registry = new SaveRegistry();
    registry.register(box('dup', 1, { value: 0 }));
    expect(() => registry.register(box('dup', 1, { value: 0 }))).toThrow(/already registered/);
  });

  it('rejects a file that is not a simulation save', () => {
    const registry = new SaveRegistry();
    expect(() => registry.load(envelope({ format: 'something.else' as typeof SAVE_FORMAT }))).toThrow(
      /not a simulation save/,
    );
  });

  it('rejects an envelope from a newer engine format', () => {
    const registry = new SaveRegistry();
    expect(() => registry.load(envelope({ formatVersion: SAVE_FORMAT_VERSION + 1 }))).toThrow(
      /newer engine/,
    );
  });

  it('errors on a missing module rather than resuming from an invented state', () => {
    const registry = new SaveRegistry();
    registry.register(box('world', 1, { value: 'live' }));
    expect(() => registry.load(envelope())).toThrow(/missing a required module/);
  });

  it('ignores module blocks this build does not know about', () => {
    const target = { value: null as JsonValue };
    const registry = new SaveRegistry();
    registry.register(box('known', 1, target));

    registry.load(
      envelope({
        modules: {
          known: { version: 1, data: 'kept' },
          unknown_future_package: { version: 4, data: { anything: true } },
        },
      }),
    );
    expect(target.value).toBe('kept');
  });
});

describe('SaveRegistry migrations', () => {
  it('upgrades an older payload before handing it to load', () => {
    const seen: Array<[JsonValue, number]> = [];
    const registry = new SaveRegistry();
    registry.register({
      id: 'npc',
      version: 3,
      save: () => ({ schema: 3 }),
      load: (data, version) => seen.push([data, version]),
      migrate: (data, fromVersion) => ({
        schema: 3,
        upgradedFrom: fromVersion,
        original: data,
      }),
    });

    registry.load(envelope({ modules: { npc: { version: 1, data: { schema: 1 } } } }));
    expect(seen).toEqual([[{ schema: 3, upgradedFrom: 1, original: { schema: 1 } }, 3]]);
  });

  it('does not call migrate when versions already match', () => {
    let migrations = 0;
    const registry = new SaveRegistry();
    registry.register({
      id: 'npc',
      version: 2,
      save: () => null,
      load: () => {},
      migrate: (data) => {
        migrations++;
        return data;
      },
    });
    registry.load(envelope({ modules: { npc: { version: 2, data: null } } }));
    expect(migrations).toBe(0);
  });

  it('refuses a payload newer than the module', () => {
    const registry = new SaveRegistry();
    registry.register(box('npc', 1, { value: null }));
    expect(() => registry.load(envelope({ modules: { npc: { version: 2, data: null } } }))).toThrow(
      /newer than this build/,
    );
  });

  it('refuses an older payload when no migration is offered', () => {
    const registry = new SaveRegistry();
    registry.register(box('npc', 2, { value: null }));
    expect(() => registry.load(envelope({ modules: { npc: { version: 1, data: null } } }))).toThrow(
      /needs migration but provides none/,
    );
  });
});

/**
 * Cross-module checks after the whole envelope is in.
 *
 * Modules load in sorted id order, so an early module cannot inspect a later
 * one's state during its own `load` — it would be reading a half-built world.
 * The second pass exists so that a module can assert about its neighbours, and
 * the tests that matter are about *when* it runs, not that it runs at all.
 */
describe('SaveRegistry post-load verification', () => {
  it('runs every verify only after every module has loaded', () => {
    const trace: string[] = [];
    const registry = new SaveRegistry();
    // 'travel' sorts before 'world': the exact ordering that made this hook
    // necessary, where the earlier module is the one with something to check.
    registry.register({
      id: 'travel',
      version: 1,
      save: () => null,
      load: () => trace.push('load travel'),
      verify: () => trace.push('verify travel'),
    });
    registry.register({
      id: 'world',
      version: 1,
      save: () => null,
      load: () => trace.push('load world'),
      verify: () => trace.push('verify world'),
    });

    registry.load(
      envelope({ modules: { travel: { version: 1, data: null }, world: { version: 1, data: null } } }),
    );

    expect(trace).toEqual(['load travel', 'load world', 'verify travel', 'verify world']);
  });

  it('lets a module refuse a save that disagrees with another module', () => {
    let loaded: JsonValue = null;
    const registry = new SaveRegistry();
    registry.register({
      id: 'travel',
      version: 1,
      save: () => null,
      load: () => {},
      verify: () => {
        if (loaded !== 'expected') throw new Error('travel and world disagree about the world');
      },
    });
    registry.register({
      id: 'world',
      version: 1,
      save: () => null,
      load: (data) => {
        loaded = data;
      },
    });

    expect(() =>
      registry.load(
        envelope({
          modules: { travel: { version: 1, data: null }, world: { version: 1, data: 'wrong' } },
        }),
      ),
    ).toThrow(/disagree about the world/);
  });

  it('is optional, and a registry of modules without it loads unchanged', () => {
    const registry = new SaveRegistry();
    let loads = 0;
    registry.register({ id: 'npc', version: 1, save: () => null, load: () => void loads++ });

    expect(() => registry.load(envelope({ modules: { npc: { version: 1, data: null } } }))).not.toThrow();
    expect(loads).toBe(1);
  });
});

describe('hashEnvelope', () => {
  it('is stable for identical state', () => {
    expect(hashEnvelope(envelope({ tick: 42 }))).toBe(hashEnvelope(envelope({ tick: 42 })));
  });

  it('ignores wall-clock time and engine version', () => {
    const a = envelope({ createdAt: '1999-01-01T00:00:00.000Z', engineVersion: '0.1.0' });
    const b = envelope({ createdAt: '2044-12-31T23:59:59.000Z', engineVersion: '9.9.9' });
    expect(hashEnvelope(a)).toBe(hashEnvelope(b));
  });

  it('ignores module key ordering', () => {
    const a = envelope({ modules: { a: { version: 1, data: 1 }, b: { version: 1, data: 2 } } });
    const b = envelope({ modules: {} });
    b.modules['b'] = { version: 1, data: 2 };
    b.modules['a'] = { version: 1, data: 1 };
    expect(hashEnvelope(a)).toBe(hashEnvelope(b));
  });

  it('changes when the tick, the seed, or any module payload changes', () => {
    const modules = { m: { version: 1, data: { x: 1 } } };
    const base = hashEnvelope(envelope({ modules }));
    expect(hashEnvelope(envelope({ tick: 1, modules }))).not.toBe(base);
    expect(hashEnvelope(envelope({ seed: 'other', modules }))).not.toBe(base);
    expect(hashEnvelope(envelope({ modules: { m: { version: 1, data: { x: 2 } } } }))).not.toBe(base);
    expect(hashEnvelope(envelope({ modules: { m: { version: 2, data: { x: 1 } } } }))).not.toBe(base);
  });

  it('returns a 16-character hex digest', () => {
    expect(hashEnvelope(envelope())).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('envelope serialization', () => {
  it('writes canonical, key-sorted JSON', () => {
    const text = serializeEnvelope(envelope({ tick: 3 }));
    const keys = Object.keys(JSON.parse(text) as JsonObject);
    expect(keys).toEqual([...keys].sort());
    expect(parseEnvelope(text)).toEqual(envelope({ tick: 3 }));
  });

  it('rejects malformed or truncated saves instead of loading a half world', () => {
    expect(() => parseEnvelope('{')).toThrow();
    expect(() => parseEnvelope('{"format":"rpgsim.save"}')).toThrow(/failed validation/);
    expect(() => parseEnvelope(JSON.stringify({ ...envelope(), tick: -1 }))).toThrow(
      /failed validation/,
    );
    expect(() => parseEnvelope(JSON.stringify({ ...envelope(), seed: '' }))).toThrow(
      /failed validation/,
    );
  });
});

describe('MemorySaveStore', () => {
  it('stores, lists, reads back and deletes', () => {
    const store = new MemorySaveStore();
    expect(store.read('missing')).toBeUndefined();
    expect(store.list()).toEqual([]);

    store.write('b', envelope({ tick: 2 }));
    store.write('a', envelope({ tick: 1 }));
    expect(store.list()).toEqual(['a', 'b']);
    expect(store.read('a')?.tick).toBe(1);

    expect(store.delete('a')).toBe(true);
    expect(store.delete('a')).toBe(false);
    expect(store.list()).toEqual(['b']);
  });

  it('snapshots by value, so later mutation cannot rewrite history', () => {
    const store = new MemorySaveStore();
    const live = envelope({ modules: { m: { version: 1, data: { gold: 10 } } } });
    store.write('slot', live);

    (live.modules['m'] as { data: JsonObject }).data['gold'] = 999;
    live.tick = 500;

    const loaded = store.read('slot') as SaveEnvelope;
    expect(loaded.tick).toBe(0);
    expect(loaded.modules['m']?.data).toEqual({ gold: 10 });
  });

  it('overwrites an existing key', () => {
    const store = new MemorySaveStore();
    store.write('slot', envelope({ tick: 1 }));
    store.write('slot', envelope({ tick: 2 }));
    expect(store.list()).toEqual(['slot']);
    expect(store.read('slot')?.tick).toBe(2);
  });
});

describe('JsonFileSaveStore', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rpgsim-save-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('writes a readable .save.json file and reads it back', () => {
    const store = new JsonFileSaveStore(directory);
    store.write('autosave', envelope({ tick: 77 }));

    const text = readFileSync(join(directory, 'autosave.save.json'), 'utf8');
    expect(JSON.parse(text)).toMatchObject({ format: SAVE_FORMAT, tick: 77 });
    expect(store.read('autosave')?.tick).toBe(77);
  });

  it('creates the directory if it does not exist', () => {
    const store = new JsonFileSaveStore(join(directory, 'deep', 'saves'));
    store.write('x', envelope());
    expect(store.read('x')).toBeDefined();
  });

  it('lists only save files, sorted, without the extension', () => {
    const store = new JsonFileSaveStore(directory);
    store.write('day-030', envelope());
    store.write('day-002', envelope());
    writeFileSync(join(directory, 'notes.txt'), 'ignore me', 'utf8');
    expect(store.list()).toEqual(['day-002', 'day-030']);
  });

  it('reports a missing key instead of throwing', () => {
    expect(new JsonFileSaveStore(directory).read('nope')).toBeUndefined();
  });

  it('deletes, and reports whether anything was deleted', () => {
    const store = new JsonFileSaveStore(directory);
    store.write('doomed', envelope());
    expect(store.delete('doomed')).toBe(true);
    expect(store.delete('doomed')).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it('rejects keys that could escape the save directory', () => {
    const store = new JsonFileSaveStore(directory);
    const dangerous = ['../escape', 'a/b', 'a\b', '', '.hidden', 'C:evil', 'a b'];
    for (const key of dangerous) {
      expect(() => store.write(key, envelope())).toThrow(/save key must be/);
    }
  });

  it('writes byte-identical files for identical state', () => {
    const store = new JsonFileSaveStore(directory);
    store.write('one', envelope({ modules: { m: { version: 1, data: { b: 2, a: 1 } } } }));
    store.write('two', envelope({ modules: { m: { version: 1, data: { a: 1, b: 2 } } } }));

    expect(readFileSync(join(directory, 'one.save.json'), 'utf8')).toBe(
      readFileSync(join(directory, 'two.save.json'), 'utf8'),
    );
  });
});
