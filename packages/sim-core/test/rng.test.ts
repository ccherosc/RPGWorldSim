import { describe, expect, it } from 'vitest';
import { Rng, RngStream, RngStreams, deriveStreamSeedWord } from '@rpgsim/sim-core';

function draw(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.nextU32());
}

describe('Rng reproducibility', () => {
  it('produces an identical sequence for an identical seed', () => {
    const a = draw(Rng.forStream('seed-alpha', RngStream.Scratch), 200);
    const b = draw(Rng.forStream('seed-alpha', RngStream.Scratch), 200);
    expect(a).toEqual(b);
  });

  it('produces a different sequence for a different world seed', () => {
    const a = draw(Rng.forStream('seed-alpha', RngStream.Scratch), 50);
    const b = draw(Rng.forStream('seed-beta', RngStream.Scratch), 50);
    expect(a).not.toEqual(b);
  });

  it('produces a different sequence for a different stream name', () => {
    const a = draw(Rng.forStream('seed-alpha', RngStream.Weather), 50);
    const b = draw(Rng.forStream('seed-alpha', RngStream.Health), 50);
    expect(a).not.toEqual(b);
  });

  it('does not confuse (seed, stream) pairs that concatenate to the same text', () => {
    // 'ab' + 'c' and 'a' + 'bc' must not derive the same stream.
    expect(deriveStreamSeedWord('c', 'ab')).not.toBe(deriveStreamSeedWord('bc', 'a'));
  });

  it('resumes exactly from a saved state', () => {
    const original = Rng.forStream('resume-seed', RngStream.Scratch);
    draw(original, 37);
    const state = original.save();
    const expected = draw(original, 100);

    const resumed = Rng.fromState(state);
    expect(draw(resumed, 100)).toEqual(expected);
  });

  it('carries the draw counter through save and restore', () => {
    const rng = Rng.forStream('counter-seed', RngStream.Scratch);
    draw(rng, 12);
    expect(rng.draws).toBe(12);
    expect(Rng.fromState(rng.save()).draws).toBe(12);
  });

  it('rejects the all-zero state, which is an absorbing fixed point', () => {
    expect(() => Rng.fromState({ s0: 0, s1: 0, s2: 0, s3: 0, draws: 0 })).toThrow();
  });
});

describe('Rng output shape', () => {
  it('emits uint32 values across the full range', () => {
    const rng = Rng.forStream('range-seed', RngStream.Scratch);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 20_000; i++) {
      const value = rng.nextU32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
      if (value < min) min = value;
      if (value > max) max = value;
    }
    expect(min).toBeLessThan(0x0100_0000);
    expect(max).toBeGreaterThan(0xff00_0000);
  });

  it('keeps floats inside [0, 1)', () => {
    const rng = Rng.forStream('float-seed', RngStream.Scratch);
    for (let i = 0; i < 20_000; i++) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      const wide = rng.nextFloat53();
      expect(wide).toBeGreaterThanOrEqual(0);
      expect(wide).toBeLessThan(1);
    }
  });

  it('keeps nextInt inside the requested half-open range', () => {
    const rng = Rng.forStream('int-seed', RngStream.Scratch);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const value = rng.nextInt(3, 9);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(9);
      seen.add(value);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('distributes nextInt near-uniformly, showing rejection sampling works', () => {
    // 7 does not divide 2^32, so a naive modulo would over-represent low values.
    const rng = Rng.forStream('bias-seed', RngStream.Scratch);
    const counts = new Array<number>(7).fill(0);
    const samples = 140_000;
    for (let i = 0; i < samples; i++) {
      const bucket = rng.nextInt(0, 7);
      counts[bucket] = (counts[bucket] as number) + 1;
    }
    const expectedPerBucket = samples / 7;
    for (const count of counts) {
      expect(Math.abs(count - expectedPerBucket) / expectedPerBucket).toBeLessThan(0.05);
    }
  });

  it('handles single-value and inclusive ranges', () => {
    const rng = Rng.forStream('edge-seed', RngStream.Scratch);
    expect(rng.nextInt(5, 6)).toBe(5);
    expect(rng.nextIntInclusive(2, 2)).toBe(2);
    expect(() => rng.nextInt(5, 5)).toThrow();
    expect(() => rng.nextInt(5, 4)).toThrow();
  });

  it('saturates chance() at the ends without consuming randomness', () => {
    const rng = Rng.forStream('chance-seed', RngStream.Scratch);
    const before = rng.draws;
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    expect(rng.chance(-1)).toBe(false);
    expect(rng.chance(2)).toBe(true);
    expect(rng.draws).toBe(before);
  });

  it('approximates the requested probability', () => {
    const rng = Rng.forStream('prob-seed', RngStream.Scratch);
    let hits = 0;
    for (let i = 0; i < 100_000; i++) if (rng.chance(0.25)) hits++;
    expect(hits / 100_000).toBeGreaterThan(0.24);
    expect(hits / 100_000).toBeLessThan(0.26);
  });
});

describe('Rng selection helpers', () => {
  it('shuffles deterministically and preserves the multiset', () => {
    const source = Array.from({ length: 50 }, (_, i) => i);
    const a = Rng.forStream('shuffle-seed', RngStream.Scratch).shuffle([...source]);
    const b = Rng.forStream('shuffle-seed', RngStream.Scratch).shuffle([...source]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(source);
    expect(a).not.toEqual(source);
  });

  it('never picks a zero-weight option', () => {
    const rng = Rng.forStream('weight-seed', RngStream.Scratch);
    const items = ['never', 'sometimes', 'often'];
    const weights = [0, 1, 4];
    const counts = new Map<string, number>();
    for (let i = 0; i < 20_000; i++) {
      const picked = rng.pickWeighted(items, (_item, index) => weights[index] as number);
      counts.set(picked, (counts.get(picked) ?? 0) + 1);
    }
    expect(counts.get('never')).toBeUndefined();
    expect(counts.get('often') as number).toBeGreaterThan(counts.get('sometimes') as number);
  });

  it('rejects empty, negative-weight and all-zero-weight inputs', () => {
    const rng = Rng.forStream('reject-seed', RngStream.Scratch);
    expect(() => rng.pick([])).toThrow();
    expect(() => rng.pickWeighted([], () => 1)).toThrow();
    expect(() => rng.pickWeighted(['a'], () => 0)).toThrow();
    expect(() => rng.pickWeighted(['a'], () => -1)).toThrow();
  });

  it('produces a gaussian with the requested mean and spread, and bounded tails', () => {
    const rng = Rng.forStream('gauss-seed', RngStream.Scratch);
    const samples = 50_000;
    let total = 0;
    let extreme = 0;
    const values: number[] = [];
    for (let i = 0; i < samples; i++) {
      const value = rng.nextGaussian(0.5, 0.15);
      values.push(value);
      total += value;
      if (value < 0.5 - 6 * 0.15 || value > 0.5 + 6 * 0.15) extreme++;
    }
    const mean = total / samples;
    let variance = 0;
    for (const value of values) variance += (value - mean) * (value - mean);
    variance /= samples;

    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
    expect(Math.sqrt(variance)).toBeGreaterThan(0.145);
    expect(Math.sqrt(variance)).toBeLessThan(0.155);
    // Irwin-Hall has strictly bounded support; this is the documented trade-off.
    expect(extreme).toBe(0);
  });

  it('clamps the gaussian when asked', () => {
    const rng = Rng.forStream('gauss-clamp-seed', RngStream.Scratch);
    for (let i = 0; i < 5_000; i++) {
      const value = rng.nextGaussianClamped(0.5, 1, 0, 1);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('RngStreams', () => {
  it('returns the same instance for a repeated name', () => {
    const streams = new RngStreams('stream-seed');
    expect(streams.stream(RngStream.Weather)).toBe(streams.stream(RngStream.Weather));
  });

  it('keeps streams independent: extra draws in one do not shift another', () => {
    const a = new RngStreams('independence-seed');
    const b = new RngStreams('independence-seed');

    // Burn a large, uneven amount of the weather stream in `a` only.
    for (let i = 0; i < 997; i++) a.stream(RngStream.Weather).nextU32();

    const fromA = Array.from({ length: 20 }, () => a.stream(RngStream.NpcDecisions).nextU32());
    const fromB = Array.from({ length: 20 }, () => b.stream(RngStream.NpcDecisions).nextU32());
    expect(fromA).toEqual(fromB);
  });

  it('only serializes streams that have actually been used', () => {
    const streams = new RngStreams('lazy-seed');
    expect(streams.activeStreamNames()).toEqual([]);
    streams.stream(RngStream.Combat).nextU32();
    expect(streams.activeStreamNames()).toEqual([RngStream.Combat]);
  });

  it('round-trips through JSON and resumes the same sequences', () => {
    const original = new RngStreams('roundtrip-seed');
    for (let i = 0; i < 31; i++) original.stream(RngStream.Economy).nextU32();
    for (let i = 0; i < 17; i++) original.stream(RngStream.Social).nextU32();

    // Snapshot first, then draw. The restored copy must reproduce those draws.
    const restored = RngStreams.load(RngStreams.fromJson(original.toJson()));

    const expectedEconomy = Array.from({ length: 10 }, () =>
      original.stream(RngStream.Economy).nextU32(),
    );
    const expectedSocial = Array.from({ length: 10 }, () =>
      original.stream(RngStream.Social).nextU32(),
    );

    expect(restored.worldSeed).toBe('roundtrip-seed');
    expect(restored.activeStreamNames()).toEqual([RngStream.Economy, RngStream.Social].sort());
    expect(
      Array.from({ length: 10 }, () => restored.stream(RngStream.Economy).nextU32()),
    ).toEqual(expectedEconomy);
    expect(
      Array.from({ length: 10 }, () => restored.stream(RngStream.Social).nextU32()),
    ).toEqual(expectedSocial);
  });

  it('refuses to restore state belonging to a different world seed', () => {
    const source = new RngStreams('seed-one');
    source.stream(RngStream.Scratch).nextU32();
    const target = new RngStreams('seed-two');
    expect(() => target.restore(source.save())).toThrow(/different world seed/);
  });
});
