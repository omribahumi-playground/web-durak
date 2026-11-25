export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export type DeckSize = 24 | 36 | 52;

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export type PlayerType = 'human' | 'bot';
export type BotDifficulty = 'easy' | 'normal' | 'hard' | 'extreme' | 'master';
export type GameVariant = 'classic' | 'passing';

export const BOT_DIFFICULTIES: BotDifficulty[] = [
  'easy',
  'normal',
  'hard',
  'extreme',
  'master',
];

export const BOT_DIFFICULTY_LABELS: Record<BotDifficulty, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
  extreme: 'Extreme',
  master: 'Master',
};

export interface GameSettings {
  maxPlayers: 2 | 3 | 4;
  deckSize: DeckSize;
  variant: GameVariant;
  firstBoutLimitFive: boolean;
  neighborsOnlyThrowIn: boolean;
  botDifficulty: BotDifficulty;
}

export interface TablePair {
  attack: Card;
  defense: Card | null;
}

export interface PlayerState {
  id: string;
  name: string;
  seatIndex: number;
  type: PlayerType;
  botDifficulty?: BotDifficulty;
  hand: Card[];
  connected: boolean;
  isOut: boolean;
  finishOrder: number | null;
}

export interface PublicPlayerState {
  id: string;
  name: string;
  seatIndex: number;
  type: PlayerType;
  botDifficulty?: BotDifficulty;
  cardCount: number;
  connected: boolean;
  isOut: boolean;
  finishOrder: number | null;
}

export type GamePhase = 'playing' | 'finished';
export type BoutSubPhase = 'initial_attack' | 'battle' | 'taking';

export interface ActionLogEntry {
  id: string;
  text: string;
  timestamp: number;
}

export interface GameState {
  id: string;
  settings: GameSettings;
  phase: GamePhase;
  subPhase: BoutSubPhase;
  deck: Card[];
  trumpSuit: Suit;
  trumpCard: Card;
  discardCount: number;
  discardedCards: Card[];
  knownOpponentCards: Record<string, Card[]>;
  hasHadDiscard: boolean;
  players: PlayerState[];
  attackerIndex: number;
  defenderIndex: number;
  table: TablePair[];
  defenderStartHandCount: number;
  passedPlayerIds: string[];
  boutNumber: number;
  lastActionText: string;
  actionLog: ActionLogEntry[];
  durakId: string | null;
  isDraw: boolean;
  winnerIds: string[];
  version: number;
}

export interface ClientGameState {
  id: string;
  settings: GameSettings;
  phase: GamePhase;
  subPhase: BoutSubPhase;
  deckCount: number;
  trumpSuit: Suit;
  trumpCard: Card;
  discardCount: number;
  hasHadDiscard: boolean;
  players: PublicPlayerState[];
  myPlayerId: string;
  myHand: Card[];
  attackerIndex: number;
  defenderIndex: number;
  table: TablePair[];
  defenderStartHandCount: number;
  passedPlayerIds: string[];
  boutNumber: number;
  lastActionText: string;
  actionLog: ActionLogEntry[];
  durakId: string | null;
  isDraw: boolean;
  winnerIds: string[];
  version: number;
}

export type GameAction =
  | { type: 'attack'; playerId: string; cardId: string }
  | { type: 'defend'; playerId: string; cardId: string; targetIndex: number }
  | { type: 'pass_attack'; playerId: string; cardId: string }
  | { type: 'take'; playerId: string }
  | { type: 'pass_turn'; playerId: string };

export interface LobbySeat {
  seatIndex: number;
  kind: 'host' | 'remote' | 'bot' | 'open';
  playerId: string;
  peerId?: string;
  name: string;
  botDifficulty?: BotDifficulty;
  connected: boolean;
  rttMs?: number;
}

export interface LobbyState {
  roomCode: string;
  hostId: string;
  settings: GameSettings;
  seats: LobbySeat[];
  inGame: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
export const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function getRanksForDeckSize(deckSize: DeckSize): Rank[] {
  if (deckSize === 24) return [9, 10, 11, 12, 13, 14];
  if (deckSize === 52) return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  return [6, 7, 8, 9, 10, 11, 12, 13, 14];
}

export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

export const RANK_LABELS: Record<Rank, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

export const DEFAULT_SETTINGS: GameSettings = {
  maxPlayers: 2,
  deckSize: 36,
  variant: 'classic',
  firstBoutLimitFive: true,
  neighborsOnlyThrowIn: false,
  botDifficulty: 'normal',
};
