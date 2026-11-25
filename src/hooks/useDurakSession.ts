import { useCallback, useEffect, useRef, useState } from 'react';
import { pickNextBotAction } from '../game/ai';
import {
  applyGameAction,
  createInitialGameState,
  PlayerSeed,
  sanitizeGameStateForPlayer,
} from '../game/engine';
import { soundEngine } from '../game/sound';
import {
  BotDifficulty,
  ChatMessage,
  ClientGameState,
  DEFAULT_SETTINGS,
  GameAction,
  GameSettings,
  GameState,
  LobbySeat,
  LobbyState,
} from '../game/types';
import { HostToPeerMessage, PeerToHostMessage, SoundEvent } from '../net/protocol';
import {
  ClientNetworkManager,
  generateRoomCode,
  HostNetworkManager,
  SignalingStatus,
} from '../net/webrtc';

const BOT_NAMES = ['Alex AI', 'Morgan AI', 'Riley AI', 'Casey AI'];

export type SessionRole = 'home' | 'host' | 'guest';

function buildInitialSeats(
  hostId: string,
  hostName: string,
  maxPlayers: 2 | 3 | 4,
  defaultBotDifficulty: BotDifficulty,
  fillWithBots: boolean,
): LobbySeat[] {
  const seats: LobbySeat[] = [
    {
      seatIndex: 0,
      kind: 'host',
      playerId: hostId,
      name: hostName,
      connected: true,
    },
  ];
  for (let i = 1; i < maxPlayers; i++) {
    if (fillWithBots) {
      seats.push({
        seatIndex: i,
        kind: 'bot',
        playerId: `bot-${i}`,
        name: BOT_NAMES[(i - 1) % BOT_NAMES.length],
        botDifficulty: defaultBotDifficulty,
        connected: true,
      });
    } else {
      seats.push({
        seatIndex: i,
        kind: 'open',
        playerId: `open-${i}`,
        name: 'Open Seat (Human or Bot)',
        connected: false,
      });
    }
  }
  return seats;
}

export function useDurakSession() {
  const [role, setRole] = useState<SessionRole>('home');
  const [localName, setLocalName] = useState<string>(() => {
    if (typeof window === 'undefined') return 'Player';
    return window.localStorage.getItem('durak_player_name') || 'Player';
  });
  const [myPlayerId, setMyPlayerId] = useState<string>('');
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [clientGame, setClientGame] = useState<ClientGameState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [signalingStatus, setSignalingStatus] = useState<SignalingStatus>('idle');
  const [connectionNote, setConnectionNote] = useState<string>('');
  const [guestStatus, setGuestStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  >('idle');
  const [pendingManualAnswer, setPendingManualAnswer] = useState<string | null>(null);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const hostNetRef = useRef<HostNetworkManager | null>(null);
  const clientNetRef = useRef<ClientNetworkManager | null>(null);
  const lobbyRef = useRef<LobbyState | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const updateLocalName = useCallback((name: string) => {
    setLocalName(name);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('durak_player_name', name);
    }
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      soundEngine.enabled = next;
      return next;
    });
  }, []);

  const pushChatMessage = useCallback((msg: ChatMessage, broadcastFromHost = false) => {
    setChatMessages((prev) => [...prev.slice(-49), msg]);
    if (broadcastFromHost && hostNetRef.current) {
      hostNetRef.current.broadcast({ type: 'chat_broadcast', message: msg });
    }
  }, []);

  const syncLobbyToPeers = useCallback((nextLobby: LobbyState) => {
    lobbyRef.current = nextLobby;
    setLobby(nextLobby);
    hostNetRef.current?.broadcast({ type: 'lobby_state', lobby: nextLobby });
  }, []);

  const syncGameToAll = useCallback((nextGame: GameState | null, soundEvent?: SoundEvent) => {
    gameRef.current = nextGame;
    const currentLobby = lobbyRef.current;
    if (!nextGame || !currentLobby) {
      setClientGame(null);
      return;
    }

    // Update host's own sanitized view
    setClientGame(sanitizeGameStateForPlayer(nextGame, currentLobby.hostId));
    if (soundEvent) {
      soundEngine.play(soundEvent);
    }

    // Send each remote WebRTC peer ONLY their own sanitized view (no hidden opponent hands!)
    const hostNet = hostNetRef.current;
    if (hostNet) {
      for (const seat of currentLobby.seats) {
        if (seat.kind === 'remote' && seat.peerId && seat.connected) {
          hostNet.sendToPeer(seat.peerId, {
            type: 'game_state',
            state: sanitizeGameStateForPlayer(nextGame, seat.playerId),
            soundEvent,
          });
        }
      }
    }
  }, []);

  const scheduleBotIfNeeded = useCallback(() => {
    if (botTimerRef.current) {
      clearTimeout(botTimerRef.current);
      botTimerRef.current = null;
    }
    const currentGame = gameRef.current;
    if (!currentGame || currentGame.phase !== 'playing') return;

    const nextBotAction = pickNextBotAction(currentGame);
    if (!nextBotAction) return;

    const delayMs =
      nextBotAction.type === 'pass_turn'
        ? 620
        : nextBotAction.type === 'take'
          ? 700
          : 780;

    botTimerRef.current = setTimeout(() => {
      const latest = gameRef.current;
      if (!latest || latest.phase !== 'playing') return;
      const actionNow = pickNextBotAction(latest);
      if (!actionNow) return;
      const res = applyGameAction(latest, actionNow);
      if (res.ok) {
        syncGameToAll(res.state, res.soundEvent);
        scheduleBotIfNeeded();
      }
    }, delayMs);
  }, [syncGameToAll]);

  const executeHostAction = useCallback(
    (action: GameAction, fromPeerId?: string) => {
      const currentGame = gameRef.current;
      if (!currentGame) return;

      // Security check: remote peers can only act for their own assigned playerId
      if (fromPeerId && lobbyRef.current) {
        const seat = lobbyRef.current.seats.find((s) => s.peerId === fromPeerId);
        if (!seat || seat.playerId !== action.playerId) {
          hostNetRef.current?.sendToPeer(fromPeerId, {
            type: 'action_error',
            message: 'Unauthorized player action.',
          });
          return;
        }
      }

      const result = applyGameAction(currentGame, action);
      if (!result.ok) {
        if (fromPeerId) {
          hostNetRef.current?.sendToPeer(fromPeerId, {
            type: 'action_error',
            message: result.error || 'Illegal move.',
          });
        } else {
          showToast(result.error || 'Illegal move.');
        }
        return;
      }

      syncGameToAll(result.state, result.soundEvent);
      scheduleBotIfNeeded();
    },
    [scheduleBotIfNeeded, showToast, syncGameToAll],
  );

  const cleanupAll = useCallback(() => {
    if (botTimerRef.current) {
      clearTimeout(botTimerRef.current);
      botTimerRef.current = null;
    }
    hostNetRef.current?.dispose();
    hostNetRef.current = null;
    clientNetRef.current?.dispose();
    clientNetRef.current = null;
    lobbyRef.current = null;
    gameRef.current = null;
    setLobby(null);
    setClientGame(null);
    setChatMessages([]);
    setSignalingStatus('idle');
    setGuestStatus('idle');
    setPendingManualAnswer(null);
    setConnectionNote('');
    setRttMs(null);
    setRole('home');
  }, []);

  useEffect(() => {
    return () => {
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      hostNetRef.current?.dispose();
      clientNetRef.current?.dispose();
    };
  }, []);

  const createHostedLobby = useCallback(
    (options?: {
      maxPlayers?: 2 | 3 | 4;
      fillWithBots?: boolean;
      playerName?: string;
    }) => {
      cleanupAll();
      const hostDisplayName = (options?.playerName ?? localName).trim() || 'Player';
      updateLocalName(hostDisplayName);

      const roomCode = generateRoomCode();
      const settings: GameSettings = {
        ...DEFAULT_SETTINGS,
        maxPlayers: options?.maxPlayers ?? 2,
      };

      const hostNet = new HostNetworkManager(
        {
          onSignalingStatus: (status, note) => {
            setSignalingStatus(status);
            if (note) setConnectionNote(note);
            else if (status === 'connected') setConnectionNote('WebRTC room live — share code with friends!');
          },
          onRoomCodeChanged: (newCode) => {
            const cur = lobbyRef.current;
            if (cur) {
              syncLobbyToPeers({ ...cur, roomCode: newCode });
            }
          },
          onPeerConnected: () => {
            // Wait for peer's 'hello' payload before assigning seat
          },
          onPeerDisconnected: (peerId) => {
            const curLobby = lobbyRef.current;
            if (!curLobby) return;
            const seatIdx = curLobby.seats.findIndex((s) => s.peerId === peerId);
            if (seatIdx === -1) return;
            const departed = curLobby.seats[seatIdx];

            if (curLobby.inGame && gameRef.current) {
              // Convert disconnected remote player into an AI Bot so the match never stalls!
              const updatedSeats = curLobby.seats.map((s, idx) =>
                idx === seatIdx
                  ? {
                      ...s,
                      kind: 'bot' as const,
                      peerId: undefined,
                      name: `${departed.name} (Bot)`,
                      botDifficulty: curLobby.settings.botDifficulty,
                      connected: true,
                    }
                  : s,
              );
              syncLobbyToPeers({ ...curLobby, seats: updatedSeats });

              const g = gameRef.current;
              const nextGame: GameState = {
                ...g,
                players: g.players.map((p) =>
                  p.id === departed.playerId
                    ? {
                        ...p,
                        type: 'bot',
                        name: `${departed.name} (Bot)`,
                        botDifficulty: curLobby.settings.botDifficulty,
                        connected: true,
                      }
                    : p,
                ),
                lastActionText: `${departed.name} disconnected — AI bot took over their seat.`,
                version: g.version + 1,
              };
              syncGameToAll(nextGame);
              scheduleBotIfNeeded();
              pushChatMessage(
                {
                  id: `sys-${Date.now()}`,
                  senderId: 'system',
                  senderName: 'System',
                  text: `${departed.name} disconnected. AI bot took over their hand.`,
                  timestamp: Date.now(),
                  isSystem: true,
                },
                true,
              );
            } else {
              // In lobby: free the seat back to open
              const updatedSeats = curLobby.seats.map((s, idx) =>
                idx === seatIdx
                  ? {
                      seatIndex: idx,
                      kind: 'open' as const,
                      playerId: `open-${idx}`,
                      name: 'Open Seat (Human or Bot)',
                      connected: false,
                    }
                  : s,
              );
              syncLobbyToPeers({ ...curLobby, seats: updatedSeats });
              pushChatMessage(
                {
                  id: `sys-${Date.now()}`,
                  senderId: 'system',
                  senderName: 'System',
                  text: `${departed.name} left the lobby.`,
                  timestamp: Date.now(),
                  isSystem: true,
                },
                true,
              );
            }
          },
          onPeerMessage: (peerId: string, msg: PeerToHostMessage) => {
            const curLobby = lobbyRef.current;
            if (!curLobby) return;

            if (msg.type === 'hello') {
              if (curLobby.inGame) {
                hostNet.disconnectPeer(peerId, 'Game is already in progress.');
                return;
              }
              // Prefer an open seat, or replace a bot seat if all seats are bots
              let targetIdx = curLobby.seats.findIndex((s) => s.kind === 'open');
              if (targetIdx === -1) {
                targetIdx = curLobby.seats.findIndex((s) => s.kind === 'bot');
              }
              if (targetIdx === -1) {
                hostNet.disconnectPeer(peerId, 'Lobby is full of human players.');
                return;
              }

              const cleanName = msg.playerName.trim().slice(0, 20) || `Player ${targetIdx + 1}`;
              const assignedPlayerId = `human-${peerId}`;
              const updatedSeats = curLobby.seats.map((s, idx) =>
                idx === targetIdx
                  ? {
                      seatIndex: idx,
                      kind: 'remote' as const,
                      playerId: assignedPlayerId,
                      peerId,
                      name: cleanName,
                      connected: true,
                    }
                  : s,
              );

              const nextLobby: LobbyState = { ...curLobby, seats: updatedSeats };
              hostNet.sendToPeer(peerId, {
                type: 'welcome',
                assignedPlayerId,
                seatIndex: targetIdx,
              });
              syncLobbyToPeers(nextLobby);
              pushChatMessage(
                {
                  id: `sys-${Date.now()}`,
                  senderId: 'system',
                  senderName: 'System',
                  text: `${cleanName} connected via WebRTC P2P!`,
                  timestamp: Date.now(),
                  isSystem: true,
                },
                true,
              );
              return;
            }

            if (msg.type === 'game_action') {
              executeHostAction(msg.action, peerId);
              return;
            }

            if (msg.type === 'chat') {
              const seat = curLobby.seats.find((s) => s.peerId === peerId);
              if (!seat) return;
              const text = msg.text.trim().slice(0, 220);
              if (!text) return;
              pushChatMessage(
                {
                  id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                  senderId: seat.playerId,
                  senderName: seat.name,
                  text,
                  timestamp: Date.now(),
                },
                true,
              );
            }
          },
        },
        roomCode,
      );

      hostNetRef.current = hostNet;
      const hostId = hostNet.hostPeerId;
      const initialLobby: LobbyState = {
        roomCode,
        hostId,
        settings,
        seats: buildInitialSeats(
          hostId,
          hostDisplayName,
          settings.maxPlayers,
          settings.botDifficulty,
          options?.fillWithBots ?? false,
        ),
        inGame: false,
      };

      setRole('host');
      setMyPlayerId(hostId);
      lobbyRef.current = initialLobby;
      setLobby(initialLobby);
      hostNet.connectSignaling();
    },
    [
      cleanupAll,
      executeHostAction,
      localName,
      pushChatMessage,
      scheduleBotIfNeeded,
      syncGameToAll,
      syncLobbyToPeers,
      updateLocalName,
    ],
  );

  const handleGuestHostMessage = useCallback(
    (msg: HostToPeerMessage) => {
      if (msg.type === 'welcome') {
        setMyPlayerId(msg.assignedPlayerId);
        return;
      }
      if (msg.type === 'lobby_state') {
        setPendingManualAnswer(null);
        lobbyRef.current = msg.lobby;
        setLobby(msg.lobby);
        if (!msg.lobby.inGame) {
          setClientGame(null);
        }
        return;
      }
      if (msg.type === 'game_state') {
        setClientGame(msg.state);
        if (msg.soundEvent) {
          soundEngine.play(msg.soundEvent);
        }
        return;
      }
      if (msg.type === 'action_error') {
        showToast(msg.message);
        return;
      }
      if (msg.type === 'chat_broadcast') {
        pushChatMessage(msg.message, false);
        return;
      }
      if (msg.type === 'kicked') {
        showToast(msg.reason);
        cleanupAll();
      }
    },
    [cleanupAll, pushChatMessage, showToast],
  );

  const joinRoomByCode = useCallback(
    (roomCode: string, playerName?: string) => {
      cleanupAll();
      const guestName = (playerName ?? localName).trim() || 'Guest';
      updateLocalName(guestName);

      const clientNet = new ClientNetworkManager(guestName, {
        onStatusChange: (status, detail) => {
          setGuestStatus(status);
          if (detail) setConnectionNote(detail);
        },
        onMessage: handleGuestHostMessage,
        onRttUpdate: (ms) => setRttMs(ms),
      });

      clientNetRef.current = clientNet;
      setRole('guest');
      setGuestStatus('connecting');
      clientNet.joinRoom(roomCode);
    },
    [cleanupAll, handleGuestHostMessage, localName, updateLocalName],
  );

  const joinManualOffer = useCallback(
    async (offerCode: string, playerName?: string): Promise<string> => {
      cleanupAll();
      const guestName = (playerName ?? localName).trim() || 'Guest';
      updateLocalName(guestName);

      const clientNet = new ClientNetworkManager(guestName, {
        onStatusChange: (status, detail) => {
          setGuestStatus(status);
          if (detail) setConnectionNote(detail);
        },
        onMessage: handleGuestHostMessage,
        onRttUpdate: (ms) => setRttMs(ms),
      });

      clientNetRef.current = clientNet;
      setRole('guest');
      const { answerCode } = await clientNet.acceptManualOffer(offerCode);
      setPendingManualAnswer(answerCode);
      return answerCode;
    },
    [cleanupAll, handleGuestHostMessage, localName, updateLocalName],
  );

  const createManualInvite = useCallback(async () => {
    if (!hostNetRef.current) {
      throw new Error('Only the host can generate a direct P2P invite.');
    }
    return hostNetRef.current.createManualOffer();
  }, []);

  const applyManualAnswer = useCallback(async (peerId: string, answerCode: string) => {
    if (!hostNetRef.current) {
      throw new Error('Only the host can apply a direct P2P answer.');
    }
    await hostNetRef.current.acceptManualAnswer(peerId, answerCode);
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<GameSettings>) => {
      const cur = lobbyRef.current;
      if (!cur || role !== 'host' || cur.inGame) return;

      const nextSettings: GameSettings = { ...cur.settings, ...patch };
      let nextSeats = [...cur.seats];

      if (patch.maxPlayers && patch.maxPlayers !== cur.seats.length) {
        if (patch.maxPlayers > cur.seats.length) {
          for (let i = cur.seats.length; i < patch.maxPlayers; i++) {
            nextSeats.push({
              seatIndex: i,
              kind: 'open',
              playerId: `open-${i}`,
              name: 'Open Seat (Human or Bot)',
              connected: false,
            });
          }
        } else {
          // Disconnect any remote peers in seats being removed
          const removed = nextSeats.slice(patch.maxPlayers);
          for (const seat of removed) {
            if (seat.kind === 'remote' && seat.peerId) {
              hostNetRef.current?.disconnectPeer(seat.peerId, 'Lobby size was reduced.');
            }
          }
          nextSeats = nextSeats.slice(0, patch.maxPlayers);
        }
      }

      if (patch.botDifficulty) {
        nextSeats = nextSeats.map((s) =>
          s.kind === 'bot' ? { ...s, botDifficulty: patch.botDifficulty } : s,
        );
      }

      syncLobbyToPeers({ ...cur, settings: nextSettings, seats: nextSeats });
    },
    [role, syncLobbyToPeers],
  );

  const toggleSeatBot = useCallback(
    (seatIndex: number) => {
      const cur = lobbyRef.current;
      if (!cur || role !== 'host' || cur.inGame || seatIndex === 0) return;
      const target = cur.seats[seatIndex];
      if (!target) return;

      if (target.kind === 'remote' && target.peerId) {
        hostNetRef.current?.disconnectPeer(target.peerId, 'Removed from lobby by host.');
      }

      const nextSeats = cur.seats.map((s, idx) => {
        if (idx !== seatIndex) return s;
        if (s.kind === 'bot') {
          return {
            seatIndex: idx,
            kind: 'open' as const,
            playerId: `open-${idx}`,
            name: 'Open Seat (Human or Bot)',
            connected: false,
          };
        }
        return {
          seatIndex: idx,
          kind: 'bot' as const,
          playerId: `bot-${idx}-${Math.random().toString(36).slice(2, 5)}`,
          name: BOT_NAMES[(idx - 1) % BOT_NAMES.length],
          botDifficulty: cur.settings.botDifficulty,
          connected: true,
        };
      });

      syncLobbyToPeers({ ...cur, seats: nextSeats });
    },
    [role, syncLobbyToPeers],
  );

  const setSeatBotDifficulty = useCallback(
    (seatIndex: number, botDifficulty: BotDifficulty) => {
      const cur = lobbyRef.current;
      if (!cur || role !== 'host' || cur.inGame) return;
      const target = cur.seats[seatIndex];
      if (!target || target.kind !== 'bot') return;

      const nextSeats = cur.seats.map((s, idx) =>
        idx === seatIndex ? { ...s, botDifficulty } : s,
      );
      syncLobbyToPeers({ ...cur, seats: nextSeats });
    },
    [role, syncLobbyToPeers],
  );

  const fillOpenSeatsWithBots = useCallback(() => {
    const cur = lobbyRef.current;
    if (!cur || role !== 'host' || cur.inGame) return;
    const nextSeats = cur.seats.map((s, idx) =>
      s.kind === 'open'
        ? {
            seatIndex: idx,
            kind: 'bot' as const,
            playerId: `bot-${idx}-${Math.random().toString(36).slice(2, 5)}`,
            name: BOT_NAMES[(idx - 1) % BOT_NAMES.length],
            botDifficulty: cur.settings.botDifficulty,
            connected: true,
          }
        : s,
    );
    syncLobbyToPeers({ ...cur, seats: nextSeats });
  }, [role, syncLobbyToPeers]);

  const startGame = useCallback(() => {
    const cur = lobbyRef.current;
    if (!cur || role !== 'host') return;

    const filledSeats = cur.seats.filter((s) => s.kind !== 'open');
    if (filledSeats.length < 2) {
      showToast('Add at least 1 bot or wait for a friend to join (minimum 2 players).');
      return;
    }

    const seeds: PlayerSeed[] = filledSeats.map((s) => ({
      id: s.playerId,
      name: s.name,
      type: s.kind === 'bot' ? 'bot' : 'human',
      botDifficulty: s.botDifficulty ?? cur.settings.botDifficulty,
      connected: true,
    }));

    const nextLobby: LobbyState = { ...cur, inGame: true };
    syncLobbyToPeers(nextLobby);

    const newGame = createInitialGameState(seeds, {
      ...cur.settings,
      maxPlayers: filledSeats.length as 2 | 3 | 4,
    });
    syncGameToAll(newGame, 'play');
    scheduleBotIfNeeded();
  }, [role, scheduleBotIfNeeded, showToast, syncGameToAll, syncLobbyToPeers]);

  const returnToLobby = useCallback(() => {
    const cur = lobbyRef.current;
    if (!cur || role !== 'host') return;
    if (botTimerRef.current) {
      clearTimeout(botTimerRef.current);
      botTimerRef.current = null;
    }
    syncGameToAll(null);
    syncLobbyToPeers({ ...cur, inGame: false });
  }, [role, syncGameToAll, syncLobbyToPeers]);

  const sendAction = useCallback(
    (action: GameAction) => {
      if (role === 'host') {
        executeHostAction(action);
      } else if (role === 'guest') {
        clientNetRef.current?.send({ type: 'game_action', action });
      }
    },
    [executeHostAction, role],
  );

  const sendChat = useCallback(
    (text: string) => {
      const clean = text.trim().slice(0, 220);
      if (!clean) return;
      if (role === 'host') {
        const cur = lobbyRef.current;
        pushChatMessage(
          {
            id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            senderId: myPlayerId,
            senderName: cur?.seats[0]?.name || localName,
            text: clean,
            timestamp: Date.now(),
          },
          true,
        );
      } else if (role === 'guest') {
        clientNetRef.current?.send({ type: 'chat', text: clean });
      }
    },
    [localName, myPlayerId, pushChatMessage, role],
  );

  return {
    role,
    localName,
    updateLocalName,
    myPlayerId,
    lobby,
    clientGame,
    chatMessages,
    signalingStatus,
    guestStatus,
    pendingManualAnswer,
    connectionNote,
    rttMs,
    toast,
    soundEnabled,
    toggleSound,
    createHostedLobby,
    joinRoomByCode,
    joinManualOffer,
    createManualInvite,
    applyManualAnswer,
    updateSettings,
    toggleSeatBot,
    setSeatBotDifficulty,
    fillOpenSeatsWithBots,
    startGame,
    returnToLobby,
    sendAction,
    sendChat,
    leaveSession: cleanupAll,
  };
}
