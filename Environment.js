/**
 * Environment.js — time of day, weather and season as plain data, plus composeEnvironment(), a pure function that
 * turns a {time, weather, season} choice into everything the renderer needs (sky colours, fog, light colours and
 * strengths, ground type, tree colours, rain/snow, headlights). No Three.js here, so it is unit-testable in Node.
 *
 *   time     sets the sky gradient, sun/moon position, light colour + strength, stars, headlights
 *   weather  greys the sky out, thickens the fog, dims the sun, adds rain / snow, wets or whitens the road
 *   season   picks the grass texture and the tree colours (winter = snow-covered)
 *
 * The default (sunset · clear · summer) reproduces the look the game always had.
 */

export const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const luminance = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

// ───────────────────────────── time of day ─────────────────────────────
// sunDir: direction from the viewer to the sun/moon in the sky (the car drives toward −z).
export const TIMES = {
  morning: {
    label: 'Early morning', icon: '🌄',
    sky: { horizon: [1.0, 0.78, 0.62], mid: [0.80, 0.68, 0.74], zenith: [0.34, 0.46, 0.74] },
    sunDir: [0.55, 0.07, -1], glow: [1.0, 0.78, 0.55], glowK: 0.5, disc: [1.0, 0.95, 0.85],
    hemiSky: 0xdbe2f0, hemiGround: 0x4a5a3c, hemi: 1.15, sunColor: 0xffd0a0, sunI: 1.5, lightPos: [30, 10, -25],
    mountains: [0x6d6385, 0x806a7d], stars: 0, headlights: 0.15,
  },
  afternoon: {
    label: 'Afternoon', icon: '☀️',
    sky: { horizon: [0.78, 0.88, 0.98], mid: [0.50, 0.70, 0.95], zenith: [0.15, 0.38, 0.82] },
    sunDir: [-0.25, 0.62, -0.75], glow: [1.0, 0.95, 0.8], glowK: 0.25, disc: [1.0, 0.98, 0.9],
    hemiSky: 0xcfe6ff, hemiGround: 0x4d5d33, hemi: 1.55, sunColor: 0xfff2dc, sunI: 2.6, lightPos: [-20, 45, -25],
    mountains: [0x6f7f9c, 0x7f8ba3], stars: 0, headlights: 0,
  },
  sunset: {                                    // the original look of the game
    label: 'Sunset', icon: '🌇',
    sky: { horizon: [1.0, 0.66, 0.42], mid: [0.86, 0.42, 0.38], zenith: [0.10, 0.15, 0.40] },
    sunDir: [0.32, 0.17, -1], glow: [1.0, 0.72, 0.40], glowK: 0.55, disc: [1.0, 0.96, 0.85],
    hemiSky: 0xffd9b0, hemiGround: 0x3a4a2a, hemi: 1.3, sunColor: 0xffb98a, sunI: 1.8, lightPos: [-30, 18, -20],
    mountains: [0x5b3f63, 0x7a4a5a], stars: 0, headlights: 0,
  },
  evening: {                                   // dusk: the sun is just gone, sky turns purple-blue
    label: 'Evening', icon: '🌆',
    sky: { horizon: [0.85, 0.50, 0.50], mid: [0.45, 0.32, 0.52], zenith: [0.10, 0.12, 0.32] },
    sunDir: [-0.3, -0.05, -1], glow: [0.95, 0.5, 0.45], glowK: 0.4, disc: [0.0, 0.0, 0.0],
    hemiSky: 0x9aa0d0, hemiGround: 0x2c3a28, hemi: 0.85, sunColor: 0xc08a9a, sunI: 0.7, lightPos: [-30, 6, -25],
    mountains: [0x3b3052, 0x4a3858], stars: 0.25, headlights: 0.55,
  },
  night: {
    label: 'Night', icon: '🌙',
    sky: { horizon: [0.06, 0.09, 0.17], mid: [0.04, 0.06, 0.14], zenith: [0.01, 0.02, 0.07] },
    sunDir: [-0.35, 0.42, -1], glow: [0.45, 0.55, 0.9], glowK: 0.18, disc: [0.85, 0.9, 1.0],
    hemiSky: 0x2b3a6a, hemiGround: 0x0b0f18, hemi: 0.65, sunColor: 0x9db4ff, sunI: 0.5, lightPos: [-25, 35, -30],
    mountains: [0x151a2c, 0x1b2136], stars: 1, headlights: 1,
  },
};

// ───────────────────────────── weather ─────────────────────────────
//   overcast 0..1  how much the sky greys out        flat 0..1   how much the sky gradient collapses to one colour
//   dim            brightness of the grey sky        sunK/hemiK  light strength multipliers
//   fogNear/Far    metres                            mountainFog how much distant mountains melt into the fog
export const WEATHERS = {
  clear:  { label: 'Clear',  icon: '☀️', overcast: 0,    flat: 0,    dim: 1,    sunK: 1,    hemiK: 1,    fogNear: 140, fogFar: 720, mountainFog: 0,    precip: 'none', headlightBoost: 0 },
  cloudy: { label: 'Cloudy', icon: '⛅', overcast: 0.6,  flat: 0.15, dim: 0.9,  sunK: 0.45, hemiK: 0.95, fogNear: 110, fogFar: 640, mountainFog: 0.25, precip: 'none', headlightBoost: 0.1 },
  rain:   { label: 'Rain',   icon: '🌧️', overcast: 0.85, flat: 0.3,  dim: 0.62, sunK: 0.2,  hemiK: 0.8,  fogNear: 40,  fogFar: 420, mountainFog: 0.6,  precip: 'rain', headlightBoost: 0.35 },
  fog:    { label: 'Fog',    icon: '🌫️', overcast: 1,    flat: 0.9,  dim: 0.85, sunK: 0.12, hemiK: 0.9,  fogNear: 6,   fogFar: 160, mountainFog: 0.95, precip: 'none', headlightBoost: 0.5 },
  snow:   { label: 'Snow',   icon: '❄️', overcast: 0.8,  flat: 0.5,  dim: 0.95, sunK: 0.25, hemiK: 0.95, fogNear: 25,  fogFar: 320, mountainFog: 0.75, precip: 'snow', headlightBoost: 0.3 },
};

// ───────────────────────────── season ─────────────────────────────
// leaf: HSL ranges for the trees; frost = how much snow sits on them (0..1)
export const SEASONS = {
  spring: { label: 'Spring', icon: '🌸', ground: 'spring', leaf: { h: [0.22, 0.30], s: [0.50, 0.65], l: [0.35, 0.48] }, frost: 0,    snow: 0 },
  summer: { label: 'Summer', icon: '🌞', ground: 'summer', leaf: { h: [0.24, 0.32], s: [0.38, 0.58], l: [0.20, 0.30] }, frost: 0,    snow: 0 },
  autumn: { label: 'Autumn', icon: '🍂', ground: 'autumn', leaf: { h: [0.02, 0.14], s: [0.62, 0.80], l: [0.32, 0.45] }, frost: 0,    snow: 0 },
  winter: { label: 'Winter', icon: '⛄', ground: 'snow',   leaf: { h: [0.24, 0.32], s: [0.38, 0.58], l: [0.20, 0.30] }, frost: 0.8,  snow: 0.6 },
};

export const DEFAULT_ENV = { time: 'sunset', weather: 'clear', season: 'summer' };

/**
 * @param {{time:string, weather:string, season:string}} env
 * @returns a plain description of the look (arrays of 0..1 floats for colours) — see World.setEnvironment().
 */
export function composeEnvironment(env = DEFAULT_ENV) {
  const time = TIMES[env.time] ? env.time : DEFAULT_ENV.time;
  const weather = WEATHERS[env.weather] ? env.weather : DEFAULT_ENV.weather;
  const season = SEASONS[env.season] ? env.season : DEFAULT_ENV.season;
  const T = TIMES[time], W = WEATHERS[weather], S = SEASONS[season];

  const grey = (c, amt, dim) => { const g = luminance(c) * dim; return mix(c, [g, g, g], amt); };
  const horizon = grey(T.sky.horizon, W.overcast, W.dim);
  const mid = mix(grey(T.sky.mid, W.overcast, W.dim), horizon, W.flat);
  const zenith = mix(grey(T.sky.zenith, W.overcast, W.dim), horizon, W.flat);
  const sunVis = 1 - W.overcast;

  const fogColor = horizon;
  const light = clamp(luminance(fogColor) * 1.2, 0.12, 1);          // how bright the scene is (for snow glow, flakes)
  const hemiSky = rgb(T.hemiSky), sunColor = rgb(T.sunColor);

  // snow cover: falling snow or winter whitens the ground; winter alone only dusts the road
  const snowAmount = weather === 'snow' ? 1 : S.snow;
  const wet = weather === 'rain' ? 1 : 0;
  const roadTint = mix([1, 1, 1], [0.62, 0.65, 0.7], wet);
  const roadGlow = snowAmount * 0.22 * light;
  const frost = Math.max(S.frost, weather === 'snow' ? 0.6 : 0);

  const white = [1, 1, 1];
  const precipBase = mix(fogColor, white, weather === 'snow' ? 0.55 : 0.3);
  const k = 0.45 + 0.55 * clamp(luminance(fogColor) * 2, 0, 1);

  return {
    time, weather, season,
    sky: {
      horizon, mid, zenith, sunVis,
      glow: T.glow, glowK: T.glowK, disc: T.disc,
      stars: T.stars * (1 - W.overcast),
      sunDir: T.sunDir,
    },
    fog: { color: fogColor, near: W.fogNear, far: W.fogFar },
    hemi: { sky: mix(hemiSky, grey(hemiSky, 1, 1), W.overcast * 0.5), ground: rgb(T.hemiGround), intensity: T.hemi * W.hemiK },
    sun: { color: mix(sunColor, grey(sunColor, 1, 1), W.overcast * 0.6), intensity: T.sunI * W.sunK, pos: T.lightPos },
    mountains: T.mountains.map((h) => mix(rgb(h), fogColor, W.mountainFog)),
    ground: weather === 'snow' ? 'snow' : S.ground,
    road: { tint: roadTint, emissive: [roadGlow, roadGlow, roadGlow * 1.04], wet },
    shoulder: mix(rgb(0x7a6b58), [0.88, 0.9, 0.93], snowAmount),
    leaf: { ...S.leaf, frost },
    precip: { type: W.precip, density: W.precip === 'none' ? 0 : 1, color: precipBase.map((v) => v * k) },
    headlights: clamp(T.headlights + W.headlightBoost, 0, 1),
  };
}
