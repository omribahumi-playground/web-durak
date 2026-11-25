import Peer, { DataConnection } from 'peerjs';
import { HostToPeerMessage, PeerToHostMessage } from './protocol';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_PEER_PREFIX = 'durak-p2p-room-';

export function generateRoomCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return out;
}

export function roomCodeToPeerId(roomCode: string): string {
  const clean = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${ROOM_PEER_PREFIX}${clean}`;
}

export function generatePeerId(prefix = 'p'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function encodeSignalBlob(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export function decodeSignalBlob<T>(encoded: string): T {
  const clean = encoded.trim();
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      pc.removeEventListener('icegatheringstatechange', onStateChange);
      clearTimeout(timer);
      resolve();
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') {
        finish();
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onStateChange);
  });
}

function parseInboundMessage<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') {
    return raw as T;
  }
  return null;
}

export type SignalingStatus = 'idle' | 'connecting' | 'connected' | 'offline' | 'error';

interface ManualPeerRecord {
  kind: 'manual';
  peerId: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
}

interface PeerJsRecord {
  kind: 'peerjs';
  peerId: string;
  conn: DataConnection;
}

type HostPeerRecord = ManualPeerRecord | PeerJsRecord;

export interface HostNetworkCallbacks {
  onSignalingStatus: (status: SignalingStatus, note?: string) => void;
  onRoomCodeChanged?: (roomCode: string) => void;
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string) => void;
  onPeerMessage: (peerId: string, msg: PeerToHostMessage) => void;
}

export class HostNetworkManager {
  public readonly hostPeerId: string;
  public roomCode: string;
  private peer: Peer | null = null;
  private peers = new Map<string, HostPeerRecord>();
  private callbacks: HostNetworkCallbacks;
  private disposed = false;
  private collisionRetries = 0;

  constructor(callbacks: HostNetworkCallbacks, roomCode = generateRoomCode()) {
    this.hostPeerId = generatePeerId('host');
    this.roomCode = roomCode;
    this.callbacks = callbacks;
  }

  /**
   * Connects to the zero-backend public PeerJS signaling broker so friends
   * can join with just the 6-character Room Code from any static host (e.g. GitHub Pages).
   */
  public connectSignaling(): void {
    if (this.disposed) return;
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }

    this.callbacks.onSignalingStatus('connecting', 'Opening zero-backend WebRTC room...');
    try {
      const peer = new Peer(roomCodeToPeerId(this.roomCode), {
        debug: 0,
        config: { iceServers: ICE_SERVERS },
      });
      this.peer = peer;

      peer.on('open', () => {
        if (this.disposed) {
          peer.destroy();
          return;
        }
        this.collisionRetries = 0;
        this.callbacks.onSignalingStatus(
          'connected',
          'WebRTC P2P room live — share the code with friends!',
        );
      });

      peer.on('connection', (conn) => {
        if (this.disposed) {
          conn.close();
          return;
        }
        this.attachPeerJsConnection(conn);
      });

      peer.on('disconnected', () => {
        if (!this.disposed && !peer.destroyed) {
          this.callbacks.onSignalingStatus('connecting', 'Reconnecting to P2P broker...');
          try {
            peer.reconnect();
          } catch {
            this.callbacks.onSignalingStatus(
              'offline',
              'Broker disconnected — active peers, bots, and Direct P2P codes still work.',
            );
          }
        }
      });

      peer.on('error', (err) => {
        if (this.disposed) return;
        if (err.type === 'unavailable-id' && this.collisionRetries < 3) {
          this.collisionRetries += 1;
          this.roomCode = generateRoomCode();
          this.callbacks.onRoomCodeChanged?.(this.roomCode);
          this.connectSignaling();
          return;
        }
        this.callbacks.onSignalingStatus(
          'offline',
          'Public P2P broker unreachable — bots and Direct P2P Invite Codes still work.',
        );
      });
    } catch {
      this.callbacks.onSignalingStatus(
        'offline',
        'WebRTC broker unavailable — bots and Direct P2P Invite Codes still work.',
      );
    }
  }

  private attachPeerJsConnection(conn: DataConnection): void {
    const peerId = conn.peer || generatePeerId('pjs');
    const existing = this.peers.get(peerId);
    if (existing) {
      this.closeRecord(existing);
      this.peers.delete(peerId);
    }

    const record: PeerJsRecord = {
      kind: 'peerjs',
      peerId,
      conn,
    };
    this.peers.set(peerId, record);

    const handleOpen = () => {
      this.callbacks.onPeerConnected(peerId);
    };

    if (conn.open) {
      handleOpen();
    } else {
      conn.on('open', handleOpen);
    }

    conn.on('data', (raw) => {
      const parsed = parseInboundMessage<PeerToHostMessage>(raw);
      if (!parsed) return;
      if (parsed.type === 'ping') {
        this.sendToPeer(peerId, { type: 'pong', sentAt: parsed.sentAt });
        return;
      }
      this.callbacks.onPeerMessage(peerId, parsed);
    });

    conn.on('close', () => {
      this.handlePeerDrop(peerId);
    });

    conn.on('error', () => {
      this.handlePeerDrop(peerId);
    });
  }

  private closeRecord(rec: HostPeerRecord): void {
    try {
      if (rec.kind === 'peerjs') {
        rec.conn.close();
      } else {
        rec.dc?.close();
        rec.pc.close();
      }
    } catch {
      // ignore
    }
  }

  private handlePeerDrop(peerId: string): void {
    const rec = this.peers.get(peerId);
    if (!rec) return;
    this.peers.delete(peerId);
    this.closeRecord(rec);
    this.callbacks.onPeerDisconnected(peerId);
  }

  /**
   * Direct manual WebRTC invite fallback: generates a self-contained SDP Offer code
   * that connects two peers with zero external broker at all.
   */
  public async createManualOffer(): Promise<{ peerId: string; offerCode: string }> {
    const peerId = generatePeerId('manual');
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const dc = pc.createDataChannel('durak-game', { ordered: true });
    const record: ManualPeerRecord = { kind: 'manual', peerId, pc, dc };
    this.peers.set(peerId, record);

    dc.onopen = () => {
      this.callbacks.onPeerConnected(peerId);
    };

    dc.onmessage = (event) => {
      const parsed = parseInboundMessage<PeerToHostMessage>(event.data);
      if (!parsed) return;
      if (parsed.type === 'ping') {
        this.sendToPeer(peerId, { type: 'pong', sentAt: parsed.sentAt });
        return;
      }
      this.callbacks.onPeerMessage(peerId, parsed);
    };

    dc.onclose = () => {
      this.handlePeerDrop(peerId);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.handlePeerDrop(peerId);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    const offerCode = encodeSignalBlob({
      v: 1,
      peerId,
      roomCode: this.roomCode,
      sdp: pc.localDescription,
    });
    return { peerId, offerCode };
  }

  public async acceptManualAnswer(peerId: string, answerCode: string): Promise<void> {
    const rec = this.peers.get(peerId);
    if (!rec || rec.kind !== 'manual') {
      throw new Error('No pending direct invite found for that peer.');
    }
    const payload = decodeSignalBlob<{ sdp: RTCSessionDescriptionInit }>(answerCode);
    if (!payload?.sdp || payload.sdp.type !== 'answer') {
      throw new Error('Invalid answer code.');
    }
    await rec.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  }

  public sendToPeer(peerId: string, msg: HostToPeerMessage): void {
    const rec = this.peers.get(peerId);
    if (!rec) return;
    try {
      if (rec.kind === 'peerjs') {
        if (rec.conn.open) {
          rec.conn.send(JSON.stringify(msg));
        }
      } else if (rec.dc && rec.dc.readyState === 'open') {
        rec.dc.send(JSON.stringify(msg));
      }
    } catch {
      // ignore closed race
    }
  }

  public broadcast(msg: HostToPeerMessage): void {
    for (const peerId of this.peers.keys()) {
      this.sendToPeer(peerId, msg);
    }
  }

  public disconnectPeer(peerId: string, kickReason?: string): void {
    if (kickReason) {
      this.sendToPeer(peerId, { type: 'kicked', reason: kickReason });
    }
    this.handlePeerDrop(peerId);
  }

  public dispose(): void {
    this.disposed = true;
    for (const rec of this.peers.values()) {
      this.closeRecord(rec);
    }
    this.peers.clear();
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }
  }
}

export interface ClientNetworkCallbacks {
  onStatusChange: (
    status: 'connecting' | 'connected' | 'disconnected' | 'error',
    detail?: string,
  ) => void;
  onMessage: (msg: HostToPeerMessage) => void;
  onRttUpdate: (rttMs: number) => void;
}

export class ClientNetworkManager {
  public readonly peerId: string;
  private playerName: string;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private manualPc: RTCPeerConnection | null = null;
  private manualDc: RTCDataChannel | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private callbacks: ClientNetworkCallbacks;
  private disposed = false;

  constructor(playerName: string, callbacks: ClientNetworkCallbacks) {
    this.peerId = generatePeerId('guest');
    this.playerName = playerName;
    this.callbacks = callbacks;
  }

  public joinRoom(roomCode: string): void {
    const cleanCode = roomCode.trim().toUpperCase();
    this.callbacks.onStatusChange('connecting', `Connecting to room ${cleanCode} via WebRTC...`);

    try {
      const peer = new Peer({
        debug: 0,
        config: { iceServers: ICE_SERVERS },
      });
      this.peer = peer;

      this.connectTimeout = setTimeout(() => {
        if (!this.disposed && (!this.conn || !this.conn.open)) {
          this.callbacks.onStatusChange(
            'error',
            `Could not reach room "${cleanCode}". Check the code or try a Direct P2P Invite Code.`,
          );
        }
      }, 12000);

      peer.on('open', () => {
        if (this.disposed) {
          peer.destroy();
          return;
        }
        const conn = peer.connect(roomCodeToPeerId(cleanCode), {
          reliable: true,
        });
        this.conn = conn;

        conn.on('open', () => {
          this.clearConnectTimeout();
          this.callbacks.onStatusChange('connected');
          this.send({
            type: 'hello',
            peerId: this.peerId,
            playerName: this.playerName,
          });
          this.startPingLoop();
        });

        conn.on('data', (raw) => {
          const parsed = parseInboundMessage<HostToPeerMessage>(raw);
          if (!parsed) return;
          if (parsed.type === 'pong') {
            this.callbacks.onRttUpdate(Math.max(1, Date.now() - parsed.sentAt));
            return;
          }
          this.callbacks.onMessage(parsed);
        });

        conn.on('close', () => {
          this.clearConnectTimeout();
          this.stopPingLoop();
          if (!this.disposed) {
            this.callbacks.onStatusChange('disconnected', 'Disconnected from host.');
          }
        });

        conn.on('error', () => {
          this.clearConnectTimeout();
          if (!this.disposed) {
            this.callbacks.onStatusChange('error', 'WebRTC connection failed.');
          }
        });
      });

      peer.on('error', (err) => {
        this.clearConnectTimeout();
        if (this.disposed) return;
        if (err.type === 'peer-unavailable') {
          this.callbacks.onStatusChange(
            'error',
            `Room "${cleanCode}" was not found. Make sure the host's lobby is open.`,
          );
          return;
        }
        this.callbacks.onStatusChange(
          'error',
          'Could not connect to public P2P broker. Use a Direct P2P Invite Code instead.',
        );
      });
    } catch {
      this.callbacks.onStatusChange('error', 'Failed to initialize WebRTC client.');
    }
  }

  /**
   * Direct manual WebRTC join fallback: accepts a host's Base64 Offer code and
   * returns a Base64 Answer code to send back to the host.
   */
  public async acceptManualOffer(
    offerCode: string,
  ): Promise<{ roomCode: string; answerCode: string }> {
    const payload = decodeSignalBlob<{
      roomCode?: string;
      sdp: RTCSessionDescriptionInit;
    }>(offerCode);
    if (!payload?.sdp || payload.sdp.type !== 'offer') {
      throw new Error('Invalid host offer code.');
    }
    this.callbacks.onStatusChange('connecting', 'Waiting for host to apply answer code...');

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.manualPc = pc;

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      this.manualDc = dc;

      dc.onopen = () => {
        this.callbacks.onStatusChange('connected');
        this.send({
          type: 'hello',
          peerId: this.peerId,
          playerName: this.playerName,
        });
        this.startPingLoop();
      };

      dc.onmessage = (msgEvent) => {
        const parsed = parseInboundMessage<HostToPeerMessage>(msgEvent.data);
        if (!parsed) return;
        if (parsed.type === 'pong') {
          this.callbacks.onRttUpdate(Math.max(1, Date.now() - parsed.sentAt));
          return;
        }
        this.callbacks.onMessage(parsed);
      };

      dc.onclose = () => {
        this.stopPingLoop();
        if (!this.disposed) {
          this.callbacks.onStatusChange('disconnected', 'Disconnected from host.');
        }
      };
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        if (!this.disposed && (!this.manualDc || this.manualDc.readyState !== 'open')) {
          this.callbacks.onStatusChange('disconnected', 'WebRTC connection lost.');
        }
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);

    const answerCode = encodeSignalBlob({
      v: 1,
      peerId: this.peerId,
      sdp: pc.localDescription,
    });
    return { roomCode: payload.roomCode || 'DIRECT', answerCode };
  }

  public send(msg: PeerToHostMessage): void {
    try {
      if (this.conn && this.conn.open) {
        this.conn.send(JSON.stringify(msg));
        return;
      }
      if (this.manualDc && this.manualDc.readyState === 'open') {
        this.manualDc.send(JSON.stringify(msg));
      }
    } catch {
      // ignore
    }
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping', sentAt: Date.now() });
    }, 4000);
  }

  private stopPingLoop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.clearConnectTimeout();
    this.stopPingLoop();
    try {
      this.conn?.close();
      this.peer?.destroy();
      this.manualDc?.close();
      this.manualPc?.close();
    } catch {
      // ignore
    }
    this.conn = null;
    this.peer = null;
    this.manualDc = null;
    this.manualPc = null;
  }
}
