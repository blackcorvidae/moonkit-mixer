import { CATALYSTS, CHARACTERS } from './data.js';
import { makeSprite } from './sprites.js';
import {
  stageSlots, getEvoLevel, isOnStage, unfuse, removeFromStage, fuseIntoSlot,
  addToStage, activeCatalyst, activateCatalyst, deactivateCatalyst, STAGE_SIZE,
  shufflePatterns, clearStage, copyShareLink, showToast,
} from './state.js';
import {
  STEPS, isPlaying, startPlayback, togglePlayback, toggleSequencer, setTempo,
} from './sequencer.js';
import { masterGain, delayNode, setReverb, toggleLofi, setMood, setVibratoDepth } from './audio.js';

// ===================================================================
// UI RENDERING — starfield + stage
// ===================================================================
export function createStars() {
  const c = document.getElementById('starfield');
  for (let i = 0; i < 90; i++) {
    const s = document.createElement('div'); s.className = 'star';
    const sz = 1 + Math.random() * 2;
    s.style.width = sz + 'px'; s.style.height = sz + 'px';
    s.style.left = Math.random() * 100 + '%';
    s.style.top = Math.random() * 100 + '%';
    s.style.setProperty('--dur', (2 + Math.random() * 4) + 's');
    s.style.setProperty('--min-o', (0.1 + Math.random() * 0.3).toFixed(2));
    s.style.setProperty('--max-o', (0.5 + Math.random() * 0.5).toFixed(2));
    s.style.animationDelay = (Math.random() * 4) + 's';
    c.appendChild(s);
  }
}

export function renderStage() {
  const stage = document.getElementById('stage');
  stage.innerHTML = '';
  for (let i = 0; i < STAGE_SIZE; i++) {
    const slot = document.createElement('div');
    slot.className = 'stage-slot';
    slot.dataset.slotIndex = i;

    if (stageSlots[i]) {
      const char = stageSlots[i];
      const evo = getEvoLevel(char.id);
      slot.classList.add('occupied');
      if (char.fusion) slot.classList.add('fused');
      if (char.fusion && char.parts.length >= 3) slot.classList.add('eclipse');
      if (evo > 0) slot.classList.add('evo-' + evo);
      slot.style.borderColor = char.color;
      slot.style.setProperty('--char-color', char.color);
      slot.style.background = `radial-gradient(circle at center, ${char.color}15, transparent)`;

      const charEl = document.createElement('div');
      charEl.className = 'stage-character';
      charEl.style.setProperty('--char-color', char.color);

      const avatar = document.createElement('div');
      avatar.className = 'char-avatar';
      avatar.style.background = char.bg;
      avatar.style.boxShadow = `0 0 ${12 + evo * 6}px ${char.color}${40 + evo * 15}`;
      avatar.appendChild(makeSprite(char, evo, 48));
      const evoRing = document.createElement('div');
      evoRing.className = 'evo-ring';
      avatar.appendChild(evoRing);

      const nameEl = document.createElement('div');
      nameEl.className = 'char-name';
      if (char.fusion) {
        nameEl.classList.add('fusion-name');
        nameEl.style.backgroundImage = `linear-gradient(90deg, ${char.parts.map(p => p.color).join(', ')})`;
      } else {
        nameEl.style.color = char.color;
      }
      nameEl.textContent = char.name;

      const roleEl = document.createElement('div');
      roleEl.className = 'char-role';
      roleEl.textContent = char.roleLabel;

      charEl.appendChild(avatar);
      charEl.appendChild(nameEl);
      charEl.appendChild(roleEl);

      if (evo >= 3) {
        for (let s = 0; s < 4; s++) {
          const sp = document.createElement('div');
          sp.className = 'evo-sparkle';
          const sz = 3 + Math.random() * 3;
          sp.style.cssText = `width:${sz}px;height:${sz}px;top:${Math.random()*70}%;left:${Math.random()*80+5}%;animation-delay:${s*0.5}s;`;
          charEl.appendChild(sp);
        }
      }

      slot.appendChild(charEl);
      slot.addEventListener('click', () => {
        if (selectedChar !== null) { fuseIntoSlot(selectedChar, i); exitSelectMode(); }
        else char.fusion ? unfuse(i) : removeFromStage(i);
      });
    } else {
      slot.innerHTML = `<div class="slot-number">${i + 1}</div>`;
      slot.addEventListener('click', () => {
        if (selectedChar !== null) { addToStage(selectedChar, i); exitSelectMode(); }
      });
    }

    slot.addEventListener('dragover', e => {
      e.preventDefault();
      slot.classList.add(stageSlots[i] ? 'fuse-over' : 'drag-over');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over', 'fuse-over'));
    slot.addEventListener('drop', e => {
      e.preventDefault(); slot.classList.remove('drag-over', 'fuse-over');
      const charId = e.dataTransfer.getData('text/plain');
      if (!charId) return;
      if (stageSlots[i]) fuseIntoSlot(charId, i);
      else addToStage(charId, i);
    });
    stage.appendChild(slot);
  }
}

export function renderCharacterBar() {
  const bar = document.getElementById('character-bar');
  bar.innerHTML = '';
  CHARACTERS.forEach(char => {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.style.setProperty('--char-color', char.color);
    const onStage = isOnStage(char.id);
    if (onStage) card.classList.add('on-stage');
    card.draggable = true;
    card.dataset.charId = char.id;
    if (char.phase === 3) {
      const badge = document.createElement('div');
      badge.className = 'phase-badge';
      badge.textContent = 'P3';
      card.appendChild(badge);
    }
    const infoBtn = document.createElement('div');
    infoBtn.className = 'card-info';
    infoBtn.dataset.charId = char.id;
    infoBtn.textContent = '?';
    card.appendChild(infoBtn);

    const cardAvatar = document.createElement('div');
    cardAvatar.className = 'card-avatar';
    cardAvatar.style.background = char.bg;
    cardAvatar.style.boxShadow = `0 0 8px ${char.color}30`;
    cardAvatar.appendChild(makeSprite(char, 0, 32));
    card.appendChild(cardAvatar);

    const cardName = document.createElement('div');
    cardName.className = 'card-name';
    cardName.style.color = char.color;
    cardName.textContent = char.name;
    card.appendChild(cardName);

    const cardRole = document.createElement('div');
    cardRole.className = 'card-role';
    cardRole.textContent = char.roleLabel;
    card.appendChild(cardRole);

    card.addEventListener('pointerdown', e => {
      if (onStage) return;
      touchDragStart(e, char);
      startLongPress(e, char);
    });
    card.addEventListener('dragstart', e => {
      if (onStage || (touchDrag && touchDrag.active)) { e.preventDefault(); return; }
      cancelLongPress();
      e.dataTransfer.setData('text/plain', char.id);
      e.dataTransfer.effectAllowed = 'move';
      const ghost = document.getElementById('drag-ghost');
      const ghostAvatar = ghost.querySelector('.ghost-avatar');
      ghostAvatar.innerHTML = '';
      ghostAvatar.style.background = char.bg;
      ghostAvatar.style.boxShadow = `0 0 30px ${char.color}60`;
      ghostAvatar.appendChild(makeSprite(char, getEvoLevel(char.id), 56));
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(img, 0, 0);
      ghost.style.display = 'block';
      requestAnimationFrame(() => { ghost.style.left = e.clientX - 35 + 'px'; ghost.style.top = e.clientY - 35 + 'px'; });
    });
    card.addEventListener('drag', e => {
      if (e.clientX === 0 && e.clientY === 0) return;
      const ghost = document.getElementById('drag-ghost');
      ghost.style.left = e.clientX - 35 + 'px'; ghost.style.top = e.clientY - 35 + 'px';
    });
    card.addEventListener('dragend', () => {
      document.getElementById('drag-ghost').style.display = 'none';
      document.querySelectorAll('.drag-over').forEach(s => s.classList.remove('drag-over'));
    });
    card.addEventListener('click', e => {
      if (suppressNextCardClick) return;
      if (e.target.classList.contains('card-info')) return;
      if (onStage) return;
      if (char.id === selectedChar) { exitSelectMode(); return; }
      const emptySlot = stageSlots.indexOf(null);
      if (emptySlot !== -1) { addToStage(char.id, emptySlot); if (!isPlaying) startPlayback(); }
    });
    infoBtn.addEventListener('click', e => { e.stopPropagation(); openLoreCard(char); });
    bar.appendChild(card);
  });
}

let selectedChar = null;

// ===================================================================
// V6: TOUCH DRAG
// ===================================================================
let touchDrag = null;
let suppressNextCardClick = false;

function slotFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('.stage-slot') : null;
}

function clearSlotHighlights() {
  document.querySelectorAll('.drag-over, .fuse-over').forEach(s => s.classList.remove('drag-over', 'fuse-over'));
}

function touchDragStart(e, char) {
  if (e.pointerType === 'mouse') return; // mouse keeps native HTML5 drag
  touchDrag = {
    char, pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    active: false,
  };
}

function touchDragMove(e) {
  if (!touchDrag || e.pointerId !== touchDrag.pointerId) return;
  const ghost = document.getElementById('drag-ghost');
  if (!touchDrag.active) {
    // ignore micro-movement so plain taps still behave like clicks
    if (Math.hypot(e.clientX - touchDrag.startX, e.clientY - touchDrag.startY) < 8) return;
    cancelLongPress(); // real drag started — long-press-to-select no longer applies
    touchDrag.active = true;
    const ghostAvatar = ghost.querySelector('.ghost-avatar');
    ghostAvatar.innerHTML = '';
    ghostAvatar.style.background = touchDrag.char.bg;
    ghostAvatar.style.boxShadow = `0 0 30px ${touchDrag.char.color}60`;
    ghostAvatar.appendChild(makeSprite(touchDrag.char, 0, 56));
    ghost.style.display = 'block';
  }
  ghost.style.left = e.clientX - 35 + 'px';
  ghost.style.top = e.clientY - 70 + 'px'; // above the finger, not under it
  clearSlotHighlights();
  const slot = slotFromPoint(e.clientX, e.clientY);
  if (slot) slot.classList.add(stageSlots[parseInt(slot.dataset.slotIndex)] ? 'fuse-over' : 'drag-over');
}

function touchDragEnd(e) {
  if (!touchDrag || e.pointerId !== touchDrag.pointerId) return;
  const drag = touchDrag;
  touchDrag = null;
  if (!drag.active) return; // was a tap — let the click handler take it
  document.getElementById('drag-ghost').style.display = 'none';
  clearSlotHighlights();
  const slot = slotFromPoint(e.clientX, e.clientY);
  if (slot) {
    const i = parseInt(slot.dataset.slotIndex);
    if (stageSlots[i]) fuseIntoSlot(drag.char.id, i);
    else addToStage(drag.char.id, i);
  }
  // browsers may still synthesize a click on the card after the drag
  suppressNextCardClick = true;
  setTimeout(() => { suppressNextCardClick = false; }, 350);
}

function touchDragCancel(e) {
  if (!touchDrag || e.pointerId !== touchDrag.pointerId) return;
  touchDrag = null;
  document.getElementById('drag-ghost').style.display = 'none';
  clearSlotHighlights();
}

// ===================================================================
// V9: LONG-PRESS TO SELECT — a forgiving alternative to precise
// drag-to-fuse. Works for mouse and touch alike (unlike drag, which
// forks into native HTML5 DnD for mouse vs. the pointer-based path
// above for touch); mutually exclusive with both of those.
// ===================================================================
let longPress = null;

function startLongPress(e, char) {
  cancelLongPress();
  longPress = {
    char, startX: e.clientX, startY: e.clientY,
    timer: setTimeout(() => enterSelectMode(char), 450),
  };
}

function cancelLongPress() {
  if (longPress) clearTimeout(longPress.timer);
  longPress = null;
}

function longPressPointerMove(e) {
  if (!longPress) return;
  if (Math.hypot(e.clientX - longPress.startX, e.clientY - longPress.startY) > 8) cancelLongPress();
}

function enterSelectMode(char) {
  cancelLongPress();
  selectedChar = char.id;
  // a click still fires after the long-press releases — swallow it so it
  // doesn't also trigger the plain-tap instant-add-to-first-empty-slot path
  suppressNextCardClick = true;
  setTimeout(() => { suppressNextCardClick = false; }, 400);
  document.querySelectorAll('.char-card').forEach(c => c.classList.toggle('selected', c.dataset.charId === char.id));
  document.querySelectorAll('.stage-slot').forEach(s => s.classList.add('select-target'));
  showToast(`${char.name} selected — tap a slot to place, or an occupied one to fuse`);
}

export function exitSelectMode() {
  selectedChar = null;
  document.querySelectorAll('.char-card.selected').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.stage-slot.select-target').forEach(s => s.classList.remove('select-target'));
}

export function setupTouchDrag() {
  document.addEventListener('pointermove', touchDragMove, { passive: true });
  document.addEventListener('pointerup', touchDragEnd);
  document.addEventListener('pointercancel', touchDragCancel);
  document.addEventListener('pointermove', longPressPointerMove, { passive: true });
  document.addEventListener('pointerup', cancelLongPress);
  document.addEventListener('pointercancel', cancelLongPress);
  document.addEventListener('click', e => {
    if (selectedChar !== null && !e.target.closest('.char-card') && !e.target.closest('.stage-slot')) {
      exitSelectMode();
    }
  });
}


// ===================================================================
// CATALYST BAR + STEP DISPLAY
// ===================================================================
export function renderCatalystBar() {
  const bar = document.getElementById('catalyst-bar');
  bar.innerHTML = '';
  CATALYSTS.forEach(cat => {
    const card = document.createElement('div');
    card.className = 'catalyst-card' + (activeCatalyst?.id === cat.id ? ' active' : '');
    card.style.setProperty('--cat-color', cat.color);
    if (activeCatalyst?.id === cat.id) {
      card.style.borderColor = cat.color;
      card.style.background = `radial-gradient(circle at center, ${cat.color}18, rgba(20,5,40,0.6))`;
    }

    const avatar = document.createElement('div');
    avatar.className = 'cat-avatar';
    avatar.style.background = cat.bg;
    avatar.style.boxShadow = activeCatalyst?.id === cat.id ? `0 0 14px ${cat.color}80` : `0 0 6px ${cat.color}20`;
    avatar.appendChild(makeSprite(cat, 0, 32));

    const nameEl = document.createElement('div');
    nameEl.className = 'cat-name';
    nameEl.style.color = cat.color;
    nameEl.textContent = cat.name;

    const labelEl = document.createElement('div');
    labelEl.className = 'cat-label';
    labelEl.textContent = cat.effectLabel;

    const infoBtn = document.createElement('div');
    infoBtn.className = 'card-info';
    infoBtn.textContent = '?';
    infoBtn.addEventListener('click', e => { e.stopPropagation(); openCatalystLore(cat); });

    card.appendChild(infoBtn);
    card.appendChild(avatar);
    card.appendChild(nameEl);
    card.appendChild(labelEl);
    card.addEventListener('click', e => {
      if (e.target === infoBtn) return;
      activeCatalyst?.id === cat.id ? deactivateCatalyst() : activateCatalyst(cat);
    });
    bar.appendChild(card);
  });
}


export function renderStepDisplay() {
  const c = document.getElementById('step-display'); c.innerHTML = '';
  for (let i = 0; i < STEPS; i++) {
    const d = document.createElement('div');
    d.className = 'step-dot' + (i % 4 === 0 ? ' beat' : '');
    d.dataset.step = i; c.appendChild(d);
  }
}

export function updateStepDisplay(step) {
  document.querySelectorAll('.step-dot').forEach((d, i) => d.classList.toggle('active', i === step));
}

export function flashSlot(slotIdx) {
  const slot = document.querySelector(`.stage-slot[data-slot-index="${slotIdx}"]`);
  if (!slot) return;
  const sc = slot.querySelector('.stage-character');
  if (!sc) return;
  sc.classList.remove('beat-flash'); void sc.offsetWidth; sc.classList.add('beat-flash');
}

// ===================================================================
// LORE CARD
// ===================================================================
function openLoreCard(char) {
  const modal = document.getElementById('lore-modal');
  const card = modal.querySelector('.lore-card');
  const evo = getEvoLevel(char.id);
  card.style.setProperty('--lore-color', char.color);
  const loreAvatarEl = document.getElementById('lore-avatar');
  loreAvatarEl.innerHTML = '';
  loreAvatarEl.style.background = char.bg;
  loreAvatarEl.style.boxShadow = `0 0 30px ${char.color}50`;
  loreAvatarEl.appendChild(makeSprite(char, evo, 72));
  document.getElementById('lore-name').textContent = char.name;
  document.getElementById('lore-name').style.color = char.color;
  document.getElementById('lore-title').textContent = char.title + ' · ' + char.roleLabel + (char.phase === 3 ? ' · Phase 3' : '');
  document.getElementById('lore-origin').textContent = char.description;
  const evoC = document.getElementById('lore-evo'); evoC.innerHTML = '';
  if (char.evoStages) {
    char.evoStages.forEach((stage, i) => {
      const div = document.createElement('div');
      div.className = 'lore-evo-stage' + (i === evo ? ' current' : '');
      div.innerHTML = `<div class="evo-label">${i === 0 ? 'Base' : 'Evo ' + i}</div><div class="evo-desc">${stage}</div>`;
      evoC.appendChild(div);
    });
  }
  const relsC = document.getElementById('lore-rels'); relsC.innerHTML = '';
  if (char.allies) {
    char.allies.forEach(ally => {
      const ac = CHARACTERS.find(c => c.id === ally.id);
      if (!ac) return;
      const div = document.createElement('div');
      div.className = 'lore-rel';
      const relSprite = makeSprite(ac, 0, 20);
      relSprite.style.borderRadius = '4px';
      relSprite.style.verticalAlign = 'middle';
      relSprite.style.marginRight = '4px';
      div.appendChild(relSprite);
      div.appendChild(document.createTextNode(`${ac.name} — ${ally.reason}`));
      relsC.appendChild(div);
    });
  }
  modal.classList.add('open');
}
export function closeLoreCard() { document.getElementById('lore-modal').classList.remove('open'); }

function openCatalystLore(cat) {
  const modal = document.getElementById('lore-modal');
  const card = modal.querySelector('.lore-card');
  card.style.setProperty('--lore-color', cat.color);

  const loreAvatarEl = document.getElementById('lore-avatar');
  loreAvatarEl.innerHTML = '';
  loreAvatarEl.style.background = cat.bg;
  loreAvatarEl.style.boxShadow = `0 0 30px ${cat.color}50`;
  loreAvatarEl.appendChild(makeSprite(cat, 0, 72));

  document.getElementById('lore-name').textContent = cat.name;
  document.getElementById('lore-name').style.color = cat.color;
  document.getElementById('lore-title').textContent = cat.title + ' · CATALYST · ' + cat.effectLabel;
  document.getElementById('lore-origin').textContent = cat.description;

  const evoC = document.getElementById('lore-evo');
  evoC.innerHTML = '';
  const effectDiv = document.createElement('div');
  effectDiv.className = 'lore-evo-stage current';
  effectDiv.innerHTML = `<div class="evo-label">Effect</div><div class="evo-desc">${cat.effectLabel} — when active, transforms all creatures on stage</div>`;
  evoC.appendChild(effectDiv);

  document.getElementById('lore-rels').innerHTML = '<span style="font-size:0.7rem;color:var(--text-muted)">Affects all creatures on stage</span>';

  modal.classList.add('open');
}

// ===================================================================
// CONTROLS SETUP
// ===================================================================
export function setupControls() {
  document.getElementById('tempo').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    setTempo(v);
    document.getElementById('tempo-val').textContent = v;
    if (delayNode) delayNode.delayTime.value = (60.0 / v) * 0.75;
  });
  document.getElementById('volume').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    document.getElementById('volume-val').textContent = v;
    if (masterGain) masterGain.gain.value = v / 100;
  });
  document.getElementById('reverb').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    document.getElementById('reverb-val').textContent = v + '%';
    setReverb(v);
  });
  document.getElementById('vibrato').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    document.getElementById('vibrato-val').textContent = v + '%';
    setVibratoDepth(v / 100);
  });

  document.getElementById('btn-play').addEventListener('click', togglePlayback);
  document.getElementById('btn-shuffle').addEventListener('click', shufflePatterns);
  document.getElementById('btn-clear').addEventListener('click', clearStage);
  document.getElementById('btn-lofi').addEventListener('click', toggleLofi);
  document.getElementById('btn-seq').addEventListener('click', toggleSequencer);
  document.getElementById('btn-share').addEventListener('click', copyShareLink);

  document.querySelectorAll('.mood-btn').forEach(btn => btn.addEventListener('click', () => setMood(btn.dataset.mood)));
  document.getElementById('lore-close').addEventListener('click', closeLoreCard);
  document.getElementById('lore-modal').addEventListener('click', e => { if (e.target === document.getElementById('lore-modal')) closeLoreCard(); });
}
