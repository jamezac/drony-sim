// Decodificación pura de los reports HID del SpaceMouse (sin dependencias del navegador,
// para poder testearla con Vitest).
//
// Formato de los reports:
// - Report 1: traslación tx, ty, tz como int16 little-endian (6 bytes).
//   Los modelos modernos (como el SpaceMouse Wireless) mandan aquí también la rotación
//   rx, ry, rz en el mismo report (12 bytes en total).
// - Report 2: rotación rx, ry, rz (solo en modelos antiguos que la mandan por separado).
// - Report 3: bitmask de botones.

export interface SpaceMouseAxes {
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
}

export interface SpaceMouseState {
  axes: SpaceMouseAxes;
  buttons: number;
}

export const REPORT_TRANSLATION = 1;
export const REPORT_ROTATION = 2;
export const REPORT_BUTTONS = 3;

export function createSpaceMouseState(): SpaceMouseState {
  return { axes: { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 }, buttons: 0 };
}

function readInt16Triplet(data: DataView, offset: number): [number, number, number] {
  return [
    data.getInt16(offset, true),
    data.getInt16(offset + 2, true),
    data.getInt16(offset + 4, true),
  ];
}

/** Aplica un report HID al estado y devuelve el estado nuevo (no muta el original). */
export function applyReport(
  state: SpaceMouseState,
  reportId: number,
  data: DataView,
): SpaceMouseState {
  const axes = { ...state.axes };
  let buttons = state.buttons;

  if (reportId === REPORT_TRANSLATION && data.byteLength >= 6) {
    [axes.tx, axes.ty, axes.tz] = readInt16Triplet(data, 0);
    if (data.byteLength >= 12) {
      [axes.rx, axes.ry, axes.rz] = readInt16Triplet(data, 6);
    }
  } else if (reportId === REPORT_ROTATION && data.byteLength >= 6) {
    [axes.rx, axes.ry, axes.rz] = readInt16Triplet(data, 0);
  } else if (reportId === REPORT_BUTTONS && data.byteLength >= 1) {
    buttons = 0;
    for (let i = 0; i < Math.min(data.byteLength, 4); i++) {
      buttons |= data.getUint8(i) << (8 * i);
    }
  }

  return { axes, buttons };
}

/** Convierte un valor bruto a -1..1. */
export function normalizeAxis(raw: number, fullScale: number): number {
  return Math.max(-1, Math.min(1, raw / fullScale));
}
