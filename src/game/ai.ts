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
import { BotDifficulty, Card, GameAction, GameState, Suit } from './types';

function cardValue(card: Card, trumpSuit: Suit, deckCount: number): number {
  const isTrump = card.suit === trumpSuit;
  const trumpBonus = deckCount > 6 ? 18 : 14;
  return card.rank + (isTrump ? trumpBonus : 0);
}

interface DefenseAssignment {
  moves: { targetIndex: number; card: Card }[];
  totalCost: number;
}

/**
 * Exact minimum-cost bipartite matching for defending all undefended attacks.
 * Used by Hard and Extreme AIs so they never fail a defendable board due to
 * greedy ordering, and prefer cards that don't expose new throw-in ranks.
 */
function findOptimalDefensePlan(
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
          cost += deckCount > 0 ? 10 : 5;
        }

        // Prefer defending with a rank already on the table (zero new throw-in exposure!)
        if (tableRanks.has(card.rank)) {
          cost -= difficulty === 'extreme' ? 4.5 : 3;
        } else if (difficulty === 'extreme') {
          // If we hold fewer copies of this rank, opponents are more likely to hold it!
          const myCopies = handRankCounts.get(card.rank) ?? 1;
          const unseenCopies = 4 - myCopies;
          // Higher risk when many cards remain in play or opponent hands
          cost += unseenCopies * (deckCount > 0 ? 1.1 : 1.5);
        }

        // Preserve pairs in our own hand when possible on Extreme
        if (difficulty === 'extreme' && !isTrump && (handRankCounts.get(card.rank) ?? 0) >= 2) {
          cost += 1.5;
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
      // Easy bot occasionally picks a slightly suboptimal (higher) legal card
      const pickIdx = (state.boutNumber + targetIdx + hand.length) % Math.min(2, options.length);
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
    const action = chooseThrowInOrPass(state, idx, diff);
    if (action) return action;
  }

  return null;
}

function chooseOpeningAttack(
  state: GameState,
  playerIndex: number,
  difficulty: BotDifficulty,
): GameAction {
  const player = state.players[playerIndex];
  const deckCount = state.deck.length;
  const defender = state.players[state.defenderIndex];

  const sorted = [...player.hand].sort(
    (a, b) => cardValue(a, state.trumpSuit, deckCount) - cardValue(b, state.trumpSuit, deckCount),
  );

  // Easy: simple lead, occasionally picks a slightly higher non-optimal card
  if (difficulty === 'easy') {
    const nonTrumps = sorted.filter((c) => c.suit !== state.trumpSuit);
    const pool = nonTrumps.length > 0 ? nonTrumps : sorted;
    const idx = (state.boutNumber + player.hand.length) % Math.min(3, pool.length);
    return { type: 'attack', playerId: player.id, cardId: pool[idx].id };
  }

  // Group non-trumps by rank
  const rankGroups = new Map<number, Card[]>();
  for (const c of sorted) {
    if (c.suit !== state.trumpSuit) {
      const list = rankGroups.get(c.rank) ?? [];
      list.push(c);
      rankGroups.set(c.rank, list);
    }
  }

  // Normal (previous Tactical behavior): low non-trump pair <= J, else lowest card
  if (difficulty === 'normal') {
    for (const [rank, cards] of rankGroups) {
      if (rank <= 11 && cards.length >= 2) {
        return { type: 'attack', playerId: player.id, cardId: cards[0].id };
      }
    }
    return { type: 'attack', playerId: player.id, cardId: sorted[0].id };
  }

  // Hard & Extreme: strategic scoring of every candidate opening card
  const activeCount = state.players.filter((p) => !p.isOut).length;
  let bestCard = sorted[0];
  let bestScore = Infinity;

  for (const card of sorted) {
    const isTrump = card.suit === state.trumpSuit;
    let score = cardValue(card, state.trumpSuit, deckCount);

    // Bonus for leading from a pair/triple of non-trumps (creates guaranteed throw-ins!)
    const sameRankNonTrumps = rankGroups.get(card.rank) ?? [];
    if (!isTrump && sameRankNonTrumps.length >= 2) {
      score -= sameRankNonTrumps.length === 3 ? 7 : 4.5;
    }

    // In Passing mode, avoid leading a rank if we only have 1 copy and defender has many cards
    if (state.settings.variant === 'passing' && !isTrump && sameRankNonTrumps.length === 1 && defender.hand.length >= 4) {
      score += 1.5;
    }

    // Extreme: endgame lookahead when deck is empty and we are trying to force takes or go out!
    if (difficulty === 'extreme') {
      // Count how many other cards in our hand share this rank (including trump)
      const totalMyRank = player.hand.filter((c) => c.rank === card.rank).length;
      if (totalMyRank >= 2 && !isTrump) {
        score -= 2.5;
      }

      // If deck is empty and defender has few cards (endgame pressure), prefer ranks that can overwhelm defender
      if (deckCount === 0) {
        // Check if we can force defender to take in 1v1 endgame!
        if (activeCount === 2) {
          const defenderCanBeat = defender.hand.some((d) => canBeat(card, d, state.trumpSuit));
          if (!defenderCanBeat) {
            // Guaranteed take -> keeps our attack turn! Massive bonus unless burning our only ace trump needlessly
            score -= 28;
          } else {
            // See what defender's cheapest response would be and whether we have a follow-up throw-in!
            const cheapestDefense = [...defender.hand]
              .filter((d) => canBeat(card, d, state.trumpSuit))
              .sort((a, b) => cardValue(a, state.trumpSuit, 0) - cardValue(b, state.trumpSuit, 0))[0];
            if (cheapestDefense) {
              const hasFollowUp = player.hand.some(
                (c) => c.id !== card.id && (c.rank === card.rank || c.rank === cheapestDefense.rank),
              );
              if (hasFollowUp) score -= 6;
              // Forcing defender to burn a high trump is very strong!
              if (cheapestDefense.suit === state.trumpSuit && !isTrump) {
                score -= 8;
              }
            }
          }
        }

        // If we have 2 cards left and one is a high trump, lead the weaker card first so trump stays for last
        if (player.hand.length === 2 && isTrump) {
          score += 5;
        }
      } else {
        // Midgame: prefer dumping awkward medium-low non-trumps while keeping high trumps
        if (isTrump && card.rank >= 11) {
          score += 9;
        }
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
  difficulty: BotDifficulty,
): GameAction {
  const defender = state.players[defenderIndex];
  const deckCount = state.deck.length;

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
            ? bestPass.suit !== state.trumpSuit || bestPass.rank <= 10 || deckCount === 0
            : // Hard & Extreme: almost always pass with non-trump or low/mid trump (huge tempo win!)
              bestPass.suit !== state.trumpSuit || bestPass.rank <= 11 || deckCount === 0 || state.table.length >= 2;

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

  // Strategic early-take evaluation (Normal / Hard / Extreme)
  if (difficulty !== 'easy' && canDefenderTake(state, defenderIndex)) {
    const tableCardsCount = state.table.reduce((sum, p) => sum + 1 + (p.defense ? 1 : 0), 0);
    const trumpsSpent = plannedDefenses.filter(
      (d) => d.card.suit === state.trumpSuit && state.table[d.targetIndex].attack.suit !== state.trumpSuit,
    );
    const highTrumpSpent = trumpsSpent.some((d) => d.card.rank >= 12);

    if (difficulty === 'normal') {
      if (deckCount > 6 && highTrumpSpent && tableCardsCount <= 3 && defender.hand.length <= 7) {
        return { type: 'take', playerId: defender.id };
      }
    } else if (difficulty === 'hard') {
      // Take if deck is rich and defending burns a Q+ trump or 2+ trumps for just a couple cards
      const burningTooManyTrumps =
        deckCount > 6 &&
        ((highTrumpSpent && tableCardsCount <= 3) || (trumpsSpent.length >= 2 && tableCardsCount <= 4)) &&
        defender.hand.length <= 7;
      if (burningTooManyTrumps) {
        return { type: 'take', playerId: defender.id };
      }
    } else if (difficulty === 'extreme') {
      // Extreme also checks whether taking captures a trump card on the table cheaply!
      const tableHasTrump = state.table.some(
        (p) => p.attack.suit === state.trumpSuit || p.defense?.suit === state.trumpSuit,
      );
      const burningHighTrumpEarly =
        deckCount > 5 &&
        ((highTrumpSpent && tableCardsCount <= 4) ||
          (trumpsSpent.length >= 2 && tableCardsCount <= 5) ||
          (tableHasTrump && trumpsSpent.length >= 1 && tableCardsCount <= 2 && defender.hand.length <= 6));
      if (burningHighTrumpEarly && defender.hand.length <= 8) {
        return { type: 'take', playerId: defender.id };
      }
    }
  }

  // Hard & Extreme: defend the highest-value attack first, or non-trump defense first
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
  difficulty: BotDifficulty,
): GameAction | null {
  const player = state.players[playerIndex];
  const defender = state.players[state.defenderIndex];
  const deckCount = state.deck.length;
  const maxAttacks = getMaxTableAttacks(state);

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
        // Easy bot only throws in low non-trumps while defender takes
        shouldThrowIn = !isTrump && best.rank <= 10;
      } else if (difficulty === 'normal') {
        shouldThrowIn = !isTrump
          ? best.rank <= 12 || deckCount === 0 || player.hand.length <= 2
          : player.hand.length === 1 && deckCount === 0;
      } else if (difficulty === 'hard') {
        // Hard dumps all non-trumps up to K (or A in late game) to bloat defender's hand
        shouldThrowIn = !isTrump
          ? best.rank <= 13 || deckCount <= 4 || player.hand.length <= 3
          : player.hand.length === 1 && deckCount === 0;
      } else {
        // Extreme: ruthlessly dumps non-trumps (except keeping an Ace if deck is still rich and we have few cards),
        // and throws in a trump if it empties our hand in endgame!
        shouldThrowIn = !isTrump
          ? best.rank <= 13 || deckCount <= 6 || player.hand.length <= 4
          : deckCount === 0 && player.hand.length <= 2 && best.rank <= 10;
      }

      if (shouldThrowIn) {
        return { type: 'attack', playerId: player.id, cardId: best.id };
      }
    } else {
      // In battle subphase
      let shouldThrowIn = false;
      if (difficulty === 'easy') {
        // Easy sometimes skips throw-ins on higher cards and occasionally wastes low trumps
        shouldThrowIn = !isTrump ? best.rank <= 11 : best.rank <= 9;
      } else if (difficulty === 'normal') {
        shouldThrowIn = !isTrump
          ? true
          : deckCount === 0 || (player.hand.length <= 2 && best.rank <= 11);
      } else if (difficulty === 'hard') {
        // Hard throws in non-trumps, and uses low/mid trumps when defender is close to winning or deck is nearly empty
        shouldThrowIn = !isTrump
          ? best.rank <= 13 || deckCount <= 6 || defender.hand.length <= 3
          : deckCount === 0 || (deckCount <= 4 && best.rank <= 10) || (defender.hand.length <= 2 && best.rank <= 11);
      } else {
        // Extreme: checks whether throwing in can overwhelm the defender or help us empty our hand!
        const nextAfterDef = getNextActivePlayerIndex(state.players, state.defenderIndex);
        const takingGivesUsTurn = nextAfterDef === playerIndex;

        if (!isTrump) {
          // Don't feed an Ace early unless defender is short on cards or taking gives us turn
          shouldThrowIn =
            best.rank <= 13 ||
            deckCount <= 8 ||
            defender.hand.length <= 3 ||
            takingGivesUsTurn;
        } else {
          // Throw in a trump in endgame, or when we know defender cannot beat it in 1v1 endgame!
          const activeCount = state.players.filter((p) => !p.isOut).length;
          const unblockableInEndgame =
            deckCount === 0 &&
            activeCount === 2 &&
            !defender.hand.some((d) => canBeat(best, d, state.trumpSuit));
          shouldThrowIn =
            unblockableInEndgame ||
            (deckCount === 0 && (best.rank <= 11 || player.hand.length <= 2)) ||
            (defender.hand.length === 1 && best.rank <= 10);
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
