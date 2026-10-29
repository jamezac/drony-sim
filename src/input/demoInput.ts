// Entradas programadas para `npm run check`: el dron vuela solo, sin piloto, para que las
// capturas muestren algo útil.
//   ?demo=hover  → despegue automático y sticks sueltos
//   ?demo=sticks → despegue y después sticks fijos (para ver el visualizador de sticks desviado)
//   ?demo=rth    → despegue, se aleja ~15 m y pulsa "volver a casa"
//   ?demo=crash  → despegue y a toda velocidad hacia delante (en la pista de obstáculos, contra el muro)
//   ?demo=flip   → (con ?mode=acro) despegue, sube con gas a fondo y hace un flip hacia delante

import { neutralInput, type ControlInput, type Sticks } from '../core/controlInput';

export const DEMO_NAMES = ['hover', 'sticks', 'rth', 'crash', 'flip'] as const;
export type DemoName = (typeof DEMO_NAMES)[number];

// El despegue automático tarda ~2,5 s; antes de eso mover los sticks lo cancelaría
const STICKS_DEMO_DELAY_SECONDS = 4;
const STICKS_DEMO_POSITION: Sticks = { throttle: 0.3, yaw: 0.5, pitch: 0.7, roll: -0.4 };
// rth: avanza a fondo este rato (≈15 m) y luego pide volver a casa
const RTH_DEMO_FORWARD = { from: 4, to: 6.5 };
const RTH_DEMO_PRESS_SECONDS = 8;
// flip: gas a fondo (sube unos 8 m) y después flip con el gas cortado, como lo haría un piloto
const FLIP_DEMO_CLIMB = { from: 4, to: 5 };
const FLIP_DEMO_FLIP = { from: 5, to: 5.7 };

export function parseDemoName(value: string | null): DemoName | null {
  return DEMO_NAMES.find((name) => name === value) ?? null;
}

export class DemoInput {
  readonly name: DemoName;
  private elapsed = 0;
  private started = false;
  private returnPressed = false;

  constructor(name: DemoName) {
    this.name = name;
  }

  /** Segundos desde que empezó la demo */
  get time(): number {
    return this.elapsed;
  }

  sample(dt: number): ControlInput {
    this.elapsed += dt;
    const input = neutralInput();
    if (!this.started) {
      input.actions.takeoffLand = true;
      this.started = true;
    }
    if (this.name === 'crash' && this.elapsed > STICKS_DEMO_DELAY_SECONDS) input.sticks.pitch = 1;
    if (this.name === 'flip') {
      if (this.elapsed > FLIP_DEMO_CLIMB.from && this.elapsed < FLIP_DEMO_CLIMB.to) input.sticks.throttle = 1;
      if (this.elapsed > FLIP_DEMO_FLIP.from && this.elapsed < FLIP_DEMO_FLIP.to) {
        input.sticks.pitch = 1;
        input.sticks.throttle = -1;
      }
    }
    if (this.name === 'sticks' && this.elapsed > STICKS_DEMO_DELAY_SECONDS) {
      input.sticks = { ...STICKS_DEMO_POSITION };
    }
    if (this.name === 'rth') {
      if (this.elapsed > RTH_DEMO_FORWARD.from && this.elapsed < RTH_DEMO_FORWARD.to) input.sticks.pitch = 1;
      if (!this.returnPressed && this.elapsed > RTH_DEMO_PRESS_SECONDS) {
        input.actions.returnHome = true;
        this.returnPressed = true;
      }
    }
    return input;
  }
}
