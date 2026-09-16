/**
 * Simulation assertion failure.
 *
 * sim-core rule 10: never hide invalid state with silent correction. When an
 * impossible state is reached we throw loudly rather than clamping.
 */
export class SimAssertionError extends Error {
  override readonly name = 'SimAssertionError';
  constructor(
    message: string,
    readonly context?: Readonly<Record<string, unknown>>,
  ) {
    super(context ? `${message} ${safeContext(context)}` : message);
  }
}

function safeContext(context: Readonly<Record<string, unknown>>): string {
  try {
    return JSON.stringify(context);
  } catch {
    return '[uninspectable context]';
  }
}

export function assert(
  condition: unknown,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): asserts condition {
  if (!condition) throw new SimAssertionError(message, context);
}

/** Asserts a value is a safe integer. Ticks, ids and counts must all satisfy this. */
export function assertInt(
  value: number,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): asserts value is number {
  if (!Number.isSafeInteger(value)) {
    throw new SimAssertionError(`${message} (got ${String(value)})`, context);
  }
}

/** Asserts a float is usable in simulation arithmetic: no NaN, no Infinity. */
export function assertFinite(
  value: number,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): asserts value is number {
  if (!Number.isFinite(value)) {
    throw new SimAssertionError(`${message} (got ${String(value)})`, context);
  }
}

/** Exhaustiveness check for discriminated unions. */
export function assertNever(value: never, message = 'Unexpected variant'): never {
  throw new SimAssertionError(`${message}: ${JSON.stringify(value)}`);
}
