import {
  ActionLogEntry,
  Card,
  ClientGameState,
  DeckSize,
  GameAction,
  GameSettings,
  GameState,
  PlayerState,
  PlayerType,
  BotDifficulty,
  RANK_LABELS,
  SUIT_SYMBOLS,
  SUITS,
  Suit,
  getRanksForDeckSize,
} from './types';

export interface PlayerSeed {
  id: string;
  name: string;
  type: PlayerType;
  botDifficulty?: BotDifficulty;
  connected?: boolean;
}

export interface ActionResult {
  ok: boolean;
  state: GameState;
  error?: string;
  soundEvent?: 'play' | 'defend' | 'take' | 'discard' | 'pass' | 'win';
}

export function formatCard(card: Card): string {
  return `${RANK_LABELS[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
}

export function createDeck(deckSize: DeckSize = 36): Card[] {
  const ranks = getRanksForDeckSize(deckSize);
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of ranks) {
      deck.push({ id: `${suit}-${rank}`, suit, rank });
    }
  }
  return deck;
}

export function shuffleDeck(cards: Card[], rng: () => number = Math.random): Card[] {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function sortHand(
  hand: Card[],
  trumpSuit: Suit,
  mode: 'suit' | 'rank' = 'suit',
): Card[] {
  const suitOrder: Record<Suit, number> = {
    clubs: 0,
    diamonds: 1,
    spades: 2,
    hearts: 3,
  };
  return [...hand].sort((a, b) => {
    const aTrump = a.suit === trumpSuit ? 1 : 0;
    const bTrump = b.suit === trumpSuit ? 1 : 0;
    if (aTrump !== bTrump) return aTrump - bTrump;
    if (mode === 'rank') {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return suitOrder[a.suit] - suitOrder[b.suit];
    }
    if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
    return a.rank - b.rank;
  });
}

export function canBeat(attackCard: Card, defenseCard: Card, trumpSuit: Suit): boolean {
  if (defenseCard.suit === attackCard.suit) {
    return defenseCard.rank > attackCard.rank;
  }
  return defenseCard.suit === trumpSuit && attackCard.suit !== trumpSuit;
}

export function getNextActivePlayerIndex(
  players: Pick<PlayerState, 'isOut'>[],
  fromIndex: number,
): number {
  const count = players.length;
  for (let offset = 1; offset <= count; offset++) {
    const idx = (fromIndex + offset) % count;
    if (!players[idx].isOut) {
      return idx;
    }
  }
  return fromIndex;
}

export function getPrevActivePlayerIndex(
  players: Pick<PlayerState, 'isOut'>[],
  fromIndex: number,
): number {
  const count = players.length;
  for (let offset = 1; offset <= count; offset++) {
    const idx = (fromIndex - offset + count) % count;
    if (!players[idx].isOut) {
      return idx;
    }
  }
  return fromIndex;
}

export function getBaseBoutLimit(
  settings: GameSettings,
  hasHadDiscard: boolean,
): number {
  return settings.firstBoutLimitFive && !hasHadDiscard ? 5 : 6;
}

export function getMaxTableAttacks(
  state: Pick<
    GameState,
    'settings' | 'hasHadDiscard' | 'defenderStartHandCount'
  >,
): number {
  const baseLimit = getBaseBoutLimit(state.settings, state.hasHadDiscard);
  return Math.min(baseLimit, state.defenderStartHandCount);
}

export function getTableRanks(state: Pick<GameState, 'table'>): Set<number> {
  const ranks = new Set<number>();
  for (const pair of state.table) {
    ranks.add(pair.attack.rank);
    if (pair.defense) {
      ranks.add(pair.defense.rank);
    }
  }
  return ranks;
}

export function getEligibleAttackerIndices(
  state: Pick<
    GameState,
    'players' | 'attackerIndex' | 'defenderIndex' | 'subPhase' | 'settings'
  >,
): number[] {
  if (state.subPhase === 'initial_attack') {
    const main = state.players[state.attackerIndex];
    return main && !main.isOut ? [state.attackerIndex] : [];
  }

  const eligible: number[] = [];
  if (state.settings.neighborsOnlyThrowIn) {
    const prev = getPrevActivePlayerIndex(state.players, state.defenderIndex);
    const next = getNextActivePlayerIndex(state.players, state.defenderIndex);
    const candidates = new Set([state.attackerIndex, prev, next]);
    candidates.delete(state.defenderIndex);
    for (const idx of candidates) {
      if (!state.players[idx].isOut) {
        eligible.push(idx);
      }
    }
    return eligible;
  }

  for (let i = 0; i < state.players.length; i++) {
    if (i !== state.defenderIndex && !state.players[i].isOut) {
      eligible.push(i);
    }
  }
  return eligible;
}

export function allAttacksDefended(state: Pick<GameState, 'table'>): boolean {
  return state.table.length > 0 && state.table.every((pair) => pair.defense !== null);
}

export function canPlayAttackCard(
  state: Pick<
    GameState,
    | 'phase'
    | 'subPhase'
    | 'players'
    | 'attackerIndex'
    | 'defenderIndex'
    | 'table'
    | 'settings'
    | 'hasHadDiscard'
    | 'defenderStartHandCount'
  >,
  playerIndex: number,
  card: Card,
): boolean {
  if (state.phase !== 'playing') return false;
  const player = state.players[playerIndex];
  if (!player || player.isOut) return false;
  if (playerIndex === state.defenderIndex) return false;

  if (state.subPhase === 'initial_attack') {
    return playerIndex === state.attackerIndex;
  }

  const eligible = getEligibleAttackerIndices(state);
  if (!eligible.includes(playerIndex)) return false;

  const maxAttacks = getMaxTableAttacks(state);
  if (state.table.length >= maxAttacks) return false;

  const tableRanks = getTableRanks(state);
  return tableRanks.has(card.rank);
}

export function canPassAttackCard(
  state: Pick<
    GameState,
    | 'phase'
    | 'subPhase'
    | 'players'
    | 'defenderIndex'
    | 'table'
    | 'settings'
    | 'hasHadDiscard'
  >,
  playerIndex: number,
  card: Card,
  getPlayerCardCount: (idx: number) => number,
): boolean {
  if (state.phase !== 'playing') return false;
  if (state.settings.variant !== 'passing') return false;
  if (state.subPhase !== 'battle') return false;
  if (playerIndex !== state.defenderIndex) return false;
  if (state.table.length === 0) return false;
  if (state.table.some((p) => p.defense !== null)) return false;

  const attackRank = state.table[0].attack.rank;
  if (card.rank !== attackRank) return false;

  const baseCap = getBaseBoutLimit(state.settings, state.hasHadDiscard);
  if (state.table.length + 1 > baseCap) return false;

  const nextDefenderIdx = getNextActivePlayerIndex(state.players, state.defenderIndex);
  if (nextDefenderIdx === state.defenderIndex) return false;

  return getPlayerCardCount(nextDefenderIdx) >= state.table.length + 1;
}

export function canPlayerPassTurn(
  state: Pick<
    GameState,
    | 'phase'
    | 'subPhase'
    | 'players'
    | 'attackerIndex'
    | 'defenderIndex'
    | 'table'
    | 'settings'
    | 'passedPlayerIds'
  >,
  playerIndex: number,
  playerCardCount: number,
): boolean {
  if (state.phase !== 'playing') return false;
  if (state.subPhase === 'initial_attack') return false;
  if (playerIndex === state.defenderIndex) return false;
  const player = state.players[playerIndex];
  if (!player || player.isOut || playerCardCount === 0) return false;

  const eligible = getEligibleAttackerIndices(state);
  if (!eligible.includes(playerIndex)) return false;
  if (state.passedPlayerIds.includes(player.id)) return false;

  if (state.subPhase === 'taking') {
    return true;
  }

  // In battle subphase, attackers can pass once all attacks currently on table are defended
  return allAttacksDefended(state);
}

export function canDefenderTake(
  state: Pick<GameState, 'phase' | 'subPhase' | 'defenderIndex' | 'table'>,
  playerIndex: number,
): boolean {
  if (state.phase !== 'playing') return false;
  if (state.subPhase !== 'battle') return false;
  if (playerIndex !== state.defenderIndex) return false;
  return state.table.some((p) => p.defense === null);
}

function appendLog(log: ActionLogEntry[], text: string): ActionLogEntry[] {
  const entry: ActionLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    timestamp: Date.now(),
  };
  return [...log.slice(-24), entry];
}

export function createInitialGameState(
  seeds: PlayerSeed[],
  settings: GameSettings,
  rng: () => number = Math.random,
): GameState {
  if (seeds.length < 2 || seeds.length > 4) {
    throw new Error('Durak requires between 2 and 4 players.');
  }

  const deckSize = settings.deckSize ?? 36;
  const deck = shuffleDeck(createDeck(deckSize), rng);
  const players: PlayerState[] = seeds.map((seed, seatIndex) => ({
    id: seed.id,
    name: seed.name,
    seatIndex,
    type: seed.type,
    botDifficulty: seed.botDifficulty ?? settings.botDifficulty,
    hand: [],
    connected: seed.connected ?? true,
    isOut: false,
    finishOrder: null,
  }));

  // Deal 6 cards to each player
  let lastDealtCard: Card | undefined;
  for (let round = 0; round < 6; round++) {
    for (const player of players) {
      const card = deck.shift();
      if (card) {
        player.hand.push(card);
        lastDealtCard = card;
      }
    }
  }

  // Bottom card of remaining deck is the trump card; if entire deck was dealt (e.g. 24 cards & 4 players),
  // the last card dealt reveals the trump suit!
  const trumpCard = deck.length > 0 ? deck[deck.length - 1] : lastDealtCard!;
  const trumpSuit = trumpCard.suit;

  // Sort each hand for convenience
  for (const player of players) {
    player.hand = sortHand(player.hand, trumpSuit, 'suit');
  }

  // Lowest trump card holder attacks first
  let attackerIndex = 0;
  let lowestTrumpRank = Infinity;
  let foundTrump = false;
  for (let i = 0; i < players.length; i++) {
    for (const card of players[i].hand) {
      if (card.suit === trumpSuit && card.rank < lowestTrumpRank) {
        lowestTrumpRank = card.rank;
        attackerIndex = i;
        foundTrump = true;
      }
    }
  }
  if (!foundTrump) {
    attackerIndex = Math.floor(rng() * players.length);
  }

  const defenderIndex = getNextActivePlayerIndex(players, attackerIndex);
  const openingText = foundTrump
    ? `${players[attackerIndex].name} holds lowest trump (${RANK_LABELS[lowestTrumpRank as Card['rank']]}${SUIT_SYMBOLS[trumpSuit]}) and attacks first!`
    : `${players[attackerIndex].name} attacks first! Trump is ${SUIT_SYMBOLS[trumpSuit]}.`;

  return {
    id: `game-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    settings: { ...settings, deckSize, maxPlayers: seeds.length as 2 | 3 | 4 },
    phase: 'playing',
    subPhase: 'initial_attack',
    deck,
    trumpSuit,
    trumpCard,
    discardCount: 0,
    discardedCards: [],
    knownOpponentCards: Object.fromEntries(players.map((p) => [p.id, []])),
    hasHadDiscard: false,
    players,
    attackerIndex,
    defenderIndex,
    table: [],
    defenderStartHandCount: players[defenderIndex].hand.length,
    passedPlayerIds: [],
    boutNumber: 1,
    lastActionText: openingText,
    actionLog: appendLog([], openingText),
    durakId: null,
    isDraw: false,
    winnerIds: [],
    version: 1,
  };
}

function getAttackersNeedingToPass(state: GameState): PlayerState[] {
  const eligibleIndices = getEligibleAttackerIndices(state);
  return eligibleIndices
    .map((idx) => state.players[idx])
    .filter(
      (p) =>
        !p.isOut &&
        p.hand.length > 0 &&
        !state.passedPlayerIds.includes(p.id),
    );
}

function cloneKnownCards(
  known: Record<string, Card[]> | undefined,
  players: PlayerState[],
): Record<string, Card[]> {
  const out: Record<string, Card[]> = {};
  for (const p of players) {
    out[p.id] = known?.[p.id] ? [...known[p.id]] : [];
  }
  return out;
}

function removeKnownCard(
  known: Record<string, Card[]> | undefined,
  players: PlayerState[],
  playerId: string,
  cardId: string,
): Record<string, Card[]> {
  const next = cloneKnownCards(known, players);
  next[playerId] = (next[playerId] ?? []).filter((c) => c.id !== cardId);
  return next;
}

function finishBout(
  state: GameState,
  outcome: 'discard' | 'took',
): GameState {
  const players = state.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const deck = [...state.deck];
  let discardCount = state.discardCount;
  const discardedCards = [...(state.discardedCards ?? [])];
  const knownOpponentCards = cloneKnownCards(state.knownOpponentCards, players);
  let hasHadDiscard = state.hasHadDiscard;
  let winnerIds = [...state.winnerIds];
  let nextFinishOrder = winnerIds.length + 1;

  const defender = players[state.defenderIndex];
  const tableCards: Card[] = [];
  for (const pair of state.table) {
    tableCards.push(pair.attack);
    if (pair.defense) {
      tableCards.push(pair.defense);
    }
  }

  let summaryText = '';
  if (outcome === 'discard') {
    discardCount += tableCards.length;
    discardedCards.push(...tableCards);
    hasHadDiscard = true;
    summaryText = `Defended! ${defender.name} cleared the table (${tableCards.length} cards discarded).`;
  } else {
    defender.hand.push(...tableCards);
    // All cards picked up from the table are publicly visible to attentive players
    const knownSet = new Set((knownOpponentCards[defender.id] ?? []).map((c) => c.id));
    for (const c of tableCards) {
      if (!knownSet.has(c.id)) {
        knownOpponentCards[defender.id].push(c);
        knownSet.add(c.id);
      }
    }
    summaryText = `${defender.name} picked up ${tableCards.length} cards.`;
  }

  // Refill hands from deck: main attacker first, then other active players clockwise, defender LAST.
  const drawOrder: number[] = [];
  const total = players.length;
  for (let offset = 0; offset < total; offset++) {
    const idx = (state.attackerIndex + offset) % total;
    if (idx !== state.defenderIndex && !players[idx].isOut) {
      drawOrder.push(idx);
    }
  }
  if (!defender.isOut) {
    drawOrder.push(state.defenderIndex);
  }

  for (const idx of drawOrder) {
    const p = players[idx];
    while (p.hand.length < 6 && deck.length > 0) {
      const drawn = deck.shift();
      if (drawn) {
        p.hand.push(drawn);
        // The last card of the talon is the face-up trump card, so everyone sees who drew it!
        if (deck.length === 0 && drawn.id === state.trumpCard.id) {
          const already = knownOpponentCards[p.id].some((c) => c.id === drawn.id);
          if (!already) {
            knownOpponentCards[p.id].push(drawn);
          }
        }
      }
    }
    p.hand = sortHand(p.hand, state.trumpSuit, 'suit');
  }

  // Mark players who emptied their hands once the deck is empty
  if (deck.length === 0) {
    // Preserve natural finish order: attackers before defender on ties
    for (const idx of drawOrder) {
      const p = players[idx];
      if (!p.isOut && p.hand.length === 0) {
        p.isOut = true;
        p.finishOrder = nextFinishOrder++;
        winnerIds.push(p.id);
        knownOpponentCards[p.id] = [];
      }
    }
  }

  const remaining = players.filter((p) => !p.isOut);
  if (remaining.length <= 1) {
    const isDraw = remaining.length === 0;
    const durakId = remaining.length === 1 ? remaining[0].id : null;
    const endText = isDraw
      ? 'Draw! All remaining players emptied their hands on the final bout.'
      : `Game Over! ${remaining[0].name} is the Durak!`;
    return {
      ...state,
      phase: 'finished',
      subPhase: 'initial_attack',
      deck,
      discardCount,
      discardedCards,
      knownOpponentCards,
      hasHadDiscard,
      players,
      table: [],
      passedPlayerIds: [],
      lastActionText: endText,
      actionLog: appendLog(appendLog(state.actionLog, summaryText), endText),
      durakId,
      isDraw,
      winnerIds,
      version: state.version + 1,
    };
  }

  // Determine next attacker & defender
  let nextAttackerIndex: number;
  if (outcome === 'discard') {
    nextAttackerIndex = !players[state.defenderIndex].isOut
      ? state.defenderIndex
      : getNextActivePlayerIndex(players, state.defenderIndex);
  } else {
    nextAttackerIndex = getNextActivePlayerIndex(players, state.defenderIndex);
  }
  const nextDefenderIndex = getNextActivePlayerIndex(players, nextAttackerIndex);

  return {
    ...state,
    subPhase: 'initial_attack',
    deck,
    discardCount,
    discardedCards,
    knownOpponentCards,
    hasHadDiscard,
    players,
    attackerIndex: nextAttackerIndex,
    defenderIndex: nextDefenderIndex,
    table: [],
    defenderStartHandCount: players[nextDefenderIndex].hand.length,
    passedPlayerIds: [],
    boutNumber: state.boutNumber + 1,
    lastActionText: summaryText,
    actionLog: appendLog(state.actionLog, summaryText),
    winnerIds,
    version: state.version + 1,
  };
}

function checkAutoBoutResolution(state: GameState): {
  state: GameState;
  resolved?: 'discard' | 'took';
} {
  const defender = state.players[state.defenderIndex];
  const maxAttacks = getMaxTableAttacks(state);
  const remainingAttackers = getAttackersNeedingToPass(state);

  if (state.subPhase === 'taking') {
    if (state.table.length >= maxAttacks || remainingAttackers.length === 0) {
      return { state: finishBout(state, 'took'), resolved: 'took' };
    }
    return { state };
  }

  if (state.subPhase === 'battle' && allAttacksDefended(state)) {
    if (
      state.table.length >= maxAttacks ||
      defender.hand.length === 0 ||
      remainingAttackers.length === 0
    ) {
      return { state: finishBout(state, 'discard'), resolved: 'discard' };
    }
  }

  return { state };
}

export function applyGameAction(
  state: GameState,
  action: GameAction,
): ActionResult {
  if (state.phase !== 'playing') {
    return { ok: false, state, error: 'Game has already finished.' };
  }

  const playerIndex = state.players.findIndex((p) => p.id === action.playerId);
  if (playerIndex === -1) {
    return { ok: false, state, error: 'Unknown player.' };
  }
  const player = state.players[playerIndex];
  if (player.isOut) {
    return { ok: false, state, error: 'Player has already finished.' };
  }

  if (action.type === 'attack') {
    const cardIdx = player.hand.findIndex((c) => c.id === action.cardId);
    if (cardIdx === -1) {
      return { ok: false, state, error: 'Card not found in hand.' };
    }
    const card = player.hand[cardIdx];
    if (!canPlayAttackCard(state, playerIndex, card)) {
      return { ok: false, state, error: 'Illegal attack card.' };
    }

    const players = state.players.map((p, idx) =>
      idx === playerIndex
        ? { ...p, hand: p.hand.filter((c) => c.id !== card.id) }
        : p,
    );
    const table = [...state.table, { attack: card, defense: null }];
    const nextSubPhase =
      state.subPhase === 'initial_attack' ? 'battle' : state.subPhase;
    const text =
      state.subPhase === 'initial_attack'
        ? `${player.name} attacks with ${formatCard(card)}.`
        : `${player.name} throws in ${formatCard(card)}.`;

    const updated: GameState = {
      ...state,
      subPhase: nextSubPhase,
      players,
      knownOpponentCards: removeKnownCard(state.knownOpponentCards, players, player.id, card.id),
      table,
      passedPlayerIds: [],
      lastActionText: text,
      actionLog: appendLog(state.actionLog, text),
      version: state.version + 1,
    };

    const resolved = checkAutoBoutResolution(updated);
    return {
      ok: true,
      state: resolved.state,
      soundEvent:
        resolved.state.phase === 'finished'
          ? 'win'
          : resolved.resolved === 'took'
            ? 'take'
            : 'play',
    };
  }

  if (action.type === 'defend') {
    if (state.subPhase !== 'battle' || playerIndex !== state.defenderIndex) {
      return { ok: false, state, error: 'Only the defender can defend.' };
    }
    const pair = state.table[action.targetIndex];
    if (!pair || pair.defense !== null) {
      return { ok: false, state, error: 'Invalid target attack card.' };
    }
    const card = player.hand.find((c) => c.id === action.cardId);
    if (!card) {
      return { ok: false, state, error: 'Card not found in hand.' };
    }
    if (!canBeat(pair.attack, card, state.trumpSuit)) {
      return { ok: false, state, error: 'Card cannot beat the attack.' };
    }

    const players = state.players.map((p, idx) =>
      idx === playerIndex
        ? { ...p, hand: p.hand.filter((c) => c.id !== card.id) }
        : p,
    );
    const table = state.table.map((p, idx) =>
      idx === action.targetIndex ? { ...p, defense: card } : p,
    );
    const text = `${player.name} beats ${formatCard(pair.attack)} with ${formatCard(card)}.`;

    const updated: GameState = {
      ...state,
      players,
      knownOpponentCards: removeKnownCard(state.knownOpponentCards, players, player.id, card.id),
      table,
      passedPlayerIds: [],
      lastActionText: text,
      actionLog: appendLog(state.actionLog, text),
      version: state.version + 1,
    };

    const resolved = checkAutoBoutResolution(updated);
    return {
      ok: true,
      state: resolved.state,
      soundEvent:
        resolved.state.phase === 'finished'
          ? 'win'
          : resolved.resolved === 'discard'
            ? 'discard'
            : 'defend',
    };
  }

  if (action.type === 'pass_attack') {
    const card = player.hand.find((c) => c.id === action.cardId);
    if (!card) {
      return { ok: false, state, error: 'Card not found in hand.' };
    }
    const allowed = canPassAttackCard(
      state,
      playerIndex,
      card,
      (idx) => state.players[idx].hand.length,
    );
    if (!allowed) {
      return { ok: false, state, error: 'Cannot pass the attack with that card.' };
    }

    const nextDefenderIndex = getNextActivePlayerIndex(
      state.players,
      state.defenderIndex,
    );
    const players = state.players.map((p, idx) =>
      idx === playerIndex
        ? { ...p, hand: p.hand.filter((c) => c.id !== card.id) }
        : p,
    );
    const table = [...state.table, { attack: card, defense: null }];
    const text = `${player.name} passes with ${formatCard(card)} → ${players[nextDefenderIndex].name} defends!`;

    const updated: GameState = {
      ...state,
      players,
      knownOpponentCards: removeKnownCard(state.knownOpponentCards, players, player.id, card.id),
      attackerIndex: playerIndex,
      defenderIndex: nextDefenderIndex,
      defenderStartHandCount: players[nextDefenderIndex].hand.length,
      table,
      passedPlayerIds: [],
      lastActionText: text,
      actionLog: appendLog(state.actionLog, text),
      version: state.version + 1,
    };

    return { ok: true, state: updated, soundEvent: 'pass' };
  }

  if (action.type === 'take') {
    if (!canDefenderTake(state, playerIndex)) {
      return { ok: false, state, error: 'Cannot take right now.' };
    }

    const text = `${player.name} chose to take the cards. Attackers may throw in or finish.`;
    const updated: GameState = {
      ...state,
      subPhase: 'taking',
      passedPlayerIds: [],
      lastActionText: text,
      actionLog: appendLog(state.actionLog, text),
      version: state.version + 1,
    };

    // If no attacker can throw in anything (table full or attackers empty-handed), resolve immediately
    const resolved = checkAutoBoutResolution(updated);
    return {
      ok: true,
      state: resolved.state,
      soundEvent:
        resolved.state.phase === 'finished' ? 'win' : 'take',
    };
  }

  if (action.type === 'pass_turn') {
    if (!canPlayerPassTurn(state, playerIndex, player.hand.length)) {
      return { ok: false, state, error: 'Cannot pass right now.' };
    }

    const passedPlayerIds = [...state.passedPlayerIds, player.id];
    const text =
      state.subPhase === 'taking'
        ? `${player.name} is done throwing in.`
        : `${player.name} passes.`;

    const updated: GameState = {
      ...state,
      passedPlayerIds,
      lastActionText: text,
      actionLog: appendLog(state.actionLog, text),
      version: state.version + 1,
    };

    const resolved = checkAutoBoutResolution(updated);
    return {
      ok: true,
      state: resolved.state,
      soundEvent:
        resolved.state.phase === 'finished'
          ? 'win'
          : resolved.resolved === 'discard'
            ? 'discard'
            : resolved.resolved === 'took'
              ? 'take'
              : 'pass',
    };
  }

  return { ok: false, state, error: 'Unsupported action.' };
}

export function sanitizeGameStateForPlayer(
  state: GameState,
  viewerId: string,
): ClientGameState {
  const viewer = state.players.find((p) => p.id === viewerId);
  return {
    id: state.id,
    settings: state.settings,
    phase: state.phase,
    subPhase: state.subPhase,
    deckCount: state.deck.length,
    trumpSuit: state.trumpSuit,
    trumpCard: state.trumpCard,
    discardCount: state.discardCount,
    hasHadDiscard: state.hasHadDiscard,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      seatIndex: p.seatIndex,
      type: p.type,
      botDifficulty: p.botDifficulty,
      cardCount: p.hand.length,
      connected: p.connected,
      isOut: p.isOut,
      finishOrder: p.finishOrder,
    })),
    myPlayerId: viewerId,
    myHand: viewer ? [...viewer.hand] : [],
    attackerIndex: state.attackerIndex,
    defenderIndex: state.defenderIndex,
    table: state.table.map((pair) => ({
      attack: pair.attack,
      defense: pair.defense,
    })),
    defenderStartHandCount: state.defenderStartHandCount,
    passedPlayerIds: [...state.passedPlayerIds],
    boutNumber: state.boutNumber,
    lastActionText: state.lastActionText,
    actionLog: [...state.actionLog],
    durakId: state.durakId,
    isDraw: state.isDraw,
    winnerIds: [...state.winnerIds],
    version: state.version,
  };
}
