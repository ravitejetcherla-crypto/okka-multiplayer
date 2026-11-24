# OKKA — Real-time multiplayer card game

OKKA is a browser-based multiplayer card game with shareable private rooms, server-authoritative turns, private player hands, chat, reconnect support, and a responsive table UI.

## Requirements
- Node.js 20 or newer
- npm

## Run locally
From the project root:

```bash
npm install
npm --prefix server install
npm --prefix client install
npm run dev
```

Open http://localhost:5173 in multiple browser windows. Create a room in one window and join using the room code in another.

The API/socket server runs on port 3001. Vite runs on port 5173.

## Production build
```bash
npm install
npm --prefix server install
npm --prefix client install
npm run build
NODE_ENV=production npm start
```
The Express server serves the built React app and Socket.IO from the same origin.

## Deploy to Render
1. Create a GitHub repository and push this project.
2. In Render, choose **New → Blueprint** and select the repository.
3. Render reads `render.yaml` and builds the web service.
4. Open the generated `https://....onrender.com` URL and share `/?room=ROOMCODE`.

The included free plan is suitable for a prototype. Free services may sleep when idle; the first connection after inactivity can take time.

## Important prototype limitations
- Room state is held in server memory. A server restart or free-host sleep/redeploy can end active rooms.
- Reconnection works while the same server process and room still exist.
- This is a deployable prototype, not a hardened public production service. Add persistent storage (Redis or PostgreSQL), rate limits, moderation controls, and automated tests before broad public release.
- No account system is required. Rejoin uses a browser-local player token; clearing browser storage loses that token.

## Rules implementation notes
- 108-card classic deck: four colours, number cards, Skip, Reverse, Draw Two, Wild and Wild Draw Four.
- Seven cards dealt to each player.
- Opening-card actions are applied: Skip skips the first player, Reverse reverses direction, Draw Two makes the first player draw 2 and miss the turn, Wild lets the first player choose the starting colour, and opening Wild Draw Four is returned to the deck and replaced.
- One card is drawn when unable to play; if playable, that drawn card may be played, otherwise turn passes. A player may also choose to draw even when they have a playable card.
- Draw Two and Wild Draw Four are not stackable.
- Wild Draw Four is rejected if the player holds a card matching the active colour; a challenge checks that condition.
- UNO catch is available until the next player begins an action.
- Draw pile reshuffles the discard pile while preserving the top discard.
- Two-player Reverse acts like Skip.
- Draw penalties are applied automatically and the penalized player loses their turn.

This implementation is intentionally limited to the classic rule set; house rules are not enabled.
