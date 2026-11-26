import {
  allAttacksDefended,
  canBeat,
  canDefenderTake,
  canPassAttackCard,
  canPlayAttackCard,
  canPlayerPassTurn,
  getEligibleAttackerIndices,
  getMaxTableAttacks,
  getNextActivePlayerIndex,
  getTableRanks,
} from './engine';
import { pickMasterAction } from './masterAi';
import { BotDifficulty, Card, GameAction, GameState, Suit } from './types';

function cardValue(card: Card, trumpSuit: Suit, deckCount: number): number {
  const isTrump = card.suit === trumpSuit;
  const trumpBonus = deckCount > 6 ? 19 : 15;
  return card.rank + (isTrump ? trumpBonus : 0);
}

interface DefenseAssignment {
  moves: { targetIndex: number; card: Card }[];
  totalCost: number;
}

/**
 * Exact minimum-cost bipartite matching for defending all undefended attacks.
 * Used by Hard, Extreme, and Master rollouts so they never fail a defendable board
 * due to greedy ordering, and prefer cards that don't expose new throw-in ranks.
 */
export function findOptimalDefensePlan(
  state: GameState,
  hand: Card[],
  undefendedIndices: number[],
  difficulty: 'hard' | 'extreme',
): DefenseAssignment | null {
  const deckCount = state.deck.length;
  const tableRanks = getTableRanks(state);
  const handRankCounts = new Map<number, number>();
  for (const c of hand) {
    handRankCounts.set(c.rank, (handRankCounts.get(c.rank) ?? 0) + 1);
  }

  // On Extreme, also account for publicly discarded cards when estimating throw-in exposure
  const discardedRankCounts = new Map<number, number>();
  if (difficulty === 'extreme') {
    for (const c of state.discardedCards ?? []) {
      discardedRankCounts.set(c.rank, (discardedRankCounts.get(c.rank) ?? 0) + 1);
    }
  }

  // Order most constrained attacks first for fast pruning
  const orderedTargets = [...undefendedIndices].sort((a, b) => {
    const aOpts = hand.filter((c) => canBeat(state.table[a].attack, c, state.trumpSuit)).length;
    const bOpts = hand.filter((c) => canBeat(state.table[b].attack, c, state.trumpSuit)).length;
    return aOpts - bOpts;
  });

  const optionsByTarget = orderedTargets.map((targetIdx) => {
    const attackCard = state.table[targetIdx].attack;
    return hand
      .filter((c) => canBeat(attackCard, c, state.trumpSuit))
      .map((card) => {
        let cost = cardValue(card, state.trumpSuit, deckCount);
        const isTrump = card.suit === state.trumpSuit;

        // Strongly prefer matching suit over spending a trump
        if (isTrump && attackCard.suit !== state.trumpSuit) {
          cost += deckCount > 0 ? 11 : 6;
        }

        // Prefer defending with a rank already on the table (zero new throw-in exposure!)
        if (tableRanks.has(card.rank)) {
          cost -= difficulty === 'extreme' ? 5.5 : 3.5;
        } else if (difficulty === 'extreme') {
          const myCopies = handRankCounts.get(card.rank) ?? 1;
          const deadCopies = discardedRankCounts.get(card.rank) ?? 0;
          const unseenCopies = Math.max(0, 4 - myCopies - deadCopies);
          cost += unseenCopies * (deckCount > 0 ? 1.4 : 1.8);
        }

        // Preserve pairs in our own hand when possible on Extreme
        if (difficulty === 'extreme' && !isTrump && (handRankCounts.get(card.rank) ?? 0) >= 2) {
          cost += 1.6;
        }

        return { card, cost };
      })
      .sort((a, b) => a.cost - b.cost);
  });

  if (optionsByTarget.some((opts) => opts.length === 0)) {
    return null;
  }

  let best: DefenseAssignment | null = null;
  const used = new Set<string>();
  const currentMoves: { targetIndex: number; card: Card }[] = [];

  const dfs = (depth: number, costSoFar: number) => {
    if (best && costSoFar >= best.totalCost) return;
    if (depth === orderedTargets.length) {
      best = { moves: [...currentMoves], totalCost: costSoFar };
      return;
    }

    const targetIndex = orderedTargets[depth];
    const opts = optionsByTarget[depth];
    for (let i = 0; i < opts.length; i++) {
      const { card, cost } = opts[i];
      if (used.has(card.id)) continue;
      used.add(card.id);
      currentMoves.push({ targetIndex, card });
      dfs(depth + 1, costSoFar + cost);
      currentMoves.pop();
      used.delete(card.id);
    }
  };

  dfs(0, 0);
  return best;
}

function greedyDefensePlan(
  state: GameState,
  hand: Card[],
  undefendedIndices: number[],
  difficulty: 'easy' | 'normal',
): { targetIndex: number; card: Card }[] | null {
  const deckCount = state.deck.length;
  const attacksSorted = [...undefendedIndices].sort(
    (a, b) =>
      cardValue(state.table[b].attack, state.trumpSuit, deckCount) -
      cardValue(state.table[a].attack, state.trumpSuit, deckCount),
  );

  const usedIds = new Set<string>();
  const planned: { targetIndex: number; card: Card }[] = [];

  for (const targetIdx of attacksSorted) {
    const attackCard = state.table[targetIdx].attack;
    const options = hand
      .filter((c) => !usedIds.has(c.id) && canBeat(attackCard, c, state.trumpSuit))
      .sort(
        (a, b) =>
          cardValue(a, state.trumpSuit, deckCount) -
          cardValue(b, state.trumpSuit, deckCount),
      );

    if (options.length === 0) return null;

    let chosen: Card;
    if (difficulty === 'easy' && options.length > 1) {
      const pickIdx = (state.boutNumber + targetIdx + hand.length) % Math.min(3, options.length);
      chosen = options[pickIdx];
    } else {
      const nonTrump = options.find((c) => c.suit !== state.trumpSuit);
      chosen = nonTrump ?? options[0];
    }
    usedIds.add(chosen.id);
    planned.push({ targetIndex: targetIdx, card: chosen });
  }

  return planned;
}

/**
 * Fast heuristic bot policy for any non-Master difficulty (also used by Master rollouts).
 */
export function pickHeuristicActionForPlayer(
  state: GameState,
  playerIndex: number,
  difficulty: Exclude<BotDifficulty, 'master'>,
): GameAction | null {
  if (state.phase !== 'playing') return null;
  const player = state.players[playerIndex];
  if (!player || player.isOut) return null;

  if (state.subPhase === 'initial_attack') {
    if (playerIndex !== state.attackerIndex || player.hand.length === 0) return null;
    return chooseOpeningAttack(state, playerIndex, difficulty);
  }

  const undefendedIndices: number[] = [];
  state.table.forEach((pair, idx) => {
    if (!pair.defense) undefendedIndices.push(idx);
  });

  if (state.subPhase === 'battle' && playerIndex === state.defenderIndex && undefendedIndices.length > 0) {
    return chooseDefenseAction(state, playerIndex, undefendedIndices, difficulty);
  }

  if (playerIndex !== state.defenderIndex && player.hand.length > 0 && !state.passedPlayerIds.includes(player.id)) {
    return chooseThrowInOrPass(state, playerIndex, difficulty);
  }

  return null;
}

/**
 * Finds the next bot that needs to take an action right now, if any.
 */
export function pickNextBotAction(state: GameState): GameAction | null {
  if (state.phase !== 'playing') return null;

  // 1. Initial attack
  if (state.subPhase === 'initial_attack') {
    const attacker = state.players[state.attackerIndex];
    if (attacker.type !== 'bot' || attacker.isOut || attacker.hand.length === 0) {
      return null;
    }
    const diff = attacker.botDifficulty ?? state.settings.botDifficulty;
    if (diff === 'master') {
      return pickMasterAction(state, state.attackerIndex);
    }
    return chooseOpeningAttack(state, state.attackerIndex, diff);
  }

  // 2. Defender needs to respond to undefended cards
  const undefendedIndices: number[] = [];
  state.table.forEach((pair, idx) => {
    if (!pair.defense) undefendedIndices.push(idx);
  });

  if (state.subPhase === 'battle' && undefendedIndices.length > 0) {
    const defender = state.players[state.defenderIndex];
    if (defender.type === 'bot' && !defender.isOut) {
      const diff = defender.botDifficulty ?? state.settings.botDifficulty;
      if (diff === 'master') {
        return pickMasterAction(state, state.defenderIndex);
      }
      return chooseDefenseAction(state, state.defenderIndex, undefendedIndices, diff);
    }
  }

  // 3. Eligible attackers (throw in or pass)
  const eligible = getEligibleAttackerIndices(state);
  const orderedEligible = [
    ...eligible.filter((i) => i === state.attackerIndex),
    ...eligible.filter((i) => i !== state.attackerIndex),
  ];

  for (const idx of orderedEligible) {
    const player = state.players[idx];
    if (player.type !== 'bot' || player.isOut || player.hand.length === 0) {
      continue;
    }
    if (state.passedPlayerIds.includes(player.id)) {
      continue;
    }

    const diff = player.botDifficulty ?? state.settings.botDifficulty;
    if (diff === 'master') {
      const masterAction = pickMasterAction(state, idx);
      if (masterAction) return masterAction;
      continue;
    }
    const action = chooseThrowInOrPass(state, idx, diff);
    if (action) return action;
  }

  return null;
}

function chooseOpeningAttack(
  state: GameState,
  playerIndex: number,
  difficulty: Exclude<BotDifficulty, 'master'>,
): GameAction {
  const player = state.players[playerIndex];
  const deckCount = state.deck.length;
  const defender = state.players[state.defenderIndex];

  const sorted = [...player.hand].sort(
    (a, b) => cardValue(a, state.trumpSuit, deckCount) - cardValue(b, state.trumpSuit, deckCount),
  );

  // Easy: relaxed, sometimes leads awkward cards or wastes higher ranks
  if (difficulty === 'easy') {
    const nonTrumps = sorted.filter((c) => c.suit !== state.trumpSuit);
    const pool = nonTrumps.length > 0 ? nonTrumps : sorted;
    const idx = (state.boutNumber + player.hand.length) % Math.min(3, pool.length);
    return { type: 'attack', playerId: player.id, cardId: pool[idx].id };
  }

  // Normal: solid fundamentals — leads lowest card (or occasional low pair <= 9)
  if (difficulty === 'normal') {
    const lowPair = sorted.find(
      (c) =>
        c.suit !== state.trumpSuit &&
        c.rank <= 9 &&
        sorted.filter((o) => o.suit !== state.trumpSuit && o.rank === c.rank).length >= 2,
    );
    return { type: 'attack', playerId: player.id, cardId: (lowPair ?? sorted[0]).id };
  }

  // Group non-trumps by rank for Hard & Extreme
  const rankGroups = new Map<number, Card[]>();
  for (const c of sorted) {
    if (c.suit !== state.trumpSuit) {
      const list = rankGroups.get(c.rank) ?? [];
      list.push(c);
      rankGroups.set(c.rank, list);
    }
  }

  const activeCount = state.players.filter((p) => !p.isOut).length;
  const knownDefenderCards = state.knownOpponentCards?.[defender.id] ?? [];
  let bestCard = sorted[0];
  let bestScore = Infinity;

  for (const card of sorted) {
    const isTrump = card.suit === state.trumpSuit;
    let score = cardValue(card, state.trumpSuit, deckCount);

    // Leading from a non-trump pair/triple creates guaranteed throw-in pressure
    const sameRankNonTrumps = rankGroups.get(card.rank) ?? [];
    if (!isTrump && sameRankNonTrumps.length >= 2) {
      score -= sameRankNonTrumps.length === 3 ? 8 : 5;
    }

    // Passing mode awareness: avoid feeding known Passing cards to defender!
    if (state.settings.variant === 'passing') {
      if (difficulty === 'extreme' && knownDefenderCards.some((k) => k.rank === card.rank)) {
        score += 9;
      } else if (!isTrump && sameRankNonTrumps.length === 1 && defender.hand.length >= 4) {
        score += 1.8;
      }
    }

    if (difficulty === 'extreme') {
      // Remembered defender cards: if we know defender holds a card that can't beat ours,
      // or holds the same rank in Classic mode (we can keep pressuring), adjust score
      const totalMyRank = player.hand.filter((c) => c.rank === card.rank).length;
      if (totalMyRank >= 2 && !isTrump) {
        score -= 2.5;
      }

      if (deckCount === 0) {
        if (activeCount === 2) {
          const defenderCanBeat = defender.hand.some((d) => canBeat(card, d, state.trumpSuit));
          if (!defenderCanBeat) {
            score -= 26;
          } else {
            const cheapestDefense = [...defender.hand]
              .filter((d) => canBeat(card, d, state.trumpSuit))
              .sort((a, b) => cardValue(a, state.trumpSuit, 0) - cardValue(b, state.trumpSuit, 0))[0];
            if (cheapestDefense) {
              const hasFollowUp = player.hand.some(
                (c) => c.id !== card.id && (c.rank === card.rank || c.rank === cheapestDefense.rank),
              );
              if (hasFollowUp) score -= 6;
              if (cheapestDefense.suit === state.trumpSuit && !isTrump) score -= 7;
            }
          }
        }
        if (player.hand.length === 2 && isTrump) {
          score += 5;
        }
      } else if (isTrump && card.rank >= 11) {
        score += 10;
      }
    }

    if (score < bestScore) {
      bestScore = score;
      bestCard = card;
    }
  }

  return { type: 'attack', playerId: player.id, cardId: bestCard.id };
}

function chooseDefenseAction(
  state: GameState,
  defenderIndex: number,
  undefendedIndices: number[],
  difficulty: Exclude<BotDifficulty, 'master'>,
): GameAction {
  const defender = state.players[defenderIndex];
  const deckCount = state.deck.length;
  const activeCount = state.players.filter((p) => !p.isOut).length;

  // Check Passing mode opportunity first
  if (state.settings.variant === 'passing') {
    const passable = defender.hand
      .filter((card) =>
        canPassAttackCard(
          state,
          defenderIndex,
          card,
          (idx) => state.players[idx].hand.length,
        ),
      )
      .sort(
        (a, b) =>
          cardValue(a, state.trumpSuit, deckCount) -
          cardValue(b, state.trumpSuit, deckCount),
      );

    if (passable.length > 0) {
      const bestPass = passable[0];
      const shouldPass =
        difficulty === 'easy'
          ? bestPass.suit !== state.trumpSuit && state.boutNumber % 2 === 0
          : difficulty === 'normal'
            ? bestPass.suit !== state.trumpSuit || bestPass.rank <= 9 || deckCount === 0
            : // Hard & Extreme: pass aggressively — huge tempo & card-preservation advantage!
              bestPass.suit !== state.trumpSuit ||
              bestPass.rank <= 11 ||
              deckCount === 0 ||
              state.table.length >= 2;

      if (shouldPass) {
        return {
          type: 'pass_attack',
          playerId: defender.id,
          cardId: bestPass.id,
        };
      }
    }
  }

  // Plan defense
  let plannedDefenses: { targetIndex: number; card: Card }[] | null = null;
  if (difficulty === 'hard' || difficulty === 'extreme') {
    const opt = findOptimalDefensePlan(state, defender.hand, undefendedIndices, difficulty);
    plannedDefenses = opt ? opt.moves : null;
  } else {
    plannedDefenses = greedyDefensePlan(state, defender.hand, undefendedIndices, difficulty);
  }

  if (!plannedDefenses || plannedDefenses.length === 0) {
    return { type: 'take', playerId: defender.id };
  }

  // Strategic early-take evaluation (carefully calibrated by player count!
  // In 3-4 player games, taking invites 2-3 attackers to pile garbage on you, so be much stricter!)
  if (difficulty !== 'easy' && canDefenderTake(state, defenderIndex)) {
    const tableCardsCount = state.table.reduce((sum, p) => sum + 1 + (p.defense ? 1 : 0), 0);
    const trumpsSpent = plannedDefenses.filter(
      (d) =>
        d.card.suit === state.trumpSuit &&
        state.table[d.targetIndex].attack.suit !== state.trumpSuit,
    );
    const aceOrKingTrumpSpent = trumpsSpent.some((d) => d.card.rank >= 13);
    const queenPlusTrumpSpent = trumpsSpent.some((d) => d.card.rank >= 12);

    if (difficulty === 'normal') {
      // Normal occasionally takes unnecessarily early in 4p or burns trumps in 2p
      if (deckCount > 8 && queenPlusTrumpSpent && tableCardsCount <= 3 && defender.hand.length <= 7) {
        return { type: 'take', playerId: defender.id };
      }
    } else if (difficulty === 'hard') {
      // Hard only takes early in 3-4p if saving a K/A trump with plenty of deck left & small hand;
      // in 2p can take to save Q+ trumps earlier
      const allowTake =
        activeCount <= 2
          ? deckCount > 6 && queenPlusTrumpSpent && tableCardsCount <= 3 && defender.hand.length <= 7
          : deckCount > 10 && aceOrKingTrumpSpent && tableCardsCount <= 2 && defender.hand.length <= 6;
      if (allowTake) {
        return { type: 'take', playerId: defender.id };
      }
    } else if (difficulty === 'extreme') {
      const tableHasTrump = state.table.some(
        (p) => p.attack.suit === state.trumpSuit || p.defense?.suit === state.trumpSuit,
      );
      const allowTake =
        activeCount <= 2
          ? deckCount > 5 &&
            ((queenPlusTrumpSpent && tableCardsCount <= 3) ||
              (tableHasTrump && trumpsSpent.length >= 1 && tableCardsCount <= 2)) &&
            defender.hand.length <= 7
          : deckCount > 10 &&
            aceOrKingTrumpSpent &&
            tableCardsCount <= 2 &&
            defender.hand.length <= 5;
      if (allowTake) {
        return { type: 'take', playerId: defender.id };
      }
    }
  }

  const nextMove = plannedDefenses[0];
  return {
    type: 'defend',
    playerId: defender.id,
    cardId: nextMove.card.id,
    targetIndex: nextMove.targetIndex,
  };
}

function chooseThrowInOrPass(
  state: GameState,
  playerIndex: number,
  difficulty: Exclude<BotDifficulty, 'master'>,
): GameAction | null {
  const player = state.players[playerIndex];
  const defender = state.players[state.defenderIndex];
  const deckCount = state.deck.length;
  const maxAttacks = getMaxTableAttacks(state);
  const activeCount = state.players.filter((p) => !p.isOut).length;

  const playable =
    state.table.length < maxAttacks
      ? player.hand
          .filter((c) => canPlayAttackCard(state, playerIndex, c))
          .sort(
            (a, b) =>
              cardValue(a, state.trumpSuit, deckCount) -
              cardValue(b, state.trumpSuit, deckCount),
          )
      : [];

  if (playable.length > 0) {
    const best = playable[0];
    const isTrump = best.suit === state.trumpSuit;

    if (state.subPhase === 'taking') {
      let shouldThrowIn = false;
      if (difficulty === 'easy') {
        shouldThrowIn = !isTrump && best.rank <= 10;
      } else if (difficulty === 'normal') {
        shouldThrowIn = !isTrump
          ? best.rank <= 11 || deckCount === 0
          : player.hand.length === 1 && deckCount === 0;
      } else if (difficulty === 'hard') {
        shouldThrowIn = !isTrump
          ? best.rank <= 13 || deckCount <= 4 || player.hand.length <= 3
          : player.hand.length === 1 && deckCount === 0;
      } else {
        // Extreme: dump all non-trumps up to K (and Aces in late game / when hand is small) to bloat defender!
        shouldThrowIn = !isTrump
          ? best.rank <= 13 || deckCount <= 6 || player.hand.length <= 4
          : deckCount === 0 && player.hand.length === 1;
      }

      if (shouldThrowIn) {
        return { type: 'attack', playerId: player.id, cardId: best.id };
      }
    } else {
      // Battle subphase throw-ins
      let shouldThrowIn = false;
      if (difficulty === 'easy') {
        shouldThrowIn = !isTrump ? best.rank <= 11 : best.rank <= 10;
      } else if (difficulty === 'normal') {
        shouldThrowIn = !isTrump
          ? best.rank <= 13 || deckCount <= 6
          : deckCount === 0 && best.rank <= 10;
      } else if (difficulty === 'hard') {
        // Hard keeps trumps for endgame unless defender is about to escape or deck is empty
        shouldThrowIn = !isTrump
          ? best.rank <= 13 || deckCount <= 6 || defender.hand.length <= 3
          : deckCount === 0 && (best.rank <= 10 || player.hand.length <= 2);
      } else {
        const nextAfterDef = getNextActivePlayerIndex(state.players, state.defenderIndex);
        const takingGivesUsTurn = nextAfterDef === playerIndex;

        if (!isTrump) {
          shouldThrowIn =
            best.rank <= 13 ||
            deckCount <= 4 ||
            defender.hand.length <= 2 ||
            (takingGivesUsTurn && deckCount <= 6);
        } else {
          const unblockableInEndgame =
            deckCount === 0 &&
            activeCount === 2 &&
            !defender.hand.some((d) => canBeat(best, d, state.trumpSuit));
          shouldThrowIn =
            unblockableInEndgame ||
            (deckCount === 0 && (best.rank <= 10 || player.hand.length <= 2));
        }
      }

      if (shouldThrowIn && (allAttacksDefended(state) || playerIndex === state.attackerIndex)) {
        return { type: 'attack', playerId: player.id, cardId: best.id };
      }
    }
  }

  if (canPlayerPassTurn(state, playerIndex, player.hand.length)) {
    return { type: 'pass_turn', playerId: player.id };
  }

  return null;
}
