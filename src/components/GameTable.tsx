import React, { useMemo, useState } from 'react';
import {
  allAttacksDefended,
  canBeat,
  canDefenderTake,
  canPassAttackCard,
  canPlayAttackCard,
  canPlayerPassTurn,
  getEligibleAttackerIndices,
  getMaxTableAttacks,
  sortHand,
} from '../game/engine';
import {
  BOT_DIFFICULTY_LABELS,
  Card,
  ChatMessage,
  ClientGameState,
  GameAction,
  PublicPlayerState,
} from '../game/types';
import {
  IconBook,
  IconBot,
  IconChat,
  IconClose,
  IconEye,
  IconHand,
  IconMenu,
  IconPalette,
  IconPause,
  IconPlay,
  IconShield,
  IconSort,
  IconSoundOff,
  IconSoundOn,
  IconSword,
  IconTrophy,
  IconUser,
} from './Icons';
import { BotSpeed } from '../hooks/useDurakSession';
import { PlayingCard, SUIT_NAMES, SuitIcon } from './PlayingCard';

interface GameTableProps {
  role: 'host' | 'guest';
  roomCode: string;
  game: ClientGameState;
  rttMs: number | null;
  soundEnabled: boolean;
  fourColorDeck: boolean;
  botSpeed: BotSpeed;
  botsPaused: boolean;
  chatMessages: ChatMessage[];
  onToggleSound: () => void;
  onToggleFourColorDeck: () => void;
  onChangeBotSpeed: (speed: BotSpeed) => void;
  onToggleBotsPaused: () => void;
  onAction: (action: GameAction) => void;
  onSendChat: (text: string) => void;
  onPlayAgain: () => void;
  onReturnToLobby: () => void;
  onOpenRules: () => void;
  onLeave: () => void;
}

const QUICK_EMOTES = ['Nice move!', 'Taking it 😅', 'Clean defense!', 'Good game!'];
const BOT_SPEEDS: BotSpeed[] = [0.5, 1, 2, 4];

export const GameTable: React.FC<GameTableProps> = ({
  role,
  roomCode,
  game,
  rttMs,
  soundEnabled,
  fourColorDeck,
  botSpeed,
  botsPaused,
  chatMessages,
  onToggleSound,
  onToggleFourColorDeck,
  onChangeBotSpeed,
  onToggleBotsPaused,
  onAction,
  onSendChat,
  onPlayAgain,
  onReturnToLobby,
  onOpenRules,
  onLeave,
}) => {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<'suit' | 'rank'>('suit');
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAllHands, setShowAllHands] = useState(true);
  const [chatInput, setChatInput] = useState('');

  const myIndex = game.players.findIndex((p) => p.id === game.myPlayerId);
  const isSpectator = myIndex === -1;
  const bottomIndex = isSpectator ? 0 : myIndex;
  const me = game.players[bottomIndex];
  const isDefender = !isSpectator && myIndex === game.defenderIndex;
  const isMainAttacker = !isSpectator && myIndex === game.attackerIndex;

  const bottomCardsRaw = isSpectator
    ? showAllHands && game.revealedHands && me
      ? game.revealedHands[me.id] ?? []
      : []
    : game.myHand;

  const sortedHand = useMemo(
    () => sortHand(bottomCardsRaw, game.trumpSuit, sortMode),
    [bottomCardsRaw, game.trumpSuit, sortMode],
  );

  // Clear selection if selected card left hand
  const selectedCard = sortedHand.find((c) => c.id === selectedCardId) ?? null;

  const undefendedIndices = useMemo(() => {
    const out: number[] = [];
    game.table.forEach((pair, idx) => {
      if (!pair.defense) out.push(idx);
    });
    return out;
  }, [game.table]);

  // Arrange opponents clockwise starting after the bottom seat
  const opponents = useMemo(() => {
    const list: { player: PublicPlayerState; seatIdx: number; position: 'left' | 'top' | 'right' }[] = [];
    const total = game.players.length;
    if (bottomIndex === -1 || total === 0) return list;

    const ordered: { player: PublicPlayerState; seatIdx: number }[] = [];
    for (let offset = 1; offset < total; offset++) {
      const seatIdx = (bottomIndex + offset) % total;
      ordered.push({ player: game.players[seatIdx], seatIdx });
    }

    if (ordered.length === 1) {
      list.push({ ...ordered[0], position: 'top' });
    } else if (ordered.length === 2) {
      list.push({ ...ordered[0], position: 'left' });
      list.push({ ...ordered[1], position: 'right' });
    } else if (ordered.length === 3) {
      list.push({ ...ordered[0], position: 'left' });
      list.push({ ...ordered[1], position: 'top' });
      list.push({ ...ordered[2], position: 'right' });
    }
    return list;
  }, [bottomIndex, game.players]);

  const engineAdapter = useMemo(
    () => ({
      ...game,
      players: game.players.map((p) => ({ ...p, hand: [] as Card[] })),
    }),
    [game],
  );

  const canTakeNow = myIndex !== -1 && canDefenderTake(engineAdapter, myIndex);
  const canPassTurnNow =
    myIndex !== -1 &&
    canPlayerPassTurn(engineAdapter, myIndex, game.myHand.length);

  const isCardPlayable = (card: Card): boolean => {
    if (game.phase !== 'playing' || myIndex === -1 || me?.isOut) return false;
    if (isDefender) {
      if (game.subPhase !== 'battle') return false;
      const canBeatAny = undefendedIndices.some((idx) =>
        canBeat(game.table[idx].attack, card, game.trumpSuit),
      );
      const canPass = canPassAttackCard(
        engineAdapter,
        myIndex,
        card,
        (idx) => game.players[idx].cardCount,
      );
      return canBeatAny || canPass;
    }
    return canPlayAttackCard(engineAdapter, myIndex, card);
  };

  const selectedCanPassAttack =
    selectedCard !== null &&
    isDefender &&
    canPassAttackCard(
      engineAdapter,
      myIndex,
      selectedCard,
      (idx) => game.players[idx].cardCount,
    );

  const validTargetsForSelected = useMemo(() => {
    if (!selectedCard || !isDefender || game.subPhase !== 'battle') return new Set<number>();
    const set = new Set<number>();
    undefendedIndices.forEach((idx) => {
      if (canBeat(game.table[idx].attack, selectedCard, game.trumpSuit)) {
        set.add(idx);
      }
    });
    return set;
  }, [game.subPhase, game.table, game.trumpSuit, isDefender, selectedCard, undefendedIndices]);

  const handleCardClick = (card: Card) => {
    if (!isCardPlayable(card) || myIndex === -1) return;

    // Attack / throw-in: single click plays immediately!
    if (!isDefender) {
      setSelectedCardId(null);
      onAction({ type: 'attack', playerId: game.myPlayerId, cardId: card.id });
      return;
    }

    // Defender logic
    const canPass = canPassAttackCard(
      engineAdapter,
      myIndex,
      card,
      (idx) => game.players[idx].cardCount,
    );
    const beatTargets = undefendedIndices.filter((idx) =>
      canBeat(game.table[idx].attack, card, game.trumpSuit),
    );

    // If card can ONLY pass (cannot beat any attack), pass immediately!
    if (canPass && beatTargets.length === 0) {
      setSelectedCardId(null);
      onAction({ type: 'pass_attack', playerId: game.myPlayerId, cardId: card.id });
      return;
    }

    // If card can beat exactly 1 target and cannot also pass, defend immediately!
    if (!canPass && beatTargets.length === 1) {
      setSelectedCardId(null);
      onAction({
        type: 'defend',
        playerId: game.myPlayerId,
        cardId: card.id,
        targetIndex: beatTargets[0],
      });
      return;
    }

    // Otherwise select the card so player picks which attack card to beat or clicks Pass Attack
    setSelectedCardId((prev) => (prev === card.id ? null : card.id));
  };

  const handleTableAttackClick = (pairIndex: number) => {
    if (!isDefender || game.subPhase !== 'battle') return;
    if (game.table[pairIndex]?.defense !== null) return;

    if (selectedCard && validTargetsForSelected.has(pairIndex)) {
      onAction({
        type: 'defend',
        playerId: game.myPlayerId,
        cardId: selectedCard.id,
        targetIndex: pairIndex,
      });
      setSelectedCardId(null);
    }
  };

  // Precisely determine which seat(s) are currently expected to act!
  const activeTurnIndices = useMemo(() => {
    const set = new Set<number>();
    if (game.phase !== 'playing') return set;
    if (game.subPhase === 'initial_attack') {
      set.add(game.attackerIndex);
      return set;
    }
    if (game.subPhase === 'battle' && undefendedIndices.length > 0) {
      set.add(game.defenderIndex);
      return set;
    }
    // All attacks defended OR defender taking -> eligible attackers who haven't passed and still hold cards
    const eligible = getEligibleAttackerIndices(engineAdapter);
    for (const idx of eligible) {
      const p = game.players[idx];
      if (p && !p.isOut && p.cardCount > 0 && !game.passedPlayerIds.includes(p.id)) {
        set.add(idx);
      }
    }
    return set;
  }, [
    engineAdapter,
    game.attackerIndex,
    game.defenderIndex,
    game.passedPlayerIds,
    game.phase,
    game.players,
    game.subPhase,
    undefendedIndices.length,
  ]);

  const getRoleBadge = (seatIdx: number, player: PublicPlayerState) => {
    if (game.phase === 'finished') {
      if (game.durakId === player.id) {
        return { icon: null, text: 'DURAK', cls: 'role-durak' };
      }
      if (player.finishOrder) {
        return { icon: <IconTrophy size={12} />, text: `#${player.finishOrder}`, cls: 'role-winner' };
      }
    }
    if (player.isOut) {
      return { icon: <IconTrophy size={12} />, text: `Out #${player.finishOrder}`, cls: 'role-winner' };
    }
    if (seatIdx === game.defenderIndex) {
      return game.subPhase === 'taking'
        ? { icon: <IconHand size={12} />, text: 'Taking', cls: 'role-taking' }
        : { icon: <IconShield size={12} />, text: 'Defender', cls: 'role-defender' };
    }
    if (seatIdx === game.attackerIndex) {
      return { icon: <IconSword size={12} />, text: 'Attacker', cls: 'role-attacker' };
    }
    if (game.passedPlayerIds.includes(player.id)) {
      return { icon: null, text: 'Passed', cls: 'role-passed' };
    }
    return null;
  };

  const getTurnPrompt = (): string => {
    if (game.phase === 'finished') {
      return game.lastActionText;
    }
    if (isSpectator) {
      return botsPaused
        ? 'AI Battle Paused — press Resume to continue.'
        : game.lastActionText;
    }
    const attackerName = game.players[game.attackerIndex]?.name ?? 'Attacker';
    const defenderName = game.players[game.defenderIndex]?.name ?? 'Defender';

    if (game.subPhase === 'initial_attack') {
      return isMainAttacker
        ? 'Your turn to lead the attack — play any card from your hand.'
        : `Waiting for ${attackerName} to start the attack...`;
    }
    if (game.subPhase === 'taking') {
      if (isDefender) {
        return 'You called Take — waiting for attackers to throw in or finish...';
      }
      if (canPassTurnNow) {
        const hasThrowIn = sortedHand.some((c) => isCardPlayable(c));
        return hasThrowIn
          ? `${defenderName} is taking! Throw in matching ranks or click "Done".`
          : `${defenderName} is taking! No matching ranks to add — click "Done".`;
      }
      return `${defenderName} is taking the table...`;
    }
    // battle
    if (!allAttacksDefended(game)) {
      if (isDefender) {
        if (selectedCard) {
          return selectedCanPassAttack
            ? 'Click a glowing attack card to defend, or click "Pass Attack".'
            : 'Click a glowing attack card on the table to beat it.';
        }
        return 'Defend! Click a highlighted card in your hand to beat an attack, or Take.';
      }
      return `${defenderName} is defending...`;
    }
    // all attacks defended
    if (canPassTurnNow) {
      const hasThrowIn = sortedHand.some((c) => isCardPlayable(c));
      return hasThrowIn
        ? 'All defended! Throw in a matching rank or click "Discard (Pass)".'
        : 'All defended! Click "Discard (Pass)" to end the bout.';
    }
    return 'All attacks defended — waiting for attackers to pass...';
  };

  const maxAttacks = getMaxTableAttacks(game);
  const durakPlayer = game.players.find((p) => p.id === game.durakId);

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput('');
  };

  return (
    <div className="table-shell">
      {/* Top HUD */}
      <header className="table-hud">
        <div className="hud-left">
          <span className="hud-brand">DURAK</span>
          <span className="hud-chip hud-desktop-only">Room {roomCode}</span>
          <span className="hud-chip hud-desktop-only">{game.settings.deckSize}-Card</span>
          <span className="hud-chip hud-desktop-only">
            {game.settings.variant === 'passing' ? 'Passing' : 'Classic'}
          </span>
          <span className="hud-chip hud-bout-chip">#{game.boutNumber}</span>
          <span className={`hud-chip hud-trump hud-suit-${game.trumpSuit}`}>
            <span className="hud-desktop-only">Trump:</span>
            <SuitIcon suit={game.trumpSuit} className="hud-suit-svg" />
            <strong>{SUIT_NAMES[game.trumpSuit]}</strong>
          </span>
        </div>

        <div className="hud-right">
          {role === 'guest' && rttMs !== null && (
            <span className="hud-chip hud-rtc hud-desktop-only">Online</span>
          )}
          <button
            type="button"
            className={`btn btn-xs btn-icon-row hud-desktop-only ${fourColorDeck ? 'btn-gold' : 'btn-ghost'}`}
            onClick={onToggleFourColorDeck}
            title="Use distinct colors for all four suits (Black Spades, Red Hearts, Blue Diamonds, Green Clubs)"
          >
            <IconPalette size={14} />
            <span>{fourColorDeck ? '4-Color: ON' : '4-Color'}</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-icon-row hud-desktop-only"
            onClick={onToggleSound}
            title={soundEnabled ? 'Mute sound effects' : 'Enable sound effects'}
          >
            {soundEnabled ? <IconSoundOn size={14} /> : <IconSoundOff size={14} />}
            <span>{soundEnabled ? 'Sound' : 'Muted'}</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-icon-row"
            onClick={() => {
              setMenuOpen(false);
              setChatOpen((v) => !v);
            }}
            title="Table chat"
          >
            <IconChat size={14} />
            {chatMessages.length > 0 && <span>{chatMessages.length}</span>}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-icon-row hud-desktop-only"
            onClick={onOpenRules}
          >
            <IconBook size={14} />
            <span>Rules</span>
          </button>
          {role === 'host' && (
            <button
              type="button"
              className="btn btn-ghost btn-xs hud-desktop-only"
              onClick={onReturnToLobby}
            >
              Lobby
            </button>
          )}
          <button
            type="button"
            className="btn btn-danger-ghost btn-xs hud-desktop-only"
            onClick={onLeave}
          >
            Leave
          </button>

          {/* Compact Mobile Menu Toggle */}
          <button
            type="button"
            className="btn btn-secondary btn-xs btn-icon-only hud-mobile-only"
            aria-label="Match menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setChatOpen(false);
              setMenuOpen((v) => !v);
            }}
          >
            {menuOpen ? <IconClose size={15} /> : <IconMenu size={15} />}
          </button>
        </div>

        {menuOpen && (
          <div className="mobile-hud-menu hud-mobile-only">
            <div className="mobile-menu-meta">
              <span>Room <strong>{roomCode}</strong></span>
              <span>· {game.settings.deckSize}-Card {game.settings.variant === 'passing' ? 'Passing' : 'Classic'}</span>
            </div>
            <div className="mobile-menu-grid">
              <button
                type="button"
                className={`btn btn-sm btn-icon-row ${fourColorDeck ? 'btn-gold' : 'btn-secondary'}`}
                onClick={onToggleFourColorDeck}
              >
                <IconPalette size={14} />
                <span>{fourColorDeck ? '4-Color: ON' : '4-Color Suits'}</span>
              </button>
              <button type="button" className="btn btn-secondary btn-sm btn-icon-row" onClick={onToggleSound}>
                {soundEnabled ? <IconSoundOn size={14} /> : <IconSoundOff size={14} />}
                <span>{soundEnabled ? 'Sound: ON' : 'Muted'}</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm btn-icon-row"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenRules();
                }}
              >
                <IconBook size={14} />
                <span>Rules</span>
              </button>
              {role === 'host' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setMenuOpen(false);
                    onReturnToLobby();
                  }}
                >
                  Back to Lobby
                </button>
              )}
              <button
                type="button"
                className="btn btn-danger-ghost btn-sm"
                onClick={() => {
                  setMenuOpen(false);
                  onLeave();
                }}
              >
                Leave Match
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Felt Arena */}
      <main className={`felt-board players-${game.players.length}`}>
        {/* Compact mobile-only opponents + deck top bar (hidden on desktop) */}
        <div className="mobile-top-strip">
          <div className="mobile-opponents-row">
            {opponents.map(({ player, seatIdx }) => {
              const badge = getRoleBadge(seatIdx, player);
              const isActing = activeTurnIndices.has(seatIdx);
              const activeCls = isActing
                ? seatIdx === game.defenderIndex
                  ? 'seat-acting-def'
                  : 'seat-acting-atk'
                : '';
              return (
                <div key={`m-${player.id}`} className={`mobile-opp-pill ${activeCls}`}>
                  <div className="mobile-opp-line">
                    <span className="seat-type-icon">
                      {player.type === 'bot' ? <IconBot size={13} /> : <IconUser size={13} />}
                    </span>
                    <span className="mobile-opp-name">{player.name}</span>
                    {isActing && player.type === 'bot' && (
                      <span className="thinking-dots" aria-label="Thinking">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                    <span className="opponent-count">{player.cardCount}</span>
                  </div>
                  {badge && (
                    <span className={`role-pill role-pill-xs ${badge.cls}`}>
                      {badge.icon}
                      <span>{badge.text}</span>
                    </span>
                  )}
                  {isSpectator && showAllHands && game.revealedHands?.[player.id] && (
                    <div className="mobile-revealed-chips" aria-label={`${player.name}'s cards`}>
                      {sortHand(game.revealedHands[player.id], game.trumpSuit, 'suit').map((c) => (
                        <span
                          key={c.id}
                          className={`mini-card-chip hud-suit-${c.suit} ${
                            c.suit === game.trumpSuit ? 'mini-chip-trump' : ''
                          }`}
                        >
                          {c.rank <= 10 ? c.rank : ['J', 'Q', 'K', 'A'][c.rank - 11]}
                          <SuitIcon suit={c.suit} className="mini-chip-suit" />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mobile-deck-strip">
            <span className="mobile-deck-pill">
              Deck: <strong>{game.deckCount}</strong>
            </span>
            {game.deckCount > 0 && (
              <span className={`mobile-deck-pill mobile-trump-mini hud-suit-${game.trumpSuit}`}>
                <SuitIcon suit={game.trumpSuit} className="mobile-mini-suit-svg" />
                <strong>{game.trumpCard.rank <= 10 ? game.trumpCard.rank : ['J', 'Q', 'K', 'A'][game.trumpCard.rank - 11]}</strong>
              </span>
            )}
            <span className="mobile-deck-pill">
              Discard: <strong>{game.discardCount}</strong>
            </span>
          </div>
        </div>

        {/* Desktop Opponent seats */}
        {opponents.map(({ player, seatIdx, position }) => {
          const badge = getRoleBadge(seatIdx, player);
          const isActing = activeTurnIndices.has(seatIdx);
          const activeCls = isActing
            ? seatIdx === game.defenderIndex
              ? 'seat-acting-def'
              : 'seat-acting-atk'
            : '';
          const fanCount = Math.min(player.cardCount, 9);
          return (
            <div
              key={player.id}
              className={`opponent-seat opponent-${position} ${activeCls}`}
            >
              <div className="opponent-header">
                <span className="opponent-icon">
                  {player.type === 'bot' ? <IconBot size={15} /> : <IconUser size={15} />}
                </span>
                <span className="opponent-name">{player.name}</span>
                {player.type === 'bot' && player.botDifficulty && (
                  <span className={`tag tag-bot tag-bot-${player.botDifficulty}`}>
                    {BOT_DIFFICULTY_LABELS[player.botDifficulty]}
                  </span>
                )}
                <span className="opponent-count">{player.cardCount}</span>
              </div>
              <div className="opponent-role-row">
                {badge && (
                  <div className={`role-pill ${badge.cls}`}>
                    {badge.icon}
                    <span>{badge.text}</span>
                  </div>
                )}
                {isActing && player.type === 'bot' && (
                  <span className="thinking-dots" aria-label="Thinking">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
              {isSpectator && showAllHands && game.revealedHands?.[player.id] ? (
                <div className="opponent-revealed-fan" aria-label={`${player.name}'s revealed hand`}>
                  {sortHand(game.revealedHands[player.id], game.trumpSuit, 'suit').map((c) => (
                    <PlayingCard
                      key={c.id}
                      card={c}
                      isTrump={c.suit === game.trumpSuit}
                      size="sm"
                      className="revealed-opp-card"
                    />
                  ))}
                </div>
              ) : (
                <div className="opponent-fan" aria-label={`${player.cardCount} cards`}>
                  {Array.from({ length: fanCount }).map((_, idx) => (
                    <PlayingCard
                      key={idx}
                      faceDown
                      size="xs"
                      className="fan-mini-card"
                      style={{
                        transform: `translateX(${(idx - (fanCount - 1) / 2) * 14}px) rotate(${(idx - (fanCount - 1) / 2) * 4}deg)`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Left Deck / Talon */}
        <aside className="deck-zone">
          <div className="zone-caption">Draw Pile</div>
          <div className="talon-wrap">
            {game.deckCount > 0 ? (
              <>
                <PlayingCard
                  card={game.trumpCard}
                  isTrump
                  size="sm"
                  className="trump-peek-card"
                  title={`Trump card: ${game.trumpCard.rank} of ${game.trumpSuit}`}
                />
                {game.deckCount > 1 && (
                  <div
                    className={`talon-stack ${
                      game.deckCount >= 14
                        ? 'stack-thick'
                        : game.deckCount >= 6
                          ? 'stack-med'
                          : 'stack-thin'
                    }`}
                  >
                    <PlayingCard faceDown size="sm" />
                    <span className="talon-count">{game.deckCount}</span>
                  </div>
                )}
                {game.deckCount === 1 && (
                  <span className="talon-count talon-count-last">1</span>
                )}
              </>
            ) : (
              <div className={`empty-talon hud-suit-${game.trumpSuit}`} title="Deck is empty">
                <SuitIcon suit={game.trumpSuit} className="empty-talon-svg" />
                <span className="empty-talon-label">{SUIT_NAMES[game.trumpSuit]}</span>
              </div>
            )}
          </div>
        </aside>

        {/* Right Side (Desktop Symmetry): Visual Discard Pile + Recent Moves */}
        <aside className="side-right-zone">
          <div className="zone-caption">Discard ({game.discardCount})</div>
          <div className="discard-visual" title={`${game.discardCount} cards discarded`}>
            {game.discardCount > 0 ? (
              <div className="discard-stack">
                {game.discardCount >= 6 && (
                  <PlayingCard faceDown size="sm" className="discard-ghost discard-ghost-2" />
                )}
                {game.discardCount >= 2 && (
                  <PlayingCard faceDown size="sm" className="discard-ghost discard-ghost-1" />
                )}
                <PlayingCard faceDown size="sm" className="discard-top-card" />
                <span className="discard-count-badge">{game.discardCount}</span>
              </div>
            ) : (
              <div className="empty-discard-slot">
                <span>None</span>
              </div>
            )}
          </div>

          <div className="mini-log-panel">
            <div className="mini-log-title">Recent Plays</div>
            <div className="mini-log-list">
              {game.actionLog.slice(-4).map((entry) => (
                <div key={entry.id} className="mini-log-entry">
                  {entry.text}
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Center Table Pairs */}
        <section className="battle-arena" aria-label="Battle table">
          {game.table.length === 0 ? (
            <div className="empty-arena-hint">
              <div className={`arena-emblem hud-suit-${game.trumpSuit}`}>
                <SuitIcon suit={game.trumpSuit} className="arena-emblem-svg" />
              </div>
              <p>Bout #{game.boutNumber} · Trump: {SUIT_NAMES[game.trumpSuit]}</p>
            </div>
          ) : (
            <div className="table-pairs">
              {game.table.map((pair, idx) => {
                const isTargetable = validTargetsForSelected.has(idx);
                return (
                  <div key={`${pair.attack.id}-${idx}`} className="table-pair">
                    <PlayingCard
                      card={pair.attack}
                      isTrump={pair.attack.suit === game.trumpSuit}
                      highlightTarget={isTargetable}
                      size="md"
                      onClick={isTargetable ? () => handleTableAttackClick(idx) : undefined}
                    />
                    {pair.defense && (
                      <div className="defense-overlay">
                        <PlayingCard
                          card={pair.defense}
                          isTrump={pair.defense.suit === game.trumpSuit}
                          size="md"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="arena-meta">
            <span className="arena-last-text">{game.lastActionText}</span>
            <span className="arena-cap">
              Table {game.table.length}/{maxAttacks}
            </span>
          </div>
        </section>

        {/* Bottom Player Dock */}
        <section
          className={`player-dock ${
            activeTurnIndices.has(bottomIndex)
              ? bottomIndex === game.defenderIndex
                ? 'dock-acting-def'
                : 'dock-acting-atk'
              : ''
          }`}
        >
          <div className="prompt-strip">
            <div className="prompt-text">{getTurnPrompt()}</div>
            <div className="action-buttons">
              {isSpectator && (
                <>
                  <button
                    type="button"
                    className={`btn btn-xs btn-icon-row ${botsPaused ? 'btn-gold' : 'btn-secondary'}`}
                    onClick={onToggleBotsPaused}
                  >
                    {botsPaused ? <IconPlay size={12} /> : <IconPause size={12} />}
                    <span>{botsPaused ? 'Resume' : 'Pause'}</span>
                  </button>
                  <div className="speed-pills" role="group" aria-label="AI playback speed">
                    {BOT_SPEEDS.map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        className={`speed-pill ${botSpeed === spd ? 'active' : ''}`}
                        onClick={() => onChangeBotSpeed(spd)}
                      >
                        {spd}×
                      </button>
                    ))}
                  </div>
                  {game.revealedHands && (
                    <button
                      type="button"
                      className={`btn btn-xs btn-icon-row ${showAllHands ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setShowAllHands((v) => !v)}
                    >
                      <IconEye size={13} />
                      <span>{showAllHands ? 'Hands: Open' : 'Hands: Hidden'}</span>
                    </button>
                  )}
                </>
              )}

              {selectedCard && selectedCanPassAttack && (
                <button
                  type="button"
                  className="btn btn-gold btn-sm"
                  onClick={() => {
                    onAction({
                      type: 'pass_attack',
                      playerId: game.myPlayerId,
                      cardId: selectedCard.id,
                    });
                    setSelectedCardId(null);
                  }}
                >
                  Pass Attack
                </button>
              )}

              {canTakeNow && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    setSelectedCardId(null);
                    onAction({ type: 'take', playerId: game.myPlayerId });
                  }}
                >
                  Take Cards
                </button>
              )}

              {canPassTurnNow && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setSelectedCardId(null);
                    onAction({ type: 'pass_turn', playerId: game.myPlayerId });
                  }}
                >
                  {game.subPhase === 'taking' ? 'Done Throwing In' : 'Discard (Pass)'}
                </button>
              )}
            </div>
          </div>

          <div className="my-info-bar">
            <div className="my-identity">
              {isSpectator && (
                <span className="tag tag-gold">Spectating</span>
              )}
              <strong>{me?.name ?? 'You'}</strong>
              {isSpectator && me?.botDifficulty && (
                <span className={`tag tag-bot tag-bot-${me.botDifficulty}`}>
                  {BOT_DIFFICULTY_LABELS[me.botDifficulty]}
                </span>
              )}
              <span className="muted-tiny">({me?.cardCount ?? sortedHand.length} cards)</span>
              {me && (() => {
                const badge = getRoleBadge(bottomIndex, me);
                return badge ? (
                  <span className={`role-pill ${badge.cls}`}>
                    {badge.icon}
                    <span>{badge.text}</span>
                  </span>
                ) : null;
              })()}
              {isSpectator && activeTurnIndices.has(bottomIndex) && !botsPaused && (
                <span className="thinking-dots" aria-label="Thinking">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </div>

            <button
              type="button"
              className="btn btn-ghost btn-xs btn-icon-row"
              onClick={() => setSortMode((m) => (m === 'suit' ? 'rank' : 'suit'))}
            >
              <IconSort size={13} />
              <span>{sortMode === 'suit' ? 'By Suit' : 'By Rank'}</span>
            </button>
          </div>

          <div className="hand-tray">
            {isSpectator && !showAllHands ? (
              Array.from({ length: Math.min(me?.cardCount ?? 0, 10) }).map((_, idx) => (
                <PlayingCard
                  key={`spec-back-${idx}`}
                  faceDown
                  size="lg"
                  className="hand-card"
                />
              ))
            ) : sortedHand.length === 0 ? (
              <div className="empty-hand-msg">
                {me?.isOut
                  ? isSpectator
                    ? `${me.name} emptied their hand!`
                    : 'You emptied your hand — safe from being the Durak!'
                  : 'No cards in hand.'}
              </div>
            ) : (
              sortedHand.map((card) => {
                const playable = !isSpectator && isCardPlayable(card);
                return (
                  <PlayingCard
                    key={card.id}
                    card={card}
                    isTrump={card.suit === game.trumpSuit}
                    selected={!isSpectator && selectedCardId === card.id}
                    playable={playable}
                    disabled={!isSpectator && !playable}
                    size="lg"
                    className="hand-card"
                    onClick={isSpectator ? undefined : () => handleCardClick(card)}
                  />
                );
              })
            )}
          </div>
        </section>
      </main>

      {/* Collapsible Chat Drawer */}
      {chatOpen && (
        <aside className="chat-drawer">
          <div className="drawer-head">
            <h3>Table Chat</h3>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setChatOpen(false)}>
              ✕
            </button>
          </div>
          <div className="chat-feed">
            {chatMessages.map((m) => (
              <div key={m.id} className={`chat-line ${m.isSystem ? 'chat-system' : ''}`}>
                {!m.isSystem && <strong>{m.senderName}: </strong>}
                <span>{m.text}</span>
              </div>
            ))}
          </div>
          <div className="quick-emotes">
            {QUICK_EMOTES.map((q) => (
              <button
                key={q}
                type="button"
                className="emote-chip"
                onClick={() => onSendChat(q)}
              >
                {q}
              </button>
            ))}
          </div>
          <form className="chat-form" onSubmit={handleChatSubmit}>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Message table..."
              maxLength={220}
            />
            <button type="submit" className="btn btn-secondary btn-sm">
              Send
            </button>
          </form>
        </aside>
      )}

      {/* Game Over Overlay */}
      {game.phase === 'finished' && (
        <div className="modal-backdrop">
          <div className="modal-card gameover-card">
            <div className="gameover-emblem">{game.isDraw ? '🤝' : '🃏'}</div>
            <h2>
              {game.isDraw
                ? 'It’s a Draw!'
                : `${durakPlayer?.name ?? 'Someone'} is the Durak!`}
            </h2>
            <p className="muted">
              {game.isDraw
                ? 'Everyone cleared their hand on the final bout.'
                : isSpectator
                  ? 'AI battle complete! Deal again or tweak bot difficulties in the lobby.'
                  : game.durakId === game.myPlayerId
                    ? 'You were the last player holding cards — better luck next deal!'
                    : 'Well played! You escaped being the Durak.'}
            </p>

            <div className="standings-list">
              {game.winnerIds.map((wid, i) => {
                const p = game.players.find((pl) => pl.id === wid);
                return (
                  <div key={wid} className="standing-row">
                    <span>🏆 #{i + 1}</span>
                    <strong>{p?.name}</strong>
                    <span className="muted-tiny">Winner</span>
                  </div>
                );
              })}
              {durakPlayer && (
                <div className="standing-row standing-durak">
                  <span>🃏 Last</span>
                  <strong>{durakPlayer.name}</strong>
                  <span className="muted-tiny">Durak ({durakPlayer.cardCount} left)</span>
                </div>
              )}
            </div>

            <div className="gameover-stats">
              <span>Bouts: {game.boutNumber}</span>
              <span>Discarded: {game.discardCount}</span>
            </div>

            <div className="modal-actions">
              {role === 'host' ? (
                <>
                  <button type="button" className="btn btn-gold" onClick={onPlayAgain}>
                    Deal Again
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={onReturnToLobby}>
                    Back to Lobby
                  </button>
                </>
              ) : (
                <p className="muted-small">Waiting for host to deal again or return to lobby...</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
