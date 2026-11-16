import { initAudio, cycleMood, toggleLofi, setReverb } from './audio.js';
import {
  decodeState, shufflePatterns, clearStage,
} from './state.js';
import { togglePlayback, toggleSequencer } from './sequencer.js';
import { connectMidi, setupMidiOut } from './midi.js';
import { setupEcho, playPad } from './echo.js';
import {
  createStars, renderStepDisplay, renderStage, renderCharacterBar,
  renderCatalystBar, setupControls, setupTouchDrag, closeLoreCard, exitSelectMode,
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
  document.getElementById('btn-midi').addEventListener('click', connectMidi);
  setupMidiOut();
  setupEcho();

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
    if (/^Digit[1-8]$/.test(e.code) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) playPad(+e.code.slice(5) - 1);
    if (e.code === 'Escape') { closeLoreCard(); exitSelectMode(); }
  });
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
