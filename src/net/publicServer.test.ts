import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LobbyState } from '../game/types';
import {
  buildTableListingFromLobby,
  normalizeServerSlug,
  pruneStaleRecords,
} from './publicServer';

describe('Public Server Discovery Helpers', () => {
  it('normalizes custom server names into safe slugs', () => {
    expect(normalizeServerSlug('  Friday Night Club! ')).toBe('friday-night-club');
    expect(normalizeServerSlug('###')).toBe('main-hall');
    expect(normalizeServerSlug('Blitz_24')).toBe('blitz_24');
  });

  it('builds an accurate public table listing from a mixed human/bot lobby', () => {
    const lobby: LobbyState = {
      roomCode: 'K7M9P2',
      hostId: 'host-1',
      settings: { ...DEFAULT_SETTINGS, maxPlayers: 4, deckSize: 52, variant: 'passing' },
      inGame: false,
      seats: [
        { seatIndex: 0, kind: 'host', playerId: 'host-1', name: 'Alice', connected: true },
        { seatIndex: 1, kind: 'remote', playerId: 'p-2', peerId: 'peer-2', name: 'Bob', connected: true },
        { seatIndex: 2, kind: 'bot', playerId: 'bot-2', name: 'Alex AI', botDifficulty: 'hard', connected: true },
        { seatIndex: 3, kind: 'open', playerId: 'open-3', name: 'Open Seat', connected: false },
      ],
    };

    const listing = buildTableListingFromLobby(lobby, 'competitive-arena', 'Late Night Passing');
    expect(listing).toMatchObject({
      roomCode: 'K7M9P2',
      serverId: 'competitive-arena',
      title: 'Late Night Passing',
      hostName: 'Alice',
      maxPlayers: 4,
      filledSeats: 3,
      humanCount: 2,
      botCount: 1,
      openSeats: 1,
      deckSize: 52,
      variant: 'passing',
      inGame: false,
    });
  });

  it('prunes stale presence and table records past their TTL', () => {
    const now = 100_000;
    const records = new Map([
      ['fresh', { updatedAt: now - 5_000 }],
      ['stale', { updatedAt: now - 25_000 }],
    ]);

    const changed = pruneStaleRecords(records, now, 20_000);
    expect(changed).toBe(true);
    expect(records.has('fresh')).toBe(true);
    expect(records.has('stale')).toBe(false);
  });
});
