import { describe, expect, it } from 'vitest';
import {
  defaultInputSettings,
  loadInputSettings,
  sanitizeInputSettings,
  saveInputSettings,
  SETTINGS_STORAGE_KEY,
} from '../src/core/settings';

/** localStorage en memoria para los tests (Node no tiene). */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

const calibration = Array.from({ length: 6 }, () => ({ center: 0, negative: -0.9, positive: 0.95 }));

describe('sanitizeInputSettings', () => {
  it('sin datos o con basura devuelve los valores por defecto', () => {
    expect(sanitizeInputSettings(null)).toEqual(defaultInputSettings());
    expect(sanitizeInputSettings('hola')).toEqual(defaultInputSettings());
    expect(sanitizeInputSettings(42)).toEqual(defaultInputSettings());
  });

  it('conserva los campos válidos y repone solo los inválidos', () => {
    const settings = sanitizeInputSettings({ spaceMouseProfile: 'tilt', deadzone: 3, expo: 0.5, gamepadMode: 'mode9' });
    expect(settings.spaceMouseProfile).toBe('tilt');
    expect(settings.deadzone).toBe(defaultInputSettings().deadzone); // 3 está fuera de rango
    expect(settings.expo).toBe(0.5);
    expect(settings.gamepadMode).toBe('mode2');
  });

  it('acepta una calibración coherente y rechaza una rota', () => {
    expect(sanitizeInputSettings({ calibration }).calibration).toEqual(calibration);
    const inverted = calibration.map((c) => ({ ...c, negative: 0.5 })); // negativo por encima del centro
    expect(sanitizeInputSettings({ calibration: inverted }).calibration).toBeNull();
    expect(sanitizeInputSettings({ calibration: calibration.slice(0, 3) }).calibration).toBeNull();
    expect(sanitizeInputSettings({ calibration: [{ center: 'x' }] }).calibration).toBeNull();
  });
});

describe('guardar y cargar', () => {
  it('lo guardado se recupera igual', () => {
    const storage = memoryStorage();
    const settings = { ...defaultInputSettings(), spaceMouseProfile: 'tilt' as const, expo: 0.6, calibration };
    expect(saveInputSettings(settings, storage)).toBe(true);
    expect(loadInputSettings(storage)).toEqual(settings);
  });

  it('con JSON corrupto o sin almacenamiento arranca con los valores por defecto', () => {
    const storage = memoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, '{roto');
    expect(loadInputSettings(storage)).toEqual(defaultInputSettings());
    expect(loadInputSettings(null)).toEqual(defaultInputSettings());
    expect(saveInputSettings(defaultInputSettings(), null)).toBe(false);
  });

  it('si el almacenamiento lanza excepciones (modo privado) no rompe nada', () => {
    const broken = memoryStorage();
    broken.getItem = () => {
      throw new Error('bloqueado');
    };
    broken.setItem = () => {
      throw new Error('bloqueado');
    };
    expect(loadInputSettings(broken)).toEqual(defaultInputSettings());
    expect(saveInputSettings(defaultInputSettings(), broken)).toBe(false);
  });
});
