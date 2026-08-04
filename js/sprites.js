import { SPRITES } from './data.js';

// ===================================================================
// PIXEL ART SPRITE RENDERING
// ===================================================================
function getSpritePalette(char) {
  const hex = char.color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const dark = `rgb(${Math.round(r*0.25)},${Math.round(g*0.25)},${Math.round(b*0.25)})`;
  const light = `rgb(${Math.min(255,Math.round(r+( 255-r)*0.45))},${Math.min(255,Math.round(g+(255-g)*0.45))},${Math.min(255,Math.round(b+(255-b)*0.45))})`;
  return ['transparent', dark, char.color, light, '#ffffff'];
}

function drawSprite(canvas, char, evo) {
  const rows = SPRITES[char.id];
  if (!rows) return;
  const size = canvas.width;
  const scale = Math.floor(size / 16);
  // Centroid centering: place the visual center-of-mass at canvas center
  let cx = 0, cy = 0, count = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (parseInt(rows[y][x]) > 0) { cx += x + 0.5; cy += y + 0.5; count++; }
    }
  }
  if (count === 0) return;
  cx /= count; cy /= count;
  const offsetX = Math.round(size / 2 - cx * scale);
  const offsetY = Math.round(size / 2 - cy * scale);
  const ctx2d = canvas.getContext('2d');
  ctx2d.clearRect(0, 0, size, size);
  const pal = getSpritePalette(char);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const idx = parseInt(rows[y][x]);
      if (idx === 0) continue;
      ctx2d.fillStyle = pal[idx];
      ctx2d.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
    }
  }
  if (evo >= 2) {
    ctx2d.fillStyle = `rgba(255,255,255,${0.08 + evo * 0.04})`;
    ctx2d.fillRect(0, 0, size, size);
  }
}

export function makeSprite(char, evo, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.style.imageRendering = 'pixelated';
  canvas.style.flexShrink = '0';
  if (char.fusion) {
    drawFusionSprite(canvas, char, size);
  } else {
    drawSprite(canvas, char, evo);
  }
  return canvas;
}

// ===================================================================
// V5: FUSION SYSTEM — visuals for fused creatures
// ===================================================================
function blendHex(c1, c2) {
  const p = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const [r1,g1,b1] = p(c1), [r2,g2,b2] = p(c2);
  const h = n => Math.round(n).toString(16).padStart(2,'0');
  return '#' + h((r1+r2)/2) + h((g1+g2)/2) + h((b1+b2)/2);
}

function fusionName(parts) {
  if (parts.length === 2) {
    const [a, b] = parts;
    return a.name.slice(0, Math.ceil(a.name.length / 2)) +
           b.name.slice(Math.floor(b.name.length / 2)).toLowerCase();
  }
  // V7: eclipse names weave a syllable from each of the three parents
  const [a, b, c] = parts;
  return a.name.slice(0, Math.ceil(a.name.length / 3) + 1) +
         b.name.slice(Math.floor(b.name.length / 3), Math.floor(2 * b.name.length / 3)).toLowerCase() +
         c.name.slice(Math.floor(2 * c.name.length / 3)).toLowerCase();
}

export function makeFusion(...parts) {
  return {
    fusion: true,
    tier: parts.length - 1, // 1 = fusion, 2 = eclipse
    id: 'fused-' + parts.map(p => p.id).join('--'),
    name: fusionName(parts),
    color: parts.map(p => p.color).reduce((a, c) => blendHex(a, c)),
    bg: `radial-gradient(circle at 35% 35%, #1a0a2e, #06000f)`,
    roleLabel: parts.map(p => p.roleLabel).join('+'),
    parts,
  };
}

function drawFusionSprite(canvas, fusion, size) {
  // one vertical stripe per part, glowing seams between them
  const parts = fusion.parts;
  const n = parts.length;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, size, size);
  let x = 0;
  parts.forEach((p, i) => {
    const w = i === n - 1 ? size - x : Math.floor(size / n);
    const c = document.createElement('canvas'); c.width = c.height = size;
    drawSprite(c, p, 0);
    g.drawImage(c, x, 0, w, size, x, 0, w, size);
    x += w;
  });
  g.fillStyle = 'rgba(255, 255, 255, 0.35)';
  for (let i = 1; i < n; i++) g.fillRect(Math.floor(size * i / n) - 1, 0, 2, size);
}
