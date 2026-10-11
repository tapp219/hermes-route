"use strict";
(async () => {
  const TTL_MS = 60 * 60 * 1000; // local identity records expire after 1 hour of inactivity
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();

  const firstTextbox = document.querySelector(".first-textbox");
  const secondTextbox = document.querySelector(".second-textbox");
  const sendButton = document.querySelector(".send-button");
  const renameButton = document.querySelector(".rename-button");
  const attachButton = document.querySelector(".attach-button");
  const fileInput = $("file");

  const setStatus = (t) => { $("status").textContent = t; };
  const showAlert = (t) => { const a = $("alert"); a.textContent = t; a.hidden = false; };
  // A warning that goes away by itself, unless a different one has taken its place by then
  const showBriefAlert = (t) => {
    showAlert(t);
    setTimeout(() => { const a = $("alert"); if (a.textContent === t) a.hidden = true; }, 8000);
  };

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
  // { room, priv (non-extractable CryptoKey), pub (base64 SPKI), peerPub, lastActive, name (if one was chosen) }
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
  // The Copy button says "Copied!" for a moment. If the browser won't copy, the link is selected to copy by hand.
  let copyTimer = null;
  $("copy").onclick = () => navigator.clipboard.writeText(location.href).then(() => {
    $("copy").textContent = "Copied!";
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { $("copy").textContent = "Copy"; }, 1500);
  }, () => { $("link").select(); });
  // The link only ever works for two browsers, so once the other person has joined there is nothing left to
  // share: the link and Copy button give way to a note saying so (styles.css does the hiding)
  const inviteBox = document.querySelector(".invite-container");
  const hideInvite = () => { inviteBox.classList.add("joined"); };
  // On a phone the QR code and its note take a good part of the screen. Once the two are connected and
  // the messages no longer fit in their box, it shrinks to a small code beside the status line (styles.css
  // does that, on narrow screens only). Pressing the small code still opens the big one, note included.
  const tidyInvite = () => {
    if (inviteBox.classList.contains("joined") && firstTextbox.scrollHeight > firstTextbox.clientHeight + 1) inviteBox.classList.add("compact");
  };

  // ---------- QR code of the invite link ----------
  // Drawn as two shapes so styles.css can colour them: the three corner squares, and everything else
  function drawQr() {
    const holder = $("qr");
    if (typeof qrcode !== "function") { holder.hidden = true; return; }   // vendor/qrcode.js didn't load
    const qr = qrcode(0, "L");   // 0 = smallest size that fits the link; L = fewest, biggest squares
    qr.addData(location.href, "Byte");
    qr.make();
    const n = qr.getModuleCount();
    const inCorner = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    let corners = "", rest = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        if (inCorner(r, c)) corners += `M${c} ${r}h1v1h-1z`;
        else rest += `M${c} ${r}h1v1h-1z`;
      }
    }
    const SVG = "http://www.w3.org/2000/svg";
    const margin = 2;   // the white box around the code supplies the rest of the blank border scanners need
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `${-margin} ${-margin} ${n + 2 * margin} ${n + 2 * margin}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    for (const [cls, d] of [["qr-squares", rest], ["qr-corners", corners]]) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("class", cls);
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    holder.replaceChildren(svg);

    // Pressing the code opens it much bigger, so someone else can scan it from further away.
    // Pressing anywhere (or Esc) closes it again.
    const big = $("qr-big");
    big.querySelector(".qr-big-code").replaceChildren(svg.cloneNode(true));
    holder.addEventListener("click", () => {
      const joined = inviteBox.classList.contains("joined");
      big.querySelector(".qr-big-hint").textContent =
        (joined ? "You are both here, so this link now only works in your two browsers." : "Scan to join this chat.") + " Press anywhere to close.";
      big.showModal();
    });
    big.addEventListener("click", () => big.close());
  }
  drawQr();

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

  if (rec.peerPub) hideInvite();

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
    hideInvite();
    return true;
  }

  // What gets signed. It binds the SDP (including the DTLS fingerprint) to the room and to the handshake.
  const offerPayload = (sid, pub, sdp) => JSON.stringify(["p2p-sdp-v1", room, "offer", sid, pub, sdp]);
  const answerPayload = (sid, pub, offerPub, sdp) => JSON.stringify(["p2p-sdp-v1", room, "answer", sid, pub, offerPub, sdp]);

  // ---------- Chat messages ----------
  // What travels over the connection is small JSON frames:
  //   hello  sent by each side when a connection opens: its name and its message counter
  //   msg    a chat message, with an id, its place in line, and the time it was sent
  //   ack    "I have message <id>" (or file <id>, all of it)
  //   name   the sender changed their name
  //   typing the sender started (on: true) or stopped (on: false) typing
  // and, for files (see "Files" further down):
  //   file   "I have a file for you": its id, place in line, time, name, type and size
  //   want   the receiver's reply: "send me file <id>, starting at byte <from>"
  //   data   "the pieces that follow are file <id>, starting at byte <from>"; the pieces themselves
  //          are the only thing on the connection that is raw bytes instead of JSON
  //   cancel the sender can't send file <id> after all
  // Shown until a name is chosen: your own messages say "You", the other person's say "Anonymous"
  const DEFAULT_NAME = "You", DEFAULT_OTHER_NAME = "Anonymous";
  const cleanName = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 30) : "");
  // Each person picks their own name, which the other person sees too. "" until one is chosen.
  // Your name is kept in this chat's identity record, so it survives a reload, is never carried into
  // another chat, and is deleted along with the record after an hour of inactivity.
  let userName = cleanName(rec.name);
  let otherUserName = "";

  // Message order. When both people press Send at the same moment, each message reaches the other screen
  // after that screen has already shown its own, so "the order they arrived in" differs between the two
  // screens. Instead every message carries a counter (one more than the highest this side has sent or
  // seen), and both screens sort by it; if the counters tie, the person whose identity key sorts first
  // goes first. Both sides work out the same order, and a reply always comes after what it replies to.
  let clock = 0;
  const messages = [];          // the messages on screen, in the order shown
  const seen = new Set();       // ids of the other person's messages already shown, so a repeat isn't shown twice
  const outbox = new Map();     // my messages the other person hasn't confirmed yet (id -> frame), sent again after a reconnect
  let peerReady = false;        // the other side's hello has arrived on the current connection
  const validClock = (v) => Number.isSafeInteger(v) && v >= 0 && v < 2 ** 40;
  const comesBefore = (a, b) => (a.clock !== b.clock ? a.clock < b.clock : a.rank < b.rank);
  const timeText = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const nameFor = (mine) => (mine ? userName || DEFAULT_NAME : otherUserName || DEFAULT_OTHER_NAME) + ": ";

  // Adds one message to the top textbox, in its place in line: name, text, and the time it was sent
  function addMessage(m) {   // m: { id, mine, clock, ts, and either text or file }
    m.rank = (rec.pub < rec.peerPub) === m.mine ? 0 : 1;
    const messageElement = document.createElement("div");
    messageElement.className = m.mine ? "message-row" : "message-row other-user";
    m.nameSpan = document.createElement("span");
    m.nameSpan.className = "message-name";
    m.nameSpan.textContent = nameFor(m.mine);
    let body;
    if (m.file) body = fileBody(m);
    else {
      body = document.createElement("span");
      body.className = "message-text";
      body.textContent = m.text;
    }
    m.timeElement = document.createElement("time");
    m.timeElement.className = "message-time";
    m.timeElement.dateTime = new Date(m.ts).toISOString();
    m.timeElement.title = new Date(m.ts).toLocaleString();
    m.timeElement.textContent = timeText(m.ts);
    messageElement.append(m.nameSpan, body, m.timeElement);
    m.row = messageElement;

    let i = messages.length;
    while (i > 0 && comesBefore(m, messages[i - 1])) i--;
    firstTextbox.insertBefore(messageElement, i < messages.length ? messages[i].row : typingRow);
    messages.splice(i, 0, m);
    tidyInvite();
    firstTextbox.scrollTop = firstTextbox.scrollHeight;
  }

  // A name changed: every message from that person shows the new one
  function renderNames() {
    for (const m of messages) m.nameSpan.textContent = nameFor(m.mine);
    typingRow.textContent = typingText();
  }

  // ---------- Typing indicator ----------
  // While you type, the other person sees "<name> is typing..." as the last line of their messages box.
  // "on" is repeated every few seconds while the typing goes on, and the other side hides the line by
  // itself when no "on" has come for a while, so a lost "off" can't leave it showing.
  const TYPING_IDLE_MS = 3000;     // no keys pressed for this long counts as stopped
  const TYPING_REPEAT_MS = 3000;   // how often "on" is sent again while typing continues
  const TYPING_SHOWN_MS = 6000;    // how long the line stays up after the last "on"
  const typingRow = firstTextbox.querySelector(".typing-row");
  const typingText = () => `${otherUserName || DEFAULT_OTHER_NAME} is typing...`;
  let typingSentAt = 0, typingIdleTimer = null, typingHideTimer = null;

  // The other person's side: show or hide the line
  function showTyping(on) {
    clearTimeout(typingHideTimer);
    if (on) typingHideTimer = setTimeout(() => showTyping(false), TYPING_SHOWN_MS);
    if (typingRow.hidden === !on) return;   // already showing (or hidden)
    const stay = atBottom();
    typingRow.textContent = typingText();
    typingRow.hidden = !on;
    if (stay) scrollToBottom();
  }

  // This side: tell the other person when typing starts and stops
  function stopTyping() {
    clearTimeout(typingIdleTimer);
    if (!typingSentAt) return;
    typingSentAt = 0;
    sendFrame({ t: "typing", on: false });
  }
  function noteTyping() {
    if (!canSend()) return;
    if (secondTextbox.value.trim() === "") { stopTyping(); return; }   // everything deleted
    if (Date.now() - typingSentAt > TYPING_REPEAT_MS) {
      typingSentAt = Date.now();
      sendFrame({ t: "typing", on: true });
    }
    clearTimeout(typingIdleTimer);
    typingIdleTimer = setTimeout(stopTyping, TYPING_IDLE_MS);
  }

  // ---------- Files ----------
  // A file is a message like any other (same counter, same place in line on both screens), but its
  // contents go across in pieces. The sender announces it; the receiver says where to start from, which
  // is 0 unless a dropped connection left it with the first part already; the sender sends the rest.
  // Files are held in this page's memory only. Nothing is written to disk until someone presses Download.
  const MAX_FILE_BYTES = 100 * 1000 * 1000;   // 100 MB
  const PIECE_BYTES = 16 * 1024;        // the size every browser accepts in one go
  const BUFFER_FULL = 1024 * 1024;      // stop handing pieces to the browser while this much is still waiting to leave
  const BUFFER_LOW = 256 * 1024;
  // Pictures, video and sound are shown in the chat itself; anything else gets a Download button only.
  // The type has to be a plain image/..., video/... or audio/... one, with no "+" in it. That leaves out
  // SVG pictures (image/svg+xml) and web pages on purpose: those can carry scripts. If the browser turns
  // out not to be able to show the file, the preview is taken away again and Download is what is left.
  const embedKind = (type) => {
    const found = /^(image|video|audio)\/[a-z0-9.-]+$/.exec(type);
    return found ? (found[1] === "image" ? "img" : found[1]) : "";
  };
  // Different systems call the same kind of sound file different things; players only know the usual name
  const USUAL_TYPE = { "audio/vnd.wave": "audio/wav", "audio/wave": "audio/wav", "audio/x-wav": "audio/wav", "audio/mp3": "audio/mpeg", "audio/x-m4a": "audio/mp4", "video/x-m4v": "video/mp4" };
  const outgoing = new Map();   // my files the other person doesn't have all of yet (id -> message)
  const incoming = new Map();   // the other person's files I don't have all of yet (id -> message)
  let wanted = [];              // what the other person has asked for and I haven't sent yet: { m, from }
  let sendingFiles = false;
  let receiving = null;         // the incoming file that the pieces arriving now belong to

  // No folders, no control characters, and none of the invisible marks that make a name read backwards
  const cleanFileName = (v) => (typeof v === "string"
    ? v.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069\/\\]/g, "").trim().slice(0, 150) : "") || "file";
  const cleanType = (v) => {
    const type = typeof v === "string" ? v.slice(0, 100).split(";")[0].trim().toLowerCase() : "";
    return Object.hasOwn(USUAL_TYPE, type) ? USUAL_TYPE[type] : type;
  };
  const sizeText = (n) => (n < 1000 ? `${n} bytes` : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)} kB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`);
  const atBottom = () => firstTextbox.scrollHeight - firstTextbox.scrollTop - firstTextbox.clientHeight < 40;
  const scrollToBottom = () => { firstTextbox.scrollTop = firstTextbox.scrollHeight; };

  // Pressing a picture in the chat opens it as big as the window allows. Pressing anywhere (or Esc) closes it.
  const viewer = $("viewer");
  function openViewer(m, url) {
    const picture = viewer.querySelector(".viewer-picture");
    picture.src = url;
    picture.alt = m.file.name;
    viewer.querySelector(".viewer-name").textContent = m.file.name;
    const link = viewer.querySelector(".viewer-download");
    link.href = url;
    link.download = m.file.name;
    viewer.showModal();
  }
  viewer.addEventListener("click", (e) => { if (!e.target.closest("a")) viewer.close(); });

  // The middle of a file's row: its name and size, and how far along it is
  function fileBody(m) {   // m.file: { name, type, size }; m.moved: bytes sent or received so far
    m.fileBox = document.createElement("div");
    m.fileBox.className = "message-file";
    m.fileLine = document.createElement("div");
    m.fileLine.className = "file-line";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = m.file.name;
    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = sizeText(m.file.size);
    m.fileLine.append(name, size);
    m.progress = document.createElement("progress");
    m.progress.className = "file-progress";
    m.progress.max = Math.max(m.file.size, 1);
    m.stateElement = document.createElement("span");
    m.stateElement.className = "file-state";
    m.fileBox.append(m.fileLine, m.progress, m.stateElement);
    showFileState(m);
    return m.fileBox;
  }

  // The line under a file that says what is happening to it. Nothing once it has fully arrived.
  function showFileState(m) {
    const percent = Math.floor((100 * m.moved) / Math.max(m.file.size, 1));
    let text = "";
    if (m.failed) text = m.failed;
    else if (m.done) text = "";
    else if (!canSend()) text = "Waiting for the connection...";
    else if (m.stalled) text = "The other person left before this finished.";
    else if (m.mine) text = m.moved ? `Sending ${percent}%` : "Waiting to send...";
    else text = `Receiving ${percent}%`;
    m.stateElement.textContent = text;
    m.stateElement.hidden = !text;
    m.progress.value = m.moved;
    m.progress.hidden = !!m.done || !!m.failed;
  }

  // The file itself is here (straight away for the sender, after the last piece for the receiver):
  // show it if it is a picture, video or sound, and add the Download button either way
  function showFileContent(m, source) {
    const kind = embedKind(m.file.type);
    // Only the kinds shown above keep their type. Everything else is marked as plain bytes, so that
    // opening its address in a tab downloads it instead of running it as a page on this site.
    const url = URL.createObjectURL(source.slice(0, source.size, kind ? m.file.type : "application/octet-stream"));
    const stay = atBottom();
    if (kind) {
      const el = document.createElement(kind);
      el.className = kind === "audio" ? "file-audio" : "file-preview";
      let shown = el;
      if (kind === "img") {
        // A picture is a button: pressing it opens the big version. (Video has its own full-screen control.)
        el.alt = m.file.name;
        shown = document.createElement("button");
        shown.type = "button";
        shown.className = "file-open";
        shown.title = "Show bigger";
        shown.append(el);
        shown.addEventListener("click", () => openViewer(m, url));
      } else { el.controls = true; el.preload = "metadata"; }
      // Its height is only known once it has loaded: keep the newest message in view
      el.addEventListener(kind === "img" ? "load" : "loadedmetadata", () => { tidyInvite(); if (stay) scrollToBottom(); });
      el.addEventListener("error", () => shown.remove());   // not something this browser can show: Download is enough
      el.src = url;
      m.fileBox.prepend(shown);
    }
    const link = document.createElement("a");
    link.className = "download-button";
    link.href = url;
    link.download = m.file.name;
    link.textContent = "Download";
    m.fileLine.append(link);
    if (stay) scrollToBottom();
  }

  // Attach: each chosen file becomes a message straight away and is announced to the other person
  function attachFiles(files) {
    for (const file of files) {
      if (!canSend()) return;
      const name = cleanFileName(file.name);
      if (file.size > MAX_FILE_BYTES) {
        showBriefAlert(`"${name}" is too big to send. The limit is ${sizeText(MAX_FILE_BYTES)}.`);
        continue;
      }
      clock += 1;
      const frame = { t: "file", id: toHex(crypto.getRandomValues(new Uint8Array(12))), clock, ts: Date.now(), name, type: cleanType(file.type), size: file.size };
      const m = { id: frame.id, mine: true, clock, ts: frame.ts, file: { name, type: frame.type, size: file.size }, source: file, moved: 0 };
      outbox.set(m.id, frame);
      outgoing.set(m.id, m);
      addMessage(m);
      showFileContent(m, file);
      sendFrame(frame);
    }
  }

  // Resolves when the browser has sent most of what it was holding (or after a moment, to look again)
  const drained = (ch) => new Promise((resolve) => {
    const done = () => { clearTimeout(timer); ch.removeEventListener("bufferedamountlow", done); resolve(); };
    const timer = setTimeout(done, 500);
    ch.addEventListener("bufferedamountlow", done);
  });

  // Sends what the other person asked for, one file at a time, a piece at a time, never faster than
  // the connection takes it. Chat messages typed meanwhile go out in between the pieces.
  async function sendWantedFiles() {
    if (sendingFiles) return;
    sendingFiles = true;
    const ch = channel;
    const live = () => !!ch && ch === channel && ch.readyState === "open";
    try {
      while (live() && wanted.length) {
        const { m, from } = wanted.shift();
        if (!outgoing.has(m.id)) continue;
        ch.send(JSON.stringify({ t: "data", id: m.id, from }));
        m.moved = from;
        for (let at = from; at < m.file.size; at += PIECE_BYTES) {
          const length = Math.min(PIECE_BYTES, m.file.size - at);
          let piece = null;
          try { piece = await m.source.slice(at, at + length).arrayBuffer(); } catch { /* handled just below */ }
          if (!piece || piece.byteLength !== length) { cancelOutgoing(m); break; }   // the file was moved, changed or deleted
          while (live() && ch.bufferedAmount > BUFFER_FULL) await drained(ch);
          if (!live()) return;
          ch.send(piece);
          m.moved = at + length;
          showFileState(m);
        }
      }
    } catch (err) {
      console.error(err);   // the connection went away mid-send; what is unconfirmed is announced again on the next one
    } finally {
      sendingFiles = false;
      if (wanted.length && canSend()) sendWantedFiles();   // asked for on a newer connection while this was winding down
    }
  }

  function cancelOutgoing(m) {
    outbox.delete(m.id);
    outgoing.delete(m.id);
    m.failed = "This file could not be read, so it was not sent.";
    showFileState(m);
    sendFrame({ t: "cancel", id: m.id });
  }

  // An incoming file that will not be finished
  function dropIncoming(m, why) {
    incoming.delete(m.id);
    seen.add(m.id);
    if (receiving === m) receiving = null;
    m.pieces = null;
    m.failed = why;
    showFileState(m);
  }

  // One piece of the file being received
  function onPiece(piece) {
    const m = receiving;
    if (!m || piece.byteLength === 0) return;
    if (m.moved + piece.byteLength > m.file.size) { dropIncoming(m, "This file could not be received."); return; }   // more than was announced
    m.pieces.push(piece);
    m.moved += piece.byteLength;
    if (m.moved === m.file.size) finishIncoming(m);
    else showFileState(m);
  }

  function finishIncoming(m) {
    incoming.delete(m.id);
    seen.add(m.id);
    if (receiving === m) receiving = null;
    m.done = true;
    const whole = new Blob(m.pieces);
    m.pieces = null;
    showFileState(m);
    showFileContent(m, whole);
    sendFrame({ t: "ack", id: m.id });
  }

  // The other person announced a file (again after every reconnect, until I confirm having all of it)
  function onFileOffer(f) {
    if (!isStr(f.id, 64) || !validClock(f.clock) || !Number.isFinite(f.ts)) return;
    if (!Number.isSafeInteger(f.size) || f.size < 0 || f.size > MAX_FILE_BYTES) return;
    if (seen.has(f.id)) { sendFrame({ t: "ack", id: f.id }); return; }
    let m = incoming.get(f.id);
    if (!m) {
      clock = Math.max(clock, f.clock);
      m = {
        id: f.id, mine: false, clock: f.clock, ts: Math.min(f.ts, Date.now()),
        file: { name: cleanFileName(f.name), type: cleanType(f.type), size: f.size }, pieces: [], moved: 0,
      };
      incoming.set(m.id, m);
      addMessage(m);
    }
    m.stalled = false;
    if (m.file.size === 0) finishIncoming(m);
    else { showFileState(m); sendFrame({ t: "want", id: m.id, from: m.moved }); }
  }

  // ---------- WebRTC state ----------
  // Our own server's address lookup (STUN), filled in by the server when it has a relay. It lets each browser
  // learn its public address for a direct connection without telling a third party. Empty when running
  // locally, where two browsers on the same computer or network connect without it.
  let stunServers = [];
  // Filled in by the server when it has a relay: used only if no direct route works
  let relayServers = [];
  // Opening the link with ?relay=only sends everything through the relay, to check the relay itself
  const relayOnly = new URLSearchParams(location.search).get("relay") === "only";
  // Direct first: an attempt starts without the relay, and the relay is only brought in if nothing
  // connects within this long. (Offering both at once lets the relay route win the race even when a
  // direct one exists, because all the addresses are sent together.)
  const DIRECT_FIRST_MS = 8000;
  let useRelay = false;
  const rtcConfig = (withRelay) => ({
    iceServers: [...stunServers, ...(withRelay ? relayServers : [])],
    iceTransportPolicy: relayOnly ? "relay" : "all",
  });
  const ALIVE = new Set(["connecting", "connected", "disconnected"]);

  let ws = null, authed = false, stopped = false, mySlot = -1, peerOnline = false;
  let pc = null, channel = null, currentSid = null, lastOfferAt = 0;
  let attempts = 0, retryTimer = null, pingTimer = null;

  const pcState = () => (pc ? pc.connectionState : "none");
  const canSend = () => !!channel && channel.readyState === "open" && peerReady;
  const refreshSend = () => {
    sendButton.disabled = attachButton.disabled = !canSend();
    for (const m of [...outgoing.values(), ...incoming.values()]) showFileState(m);
  };
  // Sends one frame to the other person. False if there is no open connection right now.
  const sendFrame = (frame) => {
    if (!channel || channel.readyState !== "open") return false;
    try { channel.send(JSON.stringify(frame)); return true; } catch { return false; }
  };
  const send = (obj) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };

  function createPc(withRelay) {
    if (pc) {
      const old = pc;
      old.onconnectionstatechange = null;
      old.ondatachannel = null;
      old.close();
    }
    channel = null;
    peerReady = false;
    wanted = [];        // file requests and pieces belong to the connection they came in on
    receiving = null;
    currentSid = null;   // an answer to an offer from the previous connection must not be applied to this one
    const p = new RTCPeerConnection(rtcConfig(withRelay));
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
    peerReady = false;
    ch.binaryType = "arraybuffer";
    ch.bufferedAmountLowThreshold = BUFFER_LOW;
    let greeted = false;
    const greet = () => {
      if (greeted || ch !== channel || ch.readyState !== "open") return;
      greeted = true;
      sendFrame({ t: "hello", clock, name: userName });
    };
    ch.onopen = () => {
      if (ch !== channel) return;
      greet();
      refreshSend();
      showConnected();
    };
    ch.onclose = () => { if (ch === channel) { showTyping(false); typingSentAt = 0; refreshSend(); } };
    ch.onmessage = (e) => {
      if (ch !== channel) return;
      if (typeof e.data === "string") onFrame(e.data);
      else if (e.data instanceof ArrayBuffer) onPiece(e.data);
    };
    greet();   // in case the channel was already open when it was handed to us
    refreshSend();
  }

  // The other person confirmed one of my messages
  function confirmDelivered(id) {
    if (!outbox.delete(id)) return;
    const m = messages.find((x) => x.id === id);
    if (!m) return;
    m.row.classList.remove("pending");
    m.timeElement.textContent = timeText(m.ts);
    if (m.file) { outgoing.delete(id); m.done = true; showFileState(m); }
  }

  // One frame from the other person. Anything malformed is ignored.
  function onFrame(data) {
    if (data.length > 20000) return;
    let f;
    try { f = JSON.parse(data); } catch { return; }
    if (!f || typeof f !== "object") return;

    if (f.t === "hello") {
      // Catch this side's counter up (it starts again from 0 after a reload) before anything is sent
      if (validClock(f.clock)) clock = Math.max(clock, f.clock);
      otherUserName = cleanName(f.name) || otherUserName;   // no name (say, after their reload): keep the one we know
      renderNames();
      peerReady = true;
      // A file they were part-way through sending is announced again in a moment if they still have it.
      // If they don't (they reloaded the page), it stays marked as unfinished.
      for (const m of incoming.values()) m.stalled = true;
      for (const frame of outbox.values()) sendFrame(frame);   // whatever the last connection dropped
      refreshSend();
    } else if (f.t === "typing") {
      if (typeof f.on === "boolean") showTyping(f.on);
    } else if (f.t === "name") {
      otherUserName = cleanName(f.name) || otherUserName;
      renderNames();
    } else if (f.t === "ack") {
      if (isStr(f.id, 64)) confirmDelivered(f.id);
    } else if (f.t === "msg") {
      if (!isStr(f.id, 64) || !validClock(f.clock) || typeof f.text !== "string" || !Number.isFinite(f.ts)) return;
      sendFrame({ t: "ack", id: f.id });   // also for a repeat: the earlier confirmation may be what got lost
      showTyping(false);
      if (seen.has(f.id)) return;
      seen.add(f.id);
      clock = Math.max(clock, f.clock);
      // A time later than this device's own "now" can only be the other device's clock running fast
      addMessage({ id: f.id, mine: false, clock: f.clock, ts: Math.min(f.ts, Date.now()), text: f.text.slice(0, 5000) });
    } else if (f.t === "file") {
      showTyping(false);
      onFileOffer(f);
    } else if (f.t === "want") {
      const m = isStr(f.id, 64) ? outgoing.get(f.id) : null;
      if (!m || !Number.isSafeInteger(f.from) || f.from < 0 || f.from >= m.file.size) return;
      wanted = wanted.filter((w) => w.m !== m);
      wanted.push({ m, from: f.from });
      sendWantedFiles();
    } else if (f.t === "data") {
      const m = isStr(f.id, 64) ? incoming.get(f.id) : null;
      receiving = m && f.from === m.moved ? m : null;   // pieces that don't pick up where I am are let go by
    } else if (f.t === "cancel") {
      const m = isStr(f.id, 64) ? incoming.get(f.id) : null;
      if (m) dropIncoming(m, "The other person's file could not be sent.");
    }
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
    if (state === "connected") { useRelay = false; showConnected(); }   // a later reconnect starts with direct again
    else if (state === "connecting") setStatus(useRelay && !relayOnly ? "No direct route yet. Trying through the relay..." : "Connecting...");
    else if (state === "disconnected") setStatus("Connection interrupted...");
    else if (state === "failed") {
      if (relayServers.length) useRelay = true;
      setStatus("Connection lost. Reconnecting...");
      refreshSend();
      recover();
    }
    if (state !== "connected") refreshSend();
  }

  // Slot 0 is always the one who makes offers, so the two sides never collide
  async function startOffer(force) {
    if (!authed || mySlot !== 0 || !peerOnline) return;
    if (Date.now() - lastOfferAt < 2000) return;
    if (!force && ALIVE.has(pcState())) return;
    lastOfferAt = Date.now();

    const withRelay = relayOnly || useRelay;
    const p = createPc(withRelay);
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
    setStatus(useRelay && !relayOnly ? "No direct route yet. Trying through the relay..." : "Connecting...");

    // A direct-only attempt gets a short window before the relay is brought in. After that, if
    // nothing connects within 20s, try again with a fresh offer.
    const directOnly = !withRelay && relayServers.length > 0;
    setTimeout(() => {
      if (pc !== p || p.connectionState === "connected") return;
      if (directOnly) {
        useRelay = true;
        setStatus("No direct route yet. Trying through the relay...");   // say so now; gathering relay addresses takes a moment
      }
      startOffer(true);
    }, directOnly ? DIRECT_FIRST_MS : 20000);
  }

  async function onOffer(env) {
    if (!validEnv(env) || !(await acceptPeer(env))) return;
    if (!(await verifySig(env.pub, offerPayload(env.sid, env.pub, env.sdp), env.sig))) {
      showAlert("Ignored an offer with an invalid signature.");
      return;
    }
    // Follow the other side: use the relay only if their offer already includes a relay address
    const p = createPc(relayOnly || / typ relay/.test(env.sdp));
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
        showAlert("The server no longer knows this chat (it expired or restarted). Use \"New chat\" at the top and share the new link.");
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
        if (Array.isArray(msg.stunServers)) stunServers = msg.stunServers;
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
        // The other side asks again when its attempt has failed. If our last offer is more than a moment
        // old and still not connected, direct has had its chance: bring in the relay now instead of
        // starting the direct-only window over. (The request a peer sends as it joins arrives right on
        // top of our first offer, so it doesn't count.)
        if (mySlot === 0 && relayServers.length && lastOfferAt && Date.now() - lastOfferAt > 3000 && pcState() !== "connected") useRelay = true;
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
    const text = secondTextbox.value;
    if (text.trim() === "" || !canSend()) return;
    clock += 1;
    const frame = { t: "msg", id: toHex(crypto.getRandomValues(new Uint8Array(12))), clock, ts: Date.now(), text };
    outbox.set(frame.id, frame);
    const m = { id: frame.id, mine: true, clock: frame.clock, ts: frame.ts, text };
    addMessage(m);
    sendFrame(frame);
    stopTyping();
    // Normally confirmed within a moment. If not (the connection just dropped), say so until it is.
    setTimeout(() => {
      if (!outbox.has(m.id)) return;
      m.row.classList.add("pending");
      m.timeElement.textContent = "not delivered yet";
    }, 2000);
    secondTextbox.value = "";
  }
  sendButton.addEventListener("click", sendChat);
  secondTextbox.addEventListener("input", noteTyping);
  // Enter sends; Shift+Enter makes a new line
  secondTextbox.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat();
    }
  });

  // Attach opens the browser's file picker; whatever is chosen is sent
  attachButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    attachFiles(fileInput.files);
    fileInput.value = "";   // so that choosing the same file again counts as a change
  });

  // Rename: you choose your own name, and the other person sees it too
  renameButton.addEventListener("click", () => {
    const newUserName = cleanName(prompt("Enter your name: ", userName));
    if (newUserName === "") return;   // cancelled, or left blank
    userName = newUserName;
    rec.name = userName;
    touch();   // saves the record
    renderNames();
    if (peerReady) sendFrame({ t: "name", name: userName });   // otherwise the hello carries it when the connection opens
  });

  connect();
})();
