import { describe, expect, it } from 'vitest';
import {
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

  it('round-trips direct P2P SDP invite blobs cleanly', () => {
    const sample = {
      v: 1,
      roomCode: 'K7M9P2',
      sdp: { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\n' },
    };
    const encoded = encodeSignalBlob(sample);
    expect(typeof encoded).toBe('string');
    const decoded = decodeSignalBlob<typeof sample>(encoded);
    expect(decoded).toEqual(sample);
  });
});
