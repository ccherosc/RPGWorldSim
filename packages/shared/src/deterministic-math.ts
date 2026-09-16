import { assertFinite } from './assert.ts';

/**
 * Float operations that are safe to use inside the simulation.
 *
 * ECMAScript guarantees IEEE-754 exactness for `+`, `-`, `*`, `/` and
 * `Math.sqrt`, but explicitly permits implementation-defined results for
 * `Math.exp`, `Math.log`, `Math.pow`, `Math.sin`, `Math.cos`, `Math.tan`,
 * `Math.atan2`, `Math.cbrt` and friends. Those can differ between V8 versions,
 * CPU architectures and even build flags, which would break prime directive 3
 * (same seed + same inputs => same world history).
 *
 * Simulation code therefore uses only the helpers here plus the exact
 * operators. `packages/sim-core/test/determinism-guard.test.ts` enforces this
 * by scanning the source tree.
 */

/** Clamp to an inclusive range. Only comparisons; exact. */
export function clamp(value: number, min: number, max: number): number {
  assertFinite(value, 'clamp received a non-finite value');
  return value < min ? min : value > max ? max : value;
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.trunc(clamp(value, min, max));
}

/** Clamp into [0, 1]. The normalized range used by traits, needs and utilities. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Linear interpolation. Multiplication and addition only; exact. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Map `value` from [inMin, inMax] onto [outMin, outMax], clamped at both ends.
 * Division is exact, so this is deterministic.
 */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin;
  return lerp(outMin, outMax, clamp01((value - inMin) / (inMax - inMin)));
}

/** Exact integer power for small non-negative exponents (replaces `Math.pow`). */
export function ipow(base: number, exponent: number): number {
  let result = 1;
  let b = base;
  let e = Math.trunc(exponent);
  if (e < 0) throw new Error('ipow does not support negative exponents');
  while (e > 0) {
    if ((e & 1) === 1) result *= b;
    b *= b;
    e >>= 1;
  }
  return result;
}

/** Floor division that behaves correctly for negative numerators. */
export function divFloor(numerator: number, denominator: number): number {
  return Math.floor(numerator / denominator);
}

/** Euclidean modulo: the result always has the sign of `modulus`. */
export function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Round half away from zero, to an integer.
 *
 * `Math.round` rounds half toward +Infinity, which biases negative values
 * asymmetrically. Simulation quantities (coins, item counts) should round
 * symmetrically so that a gain and an equivalent loss cancel out.
 */
export function roundHalfAway(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Sum with a fixed left-to-right order, so the float result is reproducible. */
export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
