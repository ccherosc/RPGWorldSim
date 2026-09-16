import { SimAssertionError } from './assert.ts';
import type { JsonValue } from './json.ts';

/**
 * Deterministic JSON serialization.
 *
 * `JSON.stringify` preserves object insertion order, so two structurally
 * identical world states can serialize to different bytes and produce
 * different hashes. Every save file and every state hash goes through this
 * instead, which sorts object keys by UTF-16 code unit.
 *
 * Non-finite numbers throw rather than becoming `null`. A NaN that silently
 * became `null` in a save file would be a nightmare to trace back to the
 * arithmetic that produced it, so we fail at the moment of serialization.
 */
export function canonicalStringify(value: JsonValue): string {
  return write(value, []);
}

function write(value: JsonValue, path: string[]): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new SimAssertionError('Non-finite number cannot be serialized', {
          path: path.join('.') || '<root>',
          value: String(value),
        });
      }
      // Normalize -0 to 0 so it cannot produce two hashes for one state.
      return Object.is(value, -0) ? '0' : String(value);
    }
    default:
      break;
  }

  if (Array.isArray(value)) {
    const parts = value.map((item, i) => write(item, [...path, String(i)]));
    return `[${parts.join(',')}]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const entry = (value as Record<string, JsonValue>)[key];
      if (entry === undefined) continue; // matches JSON.stringify key-dropping
      parts.push(`${JSON.stringify(key)}:${write(entry, [...path, key])}`);
    }
    return `{${parts.join(',')}}`;
  }

  throw new SimAssertionError('Value is not JSON-serializable', {
    path: path.join('.') || '<root>',
    type: typeof value,
  });
}

/** Deep structural clone through the canonical form. Also validates JSON-ness. */
export function canonicalClone<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalStringify(value)) as T;
}
