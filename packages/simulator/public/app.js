const $ = (selector) => document.querySelector(selector);

const transcript = $('#transcript');
const form = $('#composer');
const input = $('#message');
const sendButton = $('#send');
const micButton = $('#mic');
const resetButton = $('#reset');
const demoButton = $('#demo-recall');
const speakToggle = $('#speak-toggle');
const inventory = $('#inventory');
const alertsList = $('#alerts');
const ring = $('#ring');
const statusLine = $('#status');

const POLL_MS = 4000;
const greeting = transcript.innerHTML;
const jsonHeaders = { 'content-type': 'application/json' };

let sessionId = '';
let config = { speech: false, demo: false };
let busy = false;
const knownAlerts = new Set();

function setStatus(text) {
  statusLine.textContent = text;
}

// ---- transcript ---------------------------------------------------------------------------------

function bubble(kind, text, toolCalls = []) {
  const li = document.createElement('li');
  li.className = `bubble ${kind}`;
  li.textContent = text;
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
  transcript.scrollTop = transcript.scrollHeight;
  return li;
}

// ---- side panels ---------------------------------------------------------------------------------

function renderInventory(items) {
  inventory.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Nothing registered yet.';
    inventory.append(empty);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = [item.brand, item.name].filter(Boolean).join(' ');
    const details = [item.model && `Model ${item.model}`, item.year && `${item.year}`].filter(Boolean);
    if (details.length) {
      const small = document.createElement('small');
      small.textContent = details.join(' · ');
      li.append(small);
    }
    inventory.append(li);
  }
}

function renderAlerts(alerts) {
  alertsList.replaceChildren();
  if (!alerts.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No alerts.';
    alertsList.append(empty);
    return;
  }
  for (const alert of alerts) {
    const li = document.createElement('li');
    const recalled = alert.kind === 'recalled';
    li.className = `alert ${recalled ? alert.severity : 'question'}`;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = recalled ? 'Recalled' : 'Needs a detail';
    const title = document.createElement('div');
    title.textContent = alert.item;
    const small = document.createElement('small');
    small.textContent = recalled ? firstSentence(alert.hazard || alert.title) : alert.question || alert.title;
    li.append(badge, title, small);
    alertsList.append(li);
  }
}

function firstSentence(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const end = clean.search(/[.!?](\s|$)/);
  return end === -1 ? clean : clean.slice(0, end + 1);
}

/**
 * Reads inventory and alerts from the server. With `announce`, an alert that appeared without the user asking
 * (the daily watcher found a new recall) becomes a proactive message, spoken like any other reply.
 */
async function refreshState({ announce }) {
  if (!sessionId) return;
  try {
    const res = await fetch(`/api/state?sessionId=${encodeURIComponent(sessionId)}`);
    if (!res.ok) return;
    const state = await res.json();
    renderInventory(state.items);
    renderAlerts(state.alerts);
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

// ---- speaking ------------------------------------------------------------------------------------

let speakToken = 0;
let currentAudio = null;

function stopSpeaking() {
  speakToken += 1;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  ring.classList.remove('speaking');
}

/** Plays Polly audio from the server; if that is unavailable or refused, the browser's own voice. */
async function speak(text) {
  if (!speakToggle.checked || !text) return;
  const token = ++speakToken;
  ring.classList.add('speaking');
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
      await new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = resolve;
        utterance.onerror = resolve;
        window.speechSynthesis.speak(utterance);
      });
    }
  } finally {
    if (token === speakToken) ring.classList.remove('speaking');
  }
}

speakToggle.addEventListener('change', () => {
  if (!speakToggle.checked) stopSpeaking();
});

// ---- listening (push to talk) -----------------------------------------------------------------------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let listening = false;

function setListening(on) {
  listening = on;
  micButton.setAttribute('aria-pressed', String(on));
  ring.classList.toggle('listening', on);
  setStatus(on ? 'Listening… tap the microphone again when you are done.' : '');
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
  micButton.title = 'Voice input needs Chrome or Edge. You can type instead.';
}

// ---- conversation ------------------------------------------------------------------------------------

function setBusy(on) {
  busy = on;
  sendButton.disabled = on;
  input.disabled = on;
  if (Recognition) micButton.disabled = on;
  ring.classList.toggle('busy', on);
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
    void speak(data.reply);
  } catch {
    bubble('error', 'I could not reach the server. Please try again.');
  } finally {
    setBusy(false);
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

resetButton.addEventListener('click', async () => {
  stopSpeaking();
  if (listening && recognizer) recognizer.abort();
  await fetch('/api/reset', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ sessionId }) }).catch(
    () => undefined,
  );
  sessionId = '';
  knownAlerts.clear();
  transcript.innerHTML = greeting;
  renderInventory([]);
  renderAlerts([]);
  setStatus('');
  input.focus();
});

demoButton.addEventListener('click', async () => {
  if (!sessionId) {
    setStatus('Tell Alexa about something you own first, then simulate a new recall for it.');
    return;
  }
  demoButton.disabled = true;
  setStatus('Publishing a new recall and running the daily watcher…');
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

// ---- start ------------------------------------------------------------------------------------------

fetch('/api/config')
  .then((res) => res.json())
  .then((c) => {
    config = c;
    demoButton.hidden = !c.demo;
  })
  .catch(() => undefined);
