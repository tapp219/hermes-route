"use strict";
(async () => {
  const TTL_MS = 60 * 60 * 1000; // local identity records expire after 1 hour of inactivity
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();

  const log = (t) => { $("log").textContent += t + "\n"; };
  const setStatus = (t) => { $("status").textContent = t; };
  const showAlert = (t) => { const a = $("alert"); a.textContent = t; a.hidden = false; };

  if (!window.isSecureContext || !window.crypto || !crypto.subtle || !window.RTCPeerConnection || !window.indexedDB) {
    setStatus("This browser can't run the app (needs HTTPS, Web Crypto, WebRTC and IndexedDB).");
    return;
  }

  // ---------- Encoding helpers ----------
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64urlToBytes = (s) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const bytesToB64url = (u8) => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const toHex = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, "0")).join("");
  const isStr = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;

  // ---------- IndexedDB: one record per room ----------
  // { room, priv (non-extractable CryptoKey), pub (base64 SPKI), peerPub, lastActive }
  const idb = new Promise((resolve, reject) => {
    const req = indexedDB.open("p2p-identities", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("rooms", { keyPath: "room" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const idbRun = async (mode, fn) => {
    const db = await idb;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("rooms", mode);
      const req = fn(tx.objectStore("rooms"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  const idbGet = (k) => idbRun("readonly", (s) => s.get(k));
  const idbPut = (v) => idbRun("readwrite", (s) => s.put(v));
  const idbDelete = (k) => idbRun("readwrite", (s) => s.delete(k));
  const idbAll = () => idbRun("readonly", (s) => s.getAll());

  try {
    for (const r of await idbAll()) {
      if (Date.now() - r.lastActive > TTL_MS) await idbDelete(r.room);
    }
  } catch (err) {
    setStatus("Can't use browser storage (private mode?). The app needs IndexedDB.");
    return;
  }

  // ---------- Work out the room and the secret from the URL ----------
  let room, secretStr, mayCreate = false;
  const m = location.pathname.match(/^\/p2p\/([A-Za-z0-9_-]{16,64})\/?$/);
  if (m) {
    room = m[1];
    secretStr = location.hash.slice(1);
  } else {
    room = toHex(crypto.getRandomValues(new Uint8Array(16)));
    secretStr = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
    // location.search is kept so a ?relay=only test flag carries over into the invite link
    history.replaceState(null, "", `/p2p/${room}${location.search}#${secretStr}`);
    mayCreate = true;
  }
  $("link").value = location.href;
  $("copy").onclick = () => navigator.clipboard.writeText(location.href).then(() => setStatus("Link copied."), () => {});

  const secretBytes = /^[A-Za-z0-9_-]{43}$/.test(secretStr) ? b64urlToBytes(secretStr) : null;
  const hmacKey = secretBytes
    ? await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
    : null;

  // ---------- This room's identity (created once, kept until it expires) ----------
  let rec;
  try {
    rec = await idbGet(room);
    if (rec && Date.now() - rec.lastActive > TTL_MS) { await idbDelete(room); rec = null; }
    if (!rec) {
      // extractable:false means the private key bytes can never be read, even by our own code
      const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      rec = {
        room,
        priv: kp.privateKey,
        pub: b64(await crypto.subtle.exportKey("spki", kp.publicKey)),
        peerPub: null,
        lastActive: Date.now(),
      };
      await idbPut(rec);
    }
  } catch (err) {
    console.error(err);
    setStatus("Could not set up your identity key in browser storage.");
    return;
  }

  if (!rec.peerPub && !hmacKey) {
    setStatus("Can't start.");
    showAlert("This invite link is missing its secret (the part after #). Ask for the full link, or start a new chat.");
    return;
  }

  const touch = () => { rec.lastActive = Date.now(); idbPut(rec).catch(() => {}); };

  // ---------- Signing, verifying, first-contact proof ----------
  const signStr = async (s) => b64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, rec.priv, enc.encode(s)));

  async function verifySig(pubB64, s, sigB64) {
    try {
      const key = await crypto.subtle.importKey("spki", unb64(pubB64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64(sigB64), enc.encode(s));
    } catch { return false; }
  }
  const macMessage = (pubB64) => JSON.stringify(["p2p-first-v1", room, pubB64]);
  const makeMac = async () => (hmacKey ? b64(await crypto.subtle.sign("HMAC", hmacKey, enc.encode(macMessage(rec.pub)))) : null);
  async function verifyMac(macB64, pubB64) {
    if (!hmacKey || !isStr(macB64, 100)) return false;
    try { return await crypto.subtle.verify("HMAC", hmacKey, unb64(macB64), enc.encode(macMessage(pubB64))); }
    catch { return false; }
  }

  const validEnv = (e) => e && typeof e === "object" && isStr(e.sid, 64) && isStr(e.pub, 200) &&
    isStr(e.sdp, 60000) && isStr(e.sig, 200) && (e.mac == null || isStr(e.mac, 100));

  // Decide whether to trust the sender of an offer/answer. Bad messages are ignored, never fatal.
  async function acceptPeer(env) {
    if (env.pub === rec.pub) return false; // our own message reflected back
    if (rec.peerPub) {
      if (env.pub !== rec.peerPub) {
        showAlert("Ignored a message from an identity that doesn't match the person you first connected with.");
        return false;
      }
      return true;
    }
    // First contact: the sender must prove it knows the secret from the link's # part
    if (!(await verifyMac(env.mac, env.pub))) {
      showAlert("Ignored a first-contact message that didn't prove knowledge of the invite secret.");
      return false;
    }
    rec.peerPub = env.pub;
    await idbPut(rec);
    return true;
  }

  // What gets signed. It binds the SDP (including the DTLS fingerprint) to the room and to the handshake.
  const offerPayload = (sid, pub, sdp) => JSON.stringify(["p2p-sdp-v1", room, "offer", sid, pub, sdp]);
  const answerPayload = (sid, pub, offerPub, sdp) => JSON.stringify(["p2p-sdp-v1", room, "answer", sid, pub, offerPub, sdp]);

  // ---------- WebRTC state ----------
  const stunServers = [{ urls: "stun:stun.l.google.com:19302" }];
  // Filled in by the server when it has a relay: used only if no direct route works
  let relayServers = [];
  // Opening the link with ?relay=only sends everything through the relay, to check the relay itself
  const relayOnly = new URLSearchParams(location.search).get("relay") === "only";
  const rtcConfig = () => ({
    iceServers: [...stunServers, ...relayServers],
    iceTransportPolicy: relayOnly ? "relay" : "all",
  });
  const ALIVE = new Set(["connecting", "connected", "disconnected"]);

  let ws = null, authed = false, stopped = false, mySlot = -1, peerOnline = false;
  let pc = null, channel = null, currentSid = null, lastOfferAt = 0;
  let attempts = 0, retryTimer = null, pingTimer = null;

  const pcState = () => (pc ? pc.connectionState : "none");
  const refreshSend = () => { $("send").disabled = !(channel && channel.readyState === "open"); };
  const send = (obj) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };

  function createPc() {
    if (pc) {
      const old = pc;
      old.onconnectionstatechange = null;
      old.ondatachannel = null;
      old.close();
    }
    channel = null;
    const p = new RTCPeerConnection(rtcConfig());
    pc = p;
    p.onconnectionstatechange = () => { if (p === pc) onPcState(p.connectionState); };
    p.ondatachannel = (e) => { if (p === pc && !channel) setupChannel(e.channel); };
    refreshSend();
    return p;
  }

  // Which kind of route a connection ended up on: "direct", "relay", or "" if the browser hasn't said yet
  async function routeInUse(p) {
    try {
      const stats = await p.getStats();
      let pair = null;
      stats.forEach((s) => { if (s.type === "transport" && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId) || pair; });
      if (!pair) stats.forEach((s) => { if (!pair && s.type === "candidate-pair" && (s.selected || (s.nominated && s.state === "succeeded"))) pair = s; });
      if (!pair) return "";
      const kinds = [stats.get(pair.localCandidateId), stats.get(pair.remoteCandidateId)].map((c) => (c ? c.candidateType : ""));
      return kinds.includes("relay") ? "relay" : "direct";
    } catch { return ""; }
  }

  async function showConnected() {
    const p = pc;
    if (!p || p.connectionState !== "connected") return;
    let route = "";
    for (let i = 0; i < 8 && !route; i++) {   // the browser can take a moment to report which route it picked
      route = await routeInUse(p);
      if (!route) await new Promise((r) => setTimeout(r, 300));
    }
    if (p !== pc || p.connectionState !== "connected") return;
    setStatus(route === "relay"
      ? "Connected through the relay server (these two networks don't allow a direct connection). Still encrypted between the two browsers by WebRTC."
      : route === "direct" ? "Connected directly to the other person (encrypted by WebRTC)." : "Connected to the other person (encrypted by WebRTC).");
  }

  function setupChannel(ch) {
    channel = ch;
    ch.onopen = () => {
      if (ch !== channel) return;
      refreshSend();
      showConnected();
    };
    ch.onclose = () => { if (ch === channel) refreshSend(); };
    ch.onmessage = (e) => {
      if (ch !== channel) return;
      log("Them: " + (typeof e.data === "string" ? e.data.slice(0, 5000) : "(binary data ignored)"));
    };
    refreshSend();
  }

  // Wait until ICE gathering finishes (or a few seconds pass) so the signed SDP contains the candidates
  function gatherComplete(p, ms) {
    return new Promise((resolve) => {
      if (p.iceGatheringState === "complete") return resolve();
      const check = () => { if (p.iceGatheringState === "complete") done(); };
      const done = () => { p.removeEventListener("icegatheringstatechange", check); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, ms);
      p.addEventListener("icegatheringstatechange", check);
    });
  }

  function recover() {
    if (!authed) return;
    if (mySlot === 0) startOffer(true);
    else send({ type: "request-offer" });
  }

  function onPcState(state) {
    if (state === "connected") showConnected();
    else if (state === "connecting") setStatus("Connecting...");
    else if (state === "disconnected") setStatus("Connection interrupted...");
    else if (state === "failed") { setStatus("Connection lost. Reconnecting..."); refreshSend(); recover(); }
    if (state !== "connected") refreshSend();
  }

  // Slot 0 is always the one who makes offers, so the two sides never collide
  async function startOffer(force) {
    if (!authed || mySlot !== 0 || !peerOnline) return;
    if (Date.now() - lastOfferAt < 2000) return;
    if (!force && ALIVE.has(pcState())) return;
    lastOfferAt = Date.now();

    const p = createPc();
    setupChannel(p.createDataChannel("chat"));
    await p.setLocalDescription(await p.createOffer());
    await gatherComplete(p, 4000);
    if (p !== pc || !authed) return;

    const sid = toHex(crypto.getRandomValues(new Uint8Array(16)));
    currentSid = sid;
    const sdp = p.localDescription.sdp;
    const env = { sid, pub: rec.pub, sdp, sig: await signStr(offerPayload(sid, rec.pub, sdp)), mac: await makeMac() };
    if (p !== pc) return;
    send({ type: "offer", env });
    setStatus("Connecting...");

    // If nothing connects within 20s, try again with a fresh offer
    setTimeout(() => { if (pc === p && p.connectionState !== "connected") startOffer(true); }, 20000);
  }

  async function onOffer(env) {
    if (!validEnv(env) || !(await acceptPeer(env))) return;
    if (!(await verifySig(env.pub, offerPayload(env.sid, env.pub, env.sdp), env.sig))) {
      showAlert("Ignored an offer with an invalid signature.");
      return;
    }
    const p = createPc();
    await p.setRemoteDescription({ type: "offer", sdp: env.sdp });
    await p.setLocalDescription(await p.createAnswer());
    await gatherComplete(p, 4000);
    if (p !== pc || !authed) return;

    const sdp = p.localDescription.sdp;
    const answer = {
      sid: env.sid, pub: rec.pub, sdp,
      sig: await signStr(answerPayload(env.sid, rec.pub, env.pub, sdp)),
      mac: await makeMac(),
    };
    if (p !== pc) return;
    send({ type: "answer", env: answer });
    setStatus("Connecting...");
  }

  async function onAnswer(env) {
    if (!validEnv(env) || env.sid !== currentSid) return;               // stale or unexpected answer
    if (!pc || pc.signalingState !== "have-local-offer") return;         // duplicate answer
    const p = pc;
    if (!(await acceptPeer(env))) return;
    if (!(await verifySig(env.pub, answerPayload(env.sid, env.pub, rec.pub, env.sdp), env.sig))) {
      showAlert("Ignored an answer with an invalid signature.");
      return;
    }
    if (p !== pc || p.signalingState !== "have-local-offer") return;
    await p.setRemoteDescription({ type: "answer", sdp: env.sdp });
  }

  // ---------- Signaling connection ----------
  function onRejected(reason) {
    stopped = true;
    if (reason === "unknown-room") {
      if (pcState() === "connected") {
        showAlert("The server no longer knows this chat (it expired or restarted). Your direct connection keeps working, but it can't be re-established if it drops.");
      } else {
        // Say so instead of silently dropping the person into a different, empty chat
        idbDelete(room).catch(() => {});
        setStatus("This chat is gone.");
        showAlert("The server no longer knows this chat (it expired or restarted). Use \"Start a new chat\" below and share the new link.");
      }
    } else if (reason === "sealed") {
      setStatus("Can't join.");
      showAlert("This invite link is already in use by two browsers, or this browser's saved identity for it was lost or expired. Start a new chat instead.");
    } else {
      setStatus("Can't join.");
      showAlert("The server refused the connection (" + reason + ").");
    }
  }

  async function onServer(msg) {
    switch (msg.type) {
      case "challenge":
        if (!isStr(msg.nonce, 100)) return;
        send({ type: "proof", sig: await signStr(JSON.stringify(["p2p-join-v1", room, msg.nonce])) });
        return;

      case "joined":
        if (Array.isArray(msg.iceServers)) relayServers = msg.iceServers;
        authed = true;
        attempts = 0;
        mayCreate = false;
        mySlot = msg.slot;
        peerOnline = !!msg.peerOnline;
        clearInterval(pingTimer);
        pingTimer = setInterval(() => { send({ type: "ping" }); touch(); }, 20000);
        touch();
        if (pcState() !== "connected") {
          setStatus(peerOnline ? "Connecting..." : "Waiting for the other person to open the link...");
        }
        if (mySlot === 0) { if (peerOnline) startOffer(false); }
        else if (!ALIVE.has(pcState())) send({ type: "request-offer" });
        return;

      case "peer-online":
        peerOnline = true;
        if (mySlot === 0) startOffer(false);
        return;

      case "peer-offline":
        peerOnline = false;
        if (pcState() !== "connected") setStatus("Waiting for the other person...");
        return;

      case "request-offer":
        peerOnline = true;
        if (mySlot === 0) startOffer(true);
        return;

      case "offer": await onOffer(msg.env); return;
      case "answer": await onAnswer(msg.env); return;

      case "replaced":
        stopped = true;
        showAlert("This chat was opened in another tab or window of this browser, which took over. Close this tab.");
        return;

      case "rejected":
        onRejected(String(msg.reason));
        return;
    }
  }

  function connect() {
    if (stopped) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(retryTimer);

    const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws = sock;
    sock.onopen = () => {
      if (sock !== ws) return;
      sock.send(JSON.stringify({ type: "join", room, pub: rec.pub, create: mayCreate }));
    };
    sock.onmessage = (e) => {
      if (sock !== ws) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && typeof msg.type === "string") onServer(msg).catch((err) => console.error(err));
    };
    sock.onerror = () => {};
    sock.onclose = (e) => {
      if (sock !== ws) return;
      authed = false;
      peerOnline = false;
      clearInterval(pingTimer);
      if (stopped) return;
      if (e.code === 1008) showAlert("The server refused the connection. If this keeps happening, the server's allowed-origin setting may not match this page's address.");
      attempts++;
      retryTimer = setTimeout(connect, Math.min(1000 * attempts, 15000));
      if (pcState() !== "connected") setStatus("Reconnecting to the server...");
    };
  }

  // Coming back to the tab: reconnect right away instead of waiting for the retry timer
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !stopped) { clearTimeout(retryTimer); connect(); }
  });

  // ---------- Chat box ----------
  function sendChat() {
    const input = $("msg");
    const text = input.value;
    if (!text || !channel || channel.readyState !== "open") return;
    channel.send(text);
    log("Me: " + text);
    input.value = "";
  }
  $("send").onclick = sendChat;
  $("msg").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

  connect();
})();
