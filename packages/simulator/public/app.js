import { BrowserEngine, Microphone, TranscribeEngine } from './voice.js';

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
const handsFreeToggle = $('#hands-free');
const engineSelect = $('#engine');
const voiceSelect = $('#voice');
const menuButton = $('#menu-button');
const settings = $('#settings');
const inventory = $('#inventory');
const notice = $('#notice');
const statusLine = $('#status');
const hint = $('#hint');

const POLL_MS = 4000;
const jsonHeaders = { 'content-type': 'application/json' };

let sessionId = '';
let config = { speech: false, demo: false, transcribe: false };
let busy = false;
let listening = false;
let speaking = false;
const knownAlerts = new Set();
/** A proactive warning Alexa spoke since the last turn; sent with the next message (see send). */
let pendingAnnouncement = '';

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

// ---- transcript: message bubbles; older ones fade at the top edge and stay reachable by scrolling ----------------

const EXAMPLE = 'we got a second-hand Graco car seat';

/**
 * Alexa never speaks first, so an empty page needs one line telling a first-time visitor what to say.
 * It disappears with the first message.
 */
function updateHint() {
  const empty = transcript.querySelector('.bubble') === null;
  hint.hidden = !empty;
  if (!empty) return;
  hint.textContent = !voice.available()
    ? `Type something like “${EXAMPLE[0].toUpperCase()}${EXAMPLE.slice(1)}.”`
    : voice.mode === 'wake'
      ? `Say “Alexa, ${EXAMPLE}.”`
      : `Tap the microphone and say “${EXAMPLE}”, or type it.`;
}

function scrollToEnd() {
  transcript.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
}

function toolChips(toolCalls) {
  const tools = document.createElement('div');
  tools.className = 'tools';
  for (const call of toolCalls) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `MCP · ${call.name}`;
    chip.title = call.result.split('\n')[0];
    tools.append(chip);
  }
  return tools;
}

/**
 * Appends a message. Alexa's words are separate spans, hidden until revealed in step with her voice
 * (revealWords); the full text is in the page from the start, for screen readers and copying.
 */
function bubble(kind, text, toolCalls = []) {
  const li = document.createElement('li');
  li.className = `bubble ${kind}`;
  const body = document.createElement('span');
  body.className = 'text';
  if (kind.startsWith('alexa')) {
    for (const [i, word] of text.split(/\s+/).filter(Boolean).entries()) {
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = i === 0 ? word : ` ${word}`;
      body.append(span);
    }
    li.dataset.reveal = 'pending';
  } else {
    body.textContent = text;
  }
  li.append(body);
  if (toolCalls.length) li.append(toolChips(toolCalls));
  removeTyping();
  transcript.append(li);
  scrollToEnd();
  updateHint();
  return li;
}

/** "Alexa is thinking": three dots in a bubble while the answer is on its way. */
function showTyping() {
  if (transcript.querySelector('.typing')) return;
  const li = document.createElement('li');
  li.className = 'typing';
  li.setAttribute('aria-label', 'Alexa is thinking');
  li.innerHTML = '<span></span><span></span><span></span>';
  transcript.append(li);
  scrollToEnd();
}

function removeTyping() {
  transcript.querySelector('.typing')?.remove();
}

/**
 * Reveals Alexa's words one by one. `progress()` says how far the voice is (0..1); words are weighted by
 * their length, so long words take longer, like speech does. Everything shows when the voice ends.
 */
function revealWords(li, progress) {
  const words = [...li.querySelectorAll('.w')];
  const weights = words.map((w) => w.textContent.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  let shown = 0;
  let frame = 0;
  li.dataset.reveal = 'running';
  const step = () => {
    const target = Math.min(1, progress()) * total;
    let acc = 0;
    let count = 0;
    for (const weight of weights) {
      if (acc + weight / 2 > target) break;
      acc += weight;
      count++;
    }
    for (; shown < count; shown++) words[shown].classList.add('on');
    if (shown < words.length && li.dataset.reveal === 'running')
      frame = requestAnimationFrame(step);
  };
  step();
  return () => {
    cancelAnimationFrame(frame);
    for (const w of words) w.classList.add('on');
    li.dataset.reveal = 'done';
  };
}

/** Without a voice the words still flow in quickly, at reading speed. */
function revealAtReadingSpeed(li) {
  const count = li.querySelectorAll('.w').length;
  const started = performance.now();
  const duration = Math.min(2500, count * 45);
  const finish = revealWords(li, () => (performance.now() - started) / duration);
  setTimeout(finish, duration + 50);
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

/** Red for a confirmed recall, and for a possible food recall that hits a family allergy. */
const urgent = (a) => a.kind === 'recalled' || a.allergy_alert === true;

function statusOf(alerts) {
  if (alerts.some(urgent)) return 'recalled';
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
  const alert = alerts.find(urgent) ?? alerts[0];

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
    sentence.textContent = alert.allergy_note
      ? `${alert.allergy_note} ${alert.kind === 'recalled' ? '' : (alert.question ?? '')}`.trim()
      : status === 'recalled'
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
    const fresh = state.alerts.filter((a) => urgent(a) && !knownAlerts.has(a.alert_id));
    // While Alexa is talking or listening, a new alert waits for the next poll instead of being dropped.
    if (announce && fresh.length && (busy || speaking || listening)) return;
    for (const alert of state.alerts) knownAlerts.add(alert.alert_id);
    if (announce && fresh.length) {
      const top = fresh[0];
      const text =
        top.kind === 'recalled'
          ? `Heads up: your ${top.item} has a recall. ${top.allergy_note ?? firstSentence(top.hazard || top.title)} Want me to walk you through the fix?`
          : `Heads up: your ${top.item} may be part of a food recall. ${top.allergy_note} Can you check the lot code on the package with me?`;
      const li = bubble('alexa proactive', text);
      pendingAnnouncement = text;
      // A question was asked: like any reply, keep listening for the answer afterwards.
      await speak(text, li);
      voice.afterReply(true);
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
  for (const li of transcript.querySelectorAll('.bubble[data-reveal="running"] .w')) {
    li.classList.add('on');
  }
  setSpeaking(false);
}

/**
 * Speaks a reply with Polly (or the browser's voice if Polly is unavailable) and reveals the words of its
 * bubble in step with the audio. Resolves when the voice has finished.
 */
async function speak(text, li) {
  if (!speakToggle.checked || !text) {
    if (li) revealAtReadingSpeed(li);
    return;
  }
  const token = ++speakToken;
  let finish = () => undefined;
  try {
    if (config.speech) {
      try {
        const res = await fetch('/api/speak', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ sessionId, text, voice: voiceSelect.value }),
        });
        if (res.ok) {
          const blob = await res.blob();
          if (token !== speakToken) return;
          const audio = new Audio(URL.createObjectURL(blob));
          currentAudio = audio;
          setSpeaking(true);
          startPulse(audio);
          if (li) {
            finish = revealWords(li, () =>
              audio.duration > 0 && Number.isFinite(audio.duration)
                ? audio.currentTime / audio.duration
                : 0,
            );
          }
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
      let spokenChars = 0;
      if (li) finish = revealWords(li, () => spokenChars / Math.max(1, text.length));
      await new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.onboundary = (event) => (spokenChars = event.charIndex + (event.charLength ?? 1));
        utterance.onend = resolve;
        utterance.onerror = resolve;
        window.speechSynthesis.speak(utterance);
      });
    } else if (li) {
      revealAtReadingSpeed(li);
    }
  } finally {
    finish();
    if (token === speakToken) setSpeaking(false);
  }
}

speakToggle.addEventListener('change', () => {
  if (!speakToggle.checked) stopSpeaking();
});

// ---- listening: a conversation like a real Echo ------------------------------------------------------------------
//
//  wake      waiting for "Alexa" (browser recognizer, free; only with hands-free on)
//  request   recording what the user says; it ends after a moment of silence and is sent
//  busy      Alexa thinks and speaks; nothing listens, so she never hears herself
//  followup  after each reply, listening again for a few seconds without the wake word; silence or
//            "thanks" / "that's all" / "stop" ends the conversation and goes back to waiting for "Alexa"

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
/** No new words for this long ends a request; after a sentence the recognizer marked final, less. */
const SILENCE_MS = 1200;
const FINAL_SILENCE_MS = 600;
const WAKE_ONLY_MS = 7000;
const FOLLOW_UP_MS = 8000;
const WAKE_WORD = /\b(alexa|alexia|alexis|alex|elexa|alecsa)\b[,.!?]?/i;
// Sounds that are not words ("Mhm", "uh"): they neither keep a request open nor get sent.
const FILLERS = /\b(m+h+m+|m{2,}|h+m+|uh+|um+|uhm+|erm+|ah+)\b[.,!?]?/gi;

/** "Mhm. We got a dresser, uh, yesterday. Mhm" -> "We got a dresser, yesterday." */
function withoutFillers(text) {
  return text
    .replace(FILLERS, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/^[\s.,!?]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const END_PHRASES =
  /^(thanks|thank you|thank you alexa|that's all|that is all|that's it|stop|cancel|never ?mind|no thanks|no thank you|nothing|bye|goodbye|good bye)[.!]?$/i;

/** "Alexa, we got a dresser" -> "We got a dresser". */
function afterWakeWord(text) {
  const parts = text.split(new RegExp(WAKE_WORD.source, 'gi'));
  const rest = (parts.at(-1) ?? '').replace(/^[\s,.!?]+/, '').trim();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

const microphone = new Microphone();

async function presignTranscribe() {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok)
    throw new Error((await res.json().catch(() => ({}))).error ?? 'Transcribe unavailable');
  return res.json();
}

const voice = {
  mode: 'off', // off | wake | request | followup | busy
  allowed: false,
  wakeEngine: null,
  engine: null,
  liveBubble: null,
  text: null,
  final: false,
  fromWake: false,
  silenceTimer: 0,
  followTimer: 0,
  restartTimer: 0,
  failures: 0,

  /** Some way to listen exists in this browser. */
  available() {
    return Boolean(Recognition) || this.transcribeReady();
  },

  transcribeReady() {
    return (
      config.transcribe && Boolean(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode)
    );
  },

  /** Which engine records requests: Amazon Transcribe when chosen and possible, else the browser's. */
  requestEngine() {
    if (this.transcribeReady() && (engineSelect.value === 'transcribe' || !Recognition)) {
      return new TranscribeEngine(microphone, presignTranscribe);
    }
    return Recognition ? new BrowserEngine(Recognition) : null;
  },

  handsFree() {
    return Boolean(Recognition) && handsFreeToggle.checked && this.allowed;
  },

  setMode(mode) {
    this.mode = mode;
    listening = mode === 'request' || mode === 'followup';
    micButton.setAttribute('aria-pressed', String(listening));
    micButton.dataset.armed = String(mode === 'wake');
    micButton.title =
      mode === 'wake'
        ? 'Hands-free: say “Alexa”, or tap to talk'
        : listening
          ? 'Tap when you are done'
          : 'Talk to Alexa';
    scene.dataset.listen = mode;
    updateRing();
    updateHint();
  },

  // -- waiting for the wake word -------------------------------------------------------------------------

  /** Back to waiting for "Alexa" (or to nothing, when hands-free is off). */
  async idle() {
    clearTimeout(this.restartTimer);
    this.setMode('off');
    if (!this.handsFree() || busy || speaking) return;
    this.setMode('wake');
    // Keep the microphone open so the request said in the same breath as "Alexa" can be sent to Transcribe.
    if (this.transcribeReady() && engineSelect.value === 'transcribe') {
      await microphone.openMic().catch(() => undefined);
    }
    if (this.mode !== 'wake') return;
    const engine = new BrowserEngine(Recognition);
    this.wakeEngine = engine;
    engine
      .start({
        onText: (text, info) => {
          this.failures = 0;
          if (this.mode === 'wake' && WAKE_WORD.test(text))
            void this.beginRequest({ fromWake: true, text });
          else if (this.mode === 'request' && this.engine === engine)
            this.heard(afterWakeWord(text), info);
        },
        onError: (error) => {
          if (error === 'not-allowed' || error === 'service-not-allowed') {
            this.allowed = false;
            setStatus('The microphone is blocked, so hands-free is off. You can still type.');
          } else {
            this.failures += 1;
          }
        },
        onEnd: () => {
          if (this.wakeEngine !== engine) return;
          this.wakeEngine = null;
          // Chrome stops continuous recognition after a while or on silence: start again.
          if (this.mode === 'wake') {
            this.restartTimer = setTimeout(() => void this.idle(), this.failures > 2 ? 5000 : 300);
          } else if (this.mode === 'request' && this.engine === engine) {
            this.finish();
          }
        },
      })
      .catch(() => undefined);
  },

  stopWake() {
    const engine = this.wakeEngine;
    this.wakeEngine = null;
    engine?.abort();
  },

  // -- recording a request ---------------------------------------------------------------------------------

  /** Starts recording: after the wake word, after a tap on the mic, or (followup) after Alexa's reply. */
  async beginRequest({ fromWake = false, text = '', followUp = false } = {}) {
    clearTimeout(this.followTimer);
    this.text = null; // so the first words, even none, start the silence timer
    this.fromWake = fromWake;
    stopSpeaking();
    this.setMode(followUp ? 'followup' : 'request');
    const useTranscribe =
      this.transcribeReady() && (engineSelect.value === 'transcribe' || !Recognition);
    if (fromWake && !useTranscribe) {
      // The browser recognizer that heard "Alexa" keeps listening for the rest of the sentence.
      this.engine = this.wakeEngine;
      this.wakeEngine = null;
      this.heard(afterWakeWord(text));
      return;
    }
    this.stopWake();
    const engine = this.requestEngine();
    if (!engine) return this.idle();
    this.engine = engine;
    if (fromWake) this.heard(afterWakeWord(text)); // shown at once; Transcribe's version replaces it
    if (followUp) this.followTimer = setTimeout(() => this.endConversation(), FOLLOW_UP_MS);
    try {
      await engine.start({
        preroll: fromWake,
        onText: (t, info) =>
          this.engine === engine && this.heard(fromWake ? afterWakeWord(t) : t, info),
        onError: (message) => {
          if (this.engine !== engine) return;
          setStatus(
            message === 'not-allowed'
              ? 'The microphone is blocked. Allow it in the browser, or type instead.'
              : 'I could not hear you clearly. Try again, or type.',
          );
        },
        onEnd: () => this.engine === engine && this.finish(),
      });
      this.allowed = true; // the browser granted the microphone: hands-free can wait for "Alexa" from now on
    } catch (error) {
      if (this.engine !== engine) return;
      this.engine = null;
      // Transcribe unavailable (budget, network): the browser recognizer takes over for this request.
      if (engine instanceof TranscribeEngine && Recognition) {
        setStatus('Using the browser’s speech recognition for now.');
        engineSelect.value = 'browser';
        return this.beginRequest({ fromWake: false, followUp });
      }
      setStatus(String(error.message ?? error));
      this.idle();
    }
  },

  /**
   * New words: shown live in the user's bubble. The request ends after a moment without NEW words (Transcribe
   * repeats unchanged results while you are quiet, and noises like "mhm" do not count), sooner once the
   * recognizer has marked the sentence final.
   */
  heard(raw, { final = false } = {}) {
    if (this.mode !== 'request' && this.mode !== 'followup') return;
    const text = withoutFillers(raw);
    const changed = text !== this.text;
    if (!changed && !(final && !this.final)) return;
    if (text && this.mode === 'followup') {
      clearTimeout(this.followTimer);
      this.setMode('request');
    }
    this.text = text;
    this.final = final;
    if (text) {
      if (!this.liveBubble) this.liveBubble = bubble('user live', '');
      this.liveBubble.querySelector('.text').textContent = text;
      scrollToEnd();
    }
    clearTimeout(this.silenceTimer);
    const wait = !text ? WAKE_ONLY_MS : final ? FINAL_SILENCE_MS : SILENCE_MS;
    this.silenceTimer = setTimeout(() => this.finish(), wait);
  },

  /** The user stopped talking (or tapped the mic): send it, or end the conversation on "thanks". */
  finish() {
    if (this.mode !== 'request' && this.mode !== 'followup') return;
    clearTimeout(this.silenceTimer);
    clearTimeout(this.followTimer);
    const engine = this.engine;
    this.engine = null;
    engine?.abort();
    const text = (this.text ?? '').trim();
    const live = this.liveBubble;
    this.liveBubble = null;
    live?.classList.remove('live');
    if (!text) {
      live?.remove();
      return this.endConversation();
    }
    if (END_PHRASES.test(text.replace(/,/g, ''))) {
      setStatus('Okay. Say “Alexa” when you need me.', 4000);
      return this.endConversation();
    }
    this.setMode('busy');
    void send(text, live, { voice: true });
  },

  /** After a reply has been spoken: listen for a follow-up without the wake word, if we were talking. */
  afterReply(byVoice) {
    if (this.mode !== 'busy' && this.mode !== 'off' && this.mode !== 'wake') return;
    // Only for someone who already talked to Alexa: never open the microphone out of the blue.
    if (byVoice && this.available() && this.allowed) {
      void this.beginRequest({ followUp: true });
    } else {
      this.idle();
    }
  },

  endConversation() {
    clearTimeout(this.silenceTimer);
    clearTimeout(this.followTimer);
    const engine = this.engine;
    this.engine = null;
    engine?.abort();
    this.liveBubble?.remove();
    this.liveBubble = null;
    this.idle();
  },

  /** Everything off (typing, reset, settings changes). */
  halt() {
    clearTimeout(this.silenceTimer);
    clearTimeout(this.followTimer);
    clearTimeout(this.restartTimer);
    this.engine?.abort();
    this.engine = null;
    this.stopWake();
    this.liveBubble?.remove();
    this.liveBubble = null;
    this.setMode('off');
  },
};

function loadSetting(key, apply) {
  try {
    const saved = window.localStorage.getItem(key);
    if (saved !== null) apply(saved);
  } catch {
    // storage unavailable: keep the default
  }
}

function saveSetting(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // not remembered, that's fine
  }
}

function setUpVoice() {
  if (!voice.available()) {
    micButton.disabled = true;
    micButton.title = 'Voice input needs Chrome or Edge.';
    notice.textContent = 'Voice input needs Chrome or Edge. You can still type to Alexa below.';
    notice.hidden = false;
    updateHint();
    return;
  }
  micButton.disabled = false;
  notice.hidden = true;
  $('#hands-free-row').hidden = !Recognition;
  $('#engine-row').hidden = !(Recognition && voice.transcribeReady());
  engineSelect.value = voice.transcribeReady() ? 'transcribe' : 'browser';
  loadSetting('engine', (v) => {
    if (v === 'browser' || voice.transcribeReady()) engineSelect.value = v;
  });
  if (!Recognition) {
    notice.textContent = 'Hands-free “Alexa” needs Chrome or Edge; tap the microphone to talk.';
    notice.hidden = false;
  }
  updateHint();
}

if (Recognition) {
  loadSetting('handsFree', (v) => (handsFreeToggle.checked = v === 'on'));
  handsFreeToggle.addEventListener('change', () => {
    saveSetting('handsFree', handsFreeToggle.checked ? 'on' : 'off');
    if (handsFreeToggle.checked) {
      if (!voice.allowed) setStatus('Tap the microphone once to allow it; then just say “Alexa”.');
      if (voice.mode === 'off') void voice.idle();
    } else if (voice.mode === 'wake') {
      voice.halt();
    }
  });
  // If the microphone was already allowed for this page, hands-free can start right away.
  navigator.permissions
    ?.query({ name: 'microphone' })
    .then((status) => {
      if (status.state === 'granted') {
        voice.allowed = true;
        if (voice.mode === 'off' && !busy) void voice.idle();
      }
    })
    .catch(() => undefined);
}

const VOICE_PREVIEW = "Hi, I'm Alexa. I'll keep an eye on recalls for your family.";

loadSetting('voice', (v) => {
  if ([...voiceSelect.options].some((o) => o.value === v)) voiceSelect.value = v;
});
voiceSelect.addEventListener('change', () => {
  saveSetting('voice', voiceSelect.value);
  stopSpeaking();
  void speak(VOICE_PREVIEW); // hear it at once
});

engineSelect.addEventListener('change', () => {
  saveSetting('engine', engineSelect.value);
  if (engineSelect.value === 'browser') microphone.close();
  if (voice.mode === 'wake') void voice.idle();
});

micButton.addEventListener('click', () => {
  if (busy) return;
  if (voice.mode === 'request' || voice.mode === 'followup') voice.finish();
  else void voice.beginRequest();
});

setUpVoice();

// ---- conversation --------------------------------------------------------------------------------------------

function setBusy(on) {
  busy = on;
  sendButton.disabled = on;
  input.disabled = on;
  micButton.disabled = on || !voice.available();
  updateRing();
  if (on) showTyping();
  else removeTyping();
  if (!on) input.focus();
}

/**
 * Sends a message and speaks the reply. `userBubble` is the live bubble the words appeared in while the
 * user talked; typed messages get a new one. After a spoken exchange, Alexa keeps listening for a follow-up.
 */
async function send(message, userBubble = null, { voice: byVoice = false } = {}) {
  if (!userBubble) bubble('user', message);
  setBusy(true);
  let replyBubble = null;
  let reply = '';
  // What Alexa said on her own since the last turn goes along, so the answer to it is understood.
  const announced = pendingAnnouncement;
  pendingAnnouncement = '';
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(announced ? { sessionId, message, announced } : { sessionId, message }),
    });
    const data = await res.json();
    if (!res.ok) {
      bubble('error', data.error ?? 'Something went wrong.');
      return;
    }
    sessionId = data.sessionId;
    reply = data.reply;
    replyBubble = bubble('alexa', data.reply, data.toolCalls);
    // Alerts raised by this very turn are already in the reply: do not announce them a second time.
    await refreshState({ announce: false });
  } catch {
    bubble('error', 'I could not reach the server. Please try again.');
  } finally {
    if (busy) setBusy(false);
  }
  if (replyBubble) await speak(reply, replyBubble);
  voice.afterReply(byVoice && Boolean(replyBubble));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || busy) return;
  input.value = '';
  stopSpeaking();
  voice.halt(); // typing ends a spoken conversation
  void send(message);
});

// ---- settings: a pop-up dialog behind the gear (voice options and the demo controls) ---------------------------

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
  voice.halt();
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
  void voice.idle();
  updateHint();
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

// ---- credits: a logo replaces the text when its file exists (img/logo-aws.svg or .png, img/logo-alexa...) ----------

function showLogos() {
  for (const mark of document.querySelectorAll('.credit-mark')) {
    const [first, ...rest] = ['svg', 'png'].map((ext) => `/img/${mark.dataset.logo}.${ext}`);
    const tryLoad = (src, others) => {
      const img = document.createElement('img');
      img.alt = mark.dataset.name;
      img.onload = () => mark.replaceChildren(img);
      img.onerror = () => others.length > 0 && tryLoad(others[0], others.slice(1));
      img.src = src;
    };
    tryLoad(first, rest);
  }
}

// ---- start --------------------------------------------------------------------------------------------------------------

updateHint();
showLogos();

fetch('/api/config')
  .then((res) => res.json())
  .then((c) => {
    config = c;
    seedButton.hidden = !c.demo;
    demoButton.hidden = !c.demo;
    $('#voice-row').hidden = !c.speech; // the browser's own voice has no choice here
    setUpVoice(); // Transcribe may be available now
  })
  .catch(() => undefined);
