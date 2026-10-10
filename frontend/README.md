# Hermes Route (frontend)

Private two-person chat. A session is opened from a link or QR code, and every message is deleted when the session ends.

**Status: working demo.** There is no backend. A mock peer ("Alex") replies locally so the UI can be built and reviewed.

## Run locally

Requires Node.js 18 or newer.

```
npm install
npm run dev
```

Open the URL it prints (usually http://localhost:5173). Run these inside the folder that contains `package.json`.

## How privacy works in the demo

- Messages exist only in React state. Nothing is written to storage, so closing or refreshing the tab ends the session.
- **End session** disconnects and clears every message immediately.
- **Invite** shows a link and QR code. The session id is in the URL fragment (`#s=...`), which browsers never send to a server, and a new id is created for every session.
- Opening an invite link removes `#s=...` from the address bar after reading it, so a reload does not rejoin and the id is not left visible. To see the other screens in the demo, open `/#s=expired`, `/#s=full` or `/#s=bad`.
- Demo-only shortcuts to the mock peer: send `/leave` to make Alex disconnect for a few seconds, or `/end` to make Alex end the session.
- The only thing stored is the theme choice (`hermes-route-theme` in localStorage).
- No third-party requests: system fonts, no analytics, `no-referrer` policy.

A frontend cannot guarantee deletion on its own. Deleting messages on the server, or never storing them there, is a backend requirement.

## Structure

- `src/services/ChatTransport.ts`: the interface the UI depends on
- `src/services/mockTransport.ts`: simulated peer; replace with WebSocket or WebRTC
- `src/hooks/useChat.ts`: messages, connection state, session start and end
- `src/components/InviteDialog/`, `QRCode/`: invite link and QR code (uses `qrcode-generator`)
- `src/components/SessionGate/`, `services/mockSession.ts`: opening an invite link shows "Joining", then the chat or an expired/invalid screen
- `docs/backend-contract.md`: what the backend must provide
- `src/hooks/useTheme.ts`: system theme detection with a manual toggle
- `src/components/`: one folder per component, each with a `.tsx` and a `.css`

## Transport modes

- **WebRTC (default).** Messages go browser to browser over an encrypted data channel. The demo signaling uses `BroadcastChannel`, so it works between tabs of the same browser only. To try it: open the app, click Invite, copy the link, and open it in a second tab.
- **Mock peer.** Create a `.env` file containing `VITE_TRANSPORT=mock` and restart `npm run dev`. The `/leave` and `/end` shortcuts only exist in this mode.
- In WebRTC mode the demo has no ICE servers, so no public IP is shared. Production needs a TURN relay (see `src/services/webrtc/rtcConfig.ts`).
