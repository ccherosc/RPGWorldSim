import { describe, expect, it } from 'vitest';
import { canonicalStringify, fnv1a32, fnv1a64Hex } from '@rpgsim/shared';
import { DEFAULT_CALENDAR, TICKS_PER_DAY, formatTimestamp } from '../src/calendar.ts';
import { EntityKind, IdGenerator, makeEntityId } from '../src/ids.ts';
import { Rng, deriveStreamSeedWord } from '../src/rng.ts';
import { RngStream, RngStreams } from '../src/rng-streams.ts';

/**
 * Golden values: actual numbers, pinned.
 *
 * Every other determinism test compares two runs to each other, which proves
 * the kernel is self-consistent but says nothing about whether it still behaves
 * the way it did yesterday, or behaves the same on another machine. Two runs on
 * a subtly different V8 would agree with each other and diverge from every
 * world ever saved.
 *
 * These tests compare against constants instead, so they fail when output
 * changes for any reason: a refactor, a Node upgrade, a different platform.
 * CI runs them on Linux while development happens on Windows, which makes the
 * cross-platform claim something the build checks rather than something the
 * documentation asserts.
 *
 * **If one of these fails, do not update the constant to make it pass.** A
 * change here means every existing save replays differently. Either the change
 * was unintended and is a bug, or it was intended and needs a save format
 * version bump, a migration, and a note in docs/PHASE_0.md. Updating the number
 * is only correct once that decision has been made deliberately.
 */

const SEED = 'golden';

describe('golden: RNG', () => {
  it('derives the same seed word for each named stream', () => {
    const names = ['worldgen', 'weather', 'npc_decisions', 'health'];
    expect(names.map((name) => deriveStreamSeedWord(SEED, name))).toEqual([
      1570393419, 225320829, 1263731612, 569743857,
    ]);
  });

  it('produces the same raw uint32 sequence', () => {
    const rng = Rng.forStream(SEED, RngStream.Weather);
    expect(Array.from({ length: 8 }, () => rng.nextU32())).toEqual([
      3939745995, 1537239141, 3270236575, 2807460650, 3439428254, 193680892, 2162962040, 3251746441,
    ]);
    expect(rng.save()).toEqual({
      s0: 3617747050,
      s1: 1028740959,
      s2: 2132356382,
      s3: 4088086895,
      draws: 8,
    });
  });

  it('produces the same derived values', () => {
    const rng = Rng.forStream(SEED, RngStream.NpcDecisions);

    expect(Array.from({ length: 4 }, () => rng.nextFloat())).toEqual([
      0.35187159571796656, 0.4493470804300159, 0.6664463547058403, 0.4942472674883902,
    ]);
    expect(rng.nextFloat53()).toBe(0.513809542638871);
    expect(Array.from({ length: 6 }, () => rng.nextIntInclusive(1, 20))).toEqual([
      20, 12, 2, 16, 16, 10,
    ]);

    // Irwin-Hall Gaussian. Pinned to the bit: this is the value most likely to
    // drift if someone "optimises" it into Box-Muller, which uses Math.log and
    // Math.cos and is therefore not reproducible across engines.
    expect(Array.from({ length: 4 }, () => rng.nextGaussian(50, 10))).toEqual([
      53.92770864535123, 56.01077281171456, 33.026686932425946, 47.12606678484008,
    ]);

    expect(rng.shuffle(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual([
      'f',
      'b',
      'd',
      'e',
      'g',
      'c',
      'a',
    ]);
    expect(Array.from({ length: 4 }, () => rng.pick(['clear', 'rain', 'storm']))).toEqual([
      'storm',
      'clear',
      'clear',
      'clear',
    ]);

    // The draw count is part of the contract: it pins how many raw words each
    // helper consumes, so a change to rejection sampling cannot pass unnoticed.
    expect(rng.draws).toBe(70);
  });

  it('serialises stream state identically', () => {
    const streams = new RngStreams(SEED);
    streams.stream(RngStream.Ecology).nextU32();
    streams.stream(RngStream.Combat).nextIntInclusive(1, 6);

    expect(canonicalStringify(streams.toJson())).toBe(
      '{"streams":{"combat":{"draws":1,"s0":1961420541,"s1":3393361222,"s2":3236521883,' +
        '"s3":1479156473},"ecology":{"draws":1,"s0":440780671,"s1":3274265858,"s2":3883966595,' +
        '"s3":2232215521}},"worldSeed":"golden"}',
    );
  });
});

describe('golden: hashing and canonical form', () => {
  it('hashes known strings to known values', () => {
    expect([fnv1a32(''), fnv1a32('world-zero'), fnv1a32('the quick brown fox')]).toEqual([
      2166136261, 2329134584, 4216576014,
    ]);
    expect([fnv1a64Hex(''), fnv1a64Hex('world-zero'), fnv1a64Hex('the quick brown fox')]).toEqual([
      '9e3779b9811c9dc5',
      'c3dcf0e48ad3c5f8',
      'cc899c32fb53d80e',
    ]);
  });

  it('canonicalises to a known string', () => {
    const canonical = canonicalStringify({
      z: 1,
      a: { d: [3, 2, 1], b: null },
      m: -0,
      n: 'sûn',
      t: true,
    });

    // Keys sorted, array order preserved, -0 normalised to 0, non-ASCII intact.
    expect(canonical).toBe('{"a":{"b":null,"d":[3,2,1]},"m":0,"n":"sûn","t":true,"z":1}');
    expect(fnv1a64Hex(canonical)).toBe('abbe6081279aa86d');
  });
});

describe('golden: calendar', () => {
  it('formats known ticks to known timestamps', () => {
    const ticks = [0, 1, TICKS_PER_DAY - 1, 47 * TICKS_PER_DAY + 12345, 359 * TICKS_PER_DAY];
    expect(ticks.map((tick) => formatTimestamp(tick, DEFAULT_CALENDAR))).toEqual([
      '1200-01-01 00:00:00',
      '1200-01-01 00:00:01',
      '1200-01-01 23:59:59',
      '1200-02-18 03:25:45',
      '1200-12-30 00:00:00',
    ]);
  });
});

describe('golden: entity ids', () => {
  it('allocates known ids', () => {
    const ids = new IdGenerator();
    expect([
      ids.next(EntityKind.Npc),
      ids.next(EntityKind.Npc),
      ids.next(EntityKind.Item),
      makeEntityId(EntityKind.Building, 42),
    ]).toEqual(['npc:0', 'npc:1', 'item:0', 'building:42']);
  });
});
