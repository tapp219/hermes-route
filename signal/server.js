"use strict";
const { WebSocketServer } = require("ws");

// Minimal signaling relay for the MVP. No keys, secrets or origin checks: anyone who
// knows a room id can join it. It only passes offers, answers and ICE candidates between
// the two browsers in a room. The chat itself never goes through this server.

// ---------- Settings (override with environment variables) ----------
const envNum = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const HOST = process.env.P2P_HOST || "127.0.0.1";   // nginx on the same machine proxies /ws here
const PORT = envNum("P2P_PORT", 9000);
const HEARTBEAT_MS = 15 * 1000;   // how often to check that each connection is still alive

const rooms = new Map();   // roomId -> Set of sockets (at most 2)
const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: 256 * 1024 });

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

// ---------- Logging: one line per event, so a failed attempt can be read back from the journal ----------
let nextId = 1;
const browserOf = (ua = "") =>
  (/iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "?") + "/" +
  (/Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "?");
const log = (ws, room, text) => console.log(`room=${String(room).slice(0, 6)} ${ws.tag} | ${text}`);

function addrKind(a) {
  if (a.endsWith(".local")) return "hidden-local-name";
  if (a.includes(":")) return /^f[cd]/i.test(a) ? "IPv6-private" : /^fe80/i.test(a) ? "IPv6-link-local" : "IPv6-public";
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) return "IPv4-private";
  if (/^192\.0\.0\./.test(a) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) return "IPv4-carrier-internal";
  return "IPv4-public";
}
function describeCandidate(c) {
  const s = c && typeof c.candidate === "string" ? c.candidate : "";
  if (!s) return "end of candidates";
  const p = s.split(" ");
  const [proto, addr, port, type] = [p[2], p[4] || "", p[5], p[7]];
  const kind = addrKind(addr);
  const shown = kind === "IPv4-public" ? `${addr}:${port}` : kind.startsWith("IPv6") ? addr.split(":").slice(0, 4).join(":") + "::" : "";
  return `candidate ${String(proto).toLowerCase()} ${type} ${kind} ${shown}`.trim();
}

// ---------- Rooms ----------
function leave(ws) {
  const id = ws.room;
  if (!id) return;
  ws.room = null;
  const room = rooms.get(id);
  if (!room) return;
  room.delete(ws);
  log(ws, id, `left; ${room.size} remain`);
  for (const peer of room) send(peer, { type: "peer-left" });
  if (room.size === 0) rooms.delete(id);
}

wss.on("connection", (ws, req) => {
  ws.room = null;   // only set once the socket has actually been let into a room
  ws.alive = true;
  ws.tag = `c${nextId++} ${req.headers["x-forwarded-for"] || req.socket.remoteAddress} ${browserOf(req.headers["user-agent"])}`;

  ws.on("pong", () => { ws.alive = true; });
  ws.on("error", () => {});   // an unhandled 'error' event would crash the process

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "join") {
      if (ws.room) return;
      const id = String(msg.room).slice(0, 100);
      let room = rooms.get(id);
      if (room && room.size >= 2) {
        log(ws, id, `REFUSED, room already has 2: ${[...room].map((p) => p.tag).join(" ; ")}`);
        send(ws, { type: "full" });
        return;
      }
      if (!room) { room = new Set(); rooms.set(id, room); }
      room.add(ws);
      ws.room = id;
      // The second person to arrive makes the offer. That also covers someone coming back after a reload.
      const initiator = room.size === 2;
      log(ws, id, `joined (${room.size} in room${initiator ? ", makes the offer" : ""})`);
      send(ws, { type: "joined", initiator });
      for (const peer of room) if (peer !== ws) send(peer, { type: "peer-joined" });
      return;
    }

    if (["offer", "answer", "candidate"].includes(msg.type) && ws.room) {
      let relayed = 0;
      for (const peer of rooms.get(ws.room) || []) {
        if (peer !== ws) { send(peer, msg); relayed++; }
      }
      log(ws, ws.room, (msg.type === "candidate" ? describeCandidate(msg.candidate) : msg.type) + (relayed ? "" : "  (not relayed: nobody else in the room)"));
    }
  });

  ws.on("close", () => leave(ws));
});

// Drop connections that stopped answering pings, so a dead one can't keep a room "full"
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);

console.log(`Signaling on ${HOST}:${PORT}`);
