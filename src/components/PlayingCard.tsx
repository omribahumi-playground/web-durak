import React from 'react';
import { Card, Rank, RANK_LABELS, Suit } from '../game/types';

export const SUIT_NAMES: Record<Suit, string> = {
  spades: 'Spades',
  hearts: 'Hearts',
  diamonds: 'Diamonds',
  clubs: 'Clubs',
};

/**
 * High-contrast, bold geometric SVG suit icons designed for clear
 * legibility even at smaller sizes and for low-vision players.
 */
export const SuitIcon: React.FC<{ suit: Suit; className?: string }> = ({
  suit,
  className = '',
}) => {
  switch (suit) {
    case 'spades':
      return (
        <svg
          className={`suit-svg suit-svg-spades ${className}`}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M12 1.5C12 1.5 2.5 9.2 2.5 14.3C2.5 17.5 4.9 19.6 7.7 19.6C9.3 19.6 10.6 18.8 11.4 17.6C11.1 19.8 10.1 21.4 8.2 22.5H15.8C13.9 21.4 12.9 19.8 12.6 17.6C13.4 18.8 14.7 19.6 16.3 19.6C19.1 19.6 21.5 17.5 21.5 14.3C21.5 9.2 12 1.5 12 1.5Z"
          />
        </svg>
      );
    case 'hearts':
      return (
        <svg
          className={`suit-svg suit-svg-hearts ${className}`}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M12 22.2C12 22.2 2.2 15.6 2.2 8.9C2.2 5.2 5.0 2.4 8.3 2.4C10.1 2.4 11.3 3.3 12 4.6C12.7 3.3 13.9 2.4 15.7 2.4C19.0 2.4 21.8 5.2 21.8 8.9C21.8 15.6 12 22.2 12 22.2Z"
          />
        </svg>
      );
    case 'diamonds':
      return (
        <svg
          className={`suit-svg suit-svg-diamonds ${className}`}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path fill="currentColor" d="M12 1.4L21.6 12L12 22.6L2.4 12L12 1.4Z" />
        </svg>
      );
    case 'clubs':
      return (
        <svg
          className={`suit-svg suit-svg-clubs ${className}`}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="6.6" r="4.5" fill="currentColor" />
          <circle cx="6.7" cy="13.8" r="4.5" fill="currentColor" />
          <circle cx="17.3" cy="13.8" r="4.5" fill="currentColor" />
          <path
            fill="currentColor"
            d="M10.5 13.5H13.5L14.2 18.8C14.6 20.4 15.5 21.6 16.8 22.5H7.2C8.5 21.6 9.4 20.4 9.8 18.8L10.5 13.5Z"
          />
        </svg>
      );
  }
};

interface PlayingCardProps {
  card?: Card;
  faceDown?: boolean;
  isTrump?: boolean;
  selected?: boolean;
  playable?: boolean;
  highlightTarget?: boolean;
  disabled?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  title?: string;
}

interface PipCoord {
  x: number;
  y: number;
  flip?: boolean;
}

const PIP_LAYOUTS: Partial<Record<Rank, PipCoord[]>> = {
  2: [
    { x: 50, y: 16 },
    { x: 50, y: 84, flip: true },
  ],
  3: [
    { x: 50, y: 16 },
    { x: 50, y: 50 },
    { x: 50, y: 84, flip: true },
  ],
  4: [
    { x: 26, y: 16 },
    { x: 74, y: 16 },
    { x: 26, y: 84, flip: true },
    { x: 74, y: 84, flip: true },
  ],
  5: [
    { x: 26, y: 16 },
    { x: 74, y: 16 },
    { x: 50, y: 50 },
    { x: 26, y: 84, flip: true },
    { x: 74, y: 84, flip: true },
  ],
  6: [
    { x: 26, y: 16 },
    { x: 74, y: 16 },
    { x: 26, y: 50 },
    { x: 74, y: 50 },
    { x: 26, y: 84, flip: true },
    { x: 74, y: 84, flip: true },
  ],
  7: [
    { x: 26, y: 16 },
    { x: 74, y: 16 },
    { x: 50, y: 33 },
    { x: 26, y: 50 },
    { x: 74, y: 50 },
    { x: 26, y: 84, flip: true },
    { x: 74, y: 84, flip: true },
  ],
  8: [
    { x: 26, y: 16 },
    { x: 74, y: 16 },
    { x: 50, y: 33 },
    { x: 26, y: 50 },
    { x: 74, y: 50 },
    { x: 50, y: 67, flip: true },
    { x: 26, y: 84, flip: true },
    { x: 74, y: 84, flip: true },
  ],
  9: [
    { x: 24, y: 13 },
    { x: 76, y: 13 },
    { x: 24, y: 37 },
    { x: 76, y: 37 },
    { x: 50, y: 50 },
    { x: 24, y: 63, flip: true },
    { x: 76, y: 63, flip: true },
    { x: 24, y: 87, flip: true },
    { x: 76, y: 87, flip: true },
  ],
  10: [
    { x: 24, y: 13 },
    { x: 76, y: 13 },
    { x: 50, y: 25 },
    { x: 24, y: 37 },
    { x: 76, y: 37 },
    { x: 24, y: 63, flip: true },
    { x: 76, y: 63, flip: true },
    { x: 50, y: 75, flip: true },
    { x: 24, y: 87, flip: true },
    { x: 76, y: 87, flip: true },
  ],
};

const CourtIcon: React.FC<{ rank: 11 | 12 | 13 }> = ({ rank }) => {
  if (rank === 13) {
    return (
      <svg className="court-svg" viewBox="0 0 36 28" aria-hidden="true">
        <path
          d="M4 22 L2 8 L11 14 L18 4 L25 14 L34 8 L32 22 Z"
          fill="#d9a536"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="18" cy="4.2" r="1.8" fill="currentColor" />
        <rect x="4" y="23.2" width="28" height="3" rx="1.2" fill="currentColor" />
      </svg>
    );
  }
  if (rank === 12) {
    return (
      <svg className="court-svg" viewBox="0 0 36 28" aria-hidden="true">
        <path
          d="M5 22 L7 10 L13 15 L18 6 L23 15 L29 10 L31 22 Z"
          fill="#e2b755"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="18" cy="4.2" r="2.1" fill="currentColor" />
        <circle cx="7" cy="8.2" r="1.6" fill="currentColor" />
        <circle cx="29" cy="8.2" r="1.6" fill="currentColor" />
        <rect x="5" y="23.2" width="26" height="2.8" rx="1.2" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="court-svg" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M16 3 L27 7.5 V15.5 C27 22.5 22 27 16 29.5 C10 27 5 22.5 5 15.5 V7.5 Z"
        fill="rgba(217, 165, 54, 0.32)"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path d="M16 7 V25 M9.5 14 H22.5" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
};

export const PlayingCard: React.FC<PlayingCardProps> = ({
  card,
  faceDown = false,
  isTrump = false,
  selected = false,
  playable = false,
  highlightTarget = false,
  disabled = false,
  size = 'md',
  className = '',
  style,
  onClick,
  title,
}) => {
  if (faceDown || !card) {
    return (
      <div
        className={`card card-back card-${size} ${className}`}
        style={style}
        title={title}
      >
        <div className="card-back-pattern" />
      </div>
    );
  }

  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  const rankLabel = RANK_LABELS[card.rank];
  const pips = PIP_LAYOUTS[card.rank];
  const isAce = card.rank === 14;
  const isCourt = card.rank >= 11 && card.rank <= 13;

  const classes = [
    'card',
    'card-face',
    `card-${size}`,
    `card-suit-${card.suit}`,
    isRed ? 'card-red' : 'card-black',
    isTrump ? 'card-trump' : '',
    selected ? 'card-selected' : '',
    playable ? 'card-playable' : '',
    highlightTarget ? 'card-target' : '',
    disabled ? 'card-disabled' : '',
    onClick ? 'card-clickable' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      style={style}
      onClick={onClick}
      disabled={!onClick || disabled}
      title={title ?? `${rankLabel} of ${SUIT_NAMES[card.suit]}${isTrump ? ' (Trump)' : ''}`}
      aria-label={`${rankLabel} of ${SUIT_NAMES[card.suit]}${isTrump ? ', trump' : ''}`}
    >
      <span className="card-corner card-corner-tl">
        <span className="card-rank">{rankLabel}</span>
        <SuitIcon suit={card.suit} className="card-corner-suit-svg" />
      </span>

      {pips && (
        <span
          className={`card-pips ${card.rank >= 9 ? 'card-pips-dense' : ''}`}
          aria-hidden="true"
        >
          {pips.map((pip, idx) => (
            <span
              key={idx}
              className={`card-pip ${pip.flip ? 'card-pip-flip' : ''}`}
              style={{ left: `${pip.x}%`, top: `${pip.y}%` }}
            >
              <SuitIcon suit={card.suit} className="card-pip-svg" />
            </span>
          ))}
        </span>
      )}

      {isAce && (
        <span className="card-ace-center" aria-hidden="true">
          <span className="card-ace-ring">
            <SuitIcon suit={card.suit} className="card-ace-svg" />
          </span>
        </span>
      )}

      {isCourt && (
        <span className="card-court-frame" aria-hidden="true">
          <SuitIcon suit={card.suit} className="court-mini-svg court-mini-tl" />
          <CourtIcon rank={card.rank as 11 | 12 | 13} />
          <span className="court-letter">{rankLabel}</span>
          <SuitIcon suit={card.suit} className="court-mini-svg court-mini-br" />
        </span>
      )}

      <span className="card-corner card-corner-br">
        <span className="card-rank">{rankLabel}</span>
        <SuitIcon suit={card.suit} className="card-corner-suit-svg" />
      </span>

      {isTrump && <span className="card-trump-pip" title="Trump suit">★</span>}
    </button>
  );
};
