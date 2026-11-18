/**
 * Settings.js — the four things the player can change: vehicle, time of day, weather, season.
 * Pure data (no DOM, no Three.js). The settings panel and the start screen are both built from SETTING_GROUPS,
 * and the same small objects travel between the Player phone and the Viewer (see Link.js).
 */
import { VEHICLE_TYPES, VEHICLES, DEFAULT_VEHICLE } from './VehicleSpecs.js';
import { TIMES, WEATHERS, SEASONS, DEFAULT_ENV } from './Environment.js';

export const DEFAULT_SETTINGS = { vehicle: DEFAULT_VEHICLE, ...DEFAULT_ENV };
export const SETTING_KEYS = ['vehicle', 'time', 'weather', 'season'];
export const ENV_KEYS = ['time', 'weather', 'season'];

const VEHICLE_ICONS = { car: '🚗', bike: '🏍️', bus: '🚌' };
const opts = (table) => Object.entries(table).map(([id, o]) => ({ id, label: o.label, icon: o.icon }));

/** Order here is the order shown in the UI. */
export const SETTING_GROUPS = [
  { key: 'vehicle', title: 'Vehicle', options: VEHICLE_TYPES.map((id) => ({ id, label: VEHICLES[id].label, icon: VEHICLE_ICONS[id] })) },
  { key: 'time', title: 'Time of day', options: opts(TIMES) },
  { key: 'weather', title: 'Weather', options: opts(WEATHERS) },
  { key: 'season', title: 'Season', options: opts(SEASONS) },
];

export function isValid(key, value) {
  const g = SETTING_GROUPS.find((x) => x.key === key);
  return !!g && typeof value === 'string' && g.options.some((o) => o.id === value);
}

/** Keeps only known keys with valid values — anything coming off the network or localStorage goes through this. */
export function pickValid(partial) {
  const out = {};
  if (!partial || typeof partial !== 'object') return out;
  for (const k of SETTING_KEYS) if (isValid(k, partial[k])) out[k] = partial[k];
  return out;
}

export const normalizeSettings = (obj) => ({ ...DEFAULT_SETTINGS, ...pickValid(obj) });

export const envChanged = (a, b) => ENV_KEYS.some((k) => a?.[k] !== b?.[k]);
