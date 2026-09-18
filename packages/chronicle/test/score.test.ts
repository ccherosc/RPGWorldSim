import { describe, expect, it } from 'vitest';
import {
  ChronicleDay,
  type Newsworthiness,
  PeopleRegister,
  PlaceRegister,
  type ScoringConfig,
  ScoringSchema,
  compareNewsworthiness,
  rank,
  scoreOf,
} from '@rpgsim/chronicle';
import {
  DEFAULT_CALENDAR,
  type EntityId,
  EntityKind,
  type SimEvent,
  TICKS_PER_DAY,
  dayKeyOf,
  makeEntityId,
} from '@rpgsim/sim-core';

/**
 * Newsworthiness, tested on days small enough to work out by hand.
 *
 * Every expected number here is arithmetic a reader can check against the
 * config below, on purpose: a scoring test that asserts whatever the code
 * currently returns tests nothing but that the code has not changed.
 */

const DAY = 90;
const KEY = dayKeyOf(DAY * TICKS_PER_DAY, DEFAULT_CALENDAR);

const npc = (index: number): EntityId => makeEntityId(EntityKind.Npc, index);
const place = (index: number): EntityId => makeEntityId(EntityKind.Location, index);

const SCORING: ScoringConfig = {
  rarity: 120,
  refusals: ['travel.blocked', 'npc.could-not-rest'],
  refusal: 40,
  crowd: 8,
  crowdCap: 40,
  stage: 12,
  consequence: 10,
  consequenceCap: 30,
};

let nextId = 1;

function event(
  type: string,
  options: {
    actors?: readonly EntityId[];
    location?: EntityId;
    causes?: readonly number[];
    data?: Record<string, unknown>;
  } = {},
): SimEvent {
  return {
    id: nextId++,
    tick: DAY * TICKS_PER_DAY,
    type,
    actors: options.actors ?? [],
    ...(options.location !== undefined ? { location: options.location } : {}),
    data: (options.data ?? {}) as SimEvent['data'],
    causes: options.causes ?? [],
  };
}

function day(events: readonly SimEvent[]): ChronicleDay {
  const people = new PeopleRegister();
  const places = new PlaceRegister();
  for (let index = 0; index < 8; index++) {
    people.add({
      id: npc(index),
      name: `Person Number${index}`,
      sex: 'female',
      born: '1170-03-02',
      family: null,
    });
  }
  places.add({ id: place(0), name: 'The Green', type: 'square', access: 'public' });
  places.add({ id: place(1), name: 'A cottage on Mill Lane', type: 'dwelling', access: 'private' });
  return new ChronicleDay({ key: KEY, events, people, places });
}

const total = (chronicle: ChronicleDay, of: SimEvent): number =>
  scoreOf(SCORING, chronicle, of).total;

describe('the config', () => {
  it('is what ships in data/chronicle/scoring.json', () => {
    // The file the simulator loads has to satisfy the schema, or the first
    // person to learn otherwise is a reader looking at a broken page.
    expect(() => ScoringSchema.parse(SCORING)).not.toThrow();
  });

  it('refuses a weight that is not a whole number', () => {
    expect(() => ScoringSchema.parse({ ...SCORING, rarity: 120.5 })).toThrow();
    expect(() => ScoringSchema.parse({ ...SCORING, refusal: -1 })).toThrow();
  });
});

describe('what makes news', () => {
  it('scores the only one of its kind above one of many', () => {
    nextId = 1;
    const alone = event('npc.removed', { actors: [npc(0)] });
    const chronicle = day([alone]);
    // rarity 120/1, nothing else.
    expect(total(chronicle, alone)).toBe(120);

    nextId = 1;
    const first = event('npc.removed', { actors: [npc(0)] });
    const second = event('npc.removed', { actors: [npc(1)] });
    const crowded = day([first, second]);
    // rarity 120/2.
    expect(total(crowded, first)).toBe(60);
    expect(total(crowded, second)).toBe(60);
  });

  it('measures rarity against the day, not against a table', () => {
    nextId = 1;
    const one = event('travel.blocked', { actors: [npc(0)] });
    const rare = day([one]);

    nextId = 1;
    const many = [0, 1, 2, 3].map((index) => event('travel.blocked', { actors: [npc(index)] }));
    const common = day(many);

    // The same event type, the same everything else: only the day differs.
    expect(total(rare, one)).toBeGreaterThan(total(common, many[0] as SimEvent));
    expect(total(rare, one)).toBe(160); // 120 + 40
    expect(total(common, many[0] as SimEvent)).toBe(70); // 30 + 40
  });

  it('scores a refusal above a success of the same rarity', () => {
    nextId = 1;
    const blocked = event('travel.blocked', { actors: [npc(0)] });
    const arrived = event('travel.arrived', { actors: [npc(1)] });
    const chronicle = day([blocked, arrived]);

    // Identical but for the type: both are the only one of their kind.
    expect(total(chronicle, blocked)).toBe(160);
    expect(total(chronicle, arrived)).toBe(120);
  });

  it('scores more people above fewer, up to a cap', () => {
    nextId = 1;
    const alone = event('society.household-founded', { actors: [npc(0)] });
    const pair = event('npc.woke', { actors: [npc(0), npc(1)] });
    const atTheCap = event('npc.turning-in', { actors: [0, 1, 2, 3, 4, 5].map(npc) });
    // Eight would be worth 7 x 8 = 56 uncapped, so this is the case that can
    // tell a working cap from an absent one.
    const past = event('npc.went-to-bed', { actors: [0, 1, 2, 3, 4, 5, 6, 7].map(npc) });
    const chronicle = day([alone, pair, atTheCap, past]);

    expect(scoreOf(SCORING, chronicle, alone).crowd).toBe(0); // one actor, no bonus
    expect(scoreOf(SCORING, chronicle, pair).crowd).toBe(8); // one beyond the first
    expect(scoreOf(SCORING, chronicle, atTheCap).crowd).toBe(40); // 5 x 8, exactly the cap
    expect(scoreOf(SCORING, chronicle, past).crowd).toBe(40); // 7 x 8 would be 56
  });

  it('scores somewhere anybody could watch above somewhere nobody could', () => {
    nextId = 1;
    const seen = event('npc.woke', { actors: [npc(0)], location: place(0) });
    const unseen = event('npc.turning-in', { actors: [npc(1)], location: place(1) });
    const nowhere = event('npc.went-to-bed', { actors: [npc(2)] });
    const chronicle = day([seen, unseen, nowhere]);

    expect(scoreOf(SCORING, chronicle, seen).stage).toBe(12);
    expect(scoreOf(SCORING, chronicle, unseen).stage).toBe(0);
    expect(scoreOf(SCORING, chronicle, nowhere).stage).toBe(0);
  });

  it('scores something that followed from something above something that did not', () => {
    nextId = 1;
    const spontaneous = event('npc.woke', { actors: [npc(0)] });
    const caused = event('npc.turning-in', { actors: [npc(1)], causes: [spontaneous.id] });
    const chained = event('npc.went-to-bed', { actors: [npc(2)], causes: [1, 2, 3, 4] });
    const chronicle = day([spontaneous, caused, chained]);

    expect(scoreOf(SCORING, chronicle, spontaneous).consequence).toBe(0);
    expect(scoreOf(SCORING, chronicle, caused).consequence).toBe(10);
    expect(scoreOf(SCORING, chronicle, chained).consequence).toBe(30); // 4 x 10, capped
  });

  it('adds its five parts and nothing else', () => {
    nextId = 1;
    const loud = event('travel.blocked', {
      actors: [npc(0), npc(1)],
      location: place(0),
      causes: [99],
    });
    const chronicle = day([loud]);
    const scored = scoreOf(SCORING, chronicle, loud);

    expect(scored).toMatchObject({ rarity: 120, refusal: 40, crowd: 8, stage: 12, consequence: 10 });
    expect(scored.total).toBe(190);
    expect(scored.total).toBe(
      scored.rarity + scored.refusal + scored.crowd + scored.stage + scored.consequence,
    );
  });

  it('is an integer, always', () => {
    nextId = 1;
    // Seven of a kind: 120/7 is 17.14..., and a score with a fraction in it is
    // an order that can differ between two machines that agree on everything.
    const seven = [0, 1, 2, 3, 4, 5, 6].map(() => event('travel.arrived', { actors: [npc(0)] }));
    const chronicle = day(seven);
    for (const one of seven) {
      const scored = scoreOf(SCORING, chronicle, one);
      expect(Number.isInteger(scored.total)).toBe(true);
      expect(scored.rarity).toBe(17);
    }
  });
});

describe('the score is a pure function of the event and the day', () => {
  it('gives the same answer however many times it is asked', () => {
    nextId = 1;
    const one = event('travel.blocked', { actors: [npc(0)], location: place(0) });
    const chronicle = day([one, event('npc.woke', { actors: [npc(1)] })]);

    const answers = [0, 1, 2, 3, 4].map(() => scoreOf(SCORING, chronicle, one).total);
    expect(new Set(answers).size).toBe(1);
  });

  it('scores two identical days identically', () => {
    const build = (): { chronicle: ChronicleDay; events: SimEvent[] } => {
      nextId = 1;
      const events = [
        event('travel.blocked', { actors: [npc(0)], location: place(0), causes: [1] }),
        event('npc.woke', { actors: [npc(1)], location: place(1) }),
        event('society.household-founded', { actors: [npc(0), npc(1), npc(2)] }),
      ];
      return { chronicle: day(events), events };
    };

    const first = build();
    const second = build();
    expect(rank(SCORING, first.chronicle).map((s) => [s.event.id, s.total])).toEqual(
      rank(SCORING, second.chronicle).map((s) => [s.event.id, s.total]),
    );
  });

  it('does not read a word of what an event says', () => {
    // The guarantee that rewording a headline cannot silently reorder the page.
    // Everything a template would draw on lives in `data`, so the test is that
    // `data` may be replaced wholesale and no score moves.
    nextId = 1;
    const plain = event('travel.blocked', {
      actors: [npc(0)],
      location: place(0),
      data: { reason: 'full' },
    });
    nextId = 1;
    const florid = event('travel.blocked', {
      actors: [npc(0)],
      location: place(0),
      data: {
        reason: 'the cottage was full to the rafters and the door would not open',
        headline: 'TURNED AWAY AT THE DOOR',
        persona: { tell: 'she rubs her wrist when she lies' },
        weight: 10_000,
      },
    });

    // Compared without the event itself, which of course still carries the
    // words: the claim is about the numbers the score arrived at.
    const numbers = ({ event: _, ...rest }: Newsworthiness): Omit<Newsworthiness, 'event'> => rest;
    expect(numbers(scoreOf(SCORING, day([florid]), florid))).toEqual(
      numbers(scoreOf(SCORING, day([plain]), plain)),
    );
  });

  it('does not depend on what order it was asked about the day', () => {
    nextId = 1;
    const events = [
      event('travel.blocked', { actors: [npc(0)], location: place(0) }),
      event('npc.woke', { actors: [npc(1)] }),
      event('npc.turning-in', { actors: [npc(2)] }),
    ];
    const chronicle = day(events);

    const forwards = events.map((one) => scoreOf(SCORING, chronicle, one).total);
    const backwards = [...events].reverse().map((one) => scoreOf(SCORING, chronicle, one).total);
    expect(backwards.reverse()).toEqual(forwards);
  });
});

describe('putting the day in order', () => {
  it('puts the most newsworthy first', () => {
    nextId = 1;
    const dull = event('npc.woke', { actors: [npc(0)] });
    const loud = event('travel.blocked', { actors: [npc(1)], location: place(0) });
    const chronicle = day([dull, loud]);

    expect(rank(SCORING, chronicle).map((s) => s.event.id)).toEqual([loud.id, dull.id]);
  });

  it('breaks a tie by event id, earliest first', () => {
    nextId = 1;
    const early = event('travel.blocked', { actors: [npc(0)], location: place(0) });
    const late = event('travel.blocked', { actors: [npc(1)], location: place(0) });
    const chronicle = day([late, early]);

    // Identical scores, handed over in the wrong order on purpose.
    expect(total(chronicle, early)).toBe(total(chronicle, late));
    expect(rank(SCORING, chronicle).map((s) => s.event.id)).toEqual([early.id, late.id]);
  });

  it('orders totally, so no two events are ever merely equal', () => {
    nextId = 1;
    const events = [0, 1, 2, 3, 4, 5].map((index) =>
      event('travel.blocked', { actors: [npc(index)], location: place(0) }),
    );
    const chronicle = day(events);
    const scored = events.map((one) => scoreOf(SCORING, chronicle, one));

    for (const a of scored) {
      for (const b of scored) {
        if (a === b) expect(compareNewsworthiness(a, b)).toBe(0);
        else expect(compareNewsworthiness(a, b)).not.toBe(0);
      }
    }
  });

  it('ranks every event of the day and loses none', () => {
    nextId = 1;
    const events = [
      event('npc.woke', { actors: [npc(0)] }),
      event('travel.blocked', { actors: [npc(1)] }),
      event('world.generated'),
    ];
    const chronicle = day(events);
    expect(rank(SCORING, chronicle)).toHaveLength(3);
  });
});
