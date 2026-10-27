// Ajustes de entrada que elige el usuario, guardados en el navegador (localStorage).
//
// Todo lo que se lee de localStorage se valida campo a campo: puede venir vacío, de una versión
// anterior o corrupto, y el simulador tiene que arrancar igual con los valores por defecto.
// localStorage además puede lanzar excepciones (modo privado, almacenamiento bloqueado).

import {
  inputConfig,
  spaceMouseGamepadConfig,
  type GamepadStickMode,
  type SpaceMouseProfileName,
} from './config';

/** Calibración de un eje: valor en reposo y valores a fondo hacia cada lado. */
export interface AxisCalibration {
  center: number;
  negative: number;
  positive: number;
}

export interface InputSettings {
  spaceMouseProfile: SpaceMouseProfileName;
  deadzone: number;
  expo: number;
  /** Una entrada por eje del SpaceMouse, o null si no está calibrado */
  calibration: AxisCalibration[] | null;
  gamepadMode: GamepadStickMode;
}

export const SETTINGS_STORAGE_KEY = 'drony.inputSettings.v1';

export function defaultInputSettings(): InputSettings {
  return {
    spaceMouseProfile: spaceMouseGamepadConfig.defaultProfile,
    deadzone: inputConfig.spaceMouse.deadzone,
    expo: inputConfig.spaceMouse.expo,
    calibration: null,
    gamepadMode: inputConfig.gamepad.defaultMode,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function sanitizeCalibration(value: unknown): AxisCalibration[] | null {
  if (!Array.isArray(value) || value.length < spaceMouseGamepadConfig.minAxes) return null;
  const axes: AxisCalibration[] = [];
  for (const axis of value) {
    if (!isRecord(axis)) return null;
    const { center, negative, positive } = axis;
    if (![center, negative, positive].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const calibration = { center, negative, positive } as AxisCalibration;
    if (!(calibration.negative < calibration.center && calibration.center < calibration.positive)) return null;
    axes.push(calibration);
  }
  return axes;
}

/** Convierte cualquier cosa (JSON leído, objeto parcial...) en ajustes válidos. */
export function sanitizeInputSettings(raw: unknown): InputSettings {
  const defaults = defaultInputSettings();
  if (!isRecord(raw)) return defaults;
  const profiles = Object.keys(spaceMouseGamepadConfig.profiles);
  return {
    spaceMouseProfile: profiles.includes(raw.spaceMouseProfile as string)
      ? (raw.spaceMouseProfile as SpaceMouseProfileName)
      : defaults.spaceMouseProfile,
    deadzone: numberInRange(raw.deadzone, 0, 0.5, defaults.deadzone),
    expo: numberInRange(raw.expo, 0, 1, defaults.expo),
    calibration: sanitizeCalibration(raw.calibration),
    gamepadMode: raw.gamepadMode === 'mode1' || raw.gamepadMode === 'mode2' ? raw.gamepadMode : defaults.gamepadMode,
  };
}

/** localStorage si existe y se puede usar; null en tests (Node) o si el navegador lo bloquea. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadInputSettings(storage: Storage | null = browserStorage()): InputSettings {
  try {
    const stored = storage?.getItem(SETTINGS_STORAGE_KEY);
    return sanitizeInputSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return defaultInputSettings();
  }
}

/** @returns si se pudo guardar */
export function saveInputSettings(settings: InputSettings, storage: Storage | null = browserStorage()): boolean {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return storage !== null;
  } catch {
    return false;
  }
}
