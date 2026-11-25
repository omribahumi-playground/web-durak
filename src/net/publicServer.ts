import mqtt, { MqttClient } from 'mqtt';
import { DeckSize, GameVariant, LobbyState } from '../game/types';

export interface PublicServerInfo {
  id: string;
  name: string;
  icon: string;
  description: string;
  isCustom?: boolean;
}

export const PRESET_PUBLIC_SERVERS: PublicServerInfo[] = [
  {
    id: 'main-hall',
    name: 'Main Hall',
    icon: '🌍',
    description: 'General Durak tables, mixed human/bot lobbies, and open chat.',
  },
  {
    id: 'casual-lounge',
    name: 'Casual Lounge',
    icon: '☕',
    description: 'Friendly tables for relaxed games and newcomers.',
  },
  {
    id: 'competitive-arena',
    name: 'Competitive Arena',
    icon: '🏆',
    description: 'Harder matches, Passing mode, and high-skill tables.',
  },
  {
    id: 'blitz-24',
    name: '24-Card Blitz',
    icon: '⚡',
    description: 'Fast-paced 24-card deck tables.',
  },
];

export type PresenceStatus = 'browsing' | 'hosting' | 'in-game';

export interface PublicPresence {
  clientId: string;
  name: string;
  status: PresenceStatus;
  roomCode?: string;
  updatedAt: number;
}

export interface PublicTableListing {
  roomCode: string;
  serverId: string;
  title: string;
  hostName: string;
  maxPlayers: 2 | 3 | 4;
  filledSeats: number;
  humanCount: number;
  botCount: number;
  openSeats: number;
  deckSize: DeckSize;
  variant: GameVariant;
  inGame: boolean;
  updatedAt: number;
}

export interface ServerChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  inviteRoomCode?: string;
  inviteTitle?: string;
  isSystem?: boolean;
}

export type ServerConnectionStatus = 'connecting' | 'connected' | 'local-only';

const TOPIC_PREFIX = 'durak-p2p-v1/servers';
const PUBLIC_MQTT_BROKERS = [
  { url: 'wss://broker.emqx.io:8084/mqtt', label: 'EMQX Public Relay' },
  { url: 'wss://broker.hivemq.com:8884/mqtt', label: 'HiveMQ Public Relay' },
];

const PRESENCE_TTL_MS = 26_000;
const TABLE_TTL_MS = 20_000;

export function normalizeServerSlug(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return cleaned || 'main-hall';
}

export function buildTableListingFromLobby(
  lobby: LobbyState,
  serverId: string,
  title: string,
): PublicTableListing {
  const hostSeat = lobby.seats[0];
  const humanCount = lobby.seats.filter(
    (s) => s.kind === 'host' || s.kind === 'remote',
  ).length;
  const botCount = lobby.seats.filter((s) => s.kind === 'bot').length;
  const openSeats = lobby.seats.filter((s) => s.kind === 'open').length;
  const filledSeats = humanCount + botCount;

  return {
    roomCode: lobby.roomCode,
    serverId,
    title: title.trim().slice(0, 40) || `${hostSeat?.name || 'Host'}'s Table`,
    hostName: hostSeat?.name || 'Host',
    maxPlayers: lobby.settings.maxPlayers,
    filledSeats,
    humanCount,
    botCount,
    openSeats,
    deckSize: lobby.settings.deckSize,
    variant: lobby.settings.variant,
    inGame: lobby.inGame,
    updatedAt: Date.now(),
  };
}

export function pruneStaleRecords<T extends { updatedAt: number }>(
  records: Map<string, T>,
  now: number,
  ttlMs: number,
): boolean {
  let changed = false;
  for (const [key, value] of records.entries()) {
    if (now - value.updatedAt > ttlMs) {
      records.delete(key);
      changed = true;
    }
  }
  return changed;
}

export interface PublicServerCallbacks {
  onStatusChange: (status: ServerConnectionStatus, brokerLabel: string) => void;
  onPresenceChange: (players: PublicPresence[]) => void;
  onTablesChange: (tables: PublicTableListing[]) => void;
  onChatMessage: (msg: ServerChatMessage) => void;
}

type LocalEnvelope =
  | { channel: 'presence'; data: PublicPresence & { offline?: boolean } }
  | { channel: 'table'; data: PublicTableListing | { roomCode: string; removed: true } }
  | { channel: 'chat'; data: ServerChatMessage };

export class PublicServerClient {
  public readonly serverId: string;
  public readonly clientId: string;
  private callbacks: PublicServerCallbacks;
  private mqttClient: MqttClient | null = null;
  private broadcast: BroadcastChannel | null = null;
  private brokerIndex = 0;
  private disposed = false;
  private status: ServerConnectionStatus = 'connecting';
  private brokerLabel = '';

  private presenceMap = new Map<string, PublicPresence>();
  private tableMap = new Map<string, PublicTableListing>();
  private seenChatIds = new Set<string>();

  private myPresence: PublicPresence;
  private hostedListing: PublicTableListing | null = null;

  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private tableTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private failoverTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    serverId: string,
    clientId: string,
    playerName: string,
    callbacks: PublicServerCallbacks,
  ) {
    this.serverId = normalizeServerSlug(serverId);
    this.clientId = clientId;
    this.callbacks = callbacks;
    this.myPresence = {
      clientId,
      name: playerName.trim() || 'Player',
      status: 'browsing',
      updatedAt: Date.now(),
    };
  }

  private topicBase(): string {
    return `${TOPIC_PREFIX}/${this.serverId}`;
  }

  public start(): void {
    if (this.disposed) return;

    // 1. Always initialize same-browser BroadcastChannel for instant local tab discovery
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel(`durak-public-server-${this.serverId}`);
        this.broadcast = bc;
        bc.onmessage = (event) => {
          const env = event.data as LocalEnvelope | undefined;
          if (!env || typeof env !== 'object') return;
          this.handleEnvelope(env);
        };
      } catch {
        // ignore unsupported environments
      }
    }

    // Seed our own presence immediately
    this.presenceMap.set(this.clientId, { ...this.myPresence, updatedAt: Date.now() });
    this.emitPresence();

    // 2. Connect to public WSS MQTT broker (with failover)
    this.connectBroker(0);

    // 3. Periodic heartbeats and stale record pruning
    this.presenceTimer = setInterval(() => {
      this.broadcastPresence();
    }, 9_000);

    this.tableTimer = setInterval(() => {
      if (this.hostedListing) {
        this.hostedListing = { ...this.hostedListing, updatedAt: Date.now() };
        this.publishRawTable(this.hostedListing);
      }
    }, 6_500);

    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      // Keep ourselves fresh
      this.presenceMap.set(this.clientId, { ...this.myPresence, updatedAt: now });
      if (pruneStaleRecords(this.presenceMap, now, PRESENCE_TTL_MS)) {
        this.emitPresence();
      }
      if (pruneStaleRecords(this.tableMap, now, TABLE_TTL_MS)) {
        this.emitTables();
      }
    }, 5_000);

    // Broadcast initial presence locally
    this.broadcastPresence();
  }

  private connectBroker(index: number): void {
    if (this.disposed) return;
    if (this.failoverTimer) {
      clearTimeout(this.failoverTimer);
      this.failoverTimer = null;
    }
    if (this.mqttClient) {
      try {
        this.mqttClient.end(true);
      } catch {
        // ignore
      }
      this.mqttClient = null;
    }

    const broker = PUBLIC_MQTT_BROKERS[index];
    if (!broker) {
      this.status = 'local-only';
      this.brokerLabel = 'Local Tabs Only';
      this.callbacks.onStatusChange(this.status, this.brokerLabel);
      return;
    }

    this.brokerIndex = index;
    this.status = 'connecting';
    this.brokerLabel = broker.label;
    this.callbacks.onStatusChange('connecting', broker.label);

    let connectedOnce = false;
    try {
      const client = mqtt.connect(broker.url, {
        clientId: `durak-${this.clientId}-${Math.random().toString(36).slice(2, 6)}`,
        clean: true,
        connectTimeout: 5500,
        reconnectPeriod: 0, // we control failover explicitly
        keepalive: 30,
      });
      this.mqttClient = client;

      this.failoverTimer = setTimeout(() => {
        if (!connectedOnce && !this.disposed) {
          this.connectBroker(index + 1);
        }
      }, 6000);

      client.on('connect', () => {
        if (this.disposed) {
          client.end(true);
          return;
        }
        connectedOnce = true;
        if (this.failoverTimer) {
          clearTimeout(this.failoverTimer);
          this.failoverTimer = null;
        }
        this.status = 'connected';
        this.brokerLabel = broker.label;
        this.callbacks.onStatusChange('connected', broker.label);

        const base = this.topicBase();
        client.subscribe([`${base}/presence/+`, `${base}/tables/+`, `${base}/chat`], () => {
          this.broadcastPresence();
          if (this.hostedListing) {
            this.publishRawTable({ ...this.hostedListing, updatedAt: Date.now() });
          }
        });
      });

      client.on('message', (topic, payload) => {
        if (this.disposed) return;
        let data: unknown;
        try {
          data = JSON.parse(payload.toString());
        } catch {
          return;
        }
        const base = this.topicBase();
        if (topic.startsWith(`${base}/presence/`)) {
          this.handleEnvelope({
            channel: 'presence',
            data: data as PublicPresence & { offline?: boolean },
          });
        } else if (topic.startsWith(`${base}/tables/`)) {
          this.handleEnvelope({
            channel: 'table',
            data: data as PublicTableListing | { roomCode: string; removed: true },
          });
        } else if (topic === `${base}/chat`) {
          this.handleEnvelope({
            channel: 'chat',
            data: data as ServerChatMessage,
          });
        }
      });

      client.on('error', () => {
        if (!connectedOnce && !this.disposed) {
          this.connectBroker(index + 1);
        }
      });

      client.on('close', () => {
        if (!this.disposed && connectedOnce) {
          // Try reconnecting starting from next broker
          this.connectBroker((this.brokerIndex + 1) % PUBLIC_MQTT_BROKERS.length);
        }
      });
    } catch {
      this.connectBroker(index + 1);
    }
  }

  private handleEnvelope(env: LocalEnvelope): void {
    if (env.channel === 'presence') {
      const p = env.data;
      if (!p || !p.clientId) return;
      if (p.offline) {
        if (this.presenceMap.delete(p.clientId)) {
          this.emitPresence();
        }
        return;
      }
      this.presenceMap.set(p.clientId, {
        clientId: p.clientId,
        name: String(p.name || 'Player').slice(0, 22),
        status: p.status || 'browsing',
        roomCode: p.roomCode,
        updatedAt: Date.now(),
      });
      this.emitPresence();
      return;
    }

    if (env.channel === 'table') {
      const t = env.data;
      if (!t || !t.roomCode) return;
      if ('removed' in t && t.removed) {
        if (this.tableMap.delete(t.roomCode)) {
          this.emitTables();
        }
        return;
      }
      const listing = t as PublicTableListing;
      if (listing.serverId !== this.serverId) return;
      this.tableMap.set(listing.roomCode, {
        ...listing,
        updatedAt: Date.now(),
      });
      this.emitTables();
      return;
    }

    if (env.channel === 'chat') {
      const m = env.data;
      if (!m || !m.id || !m.text) return;
      if (this.seenChatIds.has(m.id)) return;
      this.seenChatIds.add(m.id);
      if (this.seenChatIds.size > 200) {
        const first = this.seenChatIds.values().next().value;
        if (first) this.seenChatIds.delete(first);
      }
      this.callbacks.onChatMessage(m);
    }
  }

  private emitPresence(): void {
    const list = Array.from(this.presenceMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    this.callbacks.onPresenceChange(list);
  }

  private emitTables(): void {
    const list = Array.from(this.tableMap.values()).sort((a, b) => {
      // Open tables first, then most recently updated
      if (a.inGame !== b.inGame) return a.inGame ? 1 : -1;
      return b.updatedAt - a.updatedAt;
    });
    this.callbacks.onTablesChange(list);
  }

  private publish(subtopic: string, payload: unknown, env: LocalEnvelope): void {
    try {
      this.broadcast?.postMessage(env);
    } catch {
      // ignore
    }
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        this.mqttClient.publish(`${this.topicBase()}/${subtopic}`, JSON.stringify(payload), {
          qos: 0,
        });
      } catch {
        // ignore
      }
    }
  }

  private broadcastPresence(offline = false): void {
    const payload = {
      ...this.myPresence,
      updatedAt: Date.now(),
      ...(offline ? { offline: true } : {}),
    };
    if (!offline) {
      this.presenceMap.set(this.clientId, { ...this.myPresence, updatedAt: Date.now() });
      this.emitPresence();
    }
    this.publish(`presence/${this.clientId}`, payload, {
      channel: 'presence',
      data: payload,
    });
  }

  private publishRawTable(listing: PublicTableListing): void {
    this.tableMap.set(listing.roomCode, listing);
    this.emitTables();
    this.publish(`tables/${listing.roomCode}`, listing, {
      channel: 'table',
      data: listing,
    });
  }

  public updatePresence(name: string, status: PresenceStatus, roomCode?: string): void {
    this.myPresence = {
      clientId: this.clientId,
      name: name.trim() || 'Player',
      status,
      roomCode,
      updatedAt: Date.now(),
    };
    this.broadcastPresence(false);
  }

  public publishTable(listing: PublicTableListing): void {
    this.hostedListing = { ...listing, serverId: this.serverId, updatedAt: Date.now() };
    this.publishRawTable(this.hostedListing);
  }

  public unpublishTable(roomCode?: string): void {
    const targetCode = roomCode ?? this.hostedListing?.roomCode;
    if (!targetCode) return;
    if (this.hostedListing?.roomCode === targetCode) {
      this.hostedListing = null;
    }
    this.tableMap.delete(targetCode);
    this.emitTables();
    const removal = { roomCode: targetCode, removed: true as const };
    this.publish(`tables/${targetCode}`, removal, {
      channel: 'table',
      data: removal,
    });
  }

  public sendChat(
    senderName: string,
    text: string,
    invite?: { roomCode: string; title: string },
  ): void {
    const clean = text.trim().slice(0, 260);
    if (!clean) return;
    const msg: ServerChatMessage = {
      id: `srv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      senderId: this.clientId,
      senderName: senderName.trim() || 'Player',
      text: clean,
      timestamp: Date.now(),
      inviteRoomCode: invite?.roomCode,
      inviteTitle: invite?.title,
    };
    // Deliver locally immediately and broadcast to MQTT + BroadcastChannel
    this.handleEnvelope({ channel: 'chat', data: msg });
    this.publish('chat', msg, { channel: 'chat', data: msg });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.hostedListing) {
      this.unpublishTable(this.hostedListing.roomCode);
    }
    this.broadcastPresence(true);
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    if (this.tableTimer) clearInterval(this.tableTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    if (this.failoverTimer) clearTimeout(this.failoverTimer);
    try {
      this.broadcast?.close();
    } catch {
      // ignore
    }
    try {
      this.mqttClient?.end(true);
    } catch {
      // ignore
    }
    this.broadcast = null;
    this.mqttClient = null;
  }
}
