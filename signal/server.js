const { WebSocketServer } = require("ws");

const wss = new WebSocketServer({ port: 9000 });
const rooms = new Map(); // roomName -> Set of sockets

wss.on("connection", (ws) => {
  ws.room = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      ws.room = String(msg.room);
      if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
      const room = rooms.get(ws.room);

      if (room.size >= 2) {
        ws.send(JSON.stringify({ type: "full" }));
        return;
      }
      room.add(ws);
      ws.send(JSON.stringify({ type: "joined", initiator: room.size === 2 }));
      for (const peer of room) {
        if (peer !== ws) peer.send(JSON.stringify({ type: "peer-joined" }));
      }
      return;
    }

    if (["offer", "answer", "candidate"].includes(msg.type) && ws.room) {
      for (const peer of rooms.get(ws.room) || []) {
        if (peer !== ws) peer.send(JSON.stringify(msg));
      }
    }
  });

  ws.on("close", () => {
    if (!ws.room) return;
    const room = rooms.get(ws.room);
    if (!room) return;
    room.delete(ws);
    for (const peer of room) peer.send(JSON.stringify({ type: "peer-left" }));
    if (room.size === 0) rooms.delete(ws.room);
  });
});

console.log("Signaling on :9000");
