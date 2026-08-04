import { stageSlots, evolution, getEvoLevel, findCharState, catalystTempoMult } from './state.js';
import { ctx, playSoundForCharacter, playTotalityChord, playFusionSpark } from './audio.js';
import { makeSprite } from './sprites.js';
import { flashSlot, updateStepDisplay, renderStage } from './ui.js';

// ===================================================================
// PATTERN MUTATION
// ===================================================================
function mutatePattern(charState) {
  const p = charState.currentPattern;
  const role = charState.role;
  const rate = ['kick','snare'].includes(role) ? 0.06 :
               ['pad','ambient','sub','growl','bell'].includes(role) ? 0.04 : 0.1;
  for (let i = 0; i < p.length; i++) {
    if (Math.random() < rate) p[i] = p[i] ? 0 : 1;
  }
  if (role === 'kick') p[0] = 1;
  if (role === 'snare') { p[4] = 1; p[12] = 1; }
}

// ===================================================================
// SEQUENCER ENGINE
// ===================================================================
export const STEPS = 16;
export let tempo = 105;
export let isPlaying = false;
let currentStep = 0;
let nextStepTime = 0;
let schedulerTimer = null;
const LOOK_AHEAD = 0.1;
const SCHEDULE_INTERVAL = 25;

export function setTempo(v) { tempo = v; }

function scheduleStep(step, time) {
  stageSlots.forEach((charState, slotIdx) => {
    if (!charState) return;
    const evo = getEvoLevel(charState.id);
    let played;
    if (charState.fusion) {
      const hits = charState.parts.map(p => playSoundForCharacter(p, step, time, evo));
      played = hits.some(Boolean);
      if (hits.every(Boolean) && charState.parts.length >= 3) playTotalityChord(time, evo);
      else if (hits.filter(Boolean).length >= 2) playFusionSpark(time, evo);
    } else {
      played = playSoundForCharacter(charState, step, time, evo);
    }
    if (played) {
      const d = (time - ctx.currentTime) * 1000;
      setTimeout(() => flashSlot(slotIdx), Math.max(0, d));
    }
  });
  const d = (time - ctx.currentTime) * 1000;
  setTimeout(() => {
    updateStepDisplay(step);
    updateSeqPlayhead(step);
  }, Math.max(0, d));

  if (step === 0) {
    stageSlots.forEach(charState => {
      if (!charState) return;
      if (!evolution[charState.id]) evolution[charState.id] = { bars: 0, level: 0 };
      evolution[charState.id].bars += charState.fusion ? charState.parts.length : 1; // fusions burn twice as bright, eclipses thrice
      const bars = evolution[charState.id].bars;
      const newLevel = bars >= 12 ? 3 : bars >= 6 ? 2 : bars >= 2 ? 1 : 0;
      if (newLevel !== evolution[charState.id].level) {
        evolution[charState.id].level = newLevel;
        renderStage();
      }
      const targets = charState.fusion ? charState.parts : [charState];
      targets.forEach(t => { mutatePattern(t); refreshSeqRow(t.id); });
    });
    document.getElementById('moon').classList.toggle('bright', stageSlots.filter(Boolean).length >= 5);
  }
}

function scheduler() {
  while (nextStepTime < ctx.currentTime + LOOK_AHEAD) {
    scheduleStep(currentStep, nextStepTime);
    nextStepTime += 60.0 / (tempo * catalystTempoMult) / 4;
    currentStep = (currentStep + 1) % STEPS;
  }
}

export function startPlayback() {
  if (isPlaying) return;
  if (ctx && ctx.state === 'suspended') ctx.resume();
  isPlaying = true;
  currentStep = 0;
  nextStepTime = ctx.currentTime + 0.05;
  schedulerTimer = setInterval(scheduler, SCHEDULE_INTERVAL);
  document.getElementById('btn-play').innerHTML = '&#9724; Stop';
  document.getElementById('btn-play').classList.add('active');
  document.body.classList.add('is-playing');
}

export function stopPlayback() {
  if (!isPlaying) return;
  isPlaying = false;
  clearInterval(schedulerTimer); schedulerTimer = null;
  currentStep = 0;
  document.getElementById('btn-play').innerHTML = '&#9654; Play';
  document.getElementById('btn-play').classList.remove('active');
  document.body.classList.remove('is-playing');
  document.querySelectorAll('.step-dot').forEach(d => d.classList.remove('active'));
  document.querySelectorAll('.seq-step.playing').forEach(el => el.classList.remove('playing'));
}

export function togglePlayback() { isPlaying ? stopPlayback() : startPlayback(); }

// ===================================================================
// STEP SEQUENCER UI
// ===================================================================
export let seqOpen = false;

export function toggleSequencer() {
  seqOpen = !seqOpen;
  document.getElementById('seq-panel').classList.toggle('open', seqOpen);
  document.getElementById('btn-seq').classList.toggle('seq-active', seqOpen);
  if (seqOpen) renderSequencer();
}

export function renderSequencer() {
  const rows = document.getElementById('seq-rows');
  const active = stageSlots.filter(Boolean);
  if (active.length === 0) {
    rows.innerHTML = '<div class="seq-empty">Add creatures to the stage to edit their patterns</div>';
    return;
  }
  rows.innerHTML = '';
  const entries = [];
  stageSlots.forEach((slotState) => {
    if (!slotState) return;
    if (slotState.fusion) {
      slotState.parts.forEach(p => entries.push({ cs: p, evo: getEvoLevel(slotState.id), fused: true }));
    } else {
      entries.push({ cs: slotState, evo: getEvoLevel(slotState.id), fused: false });
    }
  });
  entries.forEach(({ cs, evo, fused }) => {
    const row = document.createElement('div');
    row.className = 'seq-row';
    row.dataset.charId = cs.id;

    const label = document.createElement('div');
    label.className = 'seq-label';
    const seqSprite = makeSprite(cs, evo, 28);
    seqSprite.style.borderRadius = '4px';
    seqSprite.style.flexShrink = '0';
    const seqName = document.createElement('span');
    seqName.className = 'seq-char-name';
    seqName.style.color = cs.color;
    seqName.textContent = (fused ? '⚡' : '') + cs.name;
    label.appendChild(seqSprite);
    label.appendChild(seqName);

    const stepsDiv = document.createElement('div');
    stepsDiv.className = 'seq-steps';
    for (let i = 0; i < STEPS; i++) {
      const btn = document.createElement('button');
      btn.className = 'seq-step' + (cs.currentPattern[i] ? ' on' : '') + (i % 4 === 0 ? ' beat-mark' : '');
      btn.id = `seq-${cs.id}-${i}`;
      btn.dataset.charId = cs.id;
      btn.dataset.step = i;
      btn.style.setProperty('--step-color', cs.color);
      btn.addEventListener('click', () => toggleSeqStep(cs.id, i));
      stepsDiv.appendChild(btn);
    }
    row.appendChild(label);
    row.appendChild(stepsDiv);
    rows.appendChild(row);
  });
}

function toggleSeqStep(charId, stepIdx) {
  const cs = findCharState(charId);
  if (!cs) return;
  cs.currentPattern[stepIdx] = cs.currentPattern[stepIdx] ? 0 : 1;
  const btn = document.getElementById(`seq-${charId}-${stepIdx}`);
  if (btn) btn.classList.toggle('on', !!cs.currentPattern[stepIdx]);
}

function updateSeqPlayhead(step) {
  document.querySelectorAll('.seq-step.playing').forEach(el => el.classList.remove('playing'));
  document.querySelectorAll(`.seq-step[data-step="${step}"]`).forEach(el => el.classList.add('playing'));
}

function refreshSeqRow(charId) {
  const cs = findCharState(charId);
  if (!cs || !seqOpen) return;
  for (let i = 0; i < STEPS; i++) {
    const btn = document.getElementById(`seq-${charId}-${i}`);
    if (btn) btn.classList.toggle('on', !!cs.currentPattern[i]);
  }
}
