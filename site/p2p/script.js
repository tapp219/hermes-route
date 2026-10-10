const log = (t) => (document.getElementById("log").textContent += t + "\n");
const setStatus = (t) => (document.getElementById("status").textContent = t);

// Get the room ID from the URL, or create one and update the URL
function getRoomId() {
  const match = location.pathname.match(/^\/p2p\/([A-Za-z0-9_-]{16,})\/?$/);
  if (match) return match[1];
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  history.replaceState(null, "", "/p2p/" + id);
  return id;
}

const roomId = getRoomId();
document.getElementById("link").value = location.href;
document.getElementById("copy").onclick = () =>
  navigator.clipboard.writeText(location.href);

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    // Add your own TURN server here once coturn is set up
  ],
};

let ws, pc, channel;

function createPeerConnection() {
  pc = new RTCPeerConnection(rtcConfig);
  pc.onicecandidate = (e) => {
    if (e.candidate) ws.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
  };
  pc.onconnectionstatechange = () => setStatus("Connection: " + pc.connectionState);
  pc.ondatachannel = (e) => setupChannel(e.channel);
}

function setupChannel(ch) {
  channel = ch;
  channel.onopen = () => {
    setStatus("Connected directly to the other person");
    document.getElementById("send").disabled = false;
  };
  channel.onmessage = (e) => log("Them: " + e.data);
}

async function handleSignal(msg) {
  switch (msg.type) {
    case "joined":
      createPeerConnection();
      if (msg.initiator) {
        setupChannel(pc.createDataChannel("chat"));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "offer", sdp: pc.localDescription }));
      } else {
        setStatus("Waiting for someone to open the invite link...");
      }
      break;
    case "offer":
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: "answer", sdp: pc.localDescription }));
      break;
    case "answer":
      await pc.setRemoteDescription(msg.sdp);
      break;
    case "candidate":
      try { await pc.addIceCandidate(msg.candidate); } catch (err) { console.error(err); }
      break;
    case "peer-left":
      setStatus("The other person left");
      document.getElementById("send").disabled = true;
      pc.close();
      break;
    case "full":
      setStatus("This invite link is already in use by two people");
      break;
  }
}

// Join automatically on load
ws = new WebSocket(`wss://${location.host}/ws`);
ws.onopen = () => ws.send(JSON.stringify({ type: "join", room: roomId }));
ws.onmessage = (e) => handleSignal(JSON.parse(e.data));
ws.onclose = () => log("(signaling connection closed)");

document.getElementById("send").onclick = () => {
  const input = document.getElementById("msg");
  if (!input.value) return;
  channel.send(input.value);
  log("Me: " + input.value);
  input.value = "";
};
