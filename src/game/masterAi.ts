import {
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
import { pickHeuristicActionForPlayer } from './ai';
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
  const trumpBonus = deckCount > 6 ? 19 : 15;
  return card.rank + (isTrump ? trumpBonus : 0);
}

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
 * Generates clean, well-ordered candidate actions for Master (and Alpha-Beta).
 */
function getOrderedLegalActions(
  state: GameState,
  playerIndex: number,
  maxActions = 10,
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
      if (card.suit !== state.trumpSuit && pairCount >= 2) prio -= 6;
      if (belief && deckCount === 0 && countLiveBeaters(card, belief, state.trumpSuit) === 0) {
        prio -= 16;
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
          const prio = cardStrength(card, state.trumpSuit, deckCount) - 9;
          actions.push({
            action: { type: 'pass_attack', playerId: player.id, cardId: card.id },
            priority: prio,
          });
        }
      }
    }

    // 2. Defend most constrained undefended attack first to minimize branching
    const targetIdx = [...undefendedIndices].sort((a, b) => {
      const aOpts = player.hand.filter((c) => canBeat(state.table[a].attack, c, state.trumpSuit)).length;
      const bOpts = player.hand.filter((c) => canBeat(state.table[b].attack, c, state.trumpSuit)).length;
      if (aOpts !== bOpts) return aOpts - bOpts;
      return (
        cardStrength(state.table[b].attack, state.trumpSuit, deckCount) -
        cardStrength(state.table[a].attack, state.trumpSuit, deckCount)
      );
    })[0];
    const attackCard = state.table[targetIdx].attack;
    const tableRanks = getTableRanks(state);

    for (const card of player.hand) {
      if (canBeat(attackCard, card, state.trumpSuit)) {
        let prio = cardStrength(card, state.trumpSuit, deckCount);
        if (card.suit === state.trumpSuit && attackCard.suit !== state.trumpSuit) {
          prio += 9;
        }
        if (tableRanks.has(card.rank)) {
          prio -= 5;
        } else if (belief) {
          prio += (belief.liveRankCounts.get(card.rank) ?? 0) * 1.5;
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

    // 3. Always include Take as a candidate (PIMC full-game rollouts will evaluate if Take truly wins!)
    if (canDefenderTake(state, playerIndex)) {
      actions.push({
        action: { type: 'take', playerId: player.id },
        priority: 38,
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
          prio += 14;
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
      priority: state.subPhase === 'taking' ? 20 : 22,
    });
  }

  actions.sort((a, b) => a.priority - b.priority);
  return actions.slice(0, maxActions).map((a) => a.action);
}

/**
 * Evaluates a finished (or near-finished) game outcome from Master's perspective.
 * Heavily prioritizes NOT being the Durak, with strong secondary reward for finishing 1st!
 */
function scoreGameOutcome(state: GameState, masterId: string): number {
  const master = state.players.find((p) => p.id === masterId);
  if (!master) return 0;

  if (state.phase === 'finished') {
    if (state.isDraw) return 15;
    if (state.durakId === masterId) return -140;
    // Escaped! Bonus for earlier finish order (1st > 2nd > 3rd)
    const order = master.finishOrder ?? 2;
    return 100 + Math.max(0, 4 - order) * 14;
  }

  // Master already escaped mid-game in 3-4 player match!
  if (master.isOut) {
    const order = master.finishOrder ?? 1;
    return 100 + Math.max(0, 4 - order) * 14;
  }

  // Fallback leaf heuristic if a rare rollout hits the step cap
  const deckCount = state.deck.length;
  const activeOpps = state.players.filter((p) => p.id !== masterId && !p.isOut);
  const avgOpp =
    activeOpps.reduce((sum, p) => sum + p.hand.length, 0) / Math.max(1, activeOpps.length);
  const myTrumps = master.hand.filter((c) => c.suit === state.trumpSuit).length;
  return (avgOpp - master.hand.length) * (deckCount === 0 ? 18 : 9) + myTrumps * 8;
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
 * Uses ONLY the opponent hand deduced via fair public card counting!
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

  const deducedOppHand = [...(belief.knownByPlayer[opp.id] ?? []), ...belief.unseenPool];
  if (deducedOppHand.length !== opp.hand.length) {
    return null;
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
  const NODE_LIMIT = 10_000;
  const MAX_DEPTH = 14;

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
      return scoreGameOutcome(sim, masterId) * 10;
    }

    const key = stateHash(sim);
    const cached = tt.get(key);
    if (cached && cached.depth >= depth) {
      return cached.score;
    }

    const actorIdx = getActiveActorIndex(sim);
    if (actorIdx === null) {
      return scoreGameOutcome(sim, masterId) * 10;
    }

    const isMax = actorIdx === masterIndex;
    const moves = getOrderedLegalActions(sim, actorIdx, 8, isMax ? belief : undefined);
    if (moves.length === 0) {
      return scoreGameOutcome(sim, masterId) * 10;
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

    if (tt.size < 6000) {
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
 * Full-Game Perfect-Information Monte Carlo (PIMC) search!
 * Samples consistent worlds from Master's fair belief state, plays each candidate
 * move ALL THE WAY TO GAME OVER using the strong Extreme policy, and picks the
 * move with the highest actual win/escape rate!
 */
function searchFullGamePimc(
  state: GameState,
  masterIndex: number,
  belief: MasterBelief,
): GameAction | null {
  const candidates = getOrderedLegalActions(state, masterIndex, 7, belief);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const masterId = state.players[masterIndex].id;
  const rng = seededRng(
    (state.version * 73856093) ^ (state.boutNumber * 19349663) ^ (state.table.length * 83492791),
  );

  // Adaptive world count: more worlds when few candidates or in critical late-game!
  const worldCount =
    candidates.length <= 3
      ? 28
      : state.deck.length <= 8
        ? 22
        : 16;

  const worlds: GameState[] = [];
  for (let w = 0; w < worldCount; w++) {
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
      let plies = 0;
      // Roll out all the way to game completion (or until Master escapes!)
      while (sim.phase === 'playing' && plies < 140) {
        const mPlayer = sim.players[masterIndex];
        if (mPlayer?.isOut) break; // Master already escaped!
        const actorIdx = getActiveActorIndex(sim);
        if (actorIdx === null) break;
        const nextAction = pickHeuristicActionForPlayer(sim, actorIdx, 'extreme');
        if (!nextAction) break;
        const nextRes = applyGameAction(sim, nextAction);
        if (!nextRes.ok) break;
        sim = nextRes.state;
        plies += 1;
      }

      totalScore += scoreGameOutcome(sim, masterId);
    }

    if (validCount === 0) continue;
    let avgScore = totalScore / validCount;

    // Subtle card-counting tie-breaker when rollout win rates are close
    if (candidate.type === 'defend') {
      const card = state.players[masterIndex].hand.find((c) => c.id === candidate.cardId);
      if (card) {
        const liveCopies = belief.liveRankCounts.get(card.rank) ?? 0;
        if (liveCopies === 0) avgScore += 2.5;
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

  // 2. Otherwise run Full-Game PIMC (Monte Carlo Determinization to Game Over)!
  return searchFullGamePimc(state, playerIndex, belief);
}
