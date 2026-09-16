/**
 * FNV-1a hashing.
 *
 * Used for two distinct jobs, both of which need stability across processes
 * and machines forever:
 *   - deriving RNG stream seeds from names,
 *   - fingerprinting world state for replay comparison.
 *
 * Changing these functions invalidates every existing save's replay, so treat
 * them as a frozen part of the save format.
 */

const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/** 32-bit FNV-1a over the UTF-16 code units of `input`. */
export function fnv1a32(input: string, seed: number = FNV_OFFSET_32): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
    hash ^= input.charCodeAt(i) >>> 8;
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 64-bit FNV-1a returned as 16 lowercase hex characters.
 *
 * Implemented as two interleaved 32-bit lanes rather than BigInt: this runs on
 * every state hash during replay tests and BigInt would dominate the cost.
 * The lanes use different seeds so they do not collide with each other.
 */
export function fnv1a64Hex(input: string): string {
  const lo = fnv1a32(input, FNV_OFFSET_32);
  const hi = fnv1a32(input, 0x9e3779b9);
  return hex8(hi) + hex8(lo);
}

function hex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
