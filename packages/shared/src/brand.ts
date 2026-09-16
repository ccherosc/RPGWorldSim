/**
 * Nominal typing helper.
 *
 * `Brand<string, 'EntityId'>` is assignable to `string`, but a bare `string`
 * is not assignable to it. This catches "passed a household id where an npc id
 * was expected" at compile time without any runtime cost.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Strip the brand back off. Use sparingly; mostly for serialization. */
export type Unbrand<T> = T extends Brand<infer U, string> ? U : T;
