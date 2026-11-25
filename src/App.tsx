import React, { useEffect, useMemo, useState } from 'react';
import { GameTable } from './components/GameTable';
import { HomeScreen } from './components/HomeScreen';
import { LobbyView } from './components/LobbyView';
import { PublicServerView } from './components/PublicServerView';
import { QrCodeDisplay } from './components/QrCodeTools';
import { RulesModal } from './components/RulesModal';
import { useDurakSession } from './hooks/useDurakSession';
import { usePublicServer } from './hooks/usePublicServer';
import { usePwaInstall } from './hooks/usePwaInstall';
import { buildTableListingFromLobby } from './net/publicServer';

export const App: React.FC = () => {
  const session = useDurakSession();
  const publicServer = usePublicServer(session.localName);
  const pwa = usePwaInstall();

  const [homeView, setHomeView] = useState<'home' | 'servers'>('home');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [isPublicTable, setIsPublicTable] = useState(false);
  const [publicTableTitle, setPublicTableTitle] = useState('');
  const [fourColorDeck, setFourColorDeck] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('durak_four_color_deck') === '1';
  });

  const toggleFourColorDeck = () => {
    setFourColorDeck((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('durak_four_color_deck', next ? '1' : '0');
      }
      return next;
    });
  };

  const initialJoinCode = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return (params.get('join') || '').trim().toUpperCase();
  }, []);

  // Keep presence synchronized with the active Public Server
  useEffect(() => {
    if (session.clientGame) {
      publicServer.updatePresence('in-game', session.lobby?.roomCode);
    } else if (session.role === 'host' && session.lobby) {
      publicServer.updatePresence('hosting', session.lobby.roomCode);
    } else {
      publicServer.updatePresence('browsing');
    }
  }, [
    session.clientGame,
    session.lobby,
    session.localName,
    session.role,
    publicServer.activeServerId,
    publicServer.updatePresence,
  ]);

  // Publish or unpublish the host's table listing in the active Public Server
  useEffect(() => {
    if (session.role !== 'host' || !session.lobby || !isPublicTable) {
      publicServer.unpublishTable();
      return;
    }
    const listing = buildTableListingFromLobby(
      session.lobby,
      publicServer.activeServerId,
      publicTableTitle || `${session.localName}'s Table`,
    );
    publicServer.publishTable(listing);
  }, [
    isPublicTable,
    publicTableTitle,
    publicServer.activeServerId,
    publicServer.publishTable,
    publicServer.unpublishTable,
    session.lobby,
    session.localName,
    session.role,
  ]);

  const handleHostFromPublicServer = (maxPlayers: 2 | 3 | 4) => {
    setIsPublicTable(true);
    setPublicTableTitle(`${session.localName.trim() || 'Player'}'s Table`);
    session.createHostedLobby({ maxPlayers, fillWithBots: false });
  };

  const handleLeaveSession = () => {
    publicServer.unpublishTable(session.lobby?.roomCode);
    setIsPublicTable(false);
    session.leaveSession();
  };

  const handlePostInviteToServerChat = () => {
    if (!session.lobby) return;
    const title = publicTableTitle.trim() || `${session.localName}'s Table`;
    const open = session.lobby.seats.filter((s) => s.kind === 'open').length;
    publicServer.sendServerChat(
      open > 0
        ? `Looking for ${open} more player${open === 1 ? '' : 's'}! (${session.lobby.settings.deckSize}-card ${session.lobby.settings.variant === 'passing' ? 'Passing' : 'Classic'})`
        : `Join my ${session.lobby.settings.maxPlayers}-player Durak table!`,
      { roomCode: session.lobby.roomCode, title },
    );
  };

  return (
    <div className={`app-root ${fourColorDeck ? 'four-color-deck' : ''}`}>
      {session.toast && (
        <div className="toast-banner" role="status">
          {session.toast}
        </div>
      )}

      {session.role === 'home' && homeView === 'home' && (
        <HomeScreen
          localName={session.localName}
          onNameChange={session.updateLocalName}
          initialJoinCode={initialJoinCode}
          publicOnlineCount={publicServer.onlinePlayers.length}
          publicTablesCount={publicServer.tables.length}
          publicServerName={publicServer.activeServer.name}
          canInstallPwa={pwa.canInstall}
          isOffline={pwa.isOffline}
          onInstallPwa={() => void pwa.promptInstall()}
          onOpenPublicServers={() => setHomeView('servers')}
          onCreateSolo={(maxPlayers) => {
            setIsPublicTable(false);
            session.createHostedLobby({ maxPlayers, fillWithBots: true });
          }}
          onCreateAiBattle={(maxPlayers) => {
            setIsPublicTable(false);
            session.createHostedLobby({ maxPlayers, fillWithBots: true, aiOnly: true });
          }}
          onHostRoom={(maxPlayers) => {
            setIsPublicTable(false);
            setPublicTableTitle(`${session.localName.trim() || 'Player'}'s Table`);
            session.createHostedLobby({ maxPlayers, fillWithBots: false });
          }}
          onJoinRoom={(code) => session.joinRoomByCode(code)}
          onJoinManualOffer={(offer) => session.joinManualOffer(offer)}
          onOpenRules={() => setRulesOpen(true)}
        />
      )}

      {session.role === 'home' && homeView === 'servers' && (
        <PublicServerView
          localName={session.localName}
          onNameChange={session.updateLocalName}
          activeServer={publicServer.activeServer}
          allServers={publicServer.allServers}
          status={publicServer.status}
          brokerLabel={publicServer.brokerLabel}
          onlinePlayers={publicServer.onlinePlayers}
          tables={publicServer.tables}
          chatMessages={publicServer.chatMessages}
          onSelectServer={publicServer.selectServer}
          onJoinCustomServer={publicServer.joinCustomServer}
          onSendChat={(text) => publicServer.sendServerChat(text)}
          onHostPublicTable={handleHostFromPublicServer}
          onJoinTable={(code) => session.joinRoomByCode(code)}
          onBackHome={() => setHomeView('home')}
          onOpenRules={() => setRulesOpen(true)}
        />
      )}

      {session.role !== 'home' && !session.lobby && (
        <div className="connecting-screen">
          <div className="panel connecting-card">
            <h2>
              {session.guestStatus === 'error' || session.guestStatus === 'disconnected'
                ? 'Connection Notice'
                : session.pendingManualAnswer
                  ? 'Send Answer Code to Host'
                  : 'Establishing WebRTC P2P Link...'}
            </h2>
            <p className="muted">
              {session.connectionNote || 'Exchanging SDP & ICE candidates with host...'}
            </p>
            {session.pendingManualAnswer && (
              <div className="manual-answer-wrap">
                <QrCodeDisplay
                  value={session.pendingManualAnswer}
                  label="Have the host scan this Answer QR code:"
                />
                <label>Or copy &amp; send this Answer Code:</label>
                <textarea readOnly rows={3} value={session.pendingManualAnswer} />
                <button
                  type="button"
                  className="btn btn-gold btn-sm"
                  onClick={() => void navigator.clipboard?.writeText(session.pendingManualAnswer!)}
                >
                  Copy Answer Code
                </button>
              </div>
            )}
            <button type="button" className="btn btn-secondary" onClick={handleLeaveSession}>
              Back to Home
            </button>
          </div>
        </div>
      )}

      {session.role !== 'home' && session.lobby && !session.clientGame && (
        <LobbyView
          role={session.role}
          lobby={session.lobby}
          myPlayerId={session.myPlayerId}
          signalingStatus={session.signalingStatus}
          guestStatus={session.guestStatus}
          connectionNote={session.connectionNote}
          rttMs={session.rttMs}
          chatMessages={session.chatMessages}
          fourColorDeck={fourColorDeck}
          isPublicTable={isPublicTable}
          publicTableTitle={publicTableTitle}
          activeServer={publicServer.activeServer}
          allServers={publicServer.allServers}
          onTogglePublicTable={setIsPublicTable}
          onPublicTableTitleChange={setPublicTableTitle}
          onSelectPublicServer={publicServer.selectServer}
          onPostInviteToServerChat={handlePostInviteToServerChat}
          onToggleFourColorDeck={toggleFourColorDeck}
          onUpdateSettings={session.updateSettings}
          onToggleSeatBot={session.toggleSeatBot}
          onSetSeatBotDifficulty={session.setSeatBotDifficulty}
          onFillWithBots={session.fillOpenSeatsWithBots}
          onStartGame={session.startGame}
          onSendChat={session.sendChat}
          onCreateManualInvite={session.createManualInvite}
          onApplyManualAnswer={session.applyManualAnswer}
          onOpenRules={() => setRulesOpen(true)}
          onLeave={handleLeaveSession}
        />
      )}

      {session.role !== 'home' && session.lobby && session.clientGame && (
        <GameTable
          role={session.role}
          roomCode={session.lobby.roomCode}
          game={session.clientGame}
          rttMs={session.rttMs}
          soundEnabled={session.soundEnabled}
          fourColorDeck={fourColorDeck}
          botSpeed={session.botSpeed}
          botsPaused={session.botsPaused}
          chatMessages={session.chatMessages}
          onToggleSound={session.toggleSound}
          onToggleFourColorDeck={toggleFourColorDeck}
          onChangeBotSpeed={session.changeBotSpeed}
          onToggleBotsPaused={session.toggleBotsPaused}
          onAction={session.sendAction}
          onSendChat={session.sendChat}
          onPlayAgain={session.startGame}
          onReturnToLobby={session.returnToLobby}
          onOpenRules={() => setRulesOpen(true)}
          onLeave={handleLeaveSession}
        />
      )}

      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </div>
  );
};

export default App;
