// ===================================================================
// V9: PROCEDURAL PATTERNS — a live "Chaos" dial (0 = sparse/minimal,
// 1 = dense/chaotic) driving shuffle and pattern drift, instead of
// picking randomly among each character's 4 fixed authored patterns.
// ===================================================================
export let chaosLevel = 0.4;
export function setChaos(v) { chaosLevel = v; }

// base = hit density at chaos 0, max = hit density at chaos 1.
// anchors are steps that mostly hold firm at low chaos and can drop
// out at high chaos, for roles that need a structural downbeat/backbeat.
const ROLE_PROFILE = {
  kick:    { base: 0.15, max: 0.5,  anchors: [0] },
  snare:   { base: 0.12, max: 0.45, anchors: [4, 12] },
  stomp:   { base: 0.15, max: 0.5,  anchors: [0, 8] },
  hihat:   { base: 0.35, max: 0.95 },
  clap:    { base: 0.15, max: 0.55 },
  arp:     { base: 0.2,  max: 0.7 },
  pluck:   { base: 0.15, max: 0.6 },
  lead:    { base: 0.15, max: 0.55 },
  melody:  { base: 0.15, max: 0.55 },
  bass:    { base: 0.12, max: 0.4 },
  fx:      { base: 0.08, max: 0.4 },
  bell:    { base: 0.08, max: 0.35 },
  chord:   { base: 0.08, max: 0.3 },
  growl:   { base: 0.08, max: 0.3 },
  vocal:   { base: 0.06, max: 0.25 },
  pad:     { base: 0.05, max: 0.2 },
  ambient: { base: 0.05, max: 0.2 },
  sub:     { base: 0.06, max: 0.25 },
};
const DEFAULT_PROFILE = { base: 0.15, max: 0.6 };

export function generatePattern(role, chaos = chaosLevel) {
  const profile = ROLE_PROFILE[role] || DEFAULT_PROFILE;
  const density = profile.base + (profile.max - profile.base) * chaos;
  const pattern = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) {
    // downbeats favored at low chaos; that bias fades out as chaos climbs
    const beatBias = i % 4 === 0 ? (1 - chaos * 0.5) : 1;
    if (Math.random() < density * beatBias) pattern[i] = 1;
  }
  (profile.anchors || []).forEach(step => {
    if (Math.random() < 1 - chaos * 0.6) pattern[step] = 1;
  });
  return pattern;
}
