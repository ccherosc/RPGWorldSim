import { assert } from '@rpgsim/shared';

/**
 * The one formatting decision the permanent record makes.
 *
 * Both memory files are tab-separated rows with a `#` comment header. That is
 * the whole format: no braces, no repeated key names, no quoting rules to get
 * wrong, and no parser to keep in step with a writer. `cut -f2`, `grep`, `sort`
 * and a human eye all work on it unaided, which matters more for a file meant to
 * be read in ten years than any amount of structure would.
 *
 * The cost is that a field may not contain a tab or a newline, so writing one is
 * refused rather than escaped. An escaping rule is a second format hiding inside
 * the first, and the values that go in these columns — slugs, names, small
 * integers, dates — have no business containing either.
 */

/** What stands in a column that has nothing in it. Never an empty string. */
export const EMPTY = '-';

/** Render one value as a cell. `null` and `undefined` become `EMPTY`. */
export function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  const text = String(value);
  if (text.length === 0) return EMPTY;
  assert(!/[\t\n\r]/.test(text), 'a chronicle field may not contain a tab or a newline', {
    value: text,
  });
  return text;
}

export function formatRow(values: readonly (string | number | null | undefined)[]): string {
  return values.map(cell).join('\t');
}

/**
 * Split a row back into cells, with `EMPTY` read back as `null`.
 *
 * The column count is asserted rather than padded. A short row means the file
 * was written by something that disagreed about the format, and guessing which
 * columns were meant is how a record quietly becomes wrong.
 */
export function parseRow(line: string, columns: number): (string | null)[] {
  const cells = line.split('\t');
  assert(cells.length === columns, 'a chronicle row has the wrong number of columns', {
    line,
    expected: columns,
    found: cells.length,
  });
  return cells.map((value) => (value === EMPTY ? null : value));
}

/** Is this a comment or a blank line — something to read past rather than parse? */
export function isSkippable(line: string): boolean {
  return line.length === 0 || line.startsWith('#');
}
