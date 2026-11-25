import {
  allAttacksDefended,
  applyGameAction,
  canBeat,
  canDefenderTake,
  canPassAttackCard,
  canPlayAttackCard,
  canPlayerPassTurn,
  createDeck,
  getEligibleAttackerIndices,
  getMaxTableAttacks,
  getTableRanks,
} from './engine';
import { Card, GameAction, GameState, PlayerState, Suit } from './types';

function seededRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface MasterBelief {
  masterId: string;
  masterIndex: number;
  liveExternalCards: Card[];
  unseenPool: Card[];
  knownByPlayer: Record<string, Card[]>;
  liveRankCounts: Map<number, number>;
  liveTrumpsCount: number;
}

/**
 * Builds a strictly fair belief state using ONLY publicly observable info:
 * - Master's own hand
 * - Cards on the table
 * - Cards visibly discarded on past bouts (state.discardedCards)
 * - Cards visibly picked up by opponents on Take or drawn as last face-up trump (state.knownOpponentCards)
 * - The face-up bottom trump card when deck.length > 0
 * Never inspects state.deck or opponents' private hands.
 */
function buildMasterBelief(state: GameState, masterIndex: number): MasterBelief {
  const master = state.players[masterIndex];
  const fullDeck = createDeck(state.settings.deckSize ?? 36);

  const accountedIds = new Set<string>();
  for (const c of master.hand) accountedIds.add(c.id);
  for (const p of state.table) {
    accountedIds.add(p.attack.id);
    if (p.defense) accountedIds.add(p.defense.id);
  }
  for (const c of state.discardedCards ?? []) {
    accountedIds.add(c.id);
  }

  const knownByPlayer: Record<string, Card[]> = {};
  for (const p of state.players) {
    if (p.id === master.id || p.isOut) {
      knownByPlayer[p.id] = [];
      continue;
    }
    const rawKnown = state.knownOpponentCards?.[p.id] ?? [];
    const validKnown: Card[] = [];
    for (const c of rawKnown) {
      if (!accountedIds.has(c.id) && validKnown.length < p.hand.length) {
        validKnown.push(c);
        accountedIds.add(c.id);
      }
    }
    knownByPlayer[p.id] = validKnown;
  }

  // If the talon still has cards, the bottom trump card is publicly visible in the deck
  const trumpInDeck = state.deck.length > 0 && !accountedIds.has(state.trumpCard.id);
  if (trumpInDeck) {
    accountedIds.add(state.trumpCard.id);
  }

  const unseenPool = fullDeck.filter((c) => !accountedIds.has(c.id));
  const liveExternalCards: Card[] = [
    ...unseenPool,
    ...(trumpInDeck ? [state.trumpCard] : []),
    ...Object.values(knownByPlayer).flat(),
  ];

  const liveRankCounts = new Map<number, number>();
  let liveTrumpsCount = 0;
  for (const c of liveExternalCards) {
    liveRankCounts.set(c.rank, (liveRankCounts.get(c.rank) ?? 0) + 1);
    if (c.suit === state.trumpSuit) liveTrumpsCount += 1;
  }

  return {
    masterId: master.id,
    masterIndex,
    liveExternalCards,
    unseenPool,
    knownByPlayer,
    liveRankCounts,
    liveTrumpsCount,
  };
}

function countLiveBeaters(card: Card, belief: MasterBelief, trumpSuit: Suit): number {
  let count = 0;
  for (const ext of belief.liveExternalCards) {
    if (canBeat(card, ext, trumpSuit)) count += 1;
  }
  return count;
}

function cardStrength(card: Card, trumpSuit: Suit, deckCount: number): number {
  const isTrump = card.suit === trumpSuit;
  const trumpBonus = deckCount > 6 ? 18 : 15;
  return card.rank + (isTrump ? trumpBonus : 0);
}

/**
 * Finds who is the next actor in any GameState (used by Minimax and rollouts).
 */
function getActiveActorIndex(state: GameState): number | null {
  if (state.phase !== 'playing') return null;

  if (state.subPhase === 'initial_attack') {
    const a = state.players[state.attackerIndex];
    return a && !a.isOut && a.hand.length > 0 ? state.attackerIndex : null;
  }

  const hasUndefended = state.table.some((p) => p.defense === null);
  if (state.subPhase === 'battle' && hasUndefended) {
    const d = state.players[state.defenderIndex];
    if (d && !d.isOut) return state.defenderIndex;
  }

  const eligible = getEligibleAttackerIndices(state);
  const ordered = [
    ...eligible.filter((i) => i === state.attackerIndex),
    ...eligible.filter((i) => i !== state.attackerIndex),
  ];
  for (const idx of ordered) {
    const p = state.players[idx];
    if (!p.isOut && p.hand.length > 0 && !state.passedPlayerIds.includes(p.id)) {
      return idx;
    }
  }
  return null;
}

/**
 * Generates clean, well-ordered legal actions for a given player in a state.
 */
function getOrderedLegalActions(
  state: GameState,
  playerIndex: number,
  maxActions = 12,
  belief?: MasterBelief,
): GameAction[] {
  const player = state.players[playerIndex];
  if (!player || player.isOut) return [];
  const deckCount = state.deck.length;
  const actions: { action: GameAction; priority: number }[] = [];

  if (state.subPhase === 'initial_attack') {
    if (playerIndex !== state.attackerIndex) return [];
    const rankCounts = new Map<number, number>();
    for (const c of player.hand) {
      if (c.suit !== state.trumpSuit) {
        rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
      }
    }

    for (const card of player.hand) {
      let prio = cardStrength(card, state.trumpSuit, deckCount);
      const pairCount = rankCounts.get(card.rank) ?? 0;
      if (card.suit !== state.trumpSuit && pairCount >= 2) prio -= 5.5;
      if (belief && deckCount === 0 && countLiveBeaters(card, belief, state.trumpSuit) === 0) {
        prio -= 14;
      }
      actions.push({
        action: { type: 'attack', playerId: player.id, cardId: card.id },
        priority: prio,
      });
    }
    actions.sort((a, b) => a.priority - b.priority);
    return actions.slice(0, maxActions).map((a) => a.action);
  }

  if (state.subPhase === 'battle' && playerIndex === state.defenderIndex) {
    const undefendedIndices: number[] = [];
    state.table.forEach((p, idx) => {
      if (!p.defense) undefendedIndices.push(idx);
    });
    if (undefendedIndices.length === 0) return [];

    // 1. Passing mode options
    if (state.settings.variant === 'passing') {
      for (const card of player.hand) {
        if (
          canPassAttackCard(
            state,
            playerIndex,
            card,
            (idx) => state.players[idx].hand.length,
          )
        ) {
          const prio = cardStrength(card, state.trumpSuit, deckCount) - 8;
          actions.push({
            action: { type: 'pass_attack', playerId: player.id, cardId: card.id },
            priority: prio,
          });
        }
      }
    }

    // 2. Defend the hardest undefended attack first to cut branching factor cleanly
    const targetIdx = [...undefendedIndices].sort(
      (a, b) =>
        cardStrength(state.table[b].attack, state.trumpSuit, deckCount) -
        cardStrength(state.table[a].attack, state.trumpSuit, deckCount),
    )[0];
    const attackCard = state.table[targetIdx].attack;
    const tableRanks = getTableRanks(state);

    for (const card of player.hand) {
      if (canBeat(attackCard, card, state.trumpSuit)) {
        let prio = cardStrength(card, state.trumpSuit, deckCount);
        if (card.suit === state.trumpSuit && attackCard.suit !== state.trumpSuit) {
          prio += 8;
        }
        if (tableRanks.has(card.rank)) {
          prio -= 4;
        } else if (belief) {
          prio += (belief.liveRankCounts.get(card.rank) ?? 0) * 1.4;
        }
        actions.push({
          action: {
            type: 'defend',
            playerId: player.id,
            cardId: card.id,
            targetIndex: targetIdx,
          },
          priority: prio,
        });
      }
    }

    // 3. Take option (always considered as a strategic choice!)
    if (canDefenderTake(state, playerIndex)) {
      actions.push({
        action: { type: 'take', playerId: player.id },
        priority: 36,
      });
    }

    actions.sort((a, b) => a.priority - b.priority);
    return actions.slice(0, maxActions).map((a) => a.action);
  }

  // Attacker throw-in or pass
  const maxAttacks = getMaxTableAttacks(state);
  if (state.table.length < maxAttacks) {
    for (const card of player.hand) {
      if (canPlayAttackCard(state, playerIndex, card)) {
        let prio = cardStrength(card, state.trumpSuit, deckCount);
        if (card.suit === state.trumpSuit && deckCount > 0) {
          prio += 12;
        }
        actions.push({
          action: { type: 'attack', playerId: player.id, cardId: card.id },
          priority: prio,
        });
      }
    }
  }

  if (canPlayerPassTurn(state, playerIndex, player.hand.length)) {
    actions.push({
      action: { type: 'pass_turn', playerId: player.id },
      priority: state.subPhase === 'taking' ? 22 : 24,
    });
  }

  actions.sort((a, b) => a.priority - b.priority);
  return actions.slice(0, maxActions).map((a) => a.action);
}

/**
 * Evaluates a position from Master's perspective.
 * Combines game outcome, hand count, trump quality, pair synergy,
 * initiative, and last-card / bottom-trump control.
 */
function evaluateMasterPosition(
  state: GameState,
  masterId: string,
  belief?: MasterBelief,
): number {
  const masterIdx = state.players.findIndex((p) => p.id === masterId);
  if (masterIdx === -1) return 0;
  const master = state.players[masterIdx];

  if (state.phase === 'finished') {
    if (state.isDraw) return 0;
    if (state.durakId === masterId) return -10_000;
    return 10_000;
  }

  // Already escaped in 3-4 player game!
  if (master.isOut) return 9_500;

  const deckCount = state.deck.length;
  const activeOpponents = state.players.filter((p) => p.id !== masterId && !p.isOut);
  const avgOppCards =
    activeOpponents.reduce((sum, p) => sum + p.hand.length, 0) /
    Math.max(1, activeOpponents.length);
  const minOppCards = Math.min(...activeOpponents.map((p) => p.hand.length));

  let score = 0;

  // 1. Hand size advantage (decisive in endgame, nuanced in early/mid game)
  if (deckCount === 0) {
    score += (avgOppCards - master.hand.length) * 34;
    if (minOppCards === 1) score -= 45;
    if (master.hand.length === 1) score += 40;
  } else {
    // Early/midgame: holding >6 cards is costly, holding extra cards right before deck empties is bad
    const excessMaster = Math.max(0, master.hand.length - 6);
    const excessOpp = Math.max(0, avgOppCards - 6);
    score += (excessOpp - excessMaster) * 14;
    if (deckCount <= 6) {
      // Transitioning to endgame: card count starts mattering strongly
      score += (avgOppCards - master.hand.length) * 12;
    }
  }

  // 2. Card quality in Master's hand (trumps, unbeatable cards, pair synergy, deadweight)
  const rankCounts = new Map<number, number>();
  let trumpCount = 0;
  for (const c of master.hand) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    const isTrump = c.suit === state.trumpSuit;
    if (isTrump) {
      trumpCount += 1;
      // High trumps are huge assets throughout the game
      score += 14 + (c.rank - 6) * 2.2;
      if (belief && countLiveBeaters(c, belief, state.trumpSuit) === 0) {
        score += 12; // Unbeatable trump!
      }
    } else {
      // In endgame, high non-trumps are strong; low singletons are liabilities
      if (deckCount === 0) {
        score += (c.rank - 9) * 1.4;
      } else {
        score += (c.rank - 8) * 1.1;
      }
    }
  }

  // Bonus for holding pairs/triples (huge attacking & passing leverage)
  for (const [, count] of rankCounts) {
    if (count >= 2) score += count * 4.5;
  }

  // Having zero trumps in endgame is dangerous unless hand is tiny
  if (deckCount <= 4 && trumpCount === 0 && master.hand.length >= 3) {
    score -= 18;
  }

  // 3. Initiative & Bout state
  if (state.attackerIndex === masterIdx) {
    score += deckCount === 0 ? 18 : 7;
  } else if (state.defenderIndex === masterIdx) {
    score -= deckCount === 0 ? 12 : 4;
    if (state.subPhase === 'taking') {
      score -= 18;
    }
  } else if (state.subPhase === 'taking') {
    // An opponent is taking cards -> great for us!
    score += 16;
  }

  // 4. Bottom trump card ownership bonus when deck just emptied!
  if (deckCount === 0 && master.hand.some((c) => c.id === state.trumpCard.id)) {
    score += 10;
  }

  return score;
}

function stateHash(state: GameState): string {
  const handsKey = state.players
    .map((p) => (p.isOut ? 'X' : p.hand.map((c) => c.id).sort().join(',')))
    .join('|');
  const tableKey = state.table
    .map((t) => `${t.attack.id}:${t.defense?.id ?? '_'}`)
    .join(',');
  return `${state.subPhase}|${state.attackerIndex}|${state.defenderIndex}|${state.passedPlayerIds.join(',')}|${handsKey}|${tableKey}`;
}

/**
 * Exact Alpha-Beta Minimax solver for 1v1 endgames (deck === 0).
 * Uses ONLY the opponent hand deduced via fair card counting!
 */
function solveEndgame1v1(
  state: GameState,
  masterIndex: number,
  belief: MasterBelief,
): GameAction | null {
  const activeIndices = state.players
    .map((p, idx) => (p.isOut ? -1 : idx))
    .filter((idx) => idx !== -1);
  if (activeIndices.length !== 2 || state.deck.length !== 0) return null;

  const oppIndex = activeIndices.find((idx) => idx !== masterIndex);
  if (oppIndex === undefined) return null;
  const opp = state.players[oppIndex];

  // Reconstruct opponent's hand strictly from public card counting
  const deducedOppHand = [...(belief.knownByPlayer[opp.id] ?? []), ...belief.unseenPool];
  if (deducedOppHand.length !== opp.hand.length) {
    return null; // Safety check if custom test state had non-standard card count
  }

  const perfectState: GameState = {
    ...state,
    players: state.players.map((p, idx) =>
      idx === oppIndex ? { ...p, hand: deducedOppHand } : { ...p, hand: [...p.hand] },
    ),
  };

  const masterId = state.players[masterIndex].id;
  const rootActions = getOrderedLegalActions(perfectState, masterIndex, 10, belief);
  if (rootActions.length === 0) return null;
  if (rootActions.length === 1) return rootActions[0];

  const tt = new Map<string, { depth: number; score: number }>();
  let nodesVisited = 0;
  const NODE_LIMIT = 5_500;
  const MAX_DEPTH = 10;

  const alphabeta = (
    sim: GameState,
    depth: number,
    alpha: number,
    beta: number,
  ): number => {
    nodesVisited += 1;
    if (sim.phase === 'finished') {
      if (sim.isDraw) return 0;
      return sim.durakId === masterId ? -10_000 - depth : 10_000 + depth;
    }
    if (depth <= 0 || nodesVisited >= NODE_LIMIT) {
      return evaluateMasterPosition(sim, masterId, belief);
    }

    const key = stateHash(sim);
    const cached = tt.get(key);
    if (cached && cached.depth >= depth) {
      return cached.score;
    }

    const actorIdx = getActiveActorIndex(sim);
    if (actorIdx === null) {
      return evaluateMasterPosition(sim, masterId, belief);
    }

    const isMax = actorIdx === masterIndex;
    const moves = getOrderedLegalActions(sim, actorIdx, 8, isMax ? belief : undefined);
    if (moves.length === 0) {
      return evaluateMasterPosition(sim, masterId, belief);
    }

    let bestScore = isMax ? -Infinity : Infinity;
    for (const move of moves) {
      const res = applyGameAction(sim, move);
      if (!res.ok) continue;
      const val = alphabeta(res.state, depth - 1, alpha, beta);
      if (isMax) {
        if (val > bestScore) bestScore = val;
        if (bestScore > alpha) alpha = bestScore;
      } else {
        if (val < bestScore) bestScore = val;
        if (bestScore < beta) beta = bestScore;
      }
      if (beta <= alpha || nodesVisited >= NODE_LIMIT) break;
    }

    if (tt.size < 4000) {
      tt.set(key, { depth, score: bestScore });
    }
    return bestScore;
  };

  let bestAction = rootActions[0];
  let bestVal = -Infinity;
  let alpha = -Infinity;

  for (const action of rootActions) {
    const res = applyGameAction(perfectState, action);
    if (!res.ok) continue;
    const val = alphabeta(res.state, MAX_DEPTH - 1, alpha, Infinity);
    if (val > bestVal) {
      bestVal = val;
      bestAction = action;
    }
    if (bestVal > alpha) alpha = bestVal;
    if (nodesVisited >= NODE_LIMIT) break;
  }

  return bestAction;
}

/**
 * Fast tactical rollout policy used inside Monte Carlo simulations.
 */
function pickFastRolloutAction(state: GameState, actorIdx: number): GameAction | null {
  const player = state.players[actorIdx];
  if (!player || player.isOut) return null;
  const deckCount = state.deck.length;

  if (state.subPhase === 'initial_attack') {
    const sorted = [...player.hand].sort(
      (a, b) => cardStrength(a, state.trumpSuit, deckCount) - cardStrength(b, state.trumpSuit, deckCount),
    );
    // Prefer low non-trump pair
    const counts = new Map<number, Card[]>();
    for (const c of sorted) {
      if (c.suit !== state.trumpSuit && c.rank <= 12) {
        const arr = counts.get(c.rank) ?? [];
        arr.push(c);
        counts.set(c.rank, arr);
      }
    }
    for (const [, arr] of counts) {
      if (arr.length >= 2) {
        return { type: 'attack', playerId: player.id, cardId: arr[0].id };
      }
    }
    return sorted[0] ? { type: 'attack', playerId: player.id, cardId: sorted[0].id } : null;
  }

  if (state.subPhase === 'battle' && actorIdx === state.defenderIndex) {
    // Pass if possible with non-trump or low trump
    if (state.settings.variant === 'passing') {
      const passCard = player.hand
        .filter((c) =>
          canPassAttackCard(state, actorIdx, c, (idx) => state.players[idx].hand.length),
        )
        .sort((a, b) => cardStrength(a, state.trumpSuit, deckCount) - cardStrength(b, state.trumpSuit, deckCount))[0];
      if (passCard && (passCard.suit !== state.trumpSuit || passCard.rank <= 10 || deckCount === 0)) {
        return { type: 'pass_attack', playerId: player.id, cardId: passCard.id };
      }
    }

    const undefIdx = state.table.findIndex((p) => p.defense === null);
    if (undefIdx === -1) return null;
    const attackCard = state.table[undefIdx].attack;
    const options = player.hand
      .filter((c) => canBeat(attackCard, c, state.trumpSuit))
      .sort((a, b) => cardStrength(a, state.trumpSuit, deckCount) - cardStrength(b, state.trumpSuit, deckCount));

    if (options.length === 0) {
      return { type: 'take', playerId: player.id };
    }
    const nonTrump = options.find((c) => c.suit !== state.trumpSuit);
    const chosen = nonTrump ?? options[0];

    // Take early if forced to burn Q+ trump while deck is rich
    if (
      deckCount > 6 &&
      chosen.suit === state.trumpSuit &&
      chosen.rank >= 12 &&
      attackCard.suit !== state.trumpSuit &&
      state.table.length <= 2 &&
      player.hand.length <= 7
    ) {
      return { type: 'take', playerId: player.id };
    }

    return {
      type: 'defend',
      playerId: player.id,
      cardId: chosen.id,
      targetIndex: undefIdx,
    };
  }

  // Throw-in or pass
  const maxAttacks = getMaxTableAttacks(state);
  if (state.table.length < maxAttacks) {
    const playable = player.hand
      .filter((c) => canPlayAttackCard(state, actorIdx, c))
      .sort((a, b) => cardStrength(a, state.trumpSuit, deckCount) - cardStrength(b, state.trumpSuit, deckCount));
    if (playable.length > 0) {
      const best = playable[0];
      const isTrump = best.suit === state.trumpSuit;
      const shouldThrow =
        state.subPhase === 'taking'
          ? !isTrump
            ? best.rank <= 13 || deckCount <= 4
            : player.hand.length === 1 && deckCount === 0
          : !isTrump
            ? best.rank <= 13 || deckCount <= 6
            : deckCount === 0 && best.rank <= 11;
      if (shouldThrow && (allAttacksDefended(state) || state.subPhase === 'taking' || actorIdx === state.attackerIndex)) {
        return { type: 'attack', playerId: player.id, cardId: best.id };
      }
    }
  }

  if (canPlayerPassTurn(state, actorIdx, player.hand.length)) {
    return { type: 'pass_turn', playerId: player.id };
  }
  return null;
}

/**
 * Samples a single consistent world (determinization) from Master's public belief state.
 */
function sampleConsistentWorld(
  state: GameState,
  belief: MasterBelief,
  rng: () => number,
): GameState {
  const pool = shuffleInPlace([...belief.unseenPool], rng);
  let cursor = 0;

  const players: PlayerState[] = state.players.map((p, idx) => {
    if (idx === belief.masterIndex || p.isOut) {
      return { ...p, hand: [...p.hand] };
    }
    const known = [...(belief.knownByPlayer[p.id] ?? [])];
    const needed = Math.max(0, p.hand.length - known.length);
    const sampled = pool.slice(cursor, cursor + needed);
    cursor += sampled.length;
    return { ...p, hand: [...known, ...sampled] };
  });

  // Remaining unseen cards go into the deck, with the visible trumpCard at the bottom!
  const deck: Card[] = [];
  if (state.deck.length > 0) {
    const unknownDeckCount = Math.max(0, state.deck.length - 1);
    const topCards = pool.slice(cursor, cursor + unknownDeckCount);
    deck.push(...topCards, state.trumpCard);
  }

  return {
    ...state,
    deck,
    players,
  };
}

/**
 * Determinized Monte Carlo search for mid-game and 3-4 player tables.
 */
function searchMidgameDeterminized(
  state: GameState,
  masterIndex: number,
  belief: MasterBelief,
): GameAction | null {
  const candidates = getOrderedLegalActions(state, masterIndex, 9, belief);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const masterId = state.players[masterIndex].id;
  const rng = seededRng(
    (state.version * 73856093) ^ (state.boutNumber * 19349663) ^ (state.table.length * 83492791),
  );

  // Use 16 sampled worlds with up to 14-ply rollouts (fast: ~8-18ms total)
  const WORLD_COUNT = 16;
  const MAX_PLIES = 14;
  const worlds: GameState[] = [];
  for (let w = 0; w < WORLD_COUNT; w++) {
    worlds.push(sampleConsistentWorld(state, belief, rng));
  }

  let bestAction = candidates[0];
  let bestAvgScore = -Infinity;

  for (const candidate of candidates) {
    let totalScore = 0;
    let validCount = 0;

    for (const world of worlds) {
      const firstStep = applyGameAction(world, candidate);
      if (!firstStep.ok) continue;
      validCount += 1;

      let sim = firstStep.state;
      const startBout = world.boutNumber;

      for (let ply = 0; ply < MAX_PLIES; ply++) {
        if (sim.phase === 'finished') break;
        // Simulate through current bout and 1 full subsequent bout for tempo & draw evaluation
        if (sim.boutNumber >= startBout + 2) break;
        const actorIdx = getActiveActorIndex(sim);
        if (actorIdx === null) break;
        const nextAction = pickFastRolloutAction(sim, actorIdx);
        if (!nextAction) break;
        const nextRes = applyGameAction(sim, nextAction);
        if (!nextRes.ok) break;
        sim = nextRes.state;
      }

      totalScore += evaluateMasterPosition(sim, masterId, belief);
    }

    if (validCount === 0) continue;
    let avgScore = totalScore / validCount;

    // Gentle card-counting tie-breaker for defending with rank-safe cards
    if (candidate.type === 'defend') {
      const card = state.players[masterIndex].hand.find((c) => c.id === candidate.cardId);
      if (card) {
        const liveCopies = belief.liveRankCounts.get(card.rank) ?? 0;
        if (liveCopies === 0) avgScore += 4;
      }
    }

    if (avgScore > bestAvgScore) {
      bestAvgScore = avgScore;
      bestAction = candidate;
    }
  }

  return bestAction;
}

/**
 * Main entry point for Master AI level.
 */
export function pickMasterAction(state: GameState, playerIndex: number): GameAction | null {
  const belief = buildMasterBelief(state, playerIndex);

  // 1. In 1v1 endgame (deck empty), run Exact Alpha-Beta Minimax Solver!
  const activeCount = state.players.filter((p) => !p.isOut).length;
  if (state.deck.length === 0 && activeCount === 2) {
    const solved = solveEndgame1v1(state, playerIndex, belief);
    if (solved) return solved;
  }

  // 2. Otherwise run Determinized Monte Carlo Rollout Search!
  return searchMidgameDeterminized(state, playerIndex, belief);
}
