import { describe, expect, it } from 'vitest';
import { pickNextBotAction } from './ai';
import {
  applyGameAction,
  canBeat,
  createInitialGameState,
  PlayerSeed,
  sanitizeGameStateForPlayer,
} from './engine';
import { Card, DEFAULT_SETTINGS, GameState, Suit } from './types';

function makeCard(suit: Suit, rank: Card['rank']): Card {
  return { id: `${suit}-${rank}`, suit, rank };
}

function deterministicRng(seed = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('Durak Engine', () => {
  it('deals 6 cards each for 2-4 players and picks lowest trump holder as first attacker', () => {
    const seeds: PlayerSeed[] = [
      { id: 'p1', name: 'Alice', type: 'human' },
      { id: 'p2', name: 'Bob', type: 'bot' },
      { id: 'p3', name: 'Carol', type: 'bot' },
      { id: 'p4', name: 'Dave', type: 'human' },
    ];
    const state = createInitialGameState(seeds, { ...DEFAULT_SETTINGS, maxPlayers: 4 }, deterministicRng(7));
    expect(state.players).toHaveLength(4);
    expect(state.deck).toHaveLength(36 - 24);
    for (const p of state.players) {
      expect(p.hand).toHaveLength(6);
    }
    expect(state.deck[state.deck.length - 1]).toEqual(state.trumpCard);

    // Verify attacker indeed holds the lowest trump among all players (if any player has one)
    const allTrumps = state.players.flatMap((p, idx) =>
      p.hand.filter((c) => c.suit === state.trumpSuit).map((c) => ({ idx, rank: c.rank })),
    );
    if (allTrumps.length > 0) {
      allTrumps.sort((a, b) => a.rank - b.rank);
      expect(state.attackerIndex).toBe(allTrumps[0].idx);
    }
  });

  it('validates canBeat rules accurately for same suit and trump suit', () => {
    expect(canBeat(makeCard('spades', 8), makeCard('spades', 10), 'hearts')).toBe(true);
    expect(canBeat(makeCard('spades', 10), makeCard('spades', 8), 'hearts')).toBe(false);
    expect(canBeat(makeCard('spades', 14), makeCard('hearts', 6), 'hearts')).toBe(true);
    expect(canBeat(makeCard('hearts', 9), makeCard('spades', 14), 'hearts')).toBe(false);
    expect(canBeat(makeCard('hearts', 9), makeCard('hearts', 11), 'hearts')).toBe(true);
    expect(canBeat(makeCard('clubs', 7), makeCard('diamonds', 14), 'hearts')).toBe(false);
  });

  it('enforces throw-in ranks, discard, refill order, and next attacker rotation', () => {
    const base = createInitialGameState(
      [
        { id: 'p1', name: 'A', type: 'human' },
        { id: 'p2', name: 'B', type: 'human' },
        { id: 'p3', name: 'C', type: 'human' },
      ],
      { ...DEFAULT_SETTINGS, maxPlayers: 3 },
      deterministicRng(1),
    );

    const custom: GameState = {
      ...base,
      trumpSuit: 'hearts',
      attackerIndex: 0,
      defenderIndex: 1,
      defenderStartHandCount: 6,
      deck: [makeCard('clubs', 12), makeCard('diamonds', 13), makeCard('spades', 14)],
      players: [
        {
          ...base.players[0],
          hand: [makeCard('spades', 7), makeCard('diamonds', 9), makeCard('clubs', 6)],
        },
        {
          ...base.players[1],
          hand: [makeCard('spades', 9), makeCard('diamonds', 10), makeCard('clubs', 8)],
        },
        {
          ...base.players[2],
          hand: [makeCard('clubs', 9), makeCard('spades', 13)],
        },
      ],
    };

    // P1 leads 7♠
    const r1 = applyGameAction(custom, { type: 'attack', playerId: 'p1', cardId: 'spades-7' });
    expect(r1.ok).toBe(true);
    expect(r1.state.subPhase).toBe('battle');

    // P3 tries to throw in 13♠ (not on table yet) -> rejected
    const badThrow = applyGameAction(r1.state, { type: 'attack', playerId: 'p3', cardId: 'spades-13' });
    expect(badThrow.ok).toBe(false);

    // P2 defends with 9♠
    const r2 = applyGameAction(r1.state, {
      type: 'defend',
      playerId: 'p2',
      cardId: 'spades-9',
      targetIndex: 0,
    });
    expect(r2.ok).toBe(true);

    // Now 9 is on the table! P3 (co-attacker) can throw in 9♣!
    const r3 = applyGameAction(r2.state, { type: 'attack', playerId: 'p3', cardId: 'clubs-9' });
    expect(r3.ok).toBe(true);
    expect(r3.state.table).toHaveLength(2);

    // P2 defends 9♣? No, 8♣ can't beat 9♣ -> fails
    const badDef = applyGameAction(r3.state, {
      type: 'defend',
      playerId: 'p2',
      cardId: 'clubs-8',
      targetIndex: 1,
    });
    expect(badDef.ok).toBe(false);

    // P2 takes!
    const r4 = applyGameAction(r3.state, { type: 'take', playerId: 'p2' });
    expect(r4.ok).toBe(true);
    expect(r4.state.subPhase).toBe('taking');

    // P1 throws in 9♦ while P2 is taking
    const r5 = applyGameAction(r4.state, { type: 'attack', playerId: 'p1', cardId: 'diamonds-9' });
    expect(r5.ok).toBe(true);

    // P1 and P3 both pass -> P2 picks up 4 table cards (7♠, 9♠, 9♣, 9♦) and skips turn!
    const r6 = applyGameAction(r5.state, { type: 'pass_turn', playerId: 'p1' });
    expect(r6.ok).toBe(true);
    const r7 = applyGameAction(r6.state, { type: 'pass_turn', playerId: 'p3' });
    expect(r7.ok).toBe(true);

    expect(r7.state.subPhase).toBe('initial_attack');
    expect(r7.state.table).toHaveLength(0);
    // P2 skipped attack, so P3 becomes attacker and P1 becomes defender!
    expect(r7.state.attackerIndex).toBe(2);
    expect(r7.state.defenderIndex).toBe(0);
    // Deck had 3 cards -> P1 drew first (had 1 card, drew all 3 to reach 4)
    expect(r7.state.deck).toHaveLength(0);
    expect(r7.state.players[0].hand).toHaveLength(4);
    expect(r7.state.players[1].hand).toHaveLength(6); // 2 remaining + 4 picked up
  });

  it('supports Passing variant accurately', () => {
    const base = createInitialGameState(
      [
        { id: 'p1', name: 'A', type: 'human' },
        { id: 'p2', name: 'B', type: 'human' },
        { id: 'p3', name: 'C', type: 'human' },
      ],
      { ...DEFAULT_SETTINGS, maxPlayers: 3, variant: 'passing' },
      deterministicRng(2),
    );

    const custom: GameState = {
      ...base,
      trumpSuit: 'hearts',
      attackerIndex: 0,
      defenderIndex: 1,
      defenderStartHandCount: 3,
      players: [
        { ...base.players[0], hand: [makeCard('spades', 8), makeCard('clubs', 6)] },
        { ...base.players[1], hand: [makeCard('diamonds', 8), makeCard('clubs', 10), makeCard('spades', 11)] },
        { ...base.players[2], hand: [makeCard('spades', 12), makeCard('diamonds', 12), makeCard('hearts', 7)] },
      ],
    };

    const r1 = applyGameAction(custom, { type: 'attack', playerId: 'p1', cardId: 'spades-8' });
    expect(r1.ok).toBe(true);

    // P2 passes with 8♦ -> P3 becomes defender with 2 cards on table!
    const r2 = applyGameAction(r1.state, { type: 'pass_attack', playerId: 'p2', cardId: 'diamonds-8' });
    expect(r2.ok).toBe(true);
    expect(r2.state.attackerIndex).toBe(1);
    expect(r2.state.defenderIndex).toBe(2);
    expect(r2.state.table).toHaveLength(2);
  });

  it('sanitizes game state so remote players never see hidden hands or deck contents', () => {
    const state = createInitialGameState(
      [
        { id: 'host', name: 'Host', type: 'human' },
        { id: 'guest', name: 'Guest', type: 'human' },
      ],
      DEFAULT_SETTINGS,
      deterministicRng(3),
    );

    const guestView = sanitizeGameStateForPlayer(state, 'guest');
    expect(guestView.myPlayerId).toBe('guest');
    expect(guestView.myHand).toEqual(state.players[1].hand);
    expect(guestView.deckCount).toBe(state.deck.length);
    expect('deck' in guestView).toBe(false);
    expect('hand' in guestView.players[0]).toBe(false);
    expect(guestView.players[0].cardCount).toBe(6);
    expect(guestView.revealedHands).toBeUndefined();

    // Even if revealAllForSpectator=true is requested on a game with humans, hands stay hidden!
    const blockedReveal = sanitizeGameStateForPlayer(state, 'spectator', true);
    expect(blockedReveal.revealedHands).toBeUndefined();

    // In a pure AI-only game, a spectator can view all bot hands
    const botState = createInitialGameState(
      [
        { id: 'b1', name: 'Bot 1', type: 'bot' },
        { id: 'b2', name: 'Bot 2', type: 'bot' },
      ],
      DEFAULT_SETTINGS,
      deterministicRng(4),
    );
    const specView = sanitizeGameStateForPlayer(botState, 'host-spectator', true);
    expect(specView.revealedHands?.b1).toEqual(botState.players[0].hand);
    expect(specView.revealedHands?.b2).toEqual(botState.players[1].hand);
  });

  it('supports 24-card, 36-card, and 52-card decks including 4-player full-deal 24-card deck', () => {
    const fourSeeds: PlayerSeed[] = [
      { id: 'p1', name: 'P1', type: 'bot' },
      { id: 'p2', name: 'P2', type: 'bot' },
      { id: 'p3', name: 'P3', type: 'bot' },
      { id: 'p4', name: 'P4', type: 'bot' },
    ];

    const state24 = createInitialGameState(
      fourSeeds,
      { ...DEFAULT_SETTINGS, maxPlayers: 4, deckSize: 24 },
      deterministicRng(11),
    );
    expect(state24.deck).toHaveLength(0);
    expect(state24.trumpCard).toBeDefined();
    expect(state24.players.every((p) => p.hand.length === 6)).toBe(true);
    expect(state24.players.flatMap((p) => p.hand).every((c) => c.rank >= 9)).toBe(true);

    const state52 = createInitialGameState(
      fourSeeds,
      { ...DEFAULT_SETTINGS, maxPlayers: 4, deckSize: 52 },
      deterministicRng(22),
    );
    expect(state52.deck).toHaveLength(52 - 24);
    const all52 = [...state52.deck, ...state52.players.flatMap((p) => p.hand)];
    expect(all52).toHaveLength(52);
    expect(all52.some((c) => c.rank === 2)).toBe(true);
  });

  it('hard and extreme AI find optimal multi-card non-trump defense matching', () => {
    const base = createInitialGameState(
      [
        { id: 'a', name: 'Attacker', type: 'bot', botDifficulty: 'normal' },
        { id: 'd', name: 'Defender', type: 'bot', botDifficulty: 'hard' },
      ],
      { ...DEFAULT_SETTINGS, maxPlayers: 2 },
      deterministicRng(99),
    );

    // Table has two undefended attacks: 9♠ and 7♠.
    // Defender holds 10♠ (beats both), 8♠ (only beats 7♠), and A♥ (trump).
    // Optimal matching beats 9♠ with 10♠ and 7♠ with 8♠ without burning trump A♥!
    const custom: GameState = {
      ...base,
      subPhase: 'battle',
      trumpSuit: 'hearts',
      attackerIndex: 0,
      defenderIndex: 1,
      defenderStartHandCount: 3,
      table: [
        { attack: makeCard('spades', 9), defense: null },
        { attack: makeCard('spades', 7), defense: null },
      ],
      players: [
        { ...base.players[0], hand: [makeCard('clubs', 6)] },
        {
          ...base.players[1],
          botDifficulty: 'extreme',
          hand: [makeCard('spades', 10), makeCard('spades', 8), makeCard('hearts', 14)],
        },
      ],
    };

    const act1 = pickNextBotAction(custom);
    expect(act1?.type).toBe('defend');
    const r1 = applyGameAction(custom, act1!);
    expect(r1.ok).toBe(true);
    const act2 = pickNextBotAction(r1.state);
    expect(act2?.type).toBe('defend');
    const r2 = applyGameAction(r1.state, act2!);
    expect(r2.ok).toBe(true);

    // Verify A♥ was preserved in defender's hand!
    expect(r2.state.players[1].hand.map((c) => c.id)).toEqual(['hearts-14']);
  });

  it('tracks public card memory (discards and picked-up cards) accurately', () => {
    const base = createInitialGameState(
      [
        { id: 'p1', name: 'A', type: 'human' },
        { id: 'p2', name: 'B', type: 'human' },
      ],
      { ...DEFAULT_SETTINGS, maxPlayers: 2 },
      deterministicRng(5),
    );
    const custom: GameState = {
      ...base,
      trumpSuit: 'hearts',
      attackerIndex: 0,
      defenderIndex: 1,
      defenderStartHandCount: 2,
      deck: [],
      discardedCards: [],
      knownOpponentCards: { p1: [], p2: [] },
      players: [
        { ...base.players[0], hand: [makeCard('spades', 8), makeCard('clubs', 10)] },
        { ...base.players[1], hand: [makeCard('clubs', 6), makeCard('diamonds', 7)] },
      ],
    };

    const r1 = applyGameAction(custom, { type: 'attack', playerId: 'p1', cardId: 'spades-8' });
    const r2 = applyGameAction(r1.state, { type: 'take', playerId: 'p2' });
    const r3 = applyGameAction(r2.state, { type: 'pass_turn', playerId: 'p1' });
    expect(r3.ok).toBe(true);
    // P2 picked up 8♠ -> publicly known to be in P2's hand!
    expect(r3.state.knownOpponentCards.p2.map((c) => c.id)).toContain('spades-8');
  });

  it('Master AI solves 1v1 endgames accurately and dominates Easy AI over a multi-game match', () => {
    let masterWins = 0;
    const totalGames = 6;
    for (let g = 0; g < totalGames; g++) {
      let state = createInitialGameState(
        [
          { id: 'm', name: 'Master Bot', type: 'bot', botDifficulty: 'master' },
          { id: 'e', name: 'Easy Bot', type: 'bot', botDifficulty: 'easy' },
        ],
        { ...DEFAULT_SETTINGS, maxPlayers: 2, deckSize: 24 },
        deterministicRng(500 + g * 17),
      );
      let steps = 0;
      while (state.phase === 'playing' && steps < 400) {
        const action = pickNextBotAction(state);
        expect(action).not.toBeNull();
        const res = applyGameAction(state, action!);
        expect(res.ok).toBe(true);
        state = res.state;
        steps++;
      }
      expect(state.phase).toBe('finished');
      if (state.durakId === 'e') masterWins += 1;
    }
    expect(masterWins).toBeGreaterThanOrEqual(4);
  });

  it('completes full 4-bot games cleanly across AI levels including Master, variants, and deck sizes', () => {
    const configs = [
      { variant: 'classic' as const, deckSize: 24 as const, seed: 101 },
      { variant: 'classic' as const, deckSize: 36 as const, seed: 102 },
      { variant: 'passing' as const, deckSize: 36 as const, seed: 202 },
      { variant: 'classic' as const, deckSize: 52 as const, seed: 303 },
    ];

    for (const cfg of configs) {
      let state = createInitialGameState(
        [
          { id: 'b1', name: 'Bot Easy', type: 'bot', botDifficulty: 'easy' },
          { id: 'b2', name: 'Bot Normal', type: 'bot', botDifficulty: 'normal' },
          { id: 'b3', name: 'Bot Extreme', type: 'bot', botDifficulty: 'extreme' },
          { id: 'b4', name: 'Bot Master', type: 'bot', botDifficulty: 'master' },
        ],
        { ...DEFAULT_SETTINGS, maxPlayers: 4, variant: cfg.variant, deckSize: cfg.deckSize },
        deterministicRng(cfg.seed),
      );

      let steps = 0;
      while (state.phase === 'playing' && steps < 900) {
        const action = pickNextBotAction(state);
        expect(action).not.toBeNull();
        const res = applyGameAction(state, action!);
        expect(res.ok).toBe(true);
        state = res.state;
        steps++;
      }

      expect(state.phase).toBe('finished');
      expect(steps).toBeLessThan(900);
      expect(state.isDraw || state.durakId !== null).toBe(true);
    }
  });
});
