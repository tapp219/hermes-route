"use strict";
const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ---------- Settings (the P2P_* ones can be overridden with environment variables) ----------
const envNum = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const HOST = process.env.P2P_HOST || "127.0.0.1";   // only nginx (same machine) can reach this
const PORT = envNum("P2P_PORT", 9000);
// Pages allowed to open a WebSocket here. The site this server sits behind is always
// allowed (see originAllowed), whatever its address is. List any other origins in
// P2P_ORIGINS, comma-separated, e.g. "https://example.com,https://www.example.com".
const EXTRA_ORIGINS = (process.env.P2P_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const ROOM_TTL_MS = envNum("P2P_ROOM_TTL_S", 60 * 60) * 1000;   // delete a room after 1 hour with nobody connected
const SWEEP_MS = Math.min(60 * 1000, ROOM_TTL_MS / 2);           // how often expired rooms are looked for
// Where the list of rooms is kept on disk, so that restarting this server doesn't end every chat.
// ":memory:" keeps it in memory only (rooms are then forgotten on restart).
const DB_PATH = process.env.P2P_DB || path.join(__dirname, "data", "rooms.db");
// A room whose hour ran out while the server was off gets this long after startup for someone to come back
const STARTUP_GRACE_MS = Math.min(5 * 60 * 1000, ROOM_TTL_MS);
const MAX_ROOMS = 5000;
// Everyone on the same wifi shares one public IP, so keep this well above "one person's tabs"
const MAX_CONNS_PER_IP = envNum("P2P_MAX_CONNS_PER_IP", 100);
const MAX_MSGS_PER_10S = 60;
const AUTH_TIMEOUT_MS = 10 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const ROOM_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
// Relay: off unless the secret is set (deploy/setup.sh puts it in /etc/hermes-route/turn.env)
const TURN_SECRET = process.env.P2P_TURN_SECRET || "";
const TURN_PORT = envNum("P2P_TURN_PORT", 3478);
const TURN_TTL_S = envNum("P2P_TURN_TTL_S", 12 * 60 * 60);   // how long a relay login stays valid

// roomId -> { id, slots: [pubKeyA, pubKeyB], sockets: [wsA, wsB], lastActive, dirty }
// This map is what the server works from. The database below is its copy on disk: the room's id,
// its two public keys and when it was last active. Nothing about who connected or what was said.
const rooms = new Map();
const connsPerIp = new Map();

// ---------- Rooms on disk (SQLite, built into Node 22.13 and later) ----------
let db = null, saveStmt = null, touchStmt = null, deleteStmt = null;
try {
  const { DatabaseSync } = require("node:sqlite");
  if (DB_PATH !== ":memory:") fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");   // quick writes that still survive a crash
  db.exec(`CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    slot0 TEXT,
    slot1 TEXT,
    last_active INTEGER NOT NULL
  )`);
  saveStmt = db.prepare(`INSERT INTO rooms (id, slot0, slot1, last_active) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET slot0 = excluded.slot0, slot1 = excluded.slot1, last_active = excluded.last_active`);
  touchStmt = db.prepare("UPDATE rooms SET last_active = ? WHERE id = ?");
  deleteStmt = db.prepare("DELETE FROM rooms WHERE id = ?");

  // Pick up where the last run left off. Time the server spent switched off shouldn't end a chat by
  // itself, so a room that is already past its hour is given a few minutes for its people to reconnect.
  const now = Date.now();
  for (const row of db.prepare("SELECT id, slot0, slot1, last_active FROM rooms").all()) {
    rooms.set(row.id, {
      id: row.id,
      slots: [row.slot0, row.slot1],
      sockets: [null, null],
      lastActive: Math.max(Number(row.last_active), now - ROOM_TTL_MS + STARTUP_GRACE_MS),
      dirty: false,
    });
  }
} catch (err) {
  // Keep serving chats from memory, as before, rather than not at all
  console.error(`Room database unavailable (${err.message}); rooms will not survive a restart.`);
  db = null;
}

// A failed write must never take the chat down with it
function dbRun(what, fn) {
  if (!db) return;
  try { fn(); } catch (err) { console.error(`Room database: could not ${what} (${err.message})`); }
}
// Written straight away: a new room, or a room's second person claiming their place
const saveRoom = (room) => dbRun("save a room", () => saveStmt.run(room.id, room.slots[0], room.slots[1], room.lastActive));
// "Last active" changes with every message, so it is only marked here and written out in batches
const touchRoom = (room) => { room.lastActive = Date.now(); room.dirty = true; };
function flushRooms() {
  dbRun("save room activity", () => {
    const dirty = [...rooms.values()].filter((r) => r.dirty);
    if (!dirty.length) return;
    db.exec("BEGIN");
    try {
      for (const room of dirty) { touchStmt.run(room.lastActive, room.id); room.dirty = false; }
      db.exec("COMMIT");
    } catch (err) { db.exec("ROLLBACK"); throw err; }
  });
}

const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: 64 * 1024 });

function send(ws, obj) {
  if (ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch {}
}

function reject(ws, reason) {
  ws.authed = false;
  send(ws, { type: "rejected", reason });
  ws.close(1008, reason);
}

// True only for the one live, authenticated socket that currently owns its slot
function isCurrent(ws) {
  return ws.authed && ws.room && ws.room.sockets[ws.slot] === ws;
}

// Accept only canonical P-256 public keys (SPKI DER, 91 bytes, base64)
function parsePublicKey(b64) {
  if (typeof b64 !== "string" || b64.length > 200) return null;
  try {
    const der = Buffer.from(b64, "base64");
    if (der.length !== 91 || der.toString("base64") !== b64) return null;
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec") return null;
    if (key.asymmetricKeyDetails.namedCurve !== "prime256v1") return null;
    return key;
  } catch {
    return null;
  }
}

const isStr = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;

// Relay logins, for when the two networks allow no direct connection. This is coturn's
// "use-auth-secret" scheme: the username is an expiry time and the password is an HMAC of it
// with the shared secret, so nothing is stored and the relay checks the same sum.
// The relay runs on the same machine as this site, so its address is whatever the browser used
// to reach us (the Host header), which keeps any address out of the config.
function relayServersFor(req) {
  if (!TURN_SECRET) return undefined;
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return undefined;
  const username = `${Math.floor(Date.now() / 1000) + TURN_TTL_S}:hermes`;
  const credential = crypto.createHmac("sha1", TURN_SECRET).update(username).digest("base64");
  return [{
    urls: [`turn:${host}:${TURN_PORT}?transport=udp`, `turn:${host}:${TURN_PORT}?transport=tcp`],
    username,
    credential,
  }];
}

// Same-origin check: the page's address (Origin) must be the address the request was
// sent to (Host, which nginx passes through). No address is written down here, so this
// keeps working when the server's IP or domain changes.
function originAllowed(req) {
  const origin = req.headers.origin;
  if (typeof origin !== "string") return false;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// Rebuild an offer/answer envelope so only expected string fields are forwarded
function cleanEnvelope(e) {
  if (!e || typeof e !== "object") return null;
  if (!isStr(e.sid, 64) || !isStr(e.pub, 200) || !isStr(e.sdp, 60000) || !isStr(e.sig, 200)) return null;
  return { sid: e.sid, pub: e.pub, sdp: e.sdp, sig: e.sig, mac: isStr(e.mac, 100) ? e.mac : null };
}

wss.on("connection", (ws, req) => {
  ws.on("error", () => {});   // an unhandled 'error' event would crash the process

  if (!originAllowed(req)) { ws.close(1008, "bad origin"); return; }

  // nginx sets X-Forwarded-For; the socket itself is always 127.0.0.1
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
  const count = connsPerIp.get(ip) || 0;
  if (count >= MAX_CONNS_PER_IP) { ws.close(1013, "too many connections"); return; }
  connsPerIp.set(ip, count + 1);

  ws.alive = true;
  ws.authed = false;
  ws.pending = null;
  ws.room = null;
  ws.slot = -1;
  ws.msgCount = 0;
  ws.authTimer = setTimeout(() => { if (!ws.authed) ws.close(1008, "auth timeout"); }, AUTH_TIMEOUT_MS);

  ws.on("pong", () => { ws.alive = true; });

  ws.on("message", (raw, isBinary) => {
    if (isBinary) return;
    if (++ws.msgCount > MAX_MSGS_PER_10S) { ws.close(1008, "rate limit"); return; }

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      // Step 1: client says who it is and which room it wants; we send a challenge
      case "join": {
        if (ws.authed || ws.pending) return;
        if (typeof msg.room !== "string" || !ROOM_ID_RE.test(msg.room)) return reject(ws, "bad-request");
        const keyObj = parsePublicKey(msg.pub);
        if (!keyObj) return reject(ws, "bad-request");
        const nonce = crypto.randomBytes(32).toString("base64");
        ws.pending = { room: msg.room, pub: msg.pub, keyObj, nonce, create: msg.create === true };
        send(ws, { type: "challenge", nonce });
        return;
      }

      // Step 2: client proves it holds the private key; only then do we touch any room
      case "proof": {
        const p = ws.pending;
        if (!p || ws.authed) return;
        ws.pending = null;   // a challenge can only be answered once

        let ok = false;
        try {
          const data = Buffer.from(JSON.stringify(["p2p-join-v1", p.room, p.nonce]));
          const sig = Buffer.from(String(msg.sig), "base64");
          ok = crypto.verify("sha256", data, { key: p.keyObj, dsaEncoding: "ieee-p1363" }, sig);
        } catch { ok = false; }
        if (!ok) return reject(ws, "bad-proof");

        let room = rooms.get(p.room);
        if (!room) {
          if (!p.create) return reject(ws, "unknown-room");
          if (rooms.size >= MAX_ROOMS) return reject(ws, "busy");
          room = { id: p.room, slots: [null, null], sockets: [null, null], lastActive: Date.now(), dirty: false };
          rooms.set(p.room, room);
        }

        // Already one of the two registered keys? Otherwise claim an empty slot, else sealed.
        let slot = room.slots.indexOf(p.pub);
        if (slot === -1) {
          slot = room.slots.indexOf(null);
          if (slot === -1) return reject(ws, "sealed");
          room.slots[slot] = p.pub;
          room.lastActive = Date.now();
          saveRoom(room);   // on disk before the browser is told it has joined
        }

        // Same identity connecting again (reconnect, or second tab): replace the old socket
        const old = room.sockets[slot];
        if (old && old !== ws) {
          old.authed = false;
          send(old, { type: "replaced" });
          old.close(4000, "replaced");
        }

        clearTimeout(ws.authTimer);
        ws.authed = true;
        ws.room = room;
        ws.slot = slot;
        room.sockets[slot] = ws;
        touchRoom(room);

        const other = room.sockets[1 - slot];
        // Only a browser that has proved its identity for this room gets a relay login
        send(ws, { type: "joined", slot, peerOnline: !!other, iceServers: relayServersFor(req) });
        if (other) send(other, { type: "peer-online" });
        return;
      }

      // Authenticated relaying. The server forwards but never stores or inspects SDP.
      case "offer":
      case "answer": {
        if (!isCurrent(ws)) return;
        touchRoom(ws.room);
        const env = cleanEnvelope(msg.env);
        const other = ws.room.sockets[1 - ws.slot];
        if (env && other) send(other, { type: msg.type, env });
        return;
      }

      case "request-offer": {
        if (!isCurrent(ws)) return;
        touchRoom(ws.room);
        const other = ws.room.sockets[1 - ws.slot];
        if (other) send(other, { type: "request-offer" });
        return;
      }

      case "ping": {
        if (isCurrent(ws)) touchRoom(ws.room);
        return;
      }
    }
  });

  ws.on("close", () => {
    clearTimeout(ws.authTimer);
    const n = (connsPerIp.get(ip) || 1) - 1;
    if (n <= 0) connsPerIp.delete(ip); else connsPerIp.set(ip, n);

    if (isCurrent(ws)) {
      const room = ws.room;
      room.sockets[ws.slot] = null;
      touchRoom(room);
      const other = room.sockets[1 - ws.slot];
      if (other) send(other, { type: "peer-offline" });
    }
  });
});

// Drop sockets that stopped answering pings (closing them frees their slot's socket)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);

// Reset per-socket message counters
setInterval(() => { for (const ws of wss.clients) ws.msgCount = 0; }, 10 * 1000);

// Delete rooms that have had nobody connected for ROOM_TTL_MS, from memory and from disk,
// and write out the activity times that changed since last time
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (!room.sockets[0] && !room.sockets[1] && now - room.lastActive > ROOM_TTL_MS) {
      rooms.delete(id);
      dbRun("delete an expired room", () => deleteStmt.run(id));
    }
  }
  flushRooms();
}, SWEEP_MS);

// Being stopped or restarted (systemd sends SIGTERM): save the latest activity times first
function shutdown() {
  flushRooms();
  dbRun("close", () => db.close());
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

wss.on("listening", () => {
  console.log(`Signaling on ${HOST}:${PORT} (relay logins ${TURN_SECRET ? "on" : "off"}; ` +
    (db ? `${rooms.size} room(s) restored from ${DB_PATH}` : "rooms kept in memory only") + ")");
});
