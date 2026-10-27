// Entradas programadas para `npm run check`: el dron vuela solo, sin piloto, para que las
// capturas muestren algo útil.
//   ?demo=hover  → despegue automático y sticks sueltos
//   ?demo=sticks → despegue y después sticks fijos (para ver el visualizador de sticks desviado)

import { neutralInput, type ControlInput, type Sticks } from '../core/controlInput';

export const DEMO_NAMES = ['hover', 'sticks'] as const;
export type DemoName = (typeof DEMO_NAMES)[number];

// El despegue automático tarda ~2,5 s; antes de eso mover los sticks lo cancelaría
const STICKS_DEMO_DELAY_SECONDS = 4;
const STICKS_DEMO_POSITION: Sticks = { throttle: 0.3, yaw: 0.5, pitch: 0.7, roll: -0.4 };

export function parseDemoName(value: string | null): DemoName | null {
  return DEMO_NAMES.find((name) => name === value) ?? null;
}

export class DemoInput {
  readonly name: DemoName;
  private elapsed = 0;
  private started = false;

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
    if (this.name === 'sticks' && this.elapsed > STICKS_DEMO_DELAY_SECONDS) {
      input.sticks = { ...STICKS_DEMO_POSITION };
    }
    return input;
  }
}
