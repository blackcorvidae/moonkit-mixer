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
// ===================================================================
import { CHARACTERS } from './data.js';
import { ctx } from './audio.js';
import { generatePattern } from './patterns.js';
import { seqOpen, renderSequencer } from './sequencer.js';
import {
  stageSlots, isOnStage, getEvoLevel, addToStage, removeFromStage,
  fuseIntoSlot, unfuse, shufflePatterns, showToast,
} from './state.js';
import { flashSlot } from './ui.js';

const CHORD_WINDOW_MS = 60;   // keys landing this close together count as one chord
const HOLD_MS = 650;          // press longer than this = hold

let access = null;
let pending = [];             // note-ons collected inside the chord window
let chordTimer = null;

const btn = () => document.getElementById('btn-midi');

export const midiSupported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

export async function connectMidi() {
  if (!midiSupported()) {
    showToast('🎹 This browser has no Web MIDI — try Chrome or Edge');
    return;
  }
  if (access) { showStatus(); return; }
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch (e) {
    showToast('🎹 MIDI access was blocked');
    return;
  }
  access.inputs.forEach(attach);
  access.onstatechange = e => {
    if (e.port.type === 'input' && e.port.state === 'connected') attach(e.port);
    showStatus();
  };
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
    b.title = names.length ? `MIDI: ${names.join(', ')}` : 'MIDI: no keyboard found';
  }
  showToast(names.length ? `🎹 ${names.join(', ')} connected — play a key!` : '🎹 No MIDI keyboard found — plug one in');
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
    (occ.fusion ? occ.parts : [occ]).forEach(t => { t.currentPattern = generatePattern(t.role); });
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
