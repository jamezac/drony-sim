// Parámetros ajustables del simulador. Nada de números mágicos fuera de aquí.

/** Sticks virtuales (−1..1): throttle + = subir, yaw + = girar en horario, pitch + = adelante, roll + = derecha. */
export type StickName = 'throttle' | 'yaw' | 'pitch' | 'roll';

/** Cómo sale un stick virtual de un eje del gamepad. */
export interface AxisBinding {
  axis: number;
  invert: boolean;
  /** Valor del eje a fondo; se divide por él para que el gesto completo dé ±1 */
  fullScale: number;
}

export type SpaceMouseProfileName = 'translation' | 'tilt';

// SpaceMouse leído por la Gamepad API. Ejes medidos con el asistente de mapeo (fase 0):
//   0 desplazar a la derecha (+) · 1 desplazar adelante (−) · 2 subir (−)
//   3 inclinar adelante (−)      · 4 inclinar a la derecha (−) · 5 girar en horario (+, llega a ~0,87)
export const spaceMouseGamepadConfig = {
  // El receptor universal aparece como varios gamepads; el del SpaceMouse es el que tiene ejes
  minAxes: 6,
  // Por defecto "translation": en "tilt", subir la tapa la inclina adelante un ~41 %
  // y cada corrección de altura cabecearía el dron. En "translation", subir apenas afecta (~12 %).
  defaultProfile: 'translation' as SpaceMouseProfileName,
  profiles: {
    // Desplazar la tapa hacia donde quieres que vaya el dron
    translation: {
      throttle: { axis: 2, invert: true, fullScale: 1 },
      yaw: { axis: 5, invert: false, fullScale: 0.85 },
      pitch: { axis: 1, invert: true, fullScale: 1 },
      roll: { axis: 0, invert: false, fullScale: 1 },
    },
    // Inclinar la tapa como quieres que se incline el dron
    tilt: {
      throttle: { axis: 2, invert: true, fullScale: 1 },
      yaw: { axis: 5, invert: false, fullScale: 0.85 },
      pitch: { axis: 3, invert: true, fullScale: 1 },
      roll: { axis: 4, invert: true, fullScale: 1 },
    },
  } satisfies Record<SpaceMouseProfileName, Record<StickName, AxisBinding>>,
  buttons: {
    takeoffLand: 0, // botón izquierdo
    modeSwitch: 1, // botón derecho
  },
};

// SpaceMouse por WebHID: alternativa, solo funciona con el driver 3DxWare cerrado
export const spaceMouseConfig = {
  // Vendor IDs USB de 3Dconnexion (el antiguo de Logitech y el actual)
  vendorIds: [0x046d, 0x256f],
  // Colección HID "controlador multieje" (Generic Desktop / Multi-axis Controller).
  // El receptor inalámbrico expone varias interfaces; esta es la que lleva los ejes.
  usagePage: 0x01,
  usage: 0x08,
  // Valor bruto aproximado del eje a fondo. Se normaliza a -1..1 dividiendo por esto.
  // Ajustar con la página de prueba si al empujar a tope no se llega a ±1.
  axisFullScale: 350,
} as const;

// Asistente de mapeo (devices.html): cómo decide que un gesto ha terminado.
// Los umbrales son relativos porque la escala que da el navegador depende del rango que
// declara el dispositivo: a fondo puede dar ±1 o bastante menos.
export const mappingWizardConfig = {
  // Pico mínimo (en -1..1) para considerar que empezó un gesto. Muy bajo a propósito.
  minPeak: 0.02,
  // La tapa se considera suelta cuando todos los ejes bajan de esta fracción del pico del gesto
  restRatio: 0.15,
  // Tiempo con la tapa suelta tras el gesto antes de pasar al siguiente paso
  restMs: 400,
} as const;
