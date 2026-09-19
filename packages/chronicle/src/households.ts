import { isJsonObject } from '@rpgsim/shared';
import { type EntityId, type SimEvent, isEntityId } from '@rpgsim/sim-core';
import type { ChronicleDay } from './day.ts';

/**
 * How many roofs the village is living under, counted off the record.
 *
 * A household is not a family. Twenty-four households hold eighty-six people
 * between them, and those people answer to twenty family names, because two
 * Barrow houses are both Barrows. `PersonRecord.family` can prove the second
 * number and has never been able to prove the first, so for a while the site
 * printed one of them in generated text and the other in prose somebody had
 * typed by hand -- twenty-four households in a caption, twenty families in the
 * tally underneath it, and no way for a reader to tell that both were true.
 *
 * The record could prove it all along. `society.household-founded` carries the
 * household's own id, so the houses are countable without households becoming
 * identified things anywhere else in the press. That is the whole of this class:
 * one number that the site would otherwise have to be told.
 *
 * **Learned forwards, like `Kinfolk` and for the same reason.** `learn` is
 * called once per day in archive order, so a page built for the third of Blossom
 * reports the houses standing on the third of Blossom. A count taken from the
 * whole archive first would put next month's houses in last month's caption.
 *
 * Dissolutions are honoured, though nothing dissolves a household yet. Counting
 * only foundings would be right today and would quietly become a high-water mark
 * the first time a house emptied -- the kind of wrong number that is never
 * noticed, because it only ever drifts in the direction of looking healthy.
 */
export class Households {
  private readonly standing = new Set<EntityId>();

  /** Houses standing as of the last day learned. */
  get count(): number {
    return this.standing.size;
  }

  learn(day: ChronicleDay): void {
    for (const event of day.byType('society.household-founded')) {
      const id = idOf(event.data);
      if (id !== undefined) this.standing.add(id);
    }
    for (const event of day.byType('society.household-dissolved')) {
      const id = idOf(event.data);
      if (id !== undefined) this.standing.delete(id);
    }
  }
}

/**
 * The household an event is about.
 *
 * A `Set` of ids rather than a tally, so that re-learning a day counts nobody
 * twice -- the press reads the archive once today and may read it twice
 * tomorrow, and a counter that went up each time would be a counter that
 * depended on how often the site was built.
 */
function idOf(data: SimEvent['data']): EntityId | undefined {
  if (!isJsonObject(data)) return undefined;
  const id = data['household'];
  return isEntityId(id) ? id : undefined;
}
