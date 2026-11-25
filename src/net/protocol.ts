import {
  ChatMessage,
  ClientGameState,
  GameAction,
  LobbyState,
} from '../game/types';

export type SoundEvent = 'play' | 'defend' | 'take' | 'discard' | 'pass' | 'win';

export type PeerToHostMessage =
  | { type: 'hello'; peerId: string; playerName: string }
  | { type: 'game_action'; action: GameAction }
  | { type: 'chat'; text: string }
  | { type: 'ping'; sentAt: number };

export type HostToPeerMessage =
  | { type: 'welcome'; assignedPlayerId: string; seatIndex: number }
  | { type: 'lobby_state'; lobby: LobbyState }
  | { type: 'game_state'; state: ClientGameState; soundEvent?: SoundEvent }
  | { type: 'action_error'; message: string }
  | { type: 'chat_broadcast'; message: ChatMessage }
  | { type: 'kicked'; reason: string }
  | { type: 'pong'; sentAt: number };
