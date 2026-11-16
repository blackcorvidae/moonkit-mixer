// ===================================================================
// MIDI BRIDGE — play the stage from a hardware keyboard (built for the
// M-VAVE FM-1, works with any MIDI keyboard)
// ===================================================================
// The FM-1's stock firmware only sends Note On/Off (fixed velocity, ch 1),
// so everything here is driven by keys alone:
//
//   pitch class → stage slot   C=1 … B=12, in any octave (OCT± doesn't matter)
//   tap   empty slot           summon a random creature that isn't on stage
//   tap   occupied slot        re-roll that creature's pattern
//   hold  occupied slot        unfuse a fusion / send a creature home
//   two keys together          fuse the higher key's creature into the lower
//   three+ keys together       shuffle every pattern
//
// V9: click 🎹 again to switch the keys to "jam" — every key simply plays
// its note, and Echolotl (js/echo.js) loops back whatever you play.
// ===================================================================
import { CHARACTERS } from './data.js';
import { ctx, moodMidiNote, setLocalMuted, setVoiceListener, echoAmount } from './audio.js';
import { hear } from './echo.js';
import { generatePattern } from './patterns.js';
import { seqOpen, renderSequencer, tempo, setStopListener } from './sequencer.js';
import {
  stageSlots, isOnStage, getEvoLevel, addToStage, removeFromStage,
  fuseIntoSlot, unfuse, shufflePatterns, showToast, catalystTempoMult,
} from './state.js';
import { flashSlot } from './ui.js';

const CHORD_WINDOW_MS = 60;   // keys landing this close together count as one chord
const HOLD_MS = 650;          // press longer than this = hold

let access = null;
let pending = [];             // note-ons collected inside the chord window
let chordTimer = null;

const btn = () => document.getElementById('btn-midi');

export const midiSupported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

async function ensureAccess() {
  if (access) return true;
  if (!midiSupported()) {
    showToast('🎹 This browser has no Web MIDI — try Chrome, Edge or Brave');
    return false;
  }
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch (e) {
    showToast('🎹 MIDI access was blocked');
    return false;
  }
  access.onstatechange = e => {
    if (inputOn && e.port.type === 'input' && e.port.state === 'connected') attach(e.port);
    if (e.port.type === 'output') pickOutput();
    if (inputOn) showStatus();
  };
  return true;
}

// What the keys do: 'summon' (stage gestures, above) or 'jam' (play notes
// for Echolotl to repeat). Remembered per browser.
let keyMode = 'summon';
try { if (localStorage.getItem('moonkit-midi-keys') === 'jam') keyMode = 'jam'; } catch (e) {}

let inputOn = false;
export async function connectMidi() {
  if (!(await ensureAccess())) return;
  if (!inputOn) {
    inputOn = true;
    access.inputs.forEach(attach);
  } else if (inputNames().length) {      // already connected: a click flips the mode
    keyMode = keyMode === 'jam' ? 'summon' : 'jam';
    try { localStorage.setItem('moonkit-midi-keys', keyMode); } catch (e) {}
    presses.clear(); pending = []; clearTimeout(chordTimer);
  }
  showStatus();
}

function attach(input) {
  input.onmidimessage = onMessage;
}

function inputNames() {
  if (!access) return [];
  return [...access.inputs.values()].filter(i => i.state === 'connected').map(i => i.name);
}

function showStatus() {
  const names = inputNames();
  const b = btn();
  if (b) {
    b.classList.toggle('midi-active', names.length > 0);
    b.title = names.length ? `MIDI: ${names.join(', ')} — click to switch between summon and jam` : 'MIDI: no keyboard found';
    b.textContent = names.length ? `🎹 Keys: ${keyMode}` : '🎹 MIDI';
  }
  showToast(!names.length ? '🎹 No MIDI keyboard found — plug one in'
    : keyMode === 'jam' ? `🎹 ${names.join(', ')}: jam — play a tune and Echolotl repeats it (click again for summon)`
    : `🎹 ${names.join(', ')}: summon — keys call creatures (click again to jam)`);
}

function pulse() {
  const b = btn();
  if (!b) return;
  b.classList.remove('midi-hit'); void b.offsetWidth; b.classList.add('midi-hit');
}

// ── message handling ───────────────────────────────────────────────
// Each press becomes a "press" record. Presses landing within CHORD_WINDOW_MS
// are resolved together; a lone press then waits for release (tap) or for
// HOLD_MS to pass (hold).
const presses = new Map();    // note → press record for keys currently down

function onMessage({ data }) {
  const [status, note, vel] = data;
  const kind = status & 0xF0;
  if (kind === 0x90 && vel > 0) noteOn(note);
  else if (kind === 0x80 || (kind === 0x90 && vel === 0)) noteOff(note);
}

function noteOn(note) {
  pulse();
  if (!ctx) { showToast('🌙 Tap the screen to start, then play!'); return; }
  if (keyMode === 'jam') { hear(note, 'keys'); return; }
  const press = { note, slot: note % 12, resolved: false, released: false, done: false, timer: null };
  presses.set(note, press);
  pending.push(press);
  clearTimeout(chordTimer);
  chordTimer = setTimeout(resolveChord, CHORD_WINDOW_MS);
}

function resolveChord() {
  const group = pending;
  pending = [];
  group.forEach(p => { p.resolved = true; });
  const slots = [...new Set(group.map(p => p.slot))].sort((a, b) => a - b);

  if (slots.length >= 3) { group.forEach(p => { p.done = true; }); shufflePatterns(); showToast('🎲 Chord shuffle!'); return; }
  if (slots.length === 2) { group.forEach(p => { p.done = true; }); fuseSlots(slots[0], slots[1]); return; }

  // One key (possibly retriggered): tap if already released, else wait for hold.
  const press = group[group.length - 1];
  group.slice(0, -1).forEach(p => { p.done = true; });
  if (press.released) { press.done = true; tapSlot(press.slot); return; }
  press.timer = setTimeout(() => { press.done = true; holdSlot(press.slot); }, HOLD_MS - CHORD_WINDOW_MS);
}

function noteOff(note) {
  const press = presses.get(note);
  if (!press) return;
  presses.delete(note);
  press.released = true;
  if (!press.resolved || press.done) return;   // resolveChord will handle it / already handled
  clearTimeout(press.timer);
  press.done = true;
  tapSlot(press.slot);
}

// ── actions ────────────────────────────────────────────────────────
function tapSlot(slot) {
  const occ = stageSlots[slot];
  if (!occ) {
    const free = CHARACTERS.filter(c => !isOnStage(c.id));
    if (!free.length) { showToast('🌙 Every creature is already on stage!'); return; }
    const pick = free[Math.floor(Math.random() * free.length)];
    addToStage(pick.id, slot);
    showToast(`${pick.emoji} ${pick.name} answered the call!`);
  } else {
    (occ.fusion ? occ.parts : [occ]).forEach(t => { if (t.role !== 'echo') t.currentPattern = generatePattern(t.role); });
    if (seqOpen) renderSequencer();
  }
  flashSlot(slot);
}

function holdSlot(slot) {
  const occ = stageSlots[slot];
  if (!occ) return;
  if (occ.fusion) { unfuse(slot); return; }
  removeFromStage(slot);
  showToast(`👋 ${occ.name} drifted home`);
}

function fuseSlots(a, b) {
  const host = stageSlots[a];
  const guest = stageSlots[b];
  if (!host || !guest) {           // not two creatures — treat each key as a tap
    tapSlot(a); tapSlot(b);
    return;
  }
  if (guest.fusion) { showToast('🚫 A fusion can only swallow a single creature'); return; }
  if (host.fusion && host.parts.length >= 3) {
    showToast('🚫 Nothing outshines a total eclipse — hold its key to let one slip out first');
    return;
  }
  if (host.fusion && getEvoLevel(host.id) < 2) {
    showToast(`🌘 ${host.name} isn't burning bright enough yet — let it evolve to ★★ first`);
    return;
  }
  removeFromStage(b);
  fuseIntoSlot(guest.id, a);
}

// ===================================================================
// MIDI OUT — creatures play an external synth (built for the FM-1 on
// firmware V16, where each of its 8 Voices listens on its own channel)
// ===================================================================
// Set FM-1 Voice n to receive on MIDI channel n. Creatures are grouped by
// role onto those 8 channels, so each group gets its own FM-1 sound.
export const ROLE_CHANNEL = {
  kick: 1, stomp: 1,                 // Voice 1 — low thumps
  snare: 2, clap: 2, hihat: 2,       // Voice 2 — hits
  bass: 3, sub: 3, growl: 3,         // Voice 3 — bass
  melody: 4, lead: 4, pluck: 4, echo: 4, // Voice 4 — tunes
  arp: 5, bell: 5,                   // Voice 5 — sparkle
  pad: 6, chord: 6,                  // Voice 6 — pads
  ambient: 7, vocal: 7,              // Voice 7 — atmosphere
  fx: 8,                             // Voice 8 — weird stuff
};
// Unpitched roles get a fixed note (Hz, so moods still bend them);
// pads and chords send a small triad.
const midiHz = n => 440 * Math.pow(2, (n - 69) / 12);
const ROLE_NOTES = {
  kick: [36], stomp: [31], snare: [50], clap: [52], hihat: [78],
  pad: [48, 55, 63], chord: [57, 60, 64], ambient: [72], vocal: [64], fx: [84],
};
// How long each role's note is held, in sequencer steps (drums: a blip)
const ROLE_GATE = { pad: 3.5, chord: 3.5, ambient: 3.5, vocal: 2, fx: 2 };
const DRUMS = new Set(['kick', 'stomp', 'snare', 'clap', 'hihat']);
// V9: roles whose notes repeat on the synth when the Echo dial is turned up
const ECHO_ROLES = new Set(['melody', 'lead', 'pluck', 'arp', 'bell', 'echo']);
const ECHO_STEPS = 3;               // repeats land a dotted eighth apart, like the browser delay
const FX_CHANNEL = 2;               // FM-1 default "effectch": CC 0–23 drive its FX
const VIBRATO_CHANNELS = [3, 4, 5, 6, 7, 8]; // CC 1 on ch 2 would change filter type

// Channel layout: a number (1–16) sends every creature on that one channel,
// so they all play the synth's current sound — set it to whatever channel the
// FM-1 listens on. 'split' uses the 8-Voice role map above (FM-1 V16 with
// Voice n set to channel n). The choice is remembered per browser.
let channelMode = 1;
try {
  const saved = localStorage.getItem('moonkit-midi-channel');
  if (saved === 'split') channelMode = 'split';
  else if (+saved >= 1 && +saved <= 16) channelMode = +saved;
} catch (e) { /* storage blocked — default to channel 1 */ }
const roleChannel = role => (channelMode === 'split' ? ROLE_CHANNEL[role] : channelMode);
const vibratoChannels = () => (channelMode === 'split' ? VIBRATO_CHANNELS : [channelMode]);

function setupChannelPicker() {
  const sel = document.getElementById('midi-ch');
  if (!sel) return;
  sel.innerHTML = Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">Ch ${i + 1}</option>`).join('')
    + '<option value="split">Ch 1–8 split</option>';
  sel.value = String(channelMode);
  sel.addEventListener('change', () => {
    if (outMode !== 'off') allNotesOff();
    channelMode = sel.value === 'split' ? 'split' : +sel.value;
    try { localStorage.setItem('moonkit-midi-channel', String(channelMode)); } catch (e) {}
    if (outMode !== 'off') { sendFxState(); helloBlip(); }
    showToast(channelMode === 'split'
      ? '🎚 Creatures split over channels 1–8 — set FM-1 Voice n to channel n'
      : `🎚 Every creature plays on channel ${channelMode}`);
  });
}

const OUT_MODES = ['off', 'both', 'synth'];
let outMode = 'off';
let output = null;
const offTimers = new Map();        // "ch:note" → pending note-off timeout
let outGen = 0;                     // bumped by allNotesOff so queued notes and echoes die with it

function pickOutput() {
  if (!access) return;
  const all = [...access.outputs.values()];
  console.info('[moonkit midi] outputs:', all.map(o => `${o.name} (${o.state}/${o.connection})`));
  const outs = all.filter(o => o.state === 'connected');
  output = outs.find(o => /FM/i.test(o.name)) || outs[0] || null;
  if (output && output.open) output.open().catch(e => console.warn('[moonkit midi] open failed', e));
}

export async function cycleMidiOut() {
  if (!(await ensureAccess())) return;
  pickOutput();
  if (!output) { showToast('🎛 No MIDI synth found — plug one in'); return; }
  const next = OUT_MODES[(OUT_MODES.indexOf(outMode) + 1) % OUT_MODES.length];
  if (outMode !== 'off' && next !== outMode) allNotesOff();
  outMode = next;
  setLocalMuted(outMode === 'synth');
  setVoiceListener(outMode === 'off' ? null : sendVoice);
  const b = document.getElementById('btn-midi-out');
  if (b) {
    b.classList.toggle('midi-active', outMode !== 'off');
    b.textContent = { off: '🎛 Out: off', both: `🎛 Out: both → ${output.name}`, synth: `🎛 Out: ${output.name} only` }[outMode];
  }
  if (outMode !== 'off') { sendFxState(); if (outMode === 'both') helloBlip(); }
  showToast({
    off: '🎛 MIDI out off — creatures sing in the browser again',
    both: `🎛 Creatures now play ${output.name} too`,
    synth: `🎛 Only ${output.name} now — browser sound muted`,
  }[outMode]);
}

// Always send immediately. Future-timestamped sends depend on the page's
// clock matching the MIDI clock, and privacy-hardened browsers (e.g. Brave)
// skew page timers — the FM-1 then never hears the notes. Notes are instead
// released by a timer when due (the sequencer only looks ~100 ms ahead).
let sendErrorShown = false;
function send(bytes) {
  if (!output) return;
  try {
    output.send(bytes);
  } catch (e) {
    console.warn('[moonkit midi] send failed', output.name, bytes, e);
    if (!sendErrorShown) { sendErrorShown = true; showToast(`🎛 Can't send to ${output.name}: ${e.name} — ${e.message}`); }
  }
}

function sendVoice(char, hz, time, evo) {
  const ch = roleChannel(char.role);
  if (!ch || !output) return;
  const dueMs = Math.max(0, (time - ctx.currentTime) * 1000);
  const stepMs = 60000 / (tempo * catalystTempoMult) / 4;
  const gateMs = DRUMS.has(char.role) ? 60 : (ROLE_GATE[char.role] ?? 0.9) * stepMs;
  const vel = Math.min(127, 72 + evo * 15);
  const freqs = ROLE_NOTES[char.role] ? ROLE_NOTES[char.role].map(midiHz) : [hz];
  const notes = freqs.map(f => clampNote(moodMidiNote(f)));   // pitch at schedule time
  const gen = outGen;
  const fire = (v, g) => { if (gen === outGen) notes.forEach(n => noteOnOut(ch, n, v, g)); };
  setTimeout(() => fire(vel, gateMs), dueMs);
  // MIDI echo: the synth can't hear the browser's delay, so replay the note
  // quieter each time. Starts at 40% on the dial; up to three repeats.
  if (!ECHO_ROLES.has(char.role)) return;
  const repeats = echoAmount >= 0.9 ? 3 : echoAmount >= 0.65 ? 2 : echoAmount >= 0.4 ? 1 : 0;
  for (let r = 1; r <= repeats; r++) {
    const v = Math.max(12, Math.round(vel * Math.pow(0.55, r)));
    setTimeout(() => fire(v, Math.min(gateMs, stepMs * 0.9)), dueMs + r * ECHO_STEPS * stepMs);
  }
}

const clampNote = n => Math.max(0, Math.min(127, n));

function noteOnOut(ch, note, vel, gateMs) {
  if (outMode === 'off') return;      // switched off while this note was queued
  const key = `${ch}:${note}`;
  if (offTimers.has(key)) {           // retrigger: end the old note first
    clearTimeout(offTimers.get(key));
    send([0x80 | (ch - 1), note, 0]);
  }
  send([0x90 | (ch - 1), note, vel]);
  // Note-offs go through a cancellable timer so a retrigger never gets cut short.
  offTimers.set(key, setTimeout(() => {
    offTimers.delete(key);
    send([0x80 | (ch - 1), note, 0]);
  }, gateMs));
}

// A quick rising blip (on the melody channel) so you can hear the synth is connected.
function helloBlip() {
  [72, 76, 79].forEach((n, i) => setTimeout(() => noteOnOut(roleChannel('melody'), n, 100, 110), i * 90));
}

function allNotesOff() {
  outGen++;
  offTimers.forEach(t => clearTimeout(t));
  offTimers.clear();
  for (let ch = 1; ch <= 16; ch++) send([0xB0 | (ch - 1), 123, 0]);
}

// Moonkit's Reverb and Vibrato controls drive the FM-1 too.
function sendReverb(pct) {
  send([0xB0 | (FX_CHANNEL - 1), 4, pct > 0 ? 1 : 0]);  // reverb switch
  send([0xB0 | (FX_CHANNEL - 1), 7, Math.round(pct)]);  // reverb mix 0–100
}
function sendVibrato(pct) {
  const v = Math.round(pct / 100 * 127);
  vibratoChannels().forEach(ch => send([0xB0 | (ch - 1), 1, v]));
}
function sendFxState() {
  sendReverb(+document.getElementById('reverb').value);
  sendVibrato(+document.getElementById('vibrato').value);
}

export function setupMidiOut() {
  setupChannelPicker();
  document.getElementById('btn-midi-out').addEventListener('click', cycleMidiOut);
  document.getElementById('reverb').addEventListener('input', e => { if (outMode !== 'off') sendReverb(+e.target.value); });
  document.getElementById('vibrato').addEventListener('input', e => { if (outMode !== 'off') sendVibrato(+e.target.value); });
  setStopListener(() => { if (outMode !== 'off') allNotesOff(); });
}
