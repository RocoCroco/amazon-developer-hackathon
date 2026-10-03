const $ = (selector) => document.querySelector(selector);

const scene = $('#scene');
const transcript = $('#transcript');
const form = $('#composer');
const input = $('#message');
const sendButton = $('#send');
const micButton = $('#mic');
const resetButton = $('#reset');
const seedButton = $('#demo-seed');
const demoButton = $('#demo-recall');
const speakToggle = $('#speak-toggle');
const menuButton = $('#menu-button');
const settings = $('#settings');
const inventory = $('#inventory');
const notice = $('#notice');
const statusLine = $('#status');

const POLL_MS = 4000;
const jsonHeaders = { 'content-type': 'application/json' };

let sessionId = '';
let config = { speech: false, demo: false };
let busy = false;
let listening = false;
let speaking = false;
const knownAlerts = new Set();

let statusTimer = 0;

/** A short-lived line above the input; it clears itself unless replaced. */
function setStatus(text, ms = 7000) {
  clearTimeout(statusTimer);
  statusLine.textContent = text;
  if (text && ms) statusTimer = setTimeout(() => (statusLine.textContent = ''), ms);
}

// ---- the light ring ----------------------------------------------------------------------------------
// idle = ring off, listening = lit ring, thinking = the ring breathes in soft blue (CSS),
// speaking = the lit ring follows the loudness of the voice.

function updateRing() {
  scene.dataset.ring = listening ? 'listening' : speaking ? 'speaking' : busy ? 'thinking' : 'idle';
}

let audioContext = null;
let pulseFrame = 0;
let pulseValue = 0.5;

/** Makes the ring's brightness follow the loudness of the audio being played. */
function startPulse(audio) {
  scene.classList.remove('fallback-pulse');
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    audioContext = audioContext ?? new Context();
    void audioContext.resume();
    const source = audioContext.createMediaElementSource(audio);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      const loudness = Math.min(1, Math.sqrt(sum / samples.length) * 5);
      pulseValue = pulseValue * 0.6 + loudness * 0.4;
      scene.style.setProperty('--pulse', pulseValue.toFixed(3));
      pulseFrame = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    // No audio analysis available: breathe on a timer instead.
    scene.classList.add('fallback-pulse');
  }
}

function stopPulse() {
  cancelAnimationFrame(pulseFrame);
  scene.classList.remove('fallback-pulse');
}

function setSpeaking(on) {
  speaking = on;
  if (!on) stopPulse();
  updateRing();
}

// ---- transcript: floating bubbles; older ones fade at the top edge and stay reachable by scrolling ----------------

function bubble(kind, text, toolCalls = []) {
  const li = document.createElement('li');
  li.className = `bubble ${kind}`;
  li.append(document.createTextNode(text));
  if (toolCalls.length) {
    const tools = document.createElement('div');
    tools.className = 'tools';
    for (const call of toolCalls) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `MCP · ${call.name}`;
      chip.title = call.result.split('\n')[0];
      tools.append(chip);
    }
    li.append(tools);
  }
  transcript.append(li);
  transcript.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  return li;
}

// ---- household panel ---------------------------------------------------------------------------------------

function firstSentence(text) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const end = clean.search(/[.!?](\s|$)/);
  return end === -1 ? clean : clean.slice(0, end + 1);
}

const rows = new Map(); // item id -> { li, status }

function statusOf(alerts) {
  if (alerts.some((a) => a.kind === 'recalled')) return 'recalled';
  if (alerts.length) return 'question';
  return 'ok';
}

function setOpen(li, open) {
  li.dataset.open = String(open);
  li.querySelector('.item-row').setAttribute('aria-expanded', String(open));
}

function buildItem(item) {
  const li = document.createElement('li');
  li.className = 'item';
  li.dataset.itemId = item.item_id;

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'item-row';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');
  const title = document.createElement('span');
  title.className = 'item-title';
  row.append(dot, title);

  const detail = document.createElement('div');
  detail.className = 'detail';
  const inner = document.createElement('div');
  const body = document.createElement('div');
  body.className = 'detail-body';
  inner.append(body);
  detail.append(inner);

  row.addEventListener('click', () => {
    if (li.dataset.status === 'ok') return;
    setOpen(li, li.dataset.open !== 'true');
  });
  li.append(row, detail);
  return li;
}

function fillItem(li, item, alerts) {
  const status = statusOf(alerts);
  const previous = li.dataset.status;
  const alert = alerts.find((a) => a.kind === 'recalled') ?? alerts[0];

  li.querySelector('.item-title').textContent = [item.brand, item.name].filter(Boolean).join(' ');
  li.dataset.status = status;
  const row = li.querySelector('.item-row');
  row.dataset.expandable = String(status !== 'ok');
  row.setAttribute(
    'aria-label',
    `${row.textContent}: ${status === 'ok' ? 'no recall known' : status === 'recalled' ? 'recalled' : 'needs a detail'}`,
  );

  const body = li.querySelector('.detail-body');
  body.replaceChildren();
  if (status !== 'ok') {
    const text = document.createElement('div');
    const model = [item.model && `Model ${item.model}`, item.year && String(item.year)]
      .filter(Boolean)
      .join(' · ');
    if (model) {
      const small = document.createElement('span');
      small.className = 'model';
      small.textContent = model;
      text.append(small);
    }
    const sentence = document.createElement('p');
    sentence.textContent =
      status === 'recalled'
        ? firstSentence(alert.hazard || alert.title)
        : alert.question || alert.title;
    text.append(sentence);
    if (status === 'recalled' && alert.image_url) {
      const img = document.createElement('img');
      img.src = alert.image_url;
      img.alt = `Recalled ${item.name}`;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove());
      body.append(img);
    }
    body.append(text);
  }

  if (previous && previous !== status) {
    li.classList.remove('flip');
    void li.offsetWidth; // restart the animation
    li.classList.add('flip');
  }
  if (!previous) setOpen(li, false);
  // A recall that just appeared (new item or new alert) unfolds smoothly to show photo and hazard.
  if (status === 'recalled' && previous !== 'recalled') {
    setTimeout(() => setOpen(li, true), previous ? 120 : 380);
  }
  if (status === 'ok') setOpen(li, false);
  return status;
}

/** Updates the list in place, so new items slide in and a recall turns the dot red with an animation. */
function renderHousehold(items, alerts) {
  const seen = new Set();
  for (const item of items) {
    seen.add(item.item_id);
    let entry = rows.get(item.item_id);
    if (!entry) {
      entry = { li: buildItem(item) };
      rows.set(item.item_id, entry);
      inventory.append(entry.li);
    }
    fillItem(
      entry.li,
      item,
      alerts.filter((a) => a.item_id === item.item_id),
    );
  }
  for (const [id, entry] of rows) {
    if (!seen.has(id)) {
      entry.li.remove();
      rows.delete(id);
    }
  }
}

/**
 * Reads inventory and alerts from the server. With `announce`, a confirmed recall that appeared without the
 * user asking (the daily watcher found it) becomes a proactive message, spoken like any other reply.
 */
async function refreshState({ announce }) {
  if (!sessionId) return;
  try {
    const res = await fetch(`/api/state?sessionId=${encodeURIComponent(sessionId)}`);
    if (!res.ok) return;
    const state = await res.json();
    renderHousehold(state.items, state.alerts);
    const fresh = state.alerts.filter((a) => a.kind === 'recalled' && !knownAlerts.has(a.alert_id));
    for (const alert of state.alerts) knownAlerts.add(alert.alert_id);
    if (announce && fresh.length) {
      const top = fresh[0];
      const text = `Heads up: your ${top.item} has a recall. ${firstSentence(top.hazard || top.title)} Want me to walk you through the fix?`;
      bubble('alexa proactive', text);
      void speak(text);
    }
  } catch {
    // The next poll tries again.
  }
}

setInterval(() => void refreshState({ announce: true }), POLL_MS);

// ---- speaking ----------------------------------------------------------------------------------------------

let speakToken = 0;
let currentAudio = null;

function stopSpeaking() {
  speakToken += 1;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  setSpeaking(false);
}

/** Plays Polly audio from the server; if that is unavailable or refused, the browser's own voice. */
async function speak(text) {
  if (!speakToggle.checked || !text) return;
  const token = ++speakToken;
  try {
    if (config.speech) {
      try {
        const res = await fetch('/api/speak', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ sessionId, text }),
        });
        if (res.ok) {
          const blob = await res.blob();
          if (token !== speakToken) return;
          const audio = new Audio(URL.createObjectURL(blob));
          currentAudio = audio;
          setSpeaking(true);
          startPulse(audio);
          await new Promise((resolve) => {
            audio.onended = resolve;
            audio.onerror = resolve;
            audio.play().catch(resolve);
          });
          return;
        }
      } catch {
        // fall through to the browser voice
      }
    }
    if (token === speakToken && 'speechSynthesis' in window) {
      setSpeaking(true);
      scene.classList.add('fallback-pulse');
      await new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = resolve;
        utterance.onerror = resolve;
        window.speechSynthesis.speak(utterance);
      });
    }
  } finally {
    if (token === speakToken) setSpeaking(false);
  }
}

speakToggle.addEventListener('change', () => {
  if (!speakToggle.checked) stopSpeaking();
});

// ---- listening (push to talk, Chrome and Edge) ---------------------------------------------------------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;

function setListening(on) {
  listening = on;
  micButton.setAttribute('aria-pressed', String(on));
  setStatus(on ? 'Listening… tap the microphone again when you are done.' : '', 0);
  updateRing();
}

function startListening() {
  stopSpeaking();
  let finalText = '';
  recognizer = new Recognition();
  recognizer.lang = 'en-US';
  recognizer.interimResults = true;
  recognizer.maxAlternatives = 1;
  recognizer.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    input.value = `${finalText}${interim}`.trim();
  };
  recognizer.onerror = (event) => {
    setStatus(
      event.error === 'not-allowed'
        ? 'The microphone is blocked. Allow it in the browser, or type instead.'
        : 'I did not catch that. Try again, or type.',
    );
  };
  recognizer.onend = () => {
    const wasListening = listening;
    setListening(false);
    const said = (finalText || input.value).trim();
    if (wasListening && said) {
      input.value = '';
      void send(said);
    }
  };
  recognizer.start();
  setListening(true);
}

if (Recognition) {
  micButton.addEventListener('click', () => {
    if (busy) return;
    if (listening) recognizer.stop();
    else startListening();
  });
} else {
  micButton.disabled = true;
  micButton.title = 'Voice input needs Chrome or Edge.';
  notice.textContent = 'Voice input needs Chrome or Edge. You can still type to Alexa below.';
  notice.hidden = false;
}

// ---- conversation --------------------------------------------------------------------------------------------

function setBusy(on) {
  busy = on;
  sendButton.disabled = on;
  input.disabled = on;
  if (Recognition) micButton.disabled = on;
  updateRing();
  if (!on) input.focus();
}

async function send(message) {
  bubble('user', message);
  setBusy(true);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId, message }),
    });
    const data = await res.json();
    if (!res.ok) {
      bubble('error', data.error ?? 'Something went wrong.');
      return;
    }
    sessionId = data.sessionId;
    bubble('alexa', data.reply, data.toolCalls);
    // Alerts raised by this very turn are already in the reply: do not announce them a second time.
    await refreshState({ announce: false });
    setBusy(false);
    void speak(data.reply);
  } catch {
    bubble('error', 'I could not reach the server. Please try again.');
  } finally {
    if (busy) setBusy(false);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || busy) return;
  input.value = '';
  stopSpeaking();
  void send(message);
});

// ---- settings: a pop-up dialog behind the chevron (voice options and the demo controls) ---------------------------

function setMenu(open) {
  if (open && !settings.open) settings.showModal();
  menuButton.setAttribute('aria-expanded', String(open));
  if (!open && settings.open) settings.close();
}

menuButton.addEventListener('click', () => setMenu(true));
settings.addEventListener('close', () => {
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.focus();
});
settings.addEventListener('toggle', () => {
  menuButton.setAttribute('aria-expanded', String(settings.open));
});
// A click on the dimmed area around the dialog closes it (Escape closes it natively).
settings.addEventListener('click', (event) => {
  if (event.target === settings) setMenu(false);
});

resetButton.addEventListener('click', async () => {
  setMenu(false);
  stopSpeaking();
  if (listening && recognizer) recognizer.abort();
  await fetch('/api/reset', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ sessionId }),
  }).catch(() => undefined);
  sessionId = '';
  knownAlerts.clear();
  for (const entry of rows.values()) entry.li.remove();
  rows.clear();
  setStatus('');
  transcript.replaceChildren(); // a real Alexa never speaks first: the page starts silent
  input.focus();
});

seedButton.addEventListener('click', async () => {
  setMenu(false);
  seedButton.disabled = true;
  setStatus('Adding the sample family…', 0);
  try {
    const res = await fetch('/api/demo/seed', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json();
    if (data.sessionId) sessionId = data.sessionId;
    setStatus(data.message ?? '');
    await refreshState({ announce: false });
  } catch {
    setStatus('Could not load the sample family.');
  } finally {
    seedButton.disabled = false;
  }
});

demoButton.addEventListener('click', async () => {
  setMenu(false);
  if (!sessionId) {
    setStatus('Tell Alexa about something you own first, then simulate a new recall for it.');
    return;
  }
  demoButton.disabled = true;
  setStatus('Publishing a new recall and running the daily watcher…', 0);
  try {
    const res = await fetch('/api/demo/new-recall', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json();
    setStatus(data.message ?? '');
    await refreshState({ announce: true });
  } catch {
    setStatus('Could not run the demo recall.');
  } finally {
    demoButton.disabled = false;
  }
});

// ---- start --------------------------------------------------------------------------------------------------------------

fetch('/api/config')
  .then((res) => res.json())
  .then((c) => {
    config = c;
    seedButton.hidden = !c.demo;
    demoButton.hidden = !c.demo;
  })
  .catch(() => undefined);
