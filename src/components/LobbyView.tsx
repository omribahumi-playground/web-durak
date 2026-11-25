import React, { useState } from 'react';
import {
  BOT_DIFFICULTIES,
  BOT_DIFFICULTY_LABELS,
  BotDifficulty,
  ChatMessage,
  GameSettings,
  LobbyState,
} from '../game/types';
import { PublicServerInfo } from '../net/publicServer';
import { SignalingStatus } from '../net/webrtc';

interface LobbyViewProps {
  role: 'host' | 'guest';
  lobby: LobbyState;
  myPlayerId: string;
  signalingStatus: SignalingStatus;
  guestStatus: string;
  connectionNote: string;
  rttMs: number | null;
  chatMessages: ChatMessage[];
  fourColorDeck: boolean;
  isPublicTable: boolean;
  publicTableTitle: string;
  activeServer: PublicServerInfo;
  allServers: PublicServerInfo[];
  onTogglePublicTable: (next: boolean) => void;
  onPublicTableTitleChange: (title: string) => void;
  onSelectPublicServer: (serverId: string) => void;
  onPostInviteToServerChat: () => void;
  onToggleFourColorDeck: () => void;
  onUpdateSettings: (patch: Partial<GameSettings>) => void;
  onToggleSeatBot: (seatIndex: number) => void;
  onSetSeatBotDifficulty: (seatIndex: number, difficulty: BotDifficulty) => void;
  onFillWithBots: () => void;
  onStartGame: () => void;
  onSendChat: (text: string) => void;
  onCreateManualInvite: () => Promise<{ peerId: string; offerCode: string }>;
  onApplyManualAnswer: (peerId: string, answerCode: string) => Promise<void>;
  onOpenRules: () => void;
  onLeave: () => void;
}

const DIFFICULTY_DESCRIPTIONS: Record<BotDifficulty, string> = {
  easy: 'Relaxed play with occasional suboptimal moves — great for learning.',
  normal: 'Solid fundamentals: smart trump conservation, pair leads, and tactical takes.',
  hard: 'Optimal multi-card defense planning, rank-safe play, and strong endgame pressure.',
  extreme: 'Relentless card-tracking, tempo exploitation, and endgame lookahead.',
  master: 'Full card memory, exact 1v1 Alpha-Beta endgame solver, and Monte Carlo mid-game search.',
};

export const LobbyView: React.FC<LobbyViewProps> = ({
  role,
  lobby,
  myPlayerId,
  signalingStatus,
  guestStatus,
  connectionNote,
  rttMs,
  chatMessages,
  fourColorDeck,
  isPublicTable,
  publicTableTitle,
  activeServer,
  allServers,
  onTogglePublicTable,
  onPublicTableTitleChange,
  onSelectPublicServer,
  onPostInviteToServerChat,
  onToggleFourColorDeck,
  onUpdateSettings,
  onToggleSeatBot,
  onSetSeatBotDifficulty,
  onFillWithBots,
  onStartGame,
  onSendChat,
  onCreateManualInvite,
  onApplyManualAnswer,
  onOpenRules,
  onLeave,
}) => {
  const [copied, setCopied] = useState<'code' | 'link' | 'offer' | 'invite' | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manualPending, setManualPending] = useState<{ peerId: string; offerCode: string } | null>(null);
  const [manualAnswerInput, setManualAnswerInput] = useState('');
  const [manualMsg, setManualMsg] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  const isHost = role === 'host';
  const filledCount = lobby.seats.filter((s) => s.kind !== 'open').length;
  const openCount = lobby.seats.length - filledCount;

  const copyText = (text: string, which: 'code' | 'link' | 'offer') => {
    void navigator.clipboard?.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?join=${lobby.roomCode}`
      : '';

  const handleGenerateOffer = async () => {
    setManualMsg('');
    setManualBusy(true);
    try {
      const offer = await onCreateManualInvite();
      setManualPending(offer);
    } catch (err) {
      setManualMsg(err instanceof Error ? err.message : 'Failed to create invite.');
    } finally {
      setManualBusy(false);
    }
  };

  const handleApplyAnswer = async () => {
    if (!manualPending) return;
    setManualMsg('');
    setManualBusy(true);
    try {
      await onApplyManualAnswer(manualPending.peerId, manualAnswerInput);
      setManualPending(null);
      setManualAnswerInput('');
      setManualMsg('WebRTC DataChannel handshake sent! Waiting for peer to appear in a seat.');
    } catch (err) {
      setManualMsg(err instanceof Error ? err.message : 'Invalid answer code.');
    } finally {
      setManualBusy(false);
    }
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput('');
  };

  return (
    <div className="lobby-shell">
      <header className="lobby-header">
        <div>
          <span className="eyebrow">WebRTC Multiplayer Table</span>
          <h1>Durak Lobby</h1>
        </div>

        <div className="lobby-header-actions">
          <div className={`status-pill status-${isHost ? signalingStatus : guestStatus}`}>
            <span className="status-dot" />
            {isHost
              ? signalingStatus === 'connected'
                ? 'WebRTC P2P Room Live'
                : signalingStatus === 'connecting'
                  ? 'Opening P2P Room...'
                  : 'Offline Mode (Bots & Direct P2P)'
              : guestStatus === 'connected'
                ? `WebRTC P2P Live${rttMs !== null ? ` · ${rttMs}ms` : ''}`
                : `Status: ${guestStatus}`}
          </div>
          <button
            type="button"
            className={`btn btn-sm ${fourColorDeck ? 'btn-gold' : 'btn-ghost'}`}
            onClick={onToggleFourColorDeck}
            title="Use distinct colors for all four suits (Spades Black, Hearts Red, Diamonds Blue, Clubs Green)"
          >
            {fourColorDeck ? '🎨 4-Color Deck: ON' : '🎨 4-Color Deck'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onOpenRules}>
            Rules
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      <div className="lobby-grid">
        {/* Left Column: Invite & Seats */}
        <div className="lobby-main">
          {/* Room Code Banner */}
          <section className="panel room-code-panel">
            <div className="room-code-block">
              <span className="muted-label">ROOM CODE</span>
              <div className="room-code-value">{lobby.roomCode}</div>
              {connectionNote && <p className="muted-small">{connectionNote}</p>}
            </div>

            <div className="room-code-buttons">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => copyText(lobby.roomCode, 'code')}
              >
                {copied === 'code' ? 'Copied Code!' : 'Copy Code'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => copyText(shareUrl, 'link')}
              >
                {copied === 'link' ? 'Copied Link!' : 'Copy Invite Link'}
              </button>
              {isHost && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowManual((v) => !v)}
                >
                  {showManual ? 'Hide Direct P2P' : 'Direct P2P Code'}
                </button>
              )}
            </div>
          </section>

          {isHost && showManual && (
            <section className="panel manual-panel">
              <h3>Direct Serverless WebRTC Handshake</h3>
              <p className="muted-small">
                Connect a friend over WebRTC with zero signaling server by exchanging Offer &amp; Answer codes.
              </p>
              {!manualPending ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={manualBusy}
                  onClick={() => void handleGenerateOffer()}
                >
                  {manualBusy ? 'Gathering ICE...' : '1. Generate Offer Code for Friend'}
                </button>
              ) : (
                <div className="manual-steps">
                  <div>
                    <div className="manual-row-head">
                      <label>1. Copy &amp; send this Offer Code to your friend:</label>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => copyText(manualPending.offerCode, 'offer')}
                      >
                        {copied === 'offer' ? 'Copied!' : 'Copy Offer'}
                      </button>
                    </div>
                    <textarea readOnly rows={2} value={manualPending.offerCode} />
                  </div>
                  <div>
                    <label>2. Paste your friend&apos;s Answer Code here:</label>
                    <textarea
                      rows={2}
                      value={manualAnswerInput}
                      onChange={(e) => setManualAnswerInput(e.target.value)}
                      placeholder="Paste guest's Answer code..."
                    />
                  </div>
                  <div className="manual-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!manualAnswerInput.trim() || manualBusy}
                      onClick={() => void handleApplyAnswer()}
                    >
                      Connect Peer
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setManualPending(null);
                        setManualAnswerInput('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {manualMsg && <p className="muted-small">{manualMsg}</p>}
            </section>
          )}

          {isHost && (
            <section className="panel public-listing-panel">
              <div className="section-head">
                <div>
                  <h2>Server Discovery</h2>
                  <p className="muted-small">
                    Keep your room private (code only) or list it in a Public Server so others can find and join it.
                  </p>
                </div>
                <div className="segmented-control compact-seg">
                  <button
                    type="button"
                    className={`seg-btn ${!isPublicTable ? 'active' : ''}`}
                    onClick={() => onTogglePublicTable(false)}
                  >
                    Private
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${isPublicTable ? 'active' : ''}`}
                    onClick={() => onTogglePublicTable(true)}
                  >
                    Public
                  </button>
                </div>
              </div>

              {isPublicTable && (
                <div className="public-listing-fields">
                  <div className="listing-field">
                    <label htmlFor="public-server-select">Public Server</label>
                    <select
                      id="public-server-select"
                      className="bot-level-select full-select"
                      value={activeServer.id}
                      onChange={(e) => onSelectPublicServer(e.target.value)}
                    >
                      {allServers.map((srv) => (
                        <option key={srv.id} value={srv.id}>
                          {srv.icon} {srv.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="listing-field">
                    <label htmlFor="public-table-title">Table Title</label>
                    <input
                      id="public-table-title"
                      type="text"
                      maxLength={40}
                      value={publicTableTitle}
                      onChange={(e) => onPublicTableTitleChange(e.target.value)}
                      placeholder="e.g. Friendly 4-Player Table"
                    />
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      onPostInviteToServerChat();
                      setCopied('invite');
                      setTimeout(() => setCopied(null), 2200);
                    }}
                  >
                    {copied === 'invite'
                      ? `Posted to ${activeServer.name} Chat!`
                      : `📣 Post Invite to ${activeServer.name} Chat`}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Seats */}
          <section className="panel">
            <div className="section-head">
              <div>
                <h2>
                  Table Seats ({filledCount}/{lobby.seats.length})
                </h2>
                <p className="muted-small">
                  Supports 2–4 players with any mix of real WebRTC humans and AI bots.
                </p>
              </div>
              {isHost && openCount > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onFillWithBots}
                >
                  Fill Open with Bots
                </button>
              )}
            </div>

            <div className="seats-list">
              {lobby.seats.map((seat) => {
                const isMe = seat.playerId === myPlayerId;
                return (
                  <div key={seat.seatIndex} className={`seat-row seat-${seat.kind}`}>
                    <div className="seat-avatar">
                      {seat.kind === 'bot' ? '🤖' : seat.kind === 'open' ? '＋' : '👤'}
                    </div>
                    <div className="seat-info">
                      <div className="seat-name">
                        {seat.name}
                        {isMe && <span className="tag tag-you">You</span>}
                        {seat.kind === 'host' && <span className="tag tag-gold">Host</span>}
                        {seat.kind === 'remote' && <span className="tag tag-rtc">WebRTC</span>}
                        {seat.kind === 'bot' && (
                          <span className={`tag tag-bot tag-bot-${seat.botDifficulty ?? lobby.settings.botDifficulty}`}>
                            AI · {BOT_DIFFICULTY_LABELS[seat.botDifficulty ?? lobby.settings.botDifficulty]}
                          </span>
                        )}
                      </div>
                      <div className="seat-sub">
                        Seat {seat.seatIndex + 1} ·{' '}
                        {seat.kind === 'open'
                          ? 'Waiting for friend to join, or add a computer player'
                          : seat.kind === 'bot'
                            ? 'Controlled by local AI engine'
                            : seat.kind === 'host'
                              ? 'Room host'
                              : 'Connected peer-to-peer'}
                      </div>
                    </div>

                    {isHost && seat.seatIndex > 0 && (
                      <div className="seat-controls">
                        {seat.kind === 'open' && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onToggleSeatBot(seat.seatIndex)}
                          >
                            + Add Bot
                          </button>
                        )}
                        {seat.kind === 'bot' && (
                          <>
                            <select
                              className="bot-level-select"
                              aria-label={`${seat.name} difficulty`}
                              value={seat.botDifficulty ?? lobby.settings.botDifficulty}
                              onChange={(e) =>
                                onSetSeatBotDifficulty(
                                  seat.seatIndex,
                                  e.target.value as BotDifficulty,
                                )
                              }
                            >
                              {BOT_DIFFICULTIES.map((lvl) => (
                                <option key={lvl} value={lvl}>
                                  {BOT_DIFFICULTY_LABELS[lvl]}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => onToggleSeatBot(seat.seatIndex)}
                            >
                              Open Seat
                            </button>
                          </>
                        )}
                        {seat.kind === 'remote' && (
                          <button
                            type="button"
                            className="btn btn-danger-ghost btn-sm"
                            onClick={() => onToggleSeatBot(seat.seatIndex)}
                          >
                            Replace w/ Bot
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Start bar */}
          <div className="lobby-start-bar">
            {isHost ? (
              <button
                type="button"
                className="btn btn-gold btn-lg btn-full"
                disabled={filledCount < 2}
                onClick={onStartGame}
              >
                {filledCount < 2
                  ? 'Add a Bot or Wait for a Friend (Min 2 Players)'
                  : `Deal Cards & Start ${filledCount}-Player Match`}
              </button>
            ) : (
              <div className="waiting-banner">
                Waiting for the host to start the match...
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Settings & Chat */}
        <div className="lobby-side">
          <section className="panel settings-panel">
            <h2>Match Rules</h2>

            <div className="setting-group">
              <label>Lobby Size</label>
              <div className="segmented-control">
                {([2, 3, 4] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={!isHost}
                    className={`seg-btn ${lobby.settings.maxPlayers === n ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ maxPlayers: n })}
                  >
                    {n} Players
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-group">
              <label>Deck Size</label>
              <div className="segmented-control">
                {([24, 36, 52] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    disabled={!isHost}
                    className={`seg-btn ${lobby.settings.deckSize === size ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ deckSize: size })}
                  >
                    {size} Cards
                  </button>
                ))}
              </div>
              <p className="muted-tiny">
                {lobby.settings.deckSize === 24
                  ? 'Fast deck (9–A). With 4 players, all 24 cards are dealt at the start and the last card dealt sets trump.'
                  : lobby.settings.deckSize === 52
                    ? 'Full deck (2–A) for longer matches.'
                    : 'Standard Durak deck (6–A).'}
              </p>
            </div>

            <div className="setting-group">
              <label>Game Mode</label>
              <div className="segmented-control">
                <button
                  type="button"
                  disabled={!isHost}
                  className={`seg-btn ${lobby.settings.variant === 'classic' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ variant: 'classic' })}
                >
                  Classic (Throw-in)
                </button>
                <button
                  type="button"
                  disabled={!isHost}
                  className={`seg-btn ${lobby.settings.variant === 'passing' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ variant: 'passing' })}
                >
                  Passing Mode
                </button>
              </div>
              <p className="muted-tiny">
                {lobby.settings.variant === 'passing'
                  ? 'Defender can pass an undefended attack to the next player by playing a card of the same rank.'
                  : 'Classic throw-in rules: attackers may add cards matching any rank on the table.'}
              </p>
            </div>

            <div className="setting-group">
              <label>Computer AI Strength</label>
              <div className="segmented-control">
                {BOT_DIFFICULTIES.map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    disabled={!isHost}
                    className={`seg-btn ${lobby.settings.botDifficulty === lvl ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ botDifficulty: lvl })}
                  >
                    {BOT_DIFFICULTY_LABELS[lvl]}
                  </button>
                ))}
              </div>
              <p className="muted-tiny">
                {DIFFICULTY_DESCRIPTIONS[lobby.settings.botDifficulty]}
              </p>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                disabled={!isHost}
                checked={lobby.settings.firstBoutLimitFive}
                onChange={(e) => onUpdateSettings({ firstBoutLimitFive: e.target.checked })}
              />
              <span>First bout capped at 5 attacks (until first discard)</span>
            </label>

            {lobby.settings.maxPlayers === 4 && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  disabled={!isHost}
                  checked={lobby.settings.neighborsOnlyThrowIn}
                  onChange={(e) => onUpdateSettings({ neighborsOnlyThrowIn: e.target.checked })}
                />
                <span>Only defender&apos;s neighbors can throw in</span>
              </label>
            )}
          </section>

          <section className="panel lobby-chat">
            <h2>Table Chat</h2>
            <div className="chat-feed">
              {chatMessages.length === 0 ? (
                <p className="muted-tiny">Chat messages travel directly over WebRTC DataChannels.</p>
              ) : (
                chatMessages.map((m) => (
                  <div key={m.id} className={`chat-line ${m.isSystem ? 'chat-system' : ''}`}>
                    {!m.isSystem && <strong>{m.senderName}: </strong>}
                    <span>{m.text}</span>
                  </div>
                ))
              )}
            </div>
            <form className="chat-form" onSubmit={handleChatSubmit}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Say hello..."
                maxLength={220}
              />
              <button type="submit" className="btn btn-secondary btn-sm">
                Send
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};
