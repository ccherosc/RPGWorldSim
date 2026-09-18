import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { type ArchiveManifest, readArchiveManifest } from '@rpgsim/sim-core';
import { assert } from '@rpgsim/shared';
import { DATA_ROOT } from './data.ts';

/**
 * The launch freeze: proof that a published day has not been rewritten.
 *
 * Every publish regenerates the whole history from the seed. That is the simple
 * choice and it keeps generated state out of the repository, but it has one
 * sharp edge: a change to worldgen, to the scheduler, to a single balance
 * number in `data/world/` would silently rewrite days people have already read.
 * The village would still be internally consistent. It would just be a
 * different village, and the archive would be a lie.
 *
 * So once a day is published its state hash is written down here, and every
 * rebuild checks the regenerated hash against the written one and fails on any
 * difference. The hash comes out of `sim.hash()` at the close of the day, so it
 * covers the whole world and not just the pages -- a day whose events are
 * identical but whose world diverged still fails, which is the point, because
 * the divergence would surface in tomorrow's paper instead.
 *
 * Failing is the whole behaviour. There is no repair, no override flag and no
 * "publish anyway": if a frozen day changed, either the change is wrong and
 * belongs reverted, or the archive is wrong and a human decides what to do
 * about it. Neither is a decision a nightly job should make at four in the
 * morning.
 */

export const FROZEN_FILE = 'frozen.json';

export const FrozenHistorySchema = z
  .object({
    /**
     * Day key to world hash, for every published day at or before
     * `frozenThrough` in `publication.json`. Written by `press freeze --write`.
     */
    days: z.record(
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      z.string().min(1),
    ),
    note: z.string().optional(),
  })
  .strip();

export type FrozenHistory = z.infer<typeof FrozenHistorySchema>;

/** Where the frozen hashes live, whether or not anything is frozen yet. */
export const frozenPath = (dataRoot: string = DATA_ROOT): string =>
  join(dataRoot, 'chronicle', FROZEN_FILE);

/**
 * The committed hashes, or an empty history when nothing has been frozen.
 *
 * A missing file is not an error. Before launch there is nothing to freeze, and
 * the check below is what decides whether an empty history is acceptable --
 * that decision belongs with `frozenThrough`, not with the filesystem.
 */
export function loadFrozenHistory(dataRoot: string = DATA_ROOT): FrozenHistory {
  const path = frozenPath(dataRoot);
  if (!existsSync(path)) return { days: {} };
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = FrozenHistorySchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${path} is not a valid frozen history: ${issues}`);
  }
  return result.data;
}

export interface FreezeCheck {
  readonly manifest: ArchiveManifest;
  readonly frozen: FrozenHistory;
  /** The last village day the site publishes, or null while nothing is frozen. */
  readonly frozenThrough: string | null;
}

export interface FreezeReport {
  /** How many days were compared hash for hash. */
  readonly checked: number;
  /** True when `frozenThrough` is null, in which case nothing was compared. */
  readonly idle: boolean;
}

/**
 * Compare a regenerated archive against the committed hashes.
 *
 * Throws on the first thing that is wrong, and the things that are wrong
 * include the bookkeeping. A freeze that is set with no hashes behind it, or
 * hashes left behind after a freeze is lifted, would both make this function
 * pass while checking nothing, and a check that passes while checking nothing
 * is worse than no check at all -- it is a green tick over an unguarded
 * archive.
 */
export function checkFrozen(options: FreezeCheck): FreezeReport {
  const { manifest, frozen, frozenThrough } = options;
  const written = Object.keys(frozen.days).sort();

  if (frozenThrough === null) {
    assert(written.length === 0, 'frozen hashes are committed but nothing is frozen', {
      days: written.length,
      first: written[0],
    });
    return { checked: 0, idle: true };
  }

  assert(written.length > 0, 'the freeze is set but no hashes are committed to check it', {
    frozenThrough,
  });
  const late = written.filter((key) => key > frozenThrough);
  assert(late.length === 0, 'frozen hashes name days the site does not publish', {
    frozenThrough,
    days: late,
  });

  const regenerated = manifest.days.filter((day) => day.key <= frozenThrough);
  const missing = written.filter((key) => !regenerated.some((day) => day.key === key));
  assert(missing.length === 0, 'the rebuilt archive is missing a frozen day', {
    days: missing,
  });
  const extra = regenerated.filter((day) => frozen.days[day.key] === undefined);
  assert(extra.length === 0, 'the rebuilt archive has a published day nobody froze', {
    days: extra.map((day) => day.key),
  });

  for (const day of regenerated) {
    // A sealed day always carries a hash; an unsealed one cannot take part,
    // and letting it through would freeze the day without checking it.
    assert(day.hash !== null, 'a frozen day was archived without a hash', { day: day.key });
    assert(day.hash === frozen.days[day.key], 'a published day has been rewritten', {
      day: day.key,
      published: frozen.days[day.key],
      rebuilt: day.hash,
    });
  }

  return { checked: regenerated.length, idle: false };
}

export interface WriteFreezeOptions {
  readonly archive: string;
  readonly frozenThrough: string;
  readonly dataRoot?: string;
  readonly note?: string;
}

/**
 * Write the committed hashes from an archive. Run once, by hand, at launch.
 *
 * This is the only thing in the press that writes into `data/`, and it is here
 * rather than done by hand because thirty hashes copied by a human is thirty
 * chances to copy one wrong -- and a wrong hash in this file fails every
 * publish from then on with a message saying history was rewritten, which is
 * the least helpful possible way to learn about a typo.
 */
export function writeFrozenHistory(options: WriteFreezeOptions): FrozenHistory {
  const manifest = readArchiveManifest(options.archive);
  assert(manifest !== undefined, 'no archive to freeze from', { archive: options.archive });
  const days: Record<string, string> = {};
  for (const day of (manifest as ArchiveManifest).days) {
    if (day.key > options.frozenThrough) continue;
    assert(day.hash !== null, 'a day to be frozen was archived without a hash', { day: day.key });
    days[day.key] = day.hash as string;
  }
  assert(Object.keys(days).length > 0, 'that freeze date is before the archive begins', {
    frozenThrough: options.frozenThrough,
  });

  const history: FrozenHistory = {
    note:
      options.note ??
      'World hashes for every published day. Written by "press freeze --write". A rebuild that disagrees with a hash in here has rewritten history and the publish fails.',
    days,
  };
  writeFileSync(frozenPath(options.dataRoot), `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  return history;
}
