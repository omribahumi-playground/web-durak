import React, { useMemo, useState } from 'react';
import {
  allAttacksDefended,
  canBeat,
  canDefenderTake,
  canPassAttackCard,
  canPlayAttackCard,
  canPlayerPassTurn,
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
import { PlayingCard, SUIT_NAMES, SuitIcon } from './PlayingCard';

interface GameTableProps {
  role: 'host' | 'guest';
  roomCode: string;
  game: ClientGameState;
  rttMs: number | null;
  soundEnabled: boolean;
  fourColorDeck: boolean;
  chatMessages: ChatMessage[];
  onToggleSound: () => void;
  onToggleFourColorDeck: () => void;
  onAction: (action: GameAction) => void;
  onSendChat: (text: string) => void;
  onPlayAgain: () => void;
  onReturnToLobby: () => void;
  onOpenRules: () => void;
  onLeave: () => void;
}

const QUICK_EMOTES = ['Nice move!', 'Taking it 😅', 'Clean defense!', 'Good game!'];

export const GameTable: React.FC<GameTableProps> = ({
  role,
  roomCode,
  game,
  rttMs,
  soundEnabled,
  fourColorDeck,
  chatMessages,
  onToggleSound,
  onToggleFourColorDeck,
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
  const [chatInput, setChatInput] = useState('');

  const myIndex = game.players.findIndex((p) => p.id === game.myPlayerId);
  const me = game.players[myIndex];
  const isDefender = myIndex === game.defenderIndex;
  const isMainAttacker = myIndex === game.attackerIndex;

  const sortedHand = useMemo(
    () => sortHand(game.myHand, game.trumpSuit, sortMode),
    [game.myHand, game.trumpSuit, sortMode],
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

  // Arrange opponents clockwise starting after local player
  const opponents = useMemo(() => {
    const list: { player: PublicPlayerState; seatIdx: number; position: 'left' | 'top' | 'right' }[] = [];
    const total = game.players.length;
    if (myIndex === -1) return list;

    const ordered: { player: PublicPlayerState; seatIdx: number }[] = [];
    for (let offset = 1; offset < total; offset++) {
      const seatIdx = (myIndex + offset) % total;
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
  }, [game.players, myIndex]);

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

  const getRoleBadge = (seatIdx: number, player: PublicPlayerState) => {
    if (game.phase === 'finished') {
      if (game.durakId === player.id) return { text: '🃏 DURAK', cls: 'role-durak' };
      if (player.finishOrder) return { text: `🏆 #${player.finishOrder}`, cls: 'role-winner' };
    }
    if (player.isOut) {
      return { text: `🏆 Out #${player.finishOrder}`, cls: 'role-winner' };
    }
    if (seatIdx === game.defenderIndex) {
      return game.subPhase === 'taking'
        ? { text: '✋ Taking', cls: 'role-taking' }
        : { text: '🛡️ Defender', cls: 'role-defender' };
    }
    if (seatIdx === game.attackerIndex) {
      return { text: '⚔️ Attacker', cls: 'role-attacker' };
    }
    if (game.passedPlayerIds.includes(player.id)) {
      return { text: '✓ Passed', cls: 'role-passed' };
    }
    return null;
  };

  const getTurnPrompt = (): string => {
    if (game.phase === 'finished') {
      return game.lastActionText;
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
          <span className="hud-chip">Room {roomCode}</span>
          <span className="hud-chip">{game.settings.deckSize}-Card</span>
          <span className="hud-chip">
            {game.settings.variant === 'passing' ? 'Passing' : 'Classic'}
          </span>
          <span className="hud-chip">Bout #{game.boutNumber}</span>
          <span className={`hud-chip hud-trump hud-suit-${game.trumpSuit}`}>
            Trump: <SuitIcon suit={game.trumpSuit} className="hud-suit-svg" />{' '}
            <strong>{SUIT_NAMES[game.trumpSuit]}</strong>
          </span>
        </div>

        <div className="hud-right">
          {role === 'guest' && rttMs !== null && (
            <span className="hud-chip hud-rtc">P2P {rttMs}ms</span>
          )}
          <button
            type="button"
            className={`btn btn-xs ${fourColorDeck ? 'btn-gold' : 'btn-ghost'}`}
            onClick={onToggleFourColorDeck}
            title="Use distinct colors for all four suits (Black Spades, Red Hearts, Blue Diamonds, Green Clubs)"
          >
            {fourColorDeck ? '🎨 4-Color: ON' : '🎨 4-Color Suits'}
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onToggleSound}>
            {soundEnabled ? '🔊 Sound' : '🔇 Muted'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setChatOpen((v) => !v)}
          >
            💬 Chat{chatMessages.length > 0 ? ` (${chatMessages.length})` : ''}
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onOpenRules}>
            Rules
          </button>
          {role === 'host' && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={onReturnToLobby}>
              Lobby
            </button>
          )}
          <button type="button" className="btn btn-danger-ghost btn-xs" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      {/* Main Felt Arena */}
      <main className={`felt-board players-${game.players.length}`}>
        {/* Opponent seats */}
        {opponents.map(({ player, seatIdx, position }) => {
          const badge = getRoleBadge(seatIdx, player);
          const fanCount = Math.min(player.cardCount, 9);
          return (
            <div
              key={player.id}
              className={`opponent-seat opponent-${position} ${
                seatIdx === game.attackerIndex || seatIdx === game.defenderIndex
                  ? 'seat-active'
                  : ''
              }`}
            >
              <div className="opponent-header">
                <span className="opponent-icon">{player.type === 'bot' ? '🤖' : '👤'}</span>
                <span className="opponent-name">{player.name}</span>
                {player.type === 'bot' && player.botDifficulty && (
                  <span className={`tag tag-bot tag-bot-${player.botDifficulty}`}>
                    {BOT_DIFFICULTY_LABELS[player.botDifficulty]}
                  </span>
                )}
                <span className="opponent-count">{player.cardCount}</span>
              </div>
              {badge && <div className={`role-pill ${badge.cls}`}>{badge.text}</div>}
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
            </div>
          );
        })}

        {/* Left Deck / Talon & Discard */}
        <aside className="deck-zone">
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
                  <div className="talon-stack">
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

          <div className="discard-pill" title="Cards discarded after successful defenses">
            <span>Discard</span>
            <strong>{game.discardCount}</strong>
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
            <span>{game.lastActionText}</span>
            <span className="arena-cap">
              Table {game.table.length}/{maxAttacks}
            </span>
          </div>
        </section>

        {/* Bottom Player Dock */}
        <section className="player-dock">
          <div className="prompt-strip">
            <div className="prompt-text">{getTurnPrompt()}</div>
            <div className="action-buttons">
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
              <strong>{me?.name ?? 'You'}</strong>
              <span className="muted-tiny">({sortedHand.length} cards)</span>
              {me && (() => {
                const badge = getRoleBadge(myIndex, me);
                return badge ? (
                  <span className={`role-pill ${badge.cls}`}>{badge.text}</span>
                ) : null;
              })()}
            </div>

            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setSortMode((m) => (m === 'suit' ? 'rank' : 'suit'))}
            >
              Sort: {sortMode === 'suit' ? 'By Suit' : 'By Rank'}
            </button>
          </div>

          <div className="hand-tray">
            {sortedHand.length === 0 ? (
              <div className="empty-hand-msg">
                {me?.isOut
                  ? 'You emptied your hand — safe from being the Durak!'
                  : 'No cards in hand.'}
              </div>
            ) : (
              sortedHand.map((card) => {
                const playable = isCardPlayable(card);
                return (
                  <PlayingCard
                    key={card.id}
                    card={card}
                    isTrump={card.suit === game.trumpSuit}
                    selected={selectedCardId === card.id}
                    playable={playable}
                    disabled={!playable}
                    size="lg"
                    className="hand-card"
                    onClick={() => handleCardClick(card)}
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
