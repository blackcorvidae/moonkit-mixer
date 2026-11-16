// ===================================================================
// V9: ECHOLOTL — the creature that repeats whatever you play
// ===================================================================
// Notes arrive from two places: the on-screen Echo pads (also keys 1–8) and
// a MIDI keyboard in "jam" mode (js/midi.js). Each note sounds right away
// and is dropped onto the nearest sequencer step, so Echolotl loops it back
// on the next pass — in the browser, and out to a MIDI synth if Out is on.
//
// A phrase is everything played without a long pause. Wait two bars and the
// next note starts a fresh phrase, replacing the old one.
//
// The riff lives on Echolotl's own definition (its single pattern and note
// list), so dragging it on stage, fusing it or restoring a share link all
// pick the riff up with no special cases.
import { CHARACTERS } from './data.js';
import { ctx, playLive, setEchoPlayListener } from './audio.js';
import { stageSlots, findCharState, addToStage, getEvoLevel, showToast } from './state.js';
import { isPlaying, startPlayback, stepNow, stepSeconds, seqOpen, renderSequencer } from './sequencer.js';
import { flashSlot } from './ui.js';

export const ECHO_ID = 'echolotl';
const STEPS = 16;
const PHRASE_GAP_BARS = 2;
// C minor pentatonic — the key every creature's tune is written in. Sunny
// mood snaps these onto its bright scale like any other melody.
const PAD_NOTES = [60, 63, 65, 67, 70, 72, 75, 77];

const def = CHARACTERS.find(c => c.id === ECHO_ID);
const riff = def.patterns[0];       // 16 steps, mutated in place
const notes = def.notes;            // 16 Hz values, mutated in place
let lastHeard = 0;                  // AudioContext time of the last hand-played note

const midiHz = n => 440 * Math.pow(2, (n - 69) / 12);
const hzMidi = hz => Math.round(69 + 12 * Math.log2(hz / 440));

function echoSlot() {
  return stageSlots.findIndex(s => s && (s.id === ECHO_ID || (s.fusion && s.parts.some(p => p.id === ECHO_ID))));
}

// Play one note by hand. source 'keys' = the MIDI synth's own keyboard,
// which is already sounding there, so the note isn't sent back out to it.
export function hear(midi, source = 'pad') {
  if (!ctx) { showToast('🌙 Tap the screen to start, then play!'); return; }
  const hz = midiHz(midi);
  const now = ctx.currentTime;
  const fresh = !lastHeard || now - lastHeard > stepSeconds() * STEPS * PHRASE_GAP_BARS;
  lastHeard = now;
  lightPad(midi);

  let slot = echoSlot();
  if (slot === -1) {
    const empty = stageSlots.indexOf(null);
    if (empty === -1) {              // nowhere to sit — still let the note ring
      playLive(def, hz, 0, source !== 'keys');
      showToast('🫧 The stage is full — make room and Echolotl will join in');
      return;
    }
    riff.fill(0);
    addToStage(ECHO_ID, empty);      // also starts playback and opens the pads
    slot = empty;
    showToast('🫧 Echolotl heard that — keep playing, it repeats you!');
  } else if (!isPlaying) {
    startPlayback();
  }

  const cs = findCharState(ECHO_ID);
  if (fresh) { riff.fill(0); cs.currentPattern.fill(0); }
  const step = stepNow();
  riff[step] = 1; notes[step] = hz;
  cs.currentPattern[step] = 1;
  // if the sequencer reaches this step in the next instant, it already sounded
  cs.skipStep = step; cs.skipUntil = now + stepSeconds() * 0.75;

  playLive(cs, hz, getEvoLevel(stageSlots[slot].id), source !== 'keys');
  flashSlot(slot);
  if (seqOpen) renderSequencer();
  updateStatus();
}

export function forget() {
  riff.fill(0);
  lastHeard = 0;
  const cs = findCharState(ECHO_ID);
  if (cs) { cs.currentPattern.fill(0); if (seqOpen) renderSequencer(); }
  updateStatus();
  showToast('🧽 Echolotl forgot everything — teach it something new');
}

// ── share links ────────────────────────────────────────────────────
// 16 steps × 2 hex digits: the MIDI note on that step, or 00 for silence.
export function encodeRiff() {
  const cs = findCharState(ECHO_ID);
  const p = cs ? cs.currentPattern : riff;
  return p.map((on, i) => (on ? Math.max(1, Math.min(127, hzMidi(notes[i]))).toString(16).padStart(2, '0') : '00')).join('');
}
export function decodeRiff(str) {
  if (!str || !/^[0-9a-f]{32}$/i.test(str)) return;
  for (let i = 0; i < STEPS; i++) {
    const n = parseInt(str.slice(i * 2, i * 2 + 2), 16);
    riff[i] = n >= 1 && n <= 127 ? 1 : 0;
    if (riff[i]) notes[i] = midiHz(n);
  }
  updateStatus();
}

// ── the pad strip ──────────────────────────────────────────────────
const panel = () => document.getElementById('echo-panel');

export function openEchoPads() { setPadsOpen(true); }
function setPadsOpen(open) {
  const p = panel();
  if (!p) return;
  p.classList.toggle('open', open);
  document.getElementById('btn-echo-pads').classList.toggle('echo-active', open);
  if (open) updateStatus();
}

function lightPad(midi) {
  const pads = [...document.querySelectorAll('.echo-pad')];
  const pad = pads.find(el => +el.dataset.note === midi) || pads.find(el => (+el.dataset.note - midi) % 12 === 0);
  if (!pad) return;
  pad.classList.remove('lit'); void pad.offsetWidth; pad.classList.add('lit');
}

function updateStatus() {
  const el = document.getElementById('echo-status');
  if (!el) return;
  const cs = findCharState(ECHO_ID);
  const n = (cs ? cs.currentPattern : riff).filter(Boolean).length;
  el.textContent = !cs ? 'tap a pad — Echolotl will come and copy you'
    : n === 0 ? 'Echolotl is listening…'
    : `Echolotl remembers ${n} note${n === 1 ? '' : 's'} · pause two bars to start over`;
}

export function playPad(index) {
  if (PAD_NOTES[index] !== undefined) hear(PAD_NOTES[index], 'pad');
}

export function setupEcho() {
  const strip = document.getElementById('echo-pads');
  PAD_NOTES.forEach((note, i) => {
    const pad = document.createElement('button');
    pad.className = 'echo-pad';
    pad.dataset.note = note;
    pad.style.setProperty('--pad-hue', 300 - i * 22);
    pad.textContent = i + 1;
    pad.setAttribute('aria-label', `Echo pad ${i + 1}`);
    pad.addEventListener('pointerdown', e => { e.preventDefault(); hear(note, 'pad'); });
    strip.appendChild(pad);
  });
  document.getElementById('btn-echo-pads').addEventListener('click', () => setPadsOpen(!panel().classList.contains('open')));
  document.getElementById('btn-echo-forget').addEventListener('click', forget);
  // pads glow when Echolotl sings a note back — the same trick the FM-1's keys do
  setEchoPlayListener((hz, time) => {
    setTimeout(() => lightPad(hzMidi(hz)), Math.max(0, (time - ctx.currentTime) * 1000));
  });
  updateStatus();
}
