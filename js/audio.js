import { activeCatalyst } from './state.js';

// ===================================================================
// MOOD SYSTEM
// ===================================================================
export let currentMood = 'dreamy';
export const MOODS = {
  dreamy: { filterMult: 0.7, detuneMult: 1.5, decayMult: 1.3,  pitchShift: 0,     reverbWet: 0.3,  delayFeedback: 0.25, label: 'Dreamy' },
  spooky: { filterMult: 0.4, detuneMult: 2.5, decayMult: 1.6,  pitchShift: -0.05, reverbWet: 0.5,  delayFeedback: 0.4,  label: 'Spooky' },
  wild:   { filterMult: 1.6, detuneMult: 0.6, decayMult: 0.65, pitchShift: 0.02,  reverbWet: 0.15, delayFeedback: 0.15, label: 'Wild'   },
  sunny:  { filterMult: 1.3, detuneMult: 0.4, decayMult: 0.8,  pitchShift: 0.01,  reverbWet: 0.22, delayFeedback: 0.2,  label: 'Sunny'  },
};
function mood() {
  const base = MOODS[currentMood];
  if (!activeCatalyst) return base;
  const c = activeCatalyst.moodMods;
  return {
    filterMult: base.filterMult * (c.filterMult ?? 1),
    detuneMult: base.detuneMult * (c.detuneMult ?? 1),
    decayMult:  base.decayMult  * (c.decayMult  ?? 1),
    pitchShift: base.pitchShift + (c.pitchShift  ?? 0),
    reverbWet:  Math.min(0.9, Math.max(0, base.reverbWet + (c.reverbWetAdd ?? 0))),
    label: base.label,
  };
}

// V8: Sunny mode snaps melodic pitches onto a bright Lydian scale (major
// with a raised 4th) so the existing 16 characters' minor-leaning note
// arrays come out major/uplifting without hand-editing every character.
const SUNNY_ROOT_PC = 0; // C
const LYDIAN_INTERVALS = [0, 2, 4, 6, 7, 9, 11];
function scaleSnap(freq) {
  const midi = 69 + 12 * Math.log2(freq / 440);
  const rounded = Math.round(midi);
  const pc = ((rounded - SUNNY_ROOT_PC) % 12 + 12) % 12;
  let best = LYDIAN_INTERVALS[0], bestDist = Infinity;
  for (const iv of LYDIAN_INTERVALS) {
    const dist = Math.abs(iv - pc);
    if (dist < bestDist) { bestDist = dist; best = iv; }
  }
  const snappedMidi = rounded - pc + best;
  return 440 * Math.pow(2, (snappedMidi - 69) / 12);
}
function applyMoodPitch(note, m) {
  const shifted = note * (1 + m.pitchShift);
  return currentMood === 'sunny' ? scaleSnap(shifted) : shifted;
}

// V8: vibrato / mod-wheel — a live sine wobble on pitch depth, layered
// onto a note's detune at trigger time (notes here are short one-shots,
// not held tones, so there's no persistent LFO bus to hook into).
export let vibratoDepth = 0; // 0..1
export function setVibratoDepth(v) { vibratoDepth = v; }
function applyVibrato(osc, time, duration) {
  if (vibratoDepth <= 0) return;
  const rate = 5.5; // Hz — gentle wobble, like easing a synth mod wheel
  const depthCents = vibratoDepth * 40;
  const steps = Math.max(4, Math.round(duration * rate * 4));
  osc.detune.setValueAtTime(0, time);
  for (let i = 1; i <= steps; i++) {
    const tt = (i / steps) * duration;
    osc.detune.linearRampToValueAtTime(Math.sin(2 * Math.PI * rate * tt) * depthCents, time + tt);
  }
}

// ===================================================================
// AUDIO ENGINE
// ===================================================================
export let ctx = null;
export let masterGain = null;
let compressor = null;
export let delayNode = null;
let delayFeedback = null;
let delayWet = null;
let noiseBuffer = null;
let reverbNode = null;
export let reverbSend = null;
let lofiFilter = null;
let lofiActive = false;

function buildReverbBuffer() {
  const len = ctx.sampleRate * 2.8;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
    }
  }
  return buf;
}

export function initAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Dynamics
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 10;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.1;

  masterGain = ctx.createGain();
  masterGain.gain.value = 0.75;

  // Delay send
  delayNode = ctx.createDelay(1.0);
  delayNode.delayTime.value = 0.33;
  delayFeedback = ctx.createGain();
  delayFeedback.gain.value = 0.25;
  delayWet = ctx.createGain();
  delayWet.gain.value = 0.2;
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayNode.connect(delayWet);
  delayWet.connect(masterGain);

  // Lo-fi filter (transparent when off)
  lofiFilter = ctx.createBiquadFilter();
  lofiFilter.type = 'lowpass';
  lofiFilter.frequency.value = 22050;
  lofiFilter.Q.value = 0.5;

  // Reverb
  reverbNode = ctx.createConvolver();
  reverbNode.buffer = buildReverbBuffer();
  reverbSend = ctx.createGain();
  reverbSend.gain.value = 0.25;

  // Chain: masterGain → compressor → lofiFilter → ctx.destination
  //        masterGain → compressor → reverbSend → reverbNode → ctx.destination
  masterGain.connect(compressor);
  compressor.connect(lofiFilter);
  lofiFilter.connect(ctx.destination);
  compressor.connect(reverbSend);
  reverbSend.connect(reverbNode);
  reverbNode.connect(ctx.destination);

  // Noise buffer
  const nLen = ctx.sampleRate * 2;
  noiseBuffer = ctx.createBuffer(1, nLen, ctx.sampleRate);
  const nd = noiseBuffer.getChannelData(0);
  for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
}

// ===================================================================
// SYNTHESIS FUNCTIONS
// ===================================================================
function playKick(time, evo) {
  const m = mood();
  const osc = ctx.createOscillator(); const gain = ctx.createGain();
  osc.type = 'sine';
  const sf = (150 + Math.random() * 20 + evo * 10) * (1 + m.pitchShift);
  osc.frequency.setValueAtTime(sf, time);
  osc.frequency.exponentialRampToValueAtTime(35, time + 0.07);
  gain.gain.setValueAtTime(0.7, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + (0.3 + evo * 0.06) * m.decayMult);
  osc.connect(gain); gain.connect(masterGain);
  osc.start(time); osc.stop(time + 0.6);
  if (evo >= 2) {
    const sub = ctx.createOscillator(); const sg = ctx.createGain();
    sub.type = 'sine'; sub.frequency.setValueAtTime(55, time);
    sg.gain.setValueAtTime(0.3, time);
    sg.gain.exponentialRampToValueAtTime(0.001, time + 0.25 * m.decayMult);
    sub.connect(sg); sg.connect(masterGain);
    sub.start(time); sub.stop(time + 0.35);
  }
}

function playSnare(time, evo) {
  const m = mood();
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer;
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass';
  nf.frequency.value = (3500 + evo * 600 + Math.random() * 300) * m.filterMult; nf.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.45, time);
  ng.gain.exponentialRampToValueAtTime(0.001, time + (0.12 + evo * 0.03) * m.decayMult);
  noise.connect(nf); nf.connect(ng); ng.connect(masterGain);
  noise.start(time); noise.stop(time + 0.3);
  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.value = 180 + Math.random() * 30;
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.25, time);
  og.gain.exponentialRampToValueAtTime(0.001, time + 0.07 * m.decayMult);
  osc.connect(og); og.connect(masterGain);
  osc.start(time); osc.stop(time + 0.15);
}

function playHihat(time, evo) {
  const m = mood();
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer;
  noise.playbackRate.value = 1 + Math.random() * 0.3;
  const filt = ctx.createBiquadFilter(); filt.type = 'highpass';
  filt.frequency.value = (7000 + evo * 800) * m.filterMult;
  const gain = ctx.createGain();
  const decay = (0.04 + Math.random() * 0.02 + evo * 0.02) * m.decayMult;
  gain.gain.setValueAtTime(0.22, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  noise.connect(filt); filt.connect(gain); gain.connect(masterGain);
  noise.start(time); noise.stop(time + decay + 0.05);
}

function playBass(time, note, evo) {
  const m = mood();
  const osc = ctx.createOscillator();
  osc.type = evo >= 2 ? 'sawtooth' : 'square';
  const dur = (0.28 + evo * 0.04) * m.decayMult;
  osc.frequency.value = applyMoodPitch(note, m) + (Math.random() - 0.5) * 2;
  applyVibrato(osc, time, dur);
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
  filt.frequency.setValueAtTime((600 + evo * 250) * m.filterMult, time);
  filt.frequency.exponentialRampToValueAtTime(150, time + 0.25);
  filt.Q.value = 4 + (currentMood === 'spooky' ? 4 : 0);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.connect(filt); filt.connect(gain); gain.connect(masterGain);
  osc.start(time); osc.stop(time + 0.5);
}

function playMelody(time, note, evo) {
  const m = mood();
  const o1 = ctx.createOscillator(); const o2 = ctx.createOscillator();
  o1.type = 'triangle'; o2.type = evo >= 2 ? 'sawtooth' : 'triangle';
  const dur = (0.35 + evo * 0.1) * m.decayMult;
  const base = applyMoodPitch(note, m);
  o1.frequency.value = base;
  o2.frequency.value = base * (1 + (0.003 + evo * 0.002) * m.detuneMult);
  applyVibrato(o1, time, dur);
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
  filt.frequency.value = (2000 + evo * 800) * m.filterMult;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.18, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  o1.connect(filt); o2.connect(filt);
  filt.connect(gain); gain.connect(masterGain); gain.connect(delayNode);
  o1.start(time); o2.start(time); o1.stop(time + 0.6); o2.stop(time + 0.6);
}

function playPad(time, evo) {
  const m = mood();
  const chord = [130.81, 155.56, 196.00];
  if (evo >= 2) chord.push(233.08);
  if (currentMood === 'spooky') chord.push(146.83);
  chord.forEach(freq => {
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.value = freq * (1 + m.pitchShift) + (Math.random() - 0.5) * 1.5 * m.detuneMult;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
    filt.frequency.value = (350 + evo * 200) * m.filterMult; filt.Q.value = 1;
    const gain = ctx.createGain();
    const dur = 2.8 * m.decayMult;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.06 + evo * 0.01, time + 0.6);
    gain.gain.setValueAtTime(0.06 + evo * 0.01, time + dur * 0.6);
    gain.gain.linearRampToValueAtTime(0, time + dur);
    osc.connect(filt); filt.connect(gain);
    gain.connect(masterGain); gain.connect(delayNode);
    osc.start(time); osc.stop(time + dur + 0.1);
  });
}

function playFX(time, evo) {
  const m = mood();
  const modFreq = (80 + Math.random() * 400) * (1 + m.pitchShift);
  const ratio = 1 + Math.floor(Math.random() * 4);
  const modIndex = (60 + Math.random() * 200 + evo * 120) * (currentMood === 'wild' ? 1.5 : 1);
  const mod = ctx.createOscillator(); const modG = ctx.createGain();
  const carrier = ctx.createOscillator(); const cG = ctx.createGain();
  mod.frequency.value = modFreq; modG.gain.value = modIndex;
  carrier.frequency.value = modFreq * ratio;
  cG.gain.setValueAtTime(0.12, time);
  cG.gain.exponentialRampToValueAtTime(0.001, time + (0.25 + evo * 0.08) * m.decayMult);
  mod.connect(modG); modG.connect(carrier.frequency);
  carrier.connect(cG); cG.connect(masterGain); cG.connect(delayNode);
  mod.start(time); carrier.start(time);
  mod.stop(time + 0.5); carrier.stop(time + 0.5);
}

function playAmbient(time, evo) {
  const m = mood();
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer;
  const filt = ctx.createBiquadFilter(); filt.type = 'bandpass';
  const bf = (200 + Math.random() * 200) * (1 + m.pitchShift);
  filt.frequency.setValueAtTime(bf, time);
  filt.frequency.linearRampToValueAtTime(bf + (400 + evo * 300) * m.filterMult, time + 1.5);
  filt.frequency.linearRampToValueAtTime(bf, time + 3);
  filt.Q.value = (6 + evo * 2) * (currentMood === 'spooky' ? 1.5 : 1);
  const gain = ctx.createGain();
  const dur = 3.2 * m.decayMult;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.07 + evo * 0.02, time + 0.5);
  gain.gain.setValueAtTime(0.07 + evo * 0.02, time + dur * 0.7);
  gain.gain.linearRampToValueAtTime(0, time + dur);
  noise.connect(filt); filt.connect(gain); gain.connect(masterGain);
  noise.start(time); noise.stop(time + dur + 0.3);
}

function playClap(time, evo) {
  const m = mood();
  const layers = 3 + evo;
  for (let i = 0; i < layers; i++) {
    const t = time + i * 0.008;
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer;
    noise.playbackRate.value = 1.2 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = (1500 + Math.random() * 800) * m.filterMult; bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (0.08 + evo * 0.02) * m.decayMult);
    noise.connect(bp); bp.connect(g); g.connect(masterGain);
    noise.start(t); noise.stop(t + 0.2);
  }
}

function playArp(time, note, evo) {
  const m = mood();
  const scaleNotes = [261.63, 311.13, 349.23, 392.00, 466.16, 523.25];
  const si = Math.floor(Math.random() * 3);
  const nc = 3 + Math.min(evo, 2);
  const sp = currentMood === 'wild' ? 0.04 : 0.06;
  for (let i = 0; i < nc; i++) {
    const t = time + i * sp;
    const noteDur = 0.12 * m.decayMult;
    const freq = applyMoodPitch(scaleNotes[(si + i) % scaleNotes.length], m);
    const osc = ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.value = freq;
    applyVibrato(osc, t, noteDur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + noteDur);
    osc.connect(g); g.connect(masterGain); g.connect(delayNode);
    osc.start(t); osc.stop(t + 0.2);
  }
}

function playVocal(time, evo) {
  const m = mood();
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer;
  const formants = currentMood === 'spooky' ?
    [{f:300,q:12},{f:900,q:10},{f:2300,q:8}] :
    currentMood === 'wild' ?
    [{f:700,q:14},{f:1200,q:10},{f:2600,q:6}] :
    [{f:400,q:12},{f:1000,q:10},{f:2500,q:8}];
  const mix = ctx.createGain(); mix.gain.value = 0;
  mix.gain.linearRampToValueAtTime(0.15 + evo * 0.03, time + 0.05);
  const dur = (0.4 + evo * 0.1) * m.decayMult;
  mix.gain.setValueAtTime(0.15 + evo * 0.03, time + dur * 0.5);
  mix.gain.linearRampToValueAtTime(0, time + dur);
  formants.forEach(f => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = f.f * (1 + m.pitchShift + (Math.random() - 0.5) * 0.1);
    bp.Q.value = f.q;
    noise.connect(bp); bp.connect(mix);
  });
  mix.connect(masterGain); mix.connect(delayNode);
  noise.start(time); noise.stop(time + dur + 0.2);
}

function playSub(time, note, evo) {
  const m = mood();
  const osc = ctx.createOscillator(); osc.type = 'sine';
  const dur = 2.5 * m.decayMult;
  osc.frequency.value = applyMoodPitch(note, m);
  applyVibrato(osc, time, dur);
  const lfo = ctx.createOscillator(); const lfoG = ctx.createGain();
  lfo.frequency.value = 0.5 + evo * 0.3; lfoG.gain.value = note * 0.04 * m.detuneMult;
  lfo.connect(lfoG); lfoG.connect(osc.frequency);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.28 + evo * 0.04, time + 0.2);
  gain.gain.setValueAtTime(0.28 + evo * 0.04, time + dur * 0.6);
  gain.gain.linearRampToValueAtTime(0, time + dur);
  osc.connect(gain); gain.connect(masterGain);
  osc.start(time); lfo.start(time);
  osc.stop(time + dur + 0.1); lfo.stop(time + dur + 0.1);
}

// ── Phase 3 Synths ──

function playPluck(time, note, evo) {
  const m = mood();
  const osc = ctx.createOscillator(); osc.type = 'triangle';
  const dur = (0.45 + evo * 0.18) * m.decayMult;
  const freq = applyMoodPitch(note, m);
  osc.frequency.setValueAtTime(freq * 1.015, time);
  osc.frequency.exponentialRampToValueAtTime(freq, time + 0.04);
  applyVibrato(osc, time, dur);
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
  filt.frequency.setValueAtTime(9000, time);
  filt.frequency.exponentialRampToValueAtTime(1400 + evo * 350, time + 0.12);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.22 + evo * 0.04, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.connect(filt); filt.connect(gain);
  gain.connect(masterGain); gain.connect(delayNode);
  osc.start(time); osc.stop(time + 1.0);
  if (evo >= 2) {
    // add a detuned upper partial
    const o2 = ctx.createOscillator(); o2.type = 'sine';
    o2.frequency.value = freq * 2.01;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.07, time);
    g2.gain.exponentialRampToValueAtTime(0.001, time + 0.25 * m.decayMult);
    o2.connect(g2); g2.connect(masterGain);
    o2.start(time); o2.stop(time + 0.4);
  }
}

function playChord(time, evo) {
  const m = mood();
  // Cm chord stab: root, minor third, fifth, (minor seventh at evo 2+)
  const freqs = [261.63, 311.13, 392.00];
  if (evo >= 2) freqs.push(466.16);
  if (currentMood === 'spooky') freqs.push(220.00); // add lower octave
  freqs.forEach(freq => {
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const dur = (0.24 + evo * 0.06) * m.decayMult;
    osc.frequency.value = applyMoodPitch(freq, m) + (Math.random() - 0.5) * 2 * m.detuneMult;
    applyVibrato(osc, time, dur);
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
    filt.frequency.setValueAtTime((2200 + evo * 400) * m.filterMult, time);
    filt.frequency.exponentialRampToValueAtTime(600, time + 0.18);
    filt.Q.value = 2.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.09, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(filt); filt.connect(gain); gain.connect(masterGain);
    osc.start(time); osc.stop(time + 0.5);
  });
}

function playGrowl(time, note, evo) {
  const m = mood();
  const osc = ctx.createOscillator(); osc.type = 'sawtooth';
  const dur = (1.8 + evo * 0.35) * m.decayMult;
  osc.frequency.value = applyMoodPitch(note, m);
  applyVibrato(osc, time, dur);
  // Waveshaper distortion
  const ws = ctx.createWaveShaper();
  const drive = 25 + evo * 18;
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2 / 256) - 1;
    curve[i] = (Math.PI + drive) * x / (Math.PI + drive * Math.abs(x));
  }
  ws.curve = curve; ws.oversample = '2x';
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
  filt.frequency.value = (280 + evo * 140) * m.filterMult; filt.Q.value = 3.5;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.2 + evo * 0.03, time + 0.06);
  gain.gain.setValueAtTime(0.2 + evo * 0.03, time + dur * 0.5);
  gain.gain.linearRampToValueAtTime(0, time + dur);
  osc.connect(ws); ws.connect(filt); filt.connect(gain); gain.connect(masterGain);
  osc.start(time); osc.stop(time + dur + 0.15);
}

function playBell(time, note, evo) {
  const m = mood();
  const freq = applyMoodPitch(note, m);
  const dur = (2.2 + evo * 1.2) * m.decayMult;
  const carrier = ctx.createOscillator(); carrier.type = 'sine';
  carrier.frequency.value = freq;
  applyVibrato(carrier, time, dur);
  const modulator = ctx.createOscillator(); modulator.type = 'sine';
  modulator.frequency.value = freq * 7;
  const modGain = ctx.createGain();
  modGain.gain.value = freq * (2.5 + evo * 1.2) * m.detuneMult;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.18 + evo * 0.03, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  modulator.connect(modGain); modGain.connect(carrier.frequency);
  carrier.connect(gain); gain.connect(masterGain); gain.connect(delayNode);
  carrier.start(time); modulator.start(time);
  carrier.stop(time + dur + 0.2); modulator.stop(time + dur + 0.2);
}

export function playFusionSpark(time, evo) {
  // bright FM shimmer when both halves of a fusion hit the same step
  const m = mood();
  const base = 1318.51 * (1 + m.pitchShift);
  const carrier = ctx.createOscillator(); carrier.type = 'sine';
  carrier.frequency.setValueAtTime(base, time);
  carrier.frequency.exponentialRampToValueAtTime(base * 1.5, time + 0.09);
  const modOsc = ctx.createOscillator(); modOsc.type = 'sine';
  modOsc.frequency.value = base * 2.01;
  const mg = ctx.createGain(); mg.gain.value = 300 + evo * 150;
  modOsc.connect(mg); mg.connect(carrier.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.07 + evo * 0.015, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.3 * m.decayMult);
  carrier.connect(g); g.connect(masterGain); g.connect(delayNode);
  carrier.start(time); modOsc.start(time);
  carrier.stop(time + 0.5); modOsc.stop(time + 0.5);
}

export function playTotalityChord(time, evo) {
  // V7: all three parts of an eclipse strike the same step — totality.
  // Deep root + fifth + a detuned shimmer above, long wash. Rare by design.
  const m = mood();
  playFusionSpark(time, evo);
  const root = 65.41 * (1 + m.pitchShift); // deep C2
  [[1, 'sine', 0.09], [1.5, 'triangle', 0.055], [4.02, 'triangle', 0.03]].forEach(([ratio, type, amp], i) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(root * ratio, time);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(amp + evo * 0.01, time + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, time + (1.2 - i * 0.25) * m.decayMult);
    o.connect(g); g.connect(masterGain); g.connect(delayNode);
    if (reverbSend) g.connect(reverbSend);
    o.start(time); o.stop(time + 1.8);
  });
}

// ── Phase 4: anthem voices ──

function playHook(time, note, evo) {
  // bright sustained lead line, built to carry a melodic hook
  const m = mood();
  const dur = (0.5 + evo * 0.12) * m.decayMult;
  const base = applyMoodPitch(note, m);
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
  const o2 = ctx.createOscillator(); o2.type = evo >= 2 ? 'square' : 'sawtooth';
  o1.frequency.value = base;
  o2.frequency.value = base * 1.003;
  applyVibrato(o1, time, dur);
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
  filt.frequency.setValueAtTime((1200 + evo * 500) * m.filterMult, time);
  filt.frequency.exponentialRampToValueAtTime((2600 + evo * 900) * m.filterMult, time + 0.08);
  filt.Q.value = 2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.2 + evo * 0.02, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  o1.connect(filt); o2.connect(filt);
  filt.connect(gain); gain.connect(masterGain); gain.connect(delayNode);
  o1.start(time); o2.start(time); o1.stop(time + dur + 0.15); o2.stop(time + dur + 0.15);
}

function playStomp(time, evo) {
  // deep stadium stomp + clap layer — a driving anthem beat, not pitched
  const m = mood();
  const osc = ctx.createOscillator(); osc.type = 'triangle';
  osc.frequency.setValueAtTime(110 + evo * 12, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.14);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.55, time);
  og.gain.exponentialRampToValueAtTime(0.001, time + (0.32 + evo * 0.05) * m.decayMult);
  osc.connect(og); og.connect(masterGain);
  osc.start(time); osc.stop(time + 0.5);

  const layers = 2 + Math.floor(evo / 2);
  for (let i = 0; i < layers; i++) {
    const t = time + i * 0.01;
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer;
    noise.playbackRate.value = 1 + Math.random() * 0.25;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = (1200 + Math.random() * 600) * m.filterMult; bp.Q.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (0.1 + evo * 0.015) * m.decayMult);
    noise.connect(bp); bp.connect(g); g.connect(masterGain);
    noise.start(t); noise.stop(t + 0.25);
  }
}

export function playSoundForCharacter(char, step, time, evo) {
  const pattern = char.currentPattern;
  if (!pattern[step]) return false;
  const note = char.notes ? char.notes[step % char.notes.length] : 261.63;
  switch (char.role) {
    case 'kick':    playKick(time, evo); break;
    case 'snare':   playSnare(time, evo); break;
    case 'hihat':   playHihat(time, evo); break;
    case 'bass':    playBass(time, note, evo); break;
    case 'melody':  playMelody(time, note, evo); break;
    case 'pad':     playPad(time, evo); break;
    case 'fx':      playFX(time, evo); break;
    case 'ambient': playAmbient(time, evo); break;
    case 'clap':    playClap(time, evo); break;
    case 'arp':     playArp(time, note, evo); break;
    case 'vocal':   playVocal(time, evo); break;
    case 'sub':     playSub(time, note, evo); break;
    case 'pluck':   playPluck(time, note, evo); break;
    case 'chord':   playChord(time, evo); break;
    case 'growl':   playGrowl(time, note, evo); break;
    case 'bell':    playBell(time, note, evo); break;
    case 'lead':    playHook(time, note, evo); break;
    case 'stomp':   playStomp(time, evo); break;
    default: break;
  }
  return true;
}

// ===================================================================
// MOOD + FX CONTROLS
// ===================================================================
export function setMood(m) {
  currentMood = m;
  document.querySelectorAll('.mood-btn').forEach(btn => btn.classList.toggle('active-mood', btn.dataset.mood === m));
  if (delayNode) {
    delayFeedback.gain.value = MOODS[m].delayFeedback;
    delayWet.gain.value = MOODS[m].reverbWet * 0.4; // scale to not overwhelm
  }
}
export function cycleMood() {
  const moods = Object.keys(MOODS);
  setMood(moods[(moods.indexOf(currentMood) + 1) % moods.length]);
}

export function setReverb(val) {
  if (reverbSend) reverbSend.gain.linearRampToValueAtTime(val / 200, ctx.currentTime + 0.05);
}

export function toggleLofi() {
  lofiActive = !lofiActive;
  if (lofiFilter) {
    lofiFilter.frequency.linearRampToValueAtTime(lofiActive ? 3800 : 22050, ctx.currentTime + 0.08);
  }
  document.getElementById('btn-lofi').classList.toggle('lofi-active', lofiActive);
}
