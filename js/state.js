import { CHARACTERS } from './data.js';
import { makeFusion } from './sprites.js';
import { currentMood, MOODS, ctx, masterGain, reverbSend, setMood } from './audio.js';
import { isPlaying, startPlayback, stopPlayback, seqOpen, renderSequencer, tempo, setTempo } from './sequencer.js';
import { renderStage, renderCharacterBar, renderCatalystBar } from './ui.js';
import { generatePattern } from './patterns.js';

// ===================================================================
// STAGE STATE
// ===================================================================
export const STAGE_SIZE = 12;
export const stageSlots = new Array(STAGE_SIZE).fill(null);
export const evolution = {};

export function getEvoLevel(charId) {
  return evolution[charId] ? evolution[charId].level : 0;
}

export function isOnStage(charId) {
  return stageSlots.some(s => s && (s.id === charId || (s.fusion && s.parts.some(p => p.id === charId))));
}

export function findCharState(charId) {
  for (const s of stageSlots) {
    if (!s) continue;
    if (s.id === charId) return s;
    if (s.fusion) {
      const p = s.parts.find(p => p.id === charId);
      if (p) return p;
    }
  }
  return null;
}

// ===================================================================
// V5: FUSION SYSTEM
// ===================================================================
export function fuseIntoSlot(charId, slotIdx, force = false) {
  const occupant = stageSlots[slotIdx];
  const charDef = CHARACTERS.find(c => c.id === charId);
  if (!occupant || !charDef || isOnStage(charId)) return;
  if (occupant.fusion && occupant.parts.length >= 3) {
    showToast('🚫 Nothing outshines a total eclipse — click it to let one slip out first');
    return;
  }
  // V7: a fusion must burn to evo ★★ before it can swallow a third
  if (occupant.fusion && !force && getEvoLevel(occupant.id) < 2) {
    showToast(`🌘 ${occupant.name} isn't burning bright enough yet — let it evolve to ★★ before it can eclipse a third`);
    return;
  }
  const pi = Math.floor(Math.random() * charDef.patterns.length);
  const newPart = { ...charDef, currentPattern: [...charDef.patterns[pi]], patternIndex: pi };
  const fusion = occupant.fusion ? makeFusion(...occupant.parts, newPart) : makeFusion(occupant, newPart);
  delete evolution[occupant.id];
  stageSlots[slotIdx] = fusion;
  evolution[fusion.id] = { bars: 0, level: 0 };
  renderStage();
  renderCharacterBar();
  if (seqOpen) renderSequencer();
  showToast(fusion.tier >= 2
    ? `🌑 TOTAL ECLIPSE — ${newPart.name} slid in front of ${occupant.name}: behold ${fusion.name}!`
    : `⚡ ${occupant.name} + ${newPart.name} fused into ${fusion.name}!`);
  if (!isPlaying) startPlayback();
}

export function unfuse(slotIdx) {
  const f = stageSlots[slotIdx];
  if (!f || !f.fusion) return;
  delete evolution[f.id];
  if (f.parts.length > 2) {
    // V7: eclipses wane one layer at a time — peel the newest part off
    const peeled = f.parts[f.parts.length - 1];
    const rest = makeFusion(...f.parts.slice(0, -1));
    stageSlots[slotIdx] = rest;
    evolution[rest.id] = { bars: 0, level: 0 };
    const empty = stageSlots.indexOf(null);
    if (empty !== -1) {
      stageSlots[empty] = peeled;
      evolution[peeled.id] = { bars: 0, level: 0 };
      showToast(`🌒 the eclipse waned — ${peeled.name} slipped out, ${rest.name} remains`);
    } else {
      showToast(`🌒 the eclipse waned — no room left, ${peeled.name} wandered off`);
    }
  } else {
    const [a, b] = f.parts;
    stageSlots[slotIdx] = a;
    evolution[a.id] = { bars: 0, level: 0 };
    const empty = stageSlots.indexOf(null);
    if (empty !== -1) {
      stageSlots[empty] = b;
      evolution[b.id] = { bars: 0, level: 0 };
      showToast(`💔 ${f.name} split back into ${a.name} + ${b.name}`);
    } else {
      showToast(`💔 ${f.name} split — no room left, ${b.name} wandered off`);
    }
  }
  renderStage();
  renderCharacterBar();
  if (seqOpen) renderSequencer();
}

// ===================================================================
// STAGE MANAGEMENT
// ===================================================================
export function addToStage(charId, slotIdx) {
  const charDef = CHARACTERS.find(c => c.id === charId);
  if (!charDef || isOnStage(charId) || stageSlots[slotIdx] !== null) return;
  const pi = Math.floor(Math.random() * charDef.patterns.length);
  stageSlots[slotIdx] = { ...charDef, currentPattern: [...charDef.patterns[pi]], patternIndex: pi };
  if (!evolution[charId]) evolution[charId] = { bars: 0, level: 0 };
  renderStage();
  renderCharacterBar();
  if (seqOpen) renderSequencer();
  if (!isPlaying && stageSlots.some(Boolean)) startPlayback();
}

export function removeFromStage(slotIdx) {
  const char = stageSlots[slotIdx];
  if (!char) return;
  delete evolution[char.id];
  stageSlots[slotIdx] = null;
  renderStage();
  renderCharacterBar();
  if (seqOpen) renderSequencer();
  if (stageSlots.every(s => s === null) && isPlaying) stopPlayback();
}

export function shufflePatterns() {
  stageSlots.forEach(cs => {
    if (!cs) return;
    const targets = cs.fusion ? cs.parts : [cs];
    targets.forEach(t => {
      t.currentPattern = generatePattern(t.role);
    });
  });
  if (seqOpen) renderSequencer();
  const btn = document.getElementById('btn-shuffle');
  btn.style.background = 'rgba(177, 78, 255, 0.5)';
  setTimeout(() => btn.style.background = '', 300);
}

export function clearStage() {
  for (let i = 0; i < STAGE_SIZE; i++) stageSlots[i] = null;
  Object.keys(evolution).forEach(k => delete evolution[k]);
  stopPlayback(); renderStage(); renderCharacterBar();
  if (seqOpen) renderSequencer();
}

// ===================================================================
// CATALYST SYSTEM
// ===================================================================
export let activeCatalyst = null;
export let catalystTempoMult = 1;

export function activateCatalyst(cat) {
  const wasWild = activeCatalyst?.moodMods?.tempoMult > 1;
  activeCatalyst = cat;
  catalystTempoMult = cat.moodMods.tempoMult ?? 1;

  document.getElementById('app').className = cat.cssClass;

  const banner = document.getElementById('catalyst-active-banner');
  banner.textContent = `✦ ${cat.effectLabel} ✦`;
  banner.style.color = cat.color;
  banner.style.background = `${cat.color}18`;
  banner.style.border = `1px solid ${cat.color}40`;
  banner.classList.add('visible');

  const needsRestart = isPlaying && (cat.moodMods.tempoMult > 1 || wasWild);
  if (needsRestart) { stopPlayback(); startPlayback(); }

  if (reverbSend) reverbSend.gain.setTargetAtTime(0.25 + (cat.moodMods.reverbWetAdd ?? 0), ctx.currentTime, 0.5);

  renderCatalystBar();
  showToast(`${cat.name} activated — stage is now ${cat.effectLabel}!`);
}

export function deactivateCatalyst() {
  const wasWild = activeCatalyst?.moodMods?.tempoMult > 1;
  activeCatalyst = null;
  catalystTempoMult = 1;

  document.getElementById('app').className = '';

  document.getElementById('catalyst-active-banner').classList.remove('visible');

  if (isPlaying && wasWild) { stopPlayback(); startPlayback(); }
  if (reverbSend) reverbSend.gain.setTargetAtTime(0.25, ctx.currentTime, 0.5);

  renderCatalystBar();
  showToast('Catalyst removed — back to normal.');
}


// ===================================================================
// URL STATE — SHARE & RESTORE
// ===================================================================
function encodeState() {
  const parts = [];
  stageSlots.forEach((cs, i) => {
    if (!cs) return;
    parts.push(cs.fusion ? `${cs.parts.map(p => p.id).join('+')}:${i}` : `${cs.id}:${i}`);
  });
  const p = new URLSearchParams();
  if (parts.length) p.set('s', parts.join(','));
  p.set('t', tempo);
  p.set('v', Math.round((masterGain ? masterGain.gain.value : 0.75) * 100));
  p.set('m', currentMood);
  return '#' + p.toString();
}

export function decodeState() {
  if (!window.location.hash || window.location.hash.length < 2) return;
  try {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const s = p.get('s');
    if (s) {
      s.split(',').forEach(part => {
        const [cid, idx] = part.split(':');
        const slotIdx = parseInt(idx);
        if (cid.includes('+')) {
          const ids = cid.split('+');
          addToStage(ids[0], slotIdx);
          // force: restored eclipses skip the evo ★★ gate — they earned it last time
          ids.slice(1).forEach(id => fuseIntoSlot(id, slotIdx, true));
        } else {
          addToStage(cid, slotIdx);
        }
      });
    }
    const t = parseInt(p.get('t'));
    if (t >= 60 && t <= 160) {
      setTempo(t);
      const el = document.getElementById('tempo');
      if (el) { el.value = t; document.getElementById('tempo-val').textContent = t; }
    }
    const v = parseInt(p.get('v'));
    if (v >= 0 && v <= 100 && masterGain) {
      masterGain.gain.value = v / 100;
      const el = document.getElementById('volume');
      if (el) { el.value = v; document.getElementById('volume-val').textContent = v; }
    }
    const m = p.get('m');
    if (m && MOODS[m]) setMood(m);
    if (stageSlots.some(Boolean)) startPlayback();
  } catch(e) {}
}

export function copyShareLink() {
  const url = window.location.href.split('#')[0] + encodeState();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('🌙 Link copied!'));
  } else {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    showToast('🌙 Link copied!');
  }
}

export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}
