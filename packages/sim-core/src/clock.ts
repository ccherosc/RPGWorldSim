import { assert, assertInt } from '@rpgsim/shared';
import {
  type CalendarConfig,
  DEFAULT_CALENDAR,
  type Tick,
  type WorldDateTime,
  formatDateTime,
  formatTimestamp,
  tickToDateTime,
} from './calendar.ts';

/**
 * The authoritative simulation time.
 *
 * Only the kernel advances the clock, and only forwards. Systems read it.
 * A backwards clock would let an action finish before it started, so the
 * monotonicity check here is a hard assertion rather than a clamp
 * (sim-core rule 10: no silent correction).
 */
export class SimClock {
  private currentTick: Tick;

  constructor(
    readonly calendar: CalendarConfig = DEFAULT_CALENDAR,
    startTick: Tick = 0,
  ) {
    assertInt(startTick, 'start tick must be an integer');
    assert(startTick >= 0, 'start tick must not be negative', { startTick });
    this.currentTick = startTick;
  }

  get tick(): Tick {
    return this.currentTick;
  }

  /** Advance to an absolute tick. Must not move backwards. */
  advanceTo(tick: Tick): void {
    assertInt(tick, 'tick must be an integer');
    assert(tick >= this.currentTick, 'Simulation clock cannot move backwards', {
      from: this.currentTick,
      to: tick,
    });
    this.currentTick = tick;
  }

  /** Advance by a non-negative duration. */
  advanceBy(ticks: number): void {
    assert(ticks >= 0, 'cannot advance the clock by a negative duration', { ticks });
    this.advanceTo(this.currentTick + ticks);
  }

  /**
   * Set the tick without the monotonicity check.
   * Reserved for save loading, where time legitimately jumps to a past value.
   */
  restore(tick: Tick): void {
    assertInt(tick, 'tick must be an integer');
    assert(tick >= 0, 'tick must not be negative', { tick });
    this.currentTick = tick;
  }

  now(): WorldDateTime {
    return tickToDateTime(this.currentTick, this.calendar);
  }

  format(): string {
    return formatDateTime(this.currentTick, this.calendar);
  }

  timestamp(): string {
    return formatTimestamp(this.currentTick, this.calendar);
  }
}
