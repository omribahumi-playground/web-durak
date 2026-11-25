# DURAK — Zero-Backend WebRTC Multiplayer Card Game

A 100% static browser-based **Durak** card game supporting **2–4 players** with any mix of **human players over WebRTC DataChannels** and **computer AI opponents**—ready for **GitHub Pages** with zero backend server required.

## Features

- **Zero-Backend WebRTC Peer-to-Peer Multiplayer**:
  - Host-authoritative star topology over reliable WebRTC DataChannels with sanitized per-player views (remote players never receive opponents' hidden hands or deck contents).
  - **Automatic 6-character Room Codes** using PeerJS's free public signaling broker—works directly from static hosting (GitHub Pages, Netlify, Vercel) with no backend to run.
  - **Direct Manual P2P Invite Codes** (Offer/Answer copy-paste) built in as a zero-broker fallback.
  - Live RTT ping readout, synced in-game chat & quick emotes, and automatic **AI Bot takeover** if a remote human disconnects mid-match.
- **Flexible 2–4 Player Lobbies**:
  - Play solo against 1–3 AI bots, play with 2–4 real friends, or mix humans and bots freely in any seat.
- **Authentic Durak Rules & Configurable Deck Size**:
  - Choose **24 cards** (9–A), **36 cards** (6–A, standard), or **52 cards** (2–A).
  - **Classic (Throw-in)** and **Passing Mode** variants.
  - Optional 5-card first-bout cap (until first discard) and optional 4-player neighbors-only throw-in rule.
  - 5 AI difficulty levels (**Easy**, **Normal**, **Hard**, **Extreme**, **Master**—with card memory, Alpha-Beta 1v1 endgame solver, and Monte Carlo mid-game search), configurable globally or per bot seat.
- **High-Visibility Cards**:
  - Bold custom SVG suit icons, traditional pip layouts (`2`–`10`), court emblems, and an optional **4-Color Suits** accessibility toggle.

## Local Development

```bash
pnpm install
pnpm run dev
```

Open `http://localhost:5173`. To test multiplayer locally, open two browser tabs—host a room in Tab 1, copy the 6-character Room Code, and join in Tab 2!

## Deploy to GitHub Pages (Zero Backend)

This repo includes a ready-to-use GitHub Actions workflow at `.github/workflows/deploy.yml` and relative asset paths (`base: './'` in `vite.config.ts`):

1. Push this repository to GitHub (on the `main` branch).
2. In your GitHub repo, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Every push to `main` automatically runs tests, builds `dist/`, and publishes to `https://<your-username>.github.io/<repo-name>/`.

## Tests & Build

```bash
pnpm test
pnpm run build
```
