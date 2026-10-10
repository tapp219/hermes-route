# Backend contract for Hermes Route

What the frontend expects. The UI only talks to `ChatTransport` (`src/services/ChatTransport.ts`) and to a session check (`src/services/mockSession.ts`). Replace those two mocks and the UI needs no changes.

## Session lifecycle

1. **Create.** A new session gets an unguessable id (the client currently makes 128 random bits; the server should own this). The creator is participant 1.
2. **Invite.** The link is `https://<host>/#s=<id>`. The id is in the fragment, so it never appears in server logs or referrers.
3. **Check.** On load the client asks whether the id is usable. Needed answers: `valid`, `expired`, `invalid`.
4. **Join.** A second participant connects. A session holds at most two people.
5. **End.** When either person ends the session, or both disconnect, or an idle timeout passes: close both connections, delete all session data, make the id permanently unusable.

## What the transport must provide

| `ChatTransport` | Meaning |
| --- | --- |
| `connect()` / `disconnect()` | Open or close the connection for the current session id |
| `send(text)` | Deliver one text message to the peer |
| `onMessage` | Peer messages only (own messages are added locally) |
| `onTyping` | Peer typing on or off |
| `onStatus` | Your own connection: `connecting`, `connected`, `disconnected` |
| `onPeerPresence` | Peer went offline (`false`) or came back (`true`) |
| `onSessionEnded` | Peer ended the session; the connection is already closed |

Message shape: `{ id, author, text, timestamp }` (see `src/types/chat.ts`).

## Session states the UI handles

- **Peer ends the session:** `onSessionEnded` clears messages and shows "<peer> ended the session".
- **Session full:** the session check returns `full` and the UI shows a dedicated screen.
- **Peer disconnected:** `onPeerPresence(false)` shows the peer as disconnected and blocks sending. Messages are not queued, because queuing would mean storing them.

## Still open

- **Own connection drops.** The UI shows "Not connected" but does not retry. Decide on reconnect rules and how long a dropped person can resume the same session.
- **Peer absent too long.** Decide when a session ends automatically if the peer never returns.

## Privacy requirements

- Never persist message contents. If a relay is used, keep them in memory only and drop them after delivery.
- Do not log message text, and do not log the full invite link.
- Idle and absolute session timeouts, so abandoned sessions disappear.
- Rate-limit session checks and joins to make guessing ids impractical.
- Strongly consider end-to-end encryption: put a separate secret in the fragment (for example `#s=<id>&k=<key>`) and encrypt in the browser, so the server never sees plaintext. This also affects whether true peer-to-peer (WebRTC) is worth it, since a relay would only carry ciphertext.

## WebRTC design

The frontend ships a `WebRtcTransport` (`src/services/webrtc/`) that implements `ChatTransport`. The only server piece it needs is a signaling service implementing `SignalingClient` (`signaling.ts`). The demo version (`broadcastSignaling.ts`) uses `BroadcastChannel`; replace it with a WebSocket client.

**What the signaling server must do**
- Hold a room per session id, with at most two people.
- Tell the person already in the room when a second person joins (`onPeerJoined`). That person makes the offer.
- Relay `offer`, `answer` and `candidate` messages to the other person, unchanged. Each carries an `id` naming the negotiation attempt; do not strip or rewrite it.
- Tell the remaining person when the other leaves (`onPeerLeft`).
- Answer the session check with `valid`, `expired`, `invalid` or `full`.
- Keep nothing after the room closes. Do not log SDP or candidates.

**Data channel protocol** (JSON, version 1): `msg`, `typing`, `ping` (every 3 seconds; no traffic for 9 seconds marks the peer disconnected) and `end`. Incoming data is size-limited and validated, and received messages get new local ids and timestamps.

**Not done yet**
- **Handshake authentication.** Without it, a malicious or compromised signaling server could swap in its own DTLS fingerprint and read the conversation. Fix: put a secret in the invite fragment (`#s=<id>&k=<secret>`), have each side send a keyed hash of its DTLS fingerprint through signaling, and verify the other side's hash before trusting the channel.
- **TURN relay.** Required for privacy (hides IP addresses) and for reliability behind strict NATs. Set `iceTransportPolicy: 'relay'`.
- **Rejoin after a crash.** A person who closes the tab sends a "bye", but a crash sends nothing, so the room may still count them. The server needs its own presence detection.
- **Waiting state.** While the first person waits for the second to arrive, the header says "Connecting". A dedicated "waiting for someone to join" state would be clearer.
