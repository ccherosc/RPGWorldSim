import { describe, expect, it } from 'vitest';
import {
  EntityKind,
  EventBus,
  EventLog,
  type EntityId,
  type EventSink,
  IdGenerator,
  type SimEvent,
  compareEntityIds,
  entityIndexOf,
  entityKindOf,
  eventFromJson,
  eventToJson,
  isEntityId,
  makeEntityId,
} from '@rpgsim/sim-core';

function event(id: number, type: string, overrides: Partial<SimEvent> = {}): SimEvent {
  return {
    id,
    tick: id * 10,
    type,
    actors: [],
    data: null,
    causes: [],
    ...overrides,
  };
}

describe('entity ids', () => {
  it('formats and parses kind and index', () => {
    const id = makeEntityId(EntityKind.Npc, 42);
    expect(id).toBe('npc:42');
    expect(entityKindOf(id)).toBe('npc');
    expect(entityIndexOf(id)).toBe(42);
  });

  it('recognises valid ids and rejects malformed ones', () => {
    expect(isEntityId('npc:0')).toBe(true);
    expect(isEntityId('household:1234')).toBe(true);
    expect(isEntityId('npc')).toBe(false);
    expect(isEntityId(':1')).toBe(false);
    expect(isEntityId('npc:-1')).toBe(false);
    expect(isEntityId('npc:1.5')).toBe(false);
    expect(isEntityId('NPC:1')).toBe(false);
    expect(isEntityId(42)).toBe(false);
  });

  it('rejects invalid kinds and indexes at construction', () => {
    expect(() => makeEntityId('Npc', 1)).toThrow();
    expect(() => makeEntityId('npc', -1)).toThrow();
    expect(() => makeEntityId('npc', 1.5)).toThrow();
  });

  it('sorts numerically within a kind, not lexicographically', () => {
    const ids = ['npc:10', 'npc:9', 'household:2', 'npc:1'] as EntityId[];
    expect([...ids].sort(compareEntityIds)).toEqual([
      'household:2',
      'npc:1',
      'npc:9',
      'npc:10',
    ]);
  });
});

describe('IdGenerator', () => {
  it('allocates monotonically per kind, starting at zero', () => {
    const ids = new IdGenerator();
    expect(ids.next(EntityKind.Npc)).toBe('npc:0');
    expect(ids.next(EntityKind.Npc)).toBe('npc:1');
    expect(ids.next(EntityKind.Household)).toBe('household:0');
    expect(ids.next(EntityKind.Npc)).toBe('npc:2');
    expect(ids.allocated(EntityKind.Npc)).toBe(3);
    expect(ids.allocated(EntityKind.Building)).toBe(0);
  });

  it('never reissues an id after a restore', () => {
    const original = new IdGenerator();
    for (let i = 0; i < 5; i++) original.next(EntityKind.Npc);

    const restored = new IdGenerator();
    restored.restore(IdGenerator.fromJson(original.toJson()));
    expect(restored.next(EntityKind.Npc)).toBe('npc:5');
  });

  it('serializes counters in sorted order for canonical saves', () => {
    const ids = new IdGenerator();
    ids.next(EntityKind.Npc);
    ids.next(EntityKind.Building);
    ids.next(EntityKind.Household);
    expect(Object.keys(ids.save().counters)).toEqual(['building', 'household', 'npc']);
  });

  it('rejects a negative counter in a snapshot', () => {
    const ids = new IdGenerator();
    expect(() => ids.restore({ counters: { npc: -1 } })).toThrow();
  });
});

describe('EventBus dispatch', () => {
  it('delivers to listeners in registration order', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.subscribe(() => order.push('first'));
    bus.subscribe(() => order.push('second'));
    bus.subscribe(() => order.push('third'));
    bus.publish(event(1, 'npc.woke'));
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('filters by exact type and by namespace prefix', () => {
    const bus = new EventBus();
    const exact: string[] = [];
    const namespaced: string[] = [];
    const all: string[] = [];
    bus.subscribe('npc.woke', (e) => exact.push(e.type));
    bus.subscribe('npc.', (e) => namespaced.push(e.type));
    bus.subscribe((e) => all.push(e.type));

    bus.publish(event(1, 'npc.woke'));
    bus.publish(event(2, 'npc.ate'));
    bus.publish(event(3, 'market.sale'));

    expect(exact).toEqual(['npc.woke']);
    expect(namespaced).toEqual(['npc.woke', 'npc.ate']);
    expect(all).toEqual(['npc.woke', 'npc.ate', 'market.sale']);
  });

  it('queues events emitted during dispatch instead of recursing', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    let cascaded = false;

    bus.subscribe((e) => {
      seen.push(`A:${e.type}`);
      if (!cascaded && e.type === 'npc.assaulted') {
        cascaded = true;
        bus.publish(event(2, 'npc.remembered'));
      }
    });
    bus.subscribe((e) => seen.push(`B:${e.type}`));

    bus.publish(event(1, 'npc.assaulted'));

    // Breadth-first: both listeners finish the first event before the second
    // event begins, so a memory-forming listener cannot interleave itself.
    expect(seen).toEqual([
      'A:npc.assaulted',
      'B:npc.assaulted',
      'A:npc.remembered',
      'B:npc.remembered',
    ]);
  });

  it('survives a deep cascade without blowing the stack', () => {
    const bus = new EventBus();
    let depth = 0;
    bus.subscribe((e) => {
      if (e.type === 'chain' && depth < 20_000) {
        depth++;
        bus.publish(event(depth + 1, 'chain'));
      }
    });
    bus.publish(event(1, 'chain'));
    expect(depth).toBe(20_000);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const stop = bus.subscribe((e) => seen.push(e.type));
    bus.publish(event(1, 'a'));
    stop();
    bus.publish(event(2, 'b'));
    expect(seen).toEqual(['a']);
    expect(bus.listenerCount).toBe(0);
  });

  it('handles unsubscribing from inside a dispatch without skipping listeners', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const stop = bus.subscribe((e) => {
      seen.push(`one:${e.type}`);
      stop();
    });
    bus.subscribe((e) => seen.push(`two:${e.type}`));

    bus.publish(event(1, 'a'));
    bus.publish(event(2, 'b'));

    expect(seen).toEqual(['one:a', 'two:a', 'two:b']);
    expect(bus.listenerCount).toBe(1);
  });

  it('treats a repeated unsubscribe as a no-op', () => {
    const bus = new EventBus();
    const stop = bus.subscribe(() => {});
    stop();
    stop();
    expect(bus.listenerCount).toBe(0);
  });
});

describe('EventLog', () => {
  it('allocates strictly increasing ids', () => {
    const log = new EventLog();
    expect(log.allocateId()).toBe(1);
    expect(log.allocateId()).toBe(2);
    expect(log.allocateId()).toBe(3);
  });

  it('keeps only the retention window but counts everything', () => {
    const log = new EventLog({ retain: 10 });
    for (let i = 1; i <= 100; i++) log.record(event(i, 'tick'));
    expect(log.count).toBe(100);
    expect(log.recent()).toHaveLength(10);
    expect(log.recent()[0]?.id).toBe(91);
    expect(log.recent()[9]?.id).toBe(100);
  });

  it('rejects a non-positive retention', () => {
    expect(() => new EventLog({ retain: 0 })).toThrow();
  });

  it('finds retained events and reports dropped ones as missing', () => {
    const log = new EventLog({ retain: 5 });
    for (let i = 1; i <= 20; i++) log.record(event(i, 'tick'));
    expect(log.find(18)?.id).toBe(18);
    expect(log.find(3)).toBeUndefined();
    expect(log.find(999)).toBeUndefined();
  });

  it('queries by type and by actor', () => {
    const log = new EventLog();
    const edric = 'npc:1' as EntityId;
    const thomas = 'npc:2' as EntityId;
    log.record(event(1, 'npc.woke', { actors: [edric] }));
    log.record(event(2, 'npc.ate', { actors: [edric] }));
    log.record(event(3, 'market.sale', { actors: [thomas, edric] }));
    log.record(event(4, 'npc.woke', { actors: [thomas] }));

    expect(log.byType('npc.woke').map((e) => e.id)).toEqual([1, 4]);
    expect(log.byType('npc.').map((e) => e.id)).toEqual([1, 2, 4]);
    expect(log.byActor(edric).map((e) => e.id)).toEqual([1, 2, 3]);
    expect(log.byActor(thomas).map((e) => e.id)).toEqual([3, 4]);
  });

  it('traces a causal chain breadth-first with depths', () => {
    const log = new EventLog();
    log.record(event(1, 'weather.drought'));
    log.record(event(2, 'crop.failed', { causes: [1] }));
    log.record(event(3, 'market.price_rose', { causes: [2] }));
    log.record(event(4, 'npc.hungry', { causes: [2] }));
    log.record(event(5, 'crime.theft', { causes: [3, 4] }));

    const trace = log.trace(5);
    expect(trace.map((step) => [step.event.id, step.depth])).toEqual([
      [5, 0],
      [3, 1],
      [4, 1],
      [2, 2],
      [1, 3],
    ]);
  });

  it('respects the trace depth limit', () => {
    const log = new EventLog();
    log.record(event(1, 'a'));
    log.record(event(2, 'b', { causes: [1] }));
    log.record(event(3, 'c', { causes: [2] }));
    expect(log.trace(3, 1).map((s) => s.event.id)).toEqual([3, 2]);
  });

  it('does not loop forever if events reference each other', () => {
    const log = new EventLog();
    log.record(event(1, 'a', { causes: [2] }));
    log.record(event(2, 'b', { causes: [1] }));
    expect(log.trace(2).map((s) => s.event.id)).toEqual([2, 1]);
  });

  it('returns an empty trace for an unknown or aged-out event', () => {
    const log = new EventLog({ retain: 2 });
    log.record(event(1, 'a'));
    log.record(event(2, 'b'));
    log.record(event(3, 'c'));
    expect(log.trace(1)).toEqual([]);
  });

  it('forwards every event to sinks, including ones past the window', () => {
    const written: number[] = [];
    let flushed = 0;
    let closed = 0;
    const sink: EventSink = {
      id: 'test',
      write: (e) => written.push(e.id),
      flush: () => flushed++,
      close: () => closed++,
    };

    const log = new EventLog({ retain: 3 });
    log.addSink(sink);
    for (let i = 1; i <= 50; i++) log.record(event(i, 'tick'));

    expect(written).toHaveLength(50);
    log.flush();
    expect(flushed).toBe(1);
    log.close();
    expect(closed).toBe(1);
  });

  it('rejects two sinks with the same id', () => {
    const log = new EventLog();
    const sink: EventSink = { id: 'dup', write: () => {} };
    log.addSink(sink);
    expect(() => log.addSink({ id: 'dup', write: () => {} })).toThrow();
    expect(log.removeSink('dup')).toBe(true);
    expect(log.removeSink('dup')).toBe(false);
  });

  it('round-trips through JSON, preserving the id counter and the window', () => {
    const log = new EventLog({ retain: 5 });
    for (let i = 1; i <= 20; i++) {
      log.allocateId();
      log.record(event(i, 'npc.woke', { actors: ['npc:1' as EntityId], data: { n: i } }));
    }

    const restored = new EventLog({ retain: 5 });
    restored.restore(EventLog.fromJson(JSON.parse(JSON.stringify(log.toJson()))));

    expect(restored.recent().map((e) => e.id)).toEqual(log.recent().map((e) => e.id));
    expect(restored.allocateId()).toBe(log.allocateId());
  });
});

describe('event JSON encoding', () => {
  it('round-trips an event with every field populated', () => {
    const original: SimEvent = {
      id: 7,
      tick: 1234,
      type: 'market.sale',
      actors: ['npc:1', 'npc:2'] as EntityId[],
      location: 'building:3' as EntityId,
      data: { item: 'grain', quantity: 4, price: 12 },
      causes: [3, 5],
    };
    expect(eventFromJson(eventToJson(original))).toEqual(original);
  });

  it('omits an absent location rather than writing null', () => {
    const json = eventToJson(event(1, 'npc.woke'));
    expect('location' in json).toBe(false);
    expect(eventFromJson(json).location).toBeUndefined();
  });

  it('rejects malformed event JSON', () => {
    expect(() => eventFromJson({ id: 1 })).toThrow();
    expect(() => eventFromJson(null)).toThrow();
  });
});
