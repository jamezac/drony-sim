// Mandos genéricos (Xbox, PlayStation, radios RC en modo joystick) por la Gamepad API.
// Solo se aceptan los que el navegador reconoce con el mapeo "standard": así los ejes tienen
// siempre el mismo significado. Se descarta el SpaceMouse y los dispositivos virtuales raros
// (como el "Unknown Gamepad beef:046d" con un hat switch fijo que hay en este equipo).

import { isSpaceMouseGamepad } from './spaceMouseGamepad';

interface PadLike {
  id: string;
  axes: readonly number[];
  mapping: string;
}

export function pickStandardGamepad<T extends PadLike>(pads: readonly T[]): T | null {
  return pads.find((pad) => pad.mapping === 'standard' && !isSpaceMouseGamepad(pad)) ?? null;
}
