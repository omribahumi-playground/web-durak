import React, { useState } from 'react';
import { QrScannerModal } from './QrCodeTools';

interface HomeScreenProps {
  localName: string;
  onNameChange: (name: string) => void;
  initialJoinCode?: string;
  publicOnlineCount: number;
  publicTablesCount: number;
  publicServerName: string;
  canInstallPwa: boolean;
  isOffline: boolean;
  onInstallPwa: () => void;
  onOpenPublicServers: () => void;
  onCreateSolo: (maxPlayers: 2 | 3 | 4) => void;
  onHostRoom: (maxPlayers: 2 | 3 | 4) => void;
  onJoinRoom: (roomCode: string) => void;
  onJoinManualOffer: (offerCode: string) => Promise<string>;
  onOpenRules: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  localName,
  onNameChange,
  initialJoinCode = '',
  publicOnlineCount,
  publicTablesCount,
  publicServerName,
  canInstallPwa,
  isOffline,
  onInstallPwa,
  onOpenPublicServers,
  onCreateSolo,
  onHostRoom,
  onJoinRoom,
  onJoinManualOffer,
  onOpenRules,
}) => {
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [hostSize, setHostSize] = useState<2 | 3 | 4>(2);
  const [showManual, setShowManual] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualOffer, setManualOffer] = useState('');
  const [manualError, setManualError] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCode.trim().toUpperCase();
    if (!cleaned) return;
    onJoinRoom(cleaned);
  };

  const handleManualJoin = async (codeOverride?: string) => {
    const code = (codeOverride ?? manualOffer).trim();
    if (!code) return;
    setManualError('');
    setManualBusy(true);
    try {
      await onJoinManualOffer(code);
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Invalid invite code.');
      setShowManual(true);
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <div className="home-shell">
      <div className="home-hero">
        <div className="home-suits" aria-hidden="true">
          <span>♠</span>
          <span className="suit-red">♥</span>
          <span>♣</span>
          <span className="suit-red">♦</span>
        </div>
        <h1 className="home-title">DURAK</h1>
        <p className="home-subtitle">
          Peer-to-Peer WebRTC Multiplayer &amp; Tactical AI Card Game for 2–4 Players
        </p>

        <div className="name-bar">
          <label htmlFor="player-name-input">Your Name</label>
          <input
            id="player-name-input"
            type="text"
            maxLength={20}
            value={localName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Enter display name"
          />
          <button type="button" className="btn btn-ghost" onClick={onOpenRules}>
            How to Play
          </button>
          {canInstallPwa && (
            <button type="button" className="btn btn-gold btn-sm" onClick={onInstallPwa}>
              📲 Install Offline App
            </button>
          )}
          {isOffline && (
            <span className="status-pill status-connecting">
              <span className="status-dot" />
              Airplane / Offline Mode
            </span>
          )}
        </div>
      </div>

      <section className="panel public-banner">
        <div className="public-banner-info">
          <div className="panel-badge badge-emerald">Public Servers &amp; Lobby Chat</div>
          <h2>Browse Public Servers &amp; Open Tables</h2>
          <p className="muted">
            Hang out in global server halls (<strong>{publicServerName}</strong>, Casual Lounge, Competitive Arena, or custom servers), chat with other players, and jump into live WebRTC tables in one click.
          </p>
        </div>
        <div className="public-banner-cta">
          <div className="public-banner-stats">
            <span>{publicOnlineCount} online</span>
            <span>·</span>
            <span>{publicTablesCount} live tables</span>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={onOpenPublicServers}
          >
            🌐 Enter Public Servers
          </button>
        </div>
      </section>

      <div className="home-grid">
        {/* Play vs Computer */}
        <section className="panel home-card">
          <div className="panel-badge">Offline &amp; Instant</div>
          <h2>Play vs Computer</h2>
          <p className="muted">
            Jump straight into a table filled with AI opponents. You can still invite friends or tweak rules in the lobby.
          </p>
          <div className="quick-sizes">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onCreateSolo(2)}
            >
              1 vs 1 Bot
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onCreateSolo(3)}
            >
              3 Players (2 Bots)
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onCreateSolo(4)}
            >
              4 Players (3 Bots)
            </button>
          </div>
        </section>

        {/* Host WebRTC Room */}
        <section className="panel home-card">
          <div className="panel-badge badge-gold">WebRTC P2P Host</div>
          <h2>Create Multiplayer Lobby</h2>
          <p className="muted">
            Host a 2–4 player room over WebRTC DataChannels. Mix real friends and AI bots freely in any seat.
          </p>
          <div className="segmented-control" role="group" aria-label="Lobby size">
            {([2, 3, 4] as const).map((size) => (
              <button
                key={size}
                type="button"
                className={`seg-btn ${hostSize === size ? 'active' : ''}`}
                onClick={() => setHostSize(size)}
              >
                {size} Seats
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-gold btn-full"
            onClick={() => onHostRoom(hostSize)}
          >
            Host {hostSize}-Player Room
          </button>
        </section>

        {/* Join WebRTC Room */}
        <section className="panel home-card">
          <div className="panel-badge badge-emerald">Join Friend</div>
          <h2>Join WebRTC Room</h2>
          <p className="muted">
            Enter a 6-character Room Code from your friend, or use a Direct Serverless P2P Invite Code.
          </p>
          <form className="join-form" onSubmit={handleJoinSubmit}>
            <input
              type="text"
              className="code-input"
              maxLength={8}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              aria-label="Room code"
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!joinCode.trim()}
            >
              Join
            </button>
          </form>

          <button
            type="button"
            className="btn btn-secondary btn-full"
            disabled={manualBusy}
            onClick={() => setScannerOpen(true)}
          >
            📷 Scan Host QR Code (Offline / LAN)
          </button>

          <button
            type="button"
            className="link-toggle"
            onClick={() => setShowManual((v) => !v)}
          >
            {showManual ? 'Hide' : 'Paste'} Direct Manual P2P Code
          </button>

          {showManual && (
            <div className="manual-box">
              <textarea
                rows={3}
                value={manualOffer}
                onChange={(e) => setManualOffer(e.target.value)}
                placeholder="Paste host's WebRTC Offer code here..."
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!manualOffer.trim() || manualBusy}
                onClick={() => void handleManualJoin()}
              >
                {manualBusy ? 'Generating Answer QR...' : 'Generate Answer QR & Code'}
              </button>
              {manualError && <p className="error-text">{manualError}</p>}
            </div>
          )}
        </section>
      </div>

      {scannerOpen && (
        <QrScannerModal
          title="Scan Host's Offer QR"
          hint="Point your camera at the host's Direct P2P Offer QR code to pair over LAN or Wi-Fi."
          onClose={() => setScannerOpen(false)}
          onScan={(decoded) => {
            setScannerOpen(false);
            setManualOffer(decoded);
            void handleManualJoin(decoded);
          }}
        />
      )}
    </div>
  );
};
