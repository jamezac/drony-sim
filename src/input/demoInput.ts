// Entradas programadas para `npm run check` (?demo=hover): el dron vuela solo, sin piloto,
// para que la captura muestre algo útil.

import { neutralInput, type ControlInput } from '../core/controlInput';

export const DEMO_NAMES = ['hover'] as const;
export type DemoName = (typeof DEMO_NAMES)[number];

export function parseDemoName(value: string | null): DemoName | null {
  return DEMO_NAMES.find((name) => name === value) ?? null;
}

export class DemoInput {
  private readonly name: DemoName;
  private started = false;

  constructor(name: DemoName) {
    this.name = name;
  }

  sample(): ControlInput {
    const input = neutralInput();
    if (this.name === 'hover' && !this.started) {
      // hover: despegue automático y luego sticks sueltos
      input.actions.takeoffLand = true;
      this.started = true;
    }
    return input;
  }
}
