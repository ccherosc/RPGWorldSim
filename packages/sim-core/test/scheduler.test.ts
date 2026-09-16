import { describe, expect, it } from 'vitest';
import { Priority, Scheduler, type ScheduledEvent } from '@rpgsim/sim-core';

function drainAll(scheduler: Scheduler): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  for (;;) {
    const event = scheduler.popDue(Number.MAX_SAFE_INTEGER);
    if (event === undefined) return out;
    out.push(event);
  }
}

describe('Scheduler ordering', () => {
  it('orders by tick first', () => {
    const scheduler = new Scheduler();
    scheduler.scheduleAt(300, 'c', null);
    scheduler.scheduleAt(100, 'a', null);
    scheduler.scheduleAt(200, 'b', null);
    expect(drainAll(scheduler).map((e) => e.kind)).toEqual(['a', 'b', 'c']);
  });

  it('orders by priority within a tick, low value first', () => {
    const scheduler = new Scheduler();
    scheduler.scheduleAt(50, 'social', null, Priority.Social);
    scheduler.scheduleAt(50, 'system', null, Priority.System);
    scheduler.scheduleAt(50, 'decision', null, Priority.Decision);
    scheduler.scheduleAt(50, 'physiology', null, Priority.Physiology);
    expect(drainAll(scheduler).map((e) => e.kind)).toEqual([
      'system',
      'physiology',
      'decision',
      'social',
    ]);
  });

  it('breaks exact ties by insertion order (FIFO), never by heap internals', () => {
    const scheduler = new Scheduler();
    for (let i = 0; i < 200; i++) scheduler.scheduleAt(10, `e${i}`, { i }, Priority.Decision);
    const order = drainAll(scheduler).map((e) => e.kind);
    expect(order).toEqual(Array.from({ length: 200 }, (_, i) => `e${i}`));
  });

  it('produces the same order regardless of the order events were inserted', () => {
    const specs = [
      { tick: 10, priority: Priority.Decision, kind: 'a' },
      { tick: 10, priority: Priority.System, kind: 'b' },
      { tick: 5, priority: Priority.Social, kind: 'c' },
      { tick: 10, priority: Priority.Decision, kind: 'd' },
      { tick: 20, priority: Priority.System, kind: 'e' },
    ];

    const forward = new Scheduler();
    for (const spec of specs) forward.scheduleAt(spec.tick, spec.kind, null, spec.priority);

    // Insertion order only decides ties, so reversing 'a' and 'd' is expected
    // to swap them; everything else must be unaffected.
    const shuffled = new Scheduler();
    for (const spec of [specs[2], specs[4], specs[0], specs[3], specs[1]] as typeof specs) {
      shuffled.scheduleAt(spec.tick, spec.kind, null, spec.priority);
    }

    expect(drainAll(forward).map((e) => e.kind)).toEqual(['c', 'b', 'a', 'd', 'e']);
    expect(drainAll(shuffled).map((e) => e.kind)).toEqual(['c', 'b', 'a', 'd', 'e']);
  });
});

describe('Scheduler due-window behaviour', () => {
  it('only releases events at or before the requested tick', () => {
    const scheduler = new Scheduler();
    scheduler.scheduleAt(10, 'soon', null);
    scheduler.scheduleAt(100, 'later', null);

    expect(scheduler.popDue(9)).toBeUndefined();
    expect(scheduler.popDue(10)?.kind).toBe('soon');
    expect(scheduler.popDue(99)).toBeUndefined();
    expect(scheduler.popDue(100)?.kind).toBe('later');
    expect(scheduler.popDue(Number.MAX_SAFE_INTEGER)).toBeUndefined();
  });

  it('reports the next due tick without consuming the event', () => {
    const scheduler = new Scheduler();
    scheduler.scheduleAt(42, 'x', null);
    expect(scheduler.peekTick()).toBe(42);
    expect(scheduler.peekTick()).toBe(42);
    expect(scheduler.size).toBe(1);
  });

  it('is empty-safe', () => {
    const scheduler = new Scheduler();
    expect(scheduler.size).toBe(0);
    expect(scheduler.peek()).toBeUndefined();
    expect(scheduler.peekTick()).toBeUndefined();
    expect(scheduler.popDue(1_000)).toBeUndefined();
  });

  it('rejects invalid scheduling requests instead of coercing them', () => {
    const scheduler = new Scheduler();
    expect(() => scheduler.scheduleAt(-1, 'x', null)).toThrow();
    expect(() => scheduler.scheduleAt(1.5, 'x', null)).toThrow();
    expect(() => scheduler.scheduleAt(10, '', null)).toThrow();
  });
});

describe('Scheduler cancellation', () => {
  it('skips cancelled events and keeps the live count accurate', () => {
    const scheduler = new Scheduler();
    scheduler.scheduleAt(10, 'keep-a', null);
    const doomed = scheduler.scheduleAt(20, 'cancelled', null);
    scheduler.scheduleAt(30, 'keep-b', null);

    expect(scheduler.size).toBe(3);
    expect(scheduler.cancel(doomed)).toBe(true);
    expect(scheduler.size).toBe(2);
    expect(scheduler.isPending(doomed)).toBe(false);
    expect(drainAll(scheduler).map((e) => e.kind)).toEqual(['keep-a', 'keep-b']);
  });

  it('reports false for unknown or repeated cancellation', () => {
    const scheduler = new Scheduler();
    const id = scheduler.scheduleAt(10, 'x', null);
    expect(scheduler.cancel(id)).toBe(true);
    expect(scheduler.cancel(id)).toBe(false);
    expect(scheduler.cancel(9_999)).toBe(false);
  });

  it('can cancel the head of the queue', () => {
    const scheduler = new Scheduler();
    const first = scheduler.scheduleAt(1, 'first', null);
    scheduler.scheduleAt(2, 'second', null);
    scheduler.cancel(first);
    expect(scheduler.peekTick()).toBe(2);
    expect(scheduler.popDue(10)?.kind).toBe('second');
  });

  it('excludes cancelled events from the pending listing and from saves', () => {
    const scheduler = new Scheduler();
    scheduler.scheduleAt(10, 'live', null);
    const id = scheduler.scheduleAt(20, 'dead', null);
    scheduler.cancel(id);
    expect(scheduler.pendingInOrder().map((e) => e.kind)).toEqual(['live']);
    expect(scheduler.save().pending.map((e) => e.kind)).toEqual(['live']);
  });
});

describe('Scheduler persistence', () => {
  it('serializes pending events in execution order, not heap order', () => {
    const scheduler = new Scheduler();
    // Insert deliberately out of order so heap layout differs from sort order.
    scheduler.scheduleAt(500, 'e', null, Priority.System);
    scheduler.scheduleAt(100, 'a', null, Priority.Social);
    scheduler.scheduleAt(100, 'b', null, Priority.System);
    scheduler.scheduleAt(300, 'd', null, Priority.System);
    scheduler.scheduleAt(200, 'c', null, Priority.System);

    expect(scheduler.save().pending.map((e) => e.kind)).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('round-trips through JSON and resumes in the identical order', () => {
    const original = new Scheduler();
    for (let i = 0; i < 40; i++) {
      original.scheduleAt(((i * 37) % 11) * 10, `k${i}`, { i }, (i % 3) * 100);
    }
    original.cancel(5);
    original.cancel(11);
    const expected = drainAll(cloneVia(original)).map((e) => `${e.kind}@${e.tick}`);

    const restored = cloneVia(original);
    expect(drainAll(restored).map((e) => `${e.kind}@${e.tick}`)).toEqual(expected);
  });

  it('preserves ids and sequence numbers so outstanding handles stay valid', () => {
    const original = new Scheduler();
    const idA = original.scheduleAt(10, 'a', null);
    const idB = original.scheduleAt(20, 'b', null);

    const restored = cloneVia(original);
    expect(restored.isPending(idA)).toBe(true);
    expect(restored.cancel(idB)).toBe(true);
    expect(drainAll(restored).map((e) => e.kind)).toEqual(['a']);
  });

  it('continues allocating fresh ids after a restore', () => {
    const original = new Scheduler();
    const first = original.scheduleAt(10, 'a', null);
    const restored = cloneVia(original);
    const next = restored.scheduleAt(10, 'b', null);
    expect(next).toBeGreaterThan(first);
  });

  it('rejects a snapshot whose ids exceed its own counters', () => {
    const scheduler = new Scheduler();
    expect(() =>
      scheduler.restore({
        nextId: 1,
        nextSeq: 99,
        pending: [{ id: 50, tick: 1, priority: 0, seq: 1, kind: 'x', payload: null }],
      }),
    ).toThrow(/ahead of the id counter/);
  });

  it('rejects a snapshot containing duplicate event ids', () => {
    const scheduler = new Scheduler();
    expect(() =>
      scheduler.restore({
        nextId: 99,
        nextSeq: 99,
        pending: [
          { id: 7, tick: 1, priority: 0, seq: 1, kind: 'x', payload: null },
          { id: 7, tick: 2, priority: 0, seq: 2, kind: 'y', payload: null },
        ],
      }),
    ).toThrow(/duplicate scheduled event id/);
  });
});

function cloneVia(scheduler: Scheduler): Scheduler {
  const clone = new Scheduler();
  clone.restore(Scheduler.fromJson(JSON.parse(JSON.stringify(scheduler.toJson()))));
  return clone;
}
