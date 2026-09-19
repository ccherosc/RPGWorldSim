import { assert, isJsonObject } from '@rpgsim/shared';
import { type EntityId, isEntityId } from '@rpgsim/sim-core';
import type { ChronicleDay } from './day.ts';

/**
 * Who belongs to whom, read back off the record a day at a time.
 *
 * The simulation holds descent properly, in `@rpgsim/society`. This is not that
 * and must not become it: the press has no world to ask, only an archive, so
 * everything here is assembled from `society.parentage-recorded` events exactly
 * as they were written. A parentage the archive never recorded is a parentage
 * the blog does not know about, which is the correct answer rather than a gap
 * to paper over.
 *
 * It exists for one sentence on the site. A villager may write about what they
 * saw, and a five-month-old saw a great deal and cannot hold a pen, so the days
 * of the youngest quarter of the village went unwritten. A parent speaking for
 * a child they live with is the one honest way to get those days onto the page:
 * a household shares its evening, and "the little one would not settle" is a
 * thing a parent knows without having to have been standing over the cot.
 *
 * **Learned forwards, never looked up backwards.** `learn` is called once per
 * day in archive order, so a parent's post on the day of a birth knows about
 * the birth and a post the day before does not. Reading the whole archive first
 * and then writing the days would let an early post rest on a fact the village
 * did not yet have, which is directive 5 with the dates filed off.
 */
export class Kinfolk {
  private readonly byParent = new Map<EntityId, EntityId[]>();
  /** `parent|child` pairs already recorded, so re-learning a day adds nobody twice. */
  private readonly known = new Set<string>();

  /** How many people are known to be somebody's parent. */
  get size(): number {
    return this.byParent.size;
  }

  /**
   * Take in one day's parentage.
   *
   * Absent parents are skipped rather than recorded as unknown. `motherAbsent`
   * says the world has a reason for not naming her -- dead, departed, unknown --
   * and none of those is somebody who can write a post about the child.
   */
  learn(day: ChronicleDay): void {
    for (const event of day.byType('society.parentage-recorded')) {
      const data = event.data;
      if (!isJsonObject(data)) continue;
      const child = data['child'];
      if (!isEntityId(child)) continue;
      for (const role of ['mother', 'father'] as const) {
        const parent = data[role];
        if (!isEntityId(parent)) continue;
        this.record(parent, child);
      }
    }
  }

  /** This person's children, oldest record first. Empty for anybody childless. */
  childrenOf(parent: EntityId): readonly EntityId[] {
    return this.byParent.get(parent) ?? EMPTY;
  }

  private record(parent: EntityId, child: EntityId): void {
    // A record that made somebody their own parent would put a villager in an
    // endless family, and the wording would read as though they had spoken
    // about themselves in the third person.
    assert(parent !== child, 'the record makes somebody their own parent', { parent });
    const pair = `${parent}|${child}`;
    if (this.known.has(pair)) return;
    this.known.add(pair);

    const held = this.byParent.get(parent);
    if (held === undefined) this.byParent.set(parent, [child]);
    else held.push(child);
  }
}

const EMPTY: readonly EntityId[] = Object.freeze([]);
