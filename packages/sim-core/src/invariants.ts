import type { Tick } from './calendar.ts';

export type InvariantSeverity = 'error' | 'warning';

export interface InvariantViolation {
  readonly invariantId: string;
  /** Defaults to the invariant's own severity, and to 'error' if it has none. */
  readonly severity?: InvariantSeverity;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * A rule about world state that must always hold.
 *
 * SIMULATION_RULES.md lists the debugging invariants this project cares about:
 * no negative quantities, no duplicate ownership, no dead NPC acting, no money
 * from nowhere, no parent younger than their child. Each becomes one of these,
 * registered by the package that owns the concept. sim-core rule 11 requires a
 * new invariant whenever a new core concept is added.
 *
 * Checks must be read-only. A check that repaired state would hide the bug it
 * was written to find.
 */
export interface Invariant<TContext = unknown> {
  readonly id: string;
  readonly description: string;
  readonly severity?: InvariantSeverity;
  check(context: TContext): InvariantViolation[] | void;
}

export interface InvariantReport {
  readonly tick: Tick;
  readonly checked: number;
  readonly violations: readonly InvariantViolation[];
}

export class InvariantError extends Error {
  override readonly name = 'InvariantError';
  constructor(readonly report: InvariantReport) {
    super(
      `${report.violations.length} invariant violation(s) at tick ${report.tick}:\n` +
        report.violations.map((v) => `  [${v.invariantId}] ${v.message}`).join('\n'),
    );
  }
}

export class InvariantRegistry<TContext = unknown> {
  private readonly invariants = new Map<string, Invariant<TContext>>();

  register(invariant: Invariant<TContext>): void {
    if (this.invariants.has(invariant.id)) {
      throw new Error(`Invariant "${invariant.id}" is already registered`);
    }
    this.invariants.set(invariant.id, invariant);
  }

  /** Registered ids, sorted so reports are deterministic. */
  ids(): string[] {
    return [...this.invariants.keys()].sort();
  }

  /** Run every invariant and collect violations. Never throws on violations. */
  run(context: TContext, tick: Tick): InvariantReport {
    const violations: InvariantViolation[] = [];
    const ids = this.ids();
    for (const id of ids) {
      const invariant = this.invariants.get(id) as Invariant<TContext>;
      const result = invariant.check(context);
      if (!result) continue;
      for (const violation of result) {
        violations.push({
          ...violation,
          severity: violation.severity ?? invariant.severity ?? 'error',
          invariantId: violation.invariantId || invariant.id,
        });
      }
    }
    return { tick, checked: ids.length, violations };
  }

  /** Run every invariant and throw if any `error`-severity violation is found. */
  assert(context: TContext, tick: Tick): InvariantReport {
    const report = this.run(context, tick);
    if (report.violations.some((v) => (v.severity ?? 'error') === 'error')) {
      throw new InvariantError(report);
    }
    return report;
  }
}

/** Helper for building a violation without repeating the id at every site. */
export function violation(
  invariantId: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): InvariantViolation {
  return details === undefined ? { invariantId, message } : { invariantId, message, details };
}
