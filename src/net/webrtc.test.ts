import { describe, expect, it } from 'vitest';
import {
  compactSdp,
  decodeSignalBlob,
  encodeSignalBlob,
  generateRoomCode,
  roomCodeToPeerId,
} from './webrtc';

describe('Zero-Backend WebRTC Helpers', () => {
  it('generates valid 6-character unambiguous room codes', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(code).not.toMatch(/[01IO]/);
    }
  });

  it('normalizes room codes into consistent PeerJS room IDs', () => {
    expect(roomCodeToPeerId(' ab34-xy ')).toBe('durak-p2p-room-AB34XY');
    expect(roomCodeToPeerId('K7M9P2')).toBe('durak-p2p-room-K7M9P2');
  });

  it('compresses and round-trips direct P2P SDP invite blobs for QR codes', () => {
    const sample = {
      v: 2,
      r: 'K7M9P2',
      t: 'offer',
      s: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=ice-ufrag:abcd\r\na=ice-pwd:supersecretpassword123456\r\n',
    };
    const encoded = encodeSignalBlob(sample);
    expect(encoded.startsWith('D2:')).toBe(true);
    const decoded = decodeSignalBlob<typeof sample>(encoded);
    expect(decoded).toEqual(sample);
  });

  it('strips non-essential SDP lines and keeps UDP candidates for compact QR pairing', () => {
    const verboseSdp = [
      'v=0',
      'o=- 12345 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=extmap-allow-mixed',
      'a=group:BUNDLE 0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=ice-ufrag:u123',
      'a=ice-pwd:p456',
      'a=fingerprint:sha-256 AA:BB:CC',
      'a=setup:actpass',
      'a=mid:0',
      'a=sctp-port:5000',
      'a=candidate:1 1 udp 2122260223 192.168.1.42 54321 typ host',
      'a=candidate:2 1 tcp 1518280447 192.168.1.42 9 typ host tcptype active',
      'a=end-of-candidates',
    ].join('\r\n');

    const compacted = compactSdp(verboseSdp);
    expect(compacted).toContain('a=ice-ufrag:u123');
    expect(compacted).toContain('a=fingerprint:sha-256 AA:BB:CC');
    expect(compacted).toContain('192.168.1.42 54321 typ host');
    expect(compacted).not.toContain('a=extmap-allow-mixed');
    expect(compacted).not.toContain('tcptype active');
    expect(compacted.length).toBeLessThan(verboseSdp.length);
  });
});
