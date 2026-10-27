// El SpaceMouse visto como "gamepad" de 6 ejes. Windows lo expone así mediante Raw Input y,
// a diferencia de WebHID, funciona aunque el driver 3DxWare esté abierto.
//
// Ojo: el receptor universal aparece como VARIOS gamepads con el mismo nombre (uno sin ejes,
// para el ratón), y puede haber otros dispositivos virtuales con ejes fijos (hat switch ≈1,286).

import { spaceMouseGamepadConfig } from '../core/config';

const SPACE_MOUSE_ID = /3dconnexion|spacemouse|256f/i;

interface PadLike {
  id: string;
  axes: readonly number[];
}

/** ¿Es el SpaceMouse? Tiene que llevar su nombre/vendor y además tener los ejes. */
export function isSpaceMouseGamepad(pad: PadLike): boolean {
  return SPACE_MOUSE_ID.test(pad.id) && pad.axes.length >= spaceMouseGamepadConfig.minAxes;
}

/** El SpaceMouse entre una lista de gamepads, o null. Nunca otro mando por descarte. */
export function pickSpaceMousePad<T extends PadLike>(pads: readonly T[]): T | null {
  return pads.find(isSpaceMouseGamepad) ?? null;
}

/** Mayor valor absoluto entre todos los ejes. */
export function axisMagnitude(axes: readonly number[]): number {
  return Math.max(0, ...axes.map(Math.abs));
}

/**
 * Desviación de cada eje respecto a su valor en reposo. Hace falta porque algunos ejes no
 * reposan en 0: Chrome en Windows expone los "hat switch" como un eje que vale ≈1,286 suelto.
 */
export function axisDeviation(axes: readonly number[], rest: readonly number[]): number[] {
  return axes.map((value, i) => value - (rest[i] ?? 0));
}

/**
 * El gamepad que más se mueve ahora mismo (en empate, el primero). Hace falta porque el
 * receptor universal puede aparecer como varios "gamepads" y no todos llevan los ejes.
 */
export function mostActivePad<T extends { axes: readonly number[] }>(
  pads: readonly T[],
): { pad: T; magnitude: number } | null {
  let best: { pad: T; magnitude: number } | null = null;
  for (const pad of pads) {
    const magnitude = axisMagnitude(pad.axes);
    if (!best || magnitude > best.magnitude) best = { pad, magnitude };
  }
  return best;
}

/** El SpaceMouse conectado ahora mismo, o null. */
export function findSpaceMouseGamepad(): Gamepad | null {
  return pickSpaceMousePad(navigator.getGamepads().filter((pad) => pad !== null));
}
