import { assert, assertInt, fnv1a32 } from '@rpgsim/shared';

/**
 * Serializable state of one RNG stream.
 *
 * `draws` is not needed to reproduce the sequence; it exists purely for
 * debugging. When two supposedly identical runs diverge, comparing per-stream
 * draw counts tells you which subsystem consumed a different amount of
 * randomness, which is almost always where the bug is.
 */
export interface RngState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
  readonly draws: number;
}

/** splitmix32 - used only to expand a single seed word into RNG state. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Turn an arbitrary seed word into a valid xoshiro128** state.
 * The all-zero state is a fixed point of the generator, so it is rejected.
 */
export function stateFromSeedWord(seedWord: number): RngState {
  const next = splitmix32(seedWord);
  let s0 = next();
  let s1 = next();
  let s2 = next();
  let s3 = next();
  while ((s0 | s1 | s2 | s3) === 0) {
    s0 = next();
    s1 = next();
    s2 = next();
    s3 = next();
  }
  return { s0, s1, s2, s3, draws: 0 };
}

/** Separator that cannot appear in a stream name, keeping derivations distinct. */
const SEED_SEPARATOR = '::';

/**
 * Derive the seed word for a named stream from the world seed.
 *
 * Named streams (`weather`, `npc_decisions`, `health`, ...) keep unrelated
 * random processes from coupling: adding one extra weather roll must not shift
 * every NPC decision that follows it.
 */
export function deriveStreamSeedWord(worldSeed: string, streamName: string): number {
  return fnv1a32(`${streamName}${SEED_SEPARATOR}${worldSeed}`, fnv1a32(worldSeed));
}

/**
 * A single deterministic random stream (xoshiro128**).
 *
 * Every method here uses only exact integer or power-of-two float arithmetic.
 * Nothing in this class calls an implementation-defined `Math` function, so the
 * output sequence is identical on every platform and engine version.
 */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private drawCount: number;

  private constructor(state: RngState) {
    this.s0 = state.s0 >>> 0;
    this.s1 = state.s1 >>> 0;
    this.s2 = state.s2 >>> 0;
    this.s3 = state.s3 >>> 0;
    this.drawCount = state.draws;
    assert(
      (this.s0 | this.s1 | this.s2 | this.s3) !== 0,
      'RNG state must not be all zero',
    );
  }

  static fromState(state: RngState): Rng {
    return new Rng(state);
  }

  static fromSeedWord(seedWord: number): Rng {
    return new Rng(stateFromSeedWord(seedWord));
  }

  static forStream(worldSeed: string, streamName: string): Rng {
    return Rng.fromSeedWord(deriveStreamSeedWord(worldSeed, streamName));
  }

  /** Number of raw words drawn so far. Debug aid; see `RngState`. */
  get draws(): number {
    return this.drawCount;
  }

  save(): RngState {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3, draws: this.drawCount };
  }

  /** Raw generator step. Returns a uniform uint32. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;

    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);

    this.drawCount++;
    return result;
  }

  /** Uniform float in [0, 1) with 32 bits of resolution. Division is exact. */
  nextFloat(): number {
    return this.nextU32() / 0x1_0000_0000;
  }

  /** Uniform float in [0, 1) with full 53-bit mantissa resolution. */
  nextFloat53(): number {
    const hi = this.nextU32() >>> 5; // 27 bits
    const lo = this.nextU32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /**
   * Uniform integer in [minInclusive, maxExclusive).
   *
   * Uses rejection sampling rather than `% range`, which would bias the low end
   * of the range whenever 2^32 is not a multiple of `range`. Over a simulated
   * year that bias is large enough to be visible in demographics.
   */
  nextInt(minInclusive: number, maxExclusive: number): number {
    assertInt(minInclusive, 'nextInt min must be an integer');
    assertInt(maxExclusive, 'nextInt max must be an integer');
    const range = maxExclusive - minInclusive;
    assert(range > 0, 'nextInt requires max > min', { minInclusive, maxExclusive });
    assert(range <= 0x1_0000_0000, 'nextInt range exceeds 2^32', { range });

    if (range === 0x1_0000_0000) return minInclusive + this.nextU32();

    // Discard the unevenly-covered tail of the uint32 space.
    const limit = 0x1_0000_0000 - (0x1_0000_0000 % range);
    let value = this.nextU32();
    while (value >= limit) value = this.nextU32();
    return minInclusive + (value % range);
  }

  /** Uniform integer in [min, max], both inclusive. */
  nextIntInclusive(min: number, max: number): number {
    return this.nextInt(min, max + 1);
  }

  /** True with probability `probability`. Values outside [0,1] are saturating. */
  chance(probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.nextFloat() < probability;
  }

  /** Uniform float in [min, max). */
  nextRange(min: number, max: number): number {
    return min + (max - min) * this.nextFloat();
  }

  pick<T>(items: readonly T[]): T {
    assert(items.length > 0, 'pick requires a non-empty array');
    return items[this.nextInt(0, items.length)] as T;
  }

  /**
   * Pick by weight. Weights must be non-negative and not all zero.
   * The scan order is fixed, so the float comparisons are reproducible.
   */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T, index: number) => number): T {
    assert(items.length > 0, 'pickWeighted requires a non-empty array');
    let total = 0;
    const weights: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const weight = weightOf(items[i] as T, i);
      assert(weight >= 0 && Number.isFinite(weight), 'weights must be finite and >= 0', {
        index: i,
        weight,
      });
      weights.push(weight);
      total += weight;
    }
    assert(total > 0, 'pickWeighted requires at least one positive weight');

    let roll = this.nextFloat() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i] as number;
      if (roll < 0) return items[i] as T;
    }
    // Only reachable through float rounding at the very top of the range.
    return items[items.length - 1] as T;
  }

  /** Fisher-Yates, in place, returning the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /**
   * Approximately normal deviate, mean 0 and standard deviation 1.
   *
   * Box-Muller would need `Math.log` and `Math.cos`, both of which are
   * implementation-defined in ECMAScript and would break cross-platform replay.
   * This is the Irwin-Hall construction instead: the sum of twelve uniforms
   * minus six has mean 0 and variance 1 exactly, and uses only addition.
   *
   * The trade-off is truncated tails (support is [-6, +6]), which is acceptable
   * and arguably desirable for simulation quantities that should never take an
   * absurd value.
   */
  nextGaussian(mean = 0, stdDev = 1): number {
    let total = 0;
    for (let i = 0; i < 12; i++) total += this.nextFloat();
    return mean + (total - 6) * stdDev;
  }

  /** Gaussian clamped to a range. The common case for trait generation. */
  nextGaussianClamped(mean: number, stdDev: number, min: number, max: number): number {
    const value = this.nextGaussian(mean, stdDev);
    return value < min ? min : value > max ? max : value;
  }
}
