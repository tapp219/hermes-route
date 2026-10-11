"use strict";
// Minimal P2P chat for the MVP. No keys, secrets or signatures: whoever opens the invite link
// joins the room. The server only relays the WebRTC handshake; messages go browser to browser.
(() => {
  const $ = (id) => document.getElementById(id);
  const log = (t) => { $("log").textContent += t + "\n"; };
  const setStatus = (t) => { $("status").textContent = t; };

  // ---------- Room id: taken from the URL (/p2p/<id>), or made up for a new chat ----------
  function getRoomId() {
    const match = location.pathname.match(/^\/p2p\/([A-Za-z0-9_-]{16,})\/?$/);
    if (match) return match[1];
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    history.replaceState(null, "", "/p2p/" + id);
    return id;
  }
  const roomId = getRoomId();
  $("link").value = location.href;
  $("copy").onclick = () => navigator.clipboard.writeText(location.href).then(() => setStatus("Link copied."), () => {});

  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      // Add a TURN (relay) server here once coturn is set up (location.hostname is this site's address):
      // { urls: `turn:${location.hostname}:3478`, username: "...", credential: "..." },
    ],
  };

  let ws = null, pc = null, channel = null;
  let remoteSet = false, pendingCandidates = [];
  const offered = { mine: [], theirs: [] };   // what each side offered, shown under "Details"

  const wsSend = (obj) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };
  const refreshSend = () => { $("send").disabled = !(channel && channel.readyState === "open"); };

  // ---------- Troubleshooting details shown on the page ----------
  function describeCandidate(line) {
    const p = String(line).split(" ");
    const [proto, addr, port, type] = [String(p[2]).toLowerCase(), p[4] || "", p[5], p[7]];
    const what = { host: "this device's local address", srflx: "public address", prflx: "public address (discovered)", relay: "relay" }[type] || type;
    if (addr.endsWith(".local")) return `${what}, hidden (only works on the same network) [${proto}]`;
    return `${what} ${addr.includes(":") ? "[" + addr + "]" : addr}:${port} [${proto}]`;
  }

  async function pairSummary() {
    if (!pc) return "";
    try {
      let pairs = 0, ok = 0, sent = 0, got = 0, haveCounts = false;
      (await pc.getStats()).forEach((s) => {
        if (s.type !== "candidate-pair") return;
        pairs++;
        if (s.state === "succeeded") ok++;
        if (typeof s.requestsSent === "number") { haveCounts = true; sent += s.requestsSent; got += s.responsesReceived || 0; }
      });
      return `Routes tried: ${pairs}, routes that answered: ${ok}` + (haveCounts ? ` (checks sent: ${sent}, replies received: ${got})` : "");
    } catch { return ""; }
  }

  async function renderDetails() {
    const lines = ["Details (for troubleshooting)"];
    if (pc) lines.push(`Connection: ${pc.connectionState}   Path finding: ${pc.iceConnectionState}   Handshake: ${pc.signalingState}`);
    lines.push("Addresses I offered:", ...(offered.mine.length ? offered.mine.map((c) => "  " + c) : ["  (none yet)"]));
    lines.push("Addresses they offered:", ...(offered.theirs.length ? offered.theirs.map((c) => "  " + c) : ["  (none yet)"]));
    const summary = await pairSummary();
    if (summary) lines.push(summary);
    $("diag").textContent = lines.join("\n");
  }

  // ---------- WebRTC ----------
  function closePeerConnection() {
    if (pc) {
      pc.onicecandidate = pc.onconnectionstatechange = pc.oniceconnectionstatechange = pc.onsignalingstatechange = pc.ondatachannel = null;
      pc.close();
    }
    pc = null;
    channel = null;
    remoteSet = false;
    pendingCandidates = [];
    offered.mine = [];
    offered.theirs = [];
    refreshSend();
  }

  function newPeerConnection() {
    closePeerConnection();
    const p = new RTCPeerConnection(rtcConfig);
    pc = p;
    p.onicecandidate = (e) => {
      if (p !== pc || !e.candidate || !e.candidate.candidate) return;
      offered.mine.push(describeCandidate(e.candidate.candidate));
      wsSend({ type: "candidate", candidate: e.candidate });
      renderDetails();
    };
    p.onconnectionstatechange = () => { if (p === pc) onStateChange(); };
    p.oniceconnectionstatechange = () => { if (p === pc) renderDetails(); };
    p.onsignalingstatechange = () => { if (p === pc) renderDetails(); };
    p.ondatachannel = (e) => { if (p === pc) setupChannel(e.channel); };
    renderDetails();
    return p;
  }

  async function onStateChange() {
    const state = pc.connectionState;
    if (state === "connected") setStatus("Connected directly to the other person");
    else if (state === "connecting") setStatus("Both sides have each other's addresses. Trying to reach the other person directly...");
    else if (state === "disconnected") setStatus("Connection interrupted...");
    else if (state === "failed") {
      refreshSend();
      setStatus("Could not connect directly. The two browsers swapped addresses, but no route between them answered. " +
        "That happens when one of the two networks (some wifi, cellular or a VPN) does not allow direct connections; " +
        "it would need a relay server. Reload both pages to try again.");
    }
    renderDetails();
  }

  function setupChannel(ch) {
    channel = ch;
    ch.onopen = () => { if (ch === channel) { refreshSend(); setStatus("Connected directly to the other person"); } };
    ch.onclose = () => { if (ch === channel) refreshSend(); };
    ch.onmessage = (e) => { if (ch === channel) log("Them: " + (typeof e.data === "string" ? e.data : "(binary data ignored)")); };
    refreshSend();
  }

  // Candidates can arrive before the offer or answer they belong to has been applied; hold them until then
  async function applyRemoteDescription(desc) {
    await pc.setRemoteDescription(desc);
    remoteSet = true;
    for (const c of pendingCandidates) {
      try { await pc.addIceCandidate(c); } catch (err) { console.error(err); }
    }
    pendingCandidates = [];
  }

  async function handleSignal(msg) {
    switch (msg.type) {
      case "joined":
        if (msg.initiator) {
          // We arrived second, so we make the offer
          const p = newPeerConnection();
          setupChannel(p.createDataChannel("chat"));
          await p.setLocalDescription(await p.createOffer());
          wsSend({ type: "offer", sdp: p.localDescription });
          setStatus("Sent our details to the other person. Waiting for theirs...");
        } else {
          setStatus("Waiting for someone to open the invite link...");
        }
        break;

      case "peer-joined":   // the other person arrived, or came back after a reload; their offer follows
        newPeerConnection();
        setStatus("The other person opened the link. Waiting for their details...");
        break;

      case "offer":
        if (!pc || remoteSet || pc.signalingState !== "stable") newPeerConnection();
        await applyRemoteDescription(msg.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        wsSend({ type: "answer", sdp: pc.localDescription });
        break;

      case "answer":
        if (!pc || pc.signalingState !== "have-local-offer") break;
        await applyRemoteDescription(msg.sdp);
        break;

      case "candidate":
        if (!pc || !msg.candidate || !msg.candidate.candidate) break;
        offered.theirs.push(describeCandidate(msg.candidate.candidate));
        if (!remoteSet) pendingCandidates.push(msg.candidate);
        else { try { await pc.addIceCandidate(msg.candidate); } catch (err) { console.error(err); } }
        break;

      case "peer-left":
        closePeerConnection();
        setStatus("The other person left. Waiting for them to come back...");
        break;

      case "full":
        setStatus("This invite link is already in use by two people. Start a new chat instead.");
        break;
    }
    renderDetails();
  }

  // ---------- Signaling connection ----------
  // Messages are handled strictly one after another, so an offer is fully applied before the candidates that follow it
  let queue = Promise.resolve();
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => wsSend({ type: "join", room: roomId });
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    queue = queue.then(() => handleSignal(msg)).catch((err) => { console.error(err); setStatus("Something went wrong while connecting: " + err.message); });
  };
  ws.onclose = () => {
    if (!pc || pc.connectionState !== "connected") setStatus("Lost the connection to the server. Reload the page.");
    else log("(connection to the server closed; the chat keeps working until someone leaves)");
  };

  // ---------- Chat box ----------
  function sendChat() {
    const input = $("msg");
    if (!input.value || !channel || channel.readyState !== "open") return;
    channel.send(input.value);
    log("Me: " + input.value);
    input.value = "";
  }
  $("send").onclick = sendChat;
  $("msg").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

  renderDetails();
})();
