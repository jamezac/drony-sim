// Teclado como respaldo (Modo 2): W/S altura, A/D giro, flechas adelante/atrás/lados, 1-4 modo,
// H vuelta a casa, V nivel de viento, C cámara.
// Una tecla es todo o nada, así que el valor sube en rampa mientras está pulsada: se parece
// más a empujar un stick poco a poco y evita tirones bruscos del dron.

import { inputConfig, type FlightModeName, type StickName } from '../core/config';
import { neutralSticks, type Sticks } from '../core/controlInput';

const STICK_KEYS: Record<StickName, { positive: string; negative: string }> = {
  throttle: { positive: 'KeyW', negative: 'KeyS' },
  yaw: { positive: 'KeyD', negative: 'KeyA' },
  pitch: { positive: 'ArrowUp', negative: 'ArrowDown' },
  roll: { positive: 'ArrowRight', negative: 'ArrowLeft' },
};

export const ACTION_KEYS = {
  toggleMotors: 'KeyE',
  takeoffLand: 'Space',
  returnHome: 'KeyH',
  reset: 'KeyR',
  cycleWind: 'KeyV',
  toggleCamera: 'KeyC',
} as const;

type ActionName = keyof typeof ACTION_KEYS;

/** Teclas 1-4: elegir modo directamente */
const MODE_KEYS: Record<string, FlightModeName> = {
  Digit1: 'cine',
  Digit2: 'normal',
  Digit3: 'sport',
  Digit4: 'atti',
};

// Teclas que el navegador usaría para hacer scroll: las capturamos nosotros
const CAPTURED_KEYS = new Set<string>([
  ...Object.values(STICK_KEYS).flatMap(({ positive, negative }) => [positive, negative]),
  ...Object.values(ACTION_KEYS),
  ...Object.keys(MODE_KEYS),
]);

/** Acerca `current` a `target`: tarda `upSeconds` en ir de 0 a ±1 y `downSeconds` en volver a 0. */
export function rampToward(current: number, target: number, dt: number, upSeconds: number, downSeconds: number): number {
  const rate = target === 0 ? 1 / downSeconds : 1 / upSeconds;
  const step = rate * dt;
  // Pequeña tolerancia: sin ella el redondeo deja valores como 0,9999999999 en vez de 1
  if (Math.abs(target - current) <= step + 1e-9) return target;
  return current + Math.sign(target - current) * step;
}

export interface KeyboardSample {
  sticks: Sticks;
  /** Acciones pulsadas desde la última muestra */
  actions: Record<ActionName, boolean>;
  /** Modo elegido con 1-4 desde la última muestra, o null */
  mode: FlightModeName | null;
}

export class KeyboardInput {
  private readonly pressed = new Set<string>();
  private readonly justPressed = new Set<string>();
  private readonly sticks = neutralSticks();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (event) => {
      if (!CAPTURED_KEYS.has(event.code)) return;
      event.preventDefault();
      if (!event.repeat) this.justPressed.add(event.code);
      this.pressed.add(event.code);
    });
    target.addEventListener('keyup', (event) => this.pressed.delete(event.code));
    // Si la ventana pierde el foco con una tecla pulsada, no recibiríamos su keyup
    target.addEventListener('blur', () => this.pressed.clear());
  }

  sample(dt: number): KeyboardSample {
    const { rampUpSeconds, rampDownSeconds } = inputConfig.keyboard;
    for (const [stick, keys] of Object.entries(STICK_KEYS) as [StickName, (typeof STICK_KEYS)[StickName]][]) {
      const target = (this.pressed.has(keys.positive) ? 1 : 0) - (this.pressed.has(keys.negative) ? 1 : 0);
      this.sticks[stick] = rampToward(this.sticks[stick], target, dt, rampUpSeconds, rampDownSeconds);
    }

    const actions = {} as Record<ActionName, boolean>;
    for (const [action, code] of Object.entries(ACTION_KEYS) as [ActionName, string][]) {
      actions[action] = this.justPressed.has(code);
    }
    const modeKey = Object.keys(MODE_KEYS).find((code) => this.justPressed.has(code));
    this.justPressed.clear();
    return { sticks: { ...this.sticks }, actions, mode: modeKey ? MODE_KEYS[modeKey] : null };
  }
}
