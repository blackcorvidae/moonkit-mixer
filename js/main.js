import { initAudio, cycleMood, toggleLofi, setReverb } from './audio.js';
import {
  decodeState, shufflePatterns, clearStage,
} from './state.js';
import { togglePlayback, toggleSequencer } from './sequencer.js';
import {
  createStars, renderStepDisplay, renderStage, renderCharacterBar,
  renderCatalystBar, setupControls, setupTouchDrag, closeLoreCard,
} from './ui.js';

// ===================================================================
// INIT
// ===================================================================
function init() {
  createStars();
  renderStepDisplay();
  renderStage();
  renderCharacterBar();
  renderCatalystBar();
  setupControls();
  setupTouchDrag();

  document.getElementById('start-screen').addEventListener('click', () => {
    initAudio();
    document.getElementById('start-screen').classList.add('hidden');
    // Restore from URL after a tick (audio context needs to settle)
    setTimeout(decodeState, 80);
  });

  document.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
    if (e.code === 'KeyS') shufflePatterns();
    if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) clearStage();
    if (e.code === 'KeyM') cycleMood();
    if (e.code === 'KeyL') toggleLofi();
    if (e.code === 'KeyR') {
      const slider = document.getElementById('reverb');
      const next = (parseInt(slider.value) + 20) % 120;
      slider.value = next;
      document.getElementById('reverb-val').textContent = next + '%';
      setReverb(next);
    }
    if (e.code === 'KeyQ') toggleSequencer();
    if (e.code === 'Escape') closeLoreCard();
  });
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
