import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  normalizeServerSlug,
  PresenceStatus,
  PRESET_PUBLIC_SERVERS,
  PublicPresence,
  PublicServerClient,
  PublicServerInfo,
  PublicTableListing,
  ServerChatMessage,
  ServerConnectionStatus,
} from '../net/publicServer';
import { generatePeerId } from '../net/webrtc';

export function usePublicServer(playerName: string) {
  const clientIdRef = useRef<string>(generatePeerId('usr'));
  const clientRef = useRef<PublicServerClient | null>(null);

  const [activeServerId, setActiveServerId] = useState<string>('main-hall');
  const [customServers, setCustomServers] = useState<PublicServerInfo[]>([]);
  const [status, setStatus] = useState<ServerConnectionStatus>('connecting');
  const [brokerLabel, setBrokerLabel] = useState<string>('');
  const [onlinePlayers, setOnlinePlayers] = useState<PublicPresence[]>([]);
  const [tables, setTables] = useState<PublicTableListing[]>([]);
  const [chatMessages, setChatMessages] = useState<ServerChatMessage[]>([]);

  const allServers = useMemo(
    () => [...PRESET_PUBLIC_SERVERS, ...customServers],
    [customServers],
  );

  const activeServer = useMemo(
    () =>
      allServers.find((s) => s.id === activeServerId) ?? {
        id: activeServerId,
        name: `#${activeServerId}`,
        icon: '🛰️',
        description: 'Custom community server hall.',
        isCustom: true,
      },
    [activeServerId, allServers],
  );

  // Connect / reconnect when activeServerId changes
  useEffect(() => {
    setOnlinePlayers([]);
    setTables([]);
    setChatMessages([]);
    setStatus('connecting');

    const client = new PublicServerClient(
      activeServerId,
      clientIdRef.current,
      playerName,
      {
        onStatusChange: (nextStatus, label) => {
          setStatus(nextStatus);
          setBrokerLabel(label);
        },
        onPresenceChange: (players) => setOnlinePlayers(players),
        onTablesChange: (nextTables) => setTables(nextTables),
        onChatMessage: (msg) =>
          setChatMessages((prev) => [...prev.slice(-79), msg]),
      },
    );
    clientRef.current = client;
    client.start();

    return () => {
      client.dispose();
      if (clientRef.current === client) {
        clientRef.current = null;
      }
    };
    // Intentionally reconnect only when switching servers; playerName updates via updatePresence below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerId]);

  const selectServer = useCallback((serverId: string) => {
    setActiveServerId(normalizeServerSlug(serverId));
  }, []);

  const joinCustomServer = useCallback((rawInput: string) => {
    const slug = normalizeServerSlug(rawInput);
    const existsPreset = PRESET_PUBLIC_SERVERS.some((s) => s.id === slug);
    if (!existsPreset) {
      setCustomServers((prev) => {
        if (prev.some((s) => s.id === slug)) return prev;
        return [
          ...prev,
          {
            id: slug,
            name: `#${slug}`,
            icon: '🛰️',
            description: 'Custom community server hall.',
            isCustom: true,
          },
        ];
      });
    }
    setActiveServerId(slug);
  }, []);

  const sendServerChat = useCallback(
    (text: string, invite?: { roomCode: string; title: string }) => {
      clientRef.current?.sendChat(playerName, text, invite);
    },
    [playerName],
  );

  const publishTable = useCallback((listing: PublicTableListing) => {
    clientRef.current?.publishTable(listing);
  }, []);

  const unpublishTable = useCallback((roomCode?: string) => {
    clientRef.current?.unpublishTable(roomCode);
  }, []);

  const updatePresence = useCallback(
    (nextStatus: PresenceStatus, roomCode?: string) => {
      clientRef.current?.updatePresence(playerName, nextStatus, roomCode);
    },
    [playerName],
  );

  return {
    myClientId: clientIdRef.current,
    activeServerId,
    activeServer,
    allServers,
    status,
    brokerLabel,
    onlinePlayers,
    tables,
    chatMessages,
    selectServer,
    joinCustomServer,
    sendServerChat,
    publishTable,
    unpublishTable,
    updatePresence,
  };
}
