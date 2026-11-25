import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

const baseProps = (size: number, className: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: `ui-icon ${className}`.trim(),
  'aria-hidden': true as const,
});

export const IconUser: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
  </svg>
);

export const IconBot: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 4v4" />
    <circle cx="12" cy="3" r="1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSword: React.FC<IconProps> = ({ size = 13, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
    <path d="M13 19l6-6" />
    <path d="M16 16l4 4" />
  </svg>
);

export const IconShield: React.FC<IconProps> = ({ size = 13, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6l7-3z" />
  </svg>
);

export const IconHand: React.FC<IconProps> = ({ size = 13, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M18 11V6a1.5 1.5 0 0 0-3 0v4" />
    <path d="M15 10V5a1.5 1.5 0 0 0-3 0v5" />
    <path d="M12 10V6a1.5 1.5 0 0 0-3 0v7" />
    <path d="M9 13l-1.5-1.5a1.5 1.5 0 0 0-2.1 2.1l3.4 5.2A4 4 0 0 0 12.1 21H14a5 5 0 0 0 5-5v-5a1.5 1.5 0 0 0-3 0" />
  </svg>
);

export const IconTrophy: React.FC<IconProps> = ({ size = 13, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M6 4h12v4a6 6 0 0 1-12 0V4z" />
    <path d="M6 6H3v2a3 3 0 0 0 3 3" />
    <path d="M18 6h3v2a3 3 0 0 1-3 3" />
    <path d="M12 14v5" />
    <path d="M8 21h8" />
  </svg>
);

export const IconSoundOn: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 6a8.5 8.5 0 0 1 0 12" />
  </svg>
);

export const IconSoundOff: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <path d="M22 9l-6 6" />
    <path d="M16 9l6 6" />
  </svg>
);

export const IconChat: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.5-4.5A8 8 0 1 1 21 12z" />
  </svg>
);

export const IconPalette: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="8.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconBook: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13z" />
    <path d="M8 7h8" />
    <path d="M8 11h6" />
  </svg>
);

export const IconQr: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3z" />
    <path d="M19 14v2" />
    <path d="M14 20h7v-2" />
  </svg>
);

export const IconGlobe: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a13 13 0 0 1 0 18a13 13 0 0 1 0-18z" />
  </svg>
);

export const IconMenu: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </svg>
);

export const IconClose: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M6 6l12 12" />
    <path d="M18 6l-12 12" />
  </svg>
);

export const IconSort: React.FC<IconProps> = ({ size = 14, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M3 7h12" />
    <path d="M3 12h9" />
    <path d="M3 17h6" />
    <path d="M17 7v10" />
    <path d="M14 14l3 3 3-3" />
  </svg>
);

export const IconDownload: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M4 20h16" />
  </svg>
);

export const IconMegaphone: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M3 11v2a1 1 0 0 0 1 1h2l6 4V6L6 10H4a1 1 0 0 0-1 1z" />
    <path d="M16 9a4 4 0 0 1 0 6" />
    <path d="M19 7a7 7 0 0 1 0 10" />
  </svg>
);

export const IconEye: React.FC<IconProps> = ({ size = 15, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconPause: React.FC<IconProps> = ({ size = 14, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPlay: React.FC<IconProps> = ({ size = 14, className = '' }) => (
  <svg {...baseProps(size, className)}>
    <path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none" />
  </svg>
);
