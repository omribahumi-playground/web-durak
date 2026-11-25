import React, { useMemo, useState } from 'react';
import {
  PublicPresence,
  PublicServerInfo,
  PublicTableListing,
  ServerChatMessage,
  ServerConnectionStatus,
} from '../net/publicServer';

interface PublicServerViewProps {
  localName: string;
  onNameChange: (name: string) => void;
  activeServer: PublicServerInfo;
  allServers: PublicServerInfo[];
  status: ServerConnectionStatus;
  brokerLabel: string;
  onlinePlayers: PublicPresence[];
  tables: PublicTableListing[];
  chatMessages: ServerChatMessage[];
  onSelectServer: (serverId: string) => void;
  onJoinCustomServer: (slug: string) => void;
  onSendChat: (text: string) => void;
  onHostPublicTable: (maxPlayers: 2 | 3 | 4) => void;
  onJoinTable: (roomCode: string) => void;
  onBackHome: () => void;
  onOpenRules: () => void;
}

export const PublicServerView: React.FC<PublicServerViewProps> = ({
  localName,
  onNameChange,
  activeServer,
  allServers,
  status,
  brokerLabel,
  onlinePlayers,
  tables,
  chatMessages,
  onSelectServer,
  onJoinCustomServer,
  onSendChat,
  onHostPublicTable,
  onJoinTable,
  onBackHome,
  onOpenRules,
}) => {
  const [customInput, setCustomInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [openOnly, setOpenOnly] = useState(false);

  const filteredTables = useMemo(() => {
    if (!openOnly) return tables;
    return tables.filter((t) => !t.inGame && (t.openSeats > 0 || t.botCount > 0));
  }, [openOnly, tables]);

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    onJoinCustomServer(customInput);
    setCustomInput('');
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput('');
  };

  return (
    <div className="server-shell">
      {/* Header */}
      <header className="lobby-header">
        <div>
          <span className="eyebrow">Zero-Backend Public Directory</span>
          <h1>
            {activeServer.icon} {activeServer.name}
          </h1>
          <p className="muted-small">{activeServer.description}</p>
        </div>

        <div className="lobby-header-actions">
          <div
            className={`status-pill status-${
              status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline'
            }`}
            title={`Connected via ${brokerLabel || 'Public Relay'}`}
          >
            <span className="status-dot" />
            {status === 'connected'
              ? `Live · ${onlinePlayers.length} Online`
              : status === 'connecting'
                ? 'Connecting to Public Relay...'
                : `Local Tab Mode · ${onlinePlayers.length} Online`}
          </div>
          <button type="button" className="btn btn-ghost" onClick={onOpenRules}>
            Rules
          </button>
          <button type="button" className="btn btn-secondary" onClick={onBackHome}>
            ← Home
          </button>
        </div>
      </header>

      {/* Server Switcher Strip */}
      <section className="panel server-switcher-bar">
        <div className="server-pills" role="tablist" aria-label="Public servers">
          {allServers.map((srv) => (
            <button
              key={srv.id}
              type="button"
              role="tab"
              aria-selected={srv.id === activeServer.id}
              className={`server-pill ${srv.id === activeServer.id ? 'active' : ''}`}
              onClick={() => onSelectServer(srv.id)}
            >
              <span>{srv.icon}</span>
              <span>{srv.name}</span>
            </button>
          ))}
        </div>

        <form className="custom-server-form" onSubmit={handleCustomSubmit}>
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder="Custom server (e.g. friday-club)"
            maxLength={32}
            aria-label="Custom server name"
          />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={!customInput.trim()}>
            Go
          </button>
        </form>
      </section>

      {/* Main Split: Tables Directory + Global Server Chat */}
      <div className="server-grid">
        {/* Left: Live Tables */}
        <section className="panel server-tables-panel">
          <div className="section-head">
            <div>
              <h2>Public Tables ({filteredTables.length})</h2>
              <p className="muted-small">
                Click any open table to connect directly via WebRTC DataChannels.
              </p>
            </div>

            <div className="table-toolbar">
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={openOnly}
                  onChange={(e) => setOpenOnly(e.target.checked)}
                />
                <span>Joinable only</span>
              </label>
              <button
                type="button"
                className="btn btn-gold btn-sm"
                onClick={() => onHostPublicTable(4)}
              >
                + Host Public Table
              </button>
            </div>
          </div>

          {filteredTables.length === 0 ? (
            <div className="empty-tables-box">
              <div className="empty-tables-icon">🃏</div>
              <h3>No open tables in {activeServer.name} yet</h3>
              <p className="muted">
                Start a public table here and anyone browsing <strong>{activeServer.name}</strong> can join in one click—or fill remaining seats with AI bots.
              </p>
              <div className="empty-tables-actions">
                <button
                  type="button"
                  className="btn btn-gold"
                  onClick={() => onHostPublicTable(2)}
                >
                  Host 2-Player Table
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onHostPublicTable(3)}
                >
                  Host 3-Player Table
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onHostPublicTable(4)}
                >
                  Host 4-Player Table
                </button>
              </div>
            </div>
          ) : (
            <div className="public-tables-list">
              {filteredTables.map((t) => {
                const canJoin = !t.inGame && (t.openSeats > 0 || t.botCount > 0);
                return (
                  <div
                    key={t.roomCode}
                    className={`public-table-card ${t.inGame ? 'table-in-game' : ''}`}
                  >
                    <div className="public-table-info">
                      <div className="public-table-top">
                        <strong>{t.title}</strong>
                        <span className={`tag ${t.inGame ? 'tag-bot' : 'tag-rtc'}`}>
                          {t.inGame ? 'In Progress' : 'Open'}
                        </span>
                        <span className="tag tag-gold">{t.roomCode}</span>
                      </div>
                      <div className="public-table-meta">
                        <span>Host: {t.hostName}</span>
                        <span>· {t.deckSize}-Card Deck</span>
                        <span>· {t.variant === 'passing' ? 'Passing Mode' : 'Classic'}</span>
                        <span>
                          · {t.humanCount}👤 {t.botCount > 0 ? `${t.botCount}🤖 ` : ''}
                          ({t.filledSeats}/{t.maxPlayers} seats)
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className={`btn btn-sm ${canJoin ? 'btn-primary' : 'btn-ghost'}`}
                      disabled={!canJoin}
                      onClick={() => onJoinTable(t.roomCode)}
                    >
                      {t.inGame ? 'Playing' : canJoin ? 'Join Table' : 'Full'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Online Players & Server Lobby Chat */}
        <aside className="server-side-col">
          <section className="panel server-online-panel">
            <div className="online-head">
              <h2>Online ({onlinePlayers.length})</h2>
              <input
                type="text"
                className="inline-name-input"
                maxLength={20}
                value={localName}
                onChange={(e) => onNameChange(e.target.value)}
                aria-label="Your display name"
                title="Your display name"
              />
            </div>

            <div className="online-chips">
              {onlinePlayers.map((p) => (
                <span key={p.clientId} className={`online-chip presence-${p.status}`}>
                  <span className="presence-dot" />
                  <span>{p.name}</span>
                  {p.status !== 'browsing' && (
                    <small>{p.status === 'hosting' ? 'Hosting' : 'Playing'}</small>
                  )}
                </span>
              ))}
            </div>
          </section>

          <section className="panel server-chat-panel">
            <h2>{activeServer.name} Chat</h2>
            <div className="server-chat-feed">
              {chatMessages.length === 0 ? (
                <p className="muted-tiny">
                  Welcome to {activeServer.name}! Say hello, organize a 4-player game, or share a table invite.
                </p>
              ) : (
                chatMessages.map((m) => (
                  <div key={m.id} className={`chat-line ${m.isSystem ? 'chat-system' : ''}`}>
                    {!m.isSystem && <strong>{m.senderName}: </strong>}
                    <span>{m.text}</span>
                    {m.inviteRoomCode && (
                      <div className="chat-invite-card">
                        <div>
                          <strong>{m.inviteTitle || 'Public Table'}</strong>
                          <span className="muted-tiny"> · Code {m.inviteRoomCode}</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-xs"
                          onClick={() => onJoinTable(m.inviteRoomCode!)}
                        >
                          Join
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <form className="chat-form" onSubmit={handleChatSubmit}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={`Message #${activeServer.id}...`}
                maxLength={260}
              />
              <button type="submit" className="btn btn-secondary btn-sm">
                Send
              </button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
};
