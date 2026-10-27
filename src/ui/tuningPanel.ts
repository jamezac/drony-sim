// Panel de ajuste en vivo (tecla `). Modifica directamente los objetos de core/config.ts,
// así puedes ver al instante qué hace cada ganancia del PID mientras vuelas.
// Los PID y el modo Normal son para experimentar y se pierden al recargar. Los ajustes de
// entrada (perfil, zona muerta, expo, modo del mando) sí se guardan en el navegador.
//
// Para experimentar: sube mucho "Velocidad angular · kp" y verás el dron vibrar (oscilación);
// bájalo mucho y lo notarás "blando", tardando en corregir. Ese equilibrio es ajustar un PID.

import GUI from 'three/addons/libs/lil-gui.module.min.js';
import {
  controlConfig,
  gamepadConfig,
  modesConfig,
  spaceMouseGamepadConfig,
  type GamepadStickMode,
  type SpaceMouseProfileName,
} from '../core/config';
import { defaultInputSettings, saveInputSettings } from '../core/settings';
import type { InputManager } from '../input/inputManager';

const DEG = Math.PI / 180;

/** Expone un campo en radianes como grados para la UI. */
function degrees<T extends object>(target: T, key: keyof T & string): Record<string, number> {
  return {
    get [key]() {
      return (target[key] as number) / DEG;
    },
    set [key](value: number) {
      (target[key] as number) = value * DEG;
    },
  };
}

export interface TuningPanel {
  /** Refresca los controles (p. ej. si los ajustes cambian desde otra pestaña) */
  refresh(): void;
}

export function createTuningPanel(input: InputManager): TuningPanel {
  const gui = new GUI({ title: 'Ajustes (tecla `)' });
  gui.hide();

  const pid = gui.addFolder('PID');
  const rate = pid.addFolder('Velocidad angular (lazo interior)');
  rate.add(controlConfig.rate, 'kp', 0, 80, 0.5);
  rate.add(controlConfig.rate, 'ki', 0, 20, 0.1);
  rate.add(controlConfig.rate, 'kd', 0, 2, 0.01);
  const attitude = pid.addFolder('Actitud');
  attitude.add(controlConfig.attitude, 'kp', 0, 20, 0.1);
  attitude.add(controlConfig.attitude, 'yawKp', 0, 10, 0.1);
  const velocity = pid.addFolder('Velocidad horizontal');
  velocity.add(controlConfig.velocity, 'kp', 0, 8, 0.1);
  velocity.add(controlConfig.velocity, 'ki', 0, 3, 0.05);
  pid.add(controlConfig.position, 'kp', 0, 4, 0.05).name('Posición · kp');
  const vertical = pid.addFolder('Vertical');
  vertical.add(controlConfig.verticalSpeed, 'kp', 0, 15, 0.1).name('Velocidad · kp');
  vertical.add(controlConfig.verticalSpeed, 'ki', 0, 8, 0.1).name('Velocidad · ki');
  vertical.add(controlConfig.altitude, 'kp', 0, 5, 0.05).name('Altura · kp');
  pid.close();

  const normal = gui.addFolder('Modo Normal');
  normal.add(modesConfig.normal, 'maxSpeed', 1, 20, 0.5).name('Vel. máx. (m/s)');
  normal.add(modesConfig.normal, 'maxClimb', 0.5, 6, 0.1).name('Subida máx. (m/s)');
  normal.add(modesConfig.normal, 'maxDescent', 0.5, 6, 0.1).name('Bajada máx. (m/s)');
  normal.add(degrees(modesConfig.normal, 'maxTilt'), 'maxTilt', 5, 45, 1).name('Inclinación máx. (°)');
  normal.add(degrees(modesConfig.normal, 'maxYawRate'), 'maxYawRate', 10, 200, 5).name('Giro máx. (°/s)');
  normal.add(modesConfig.normal, 'maxAccel', 1, 15, 0.5).name('Aceleración (m/s²)');

  // Entrada: se guarda en el navegador al soltar cada control
  const { settings } = input;
  const save = (): void => void saveInputSettings(settings);
  const entry = gui.addFolder('Entrada (se guarda)');
  const profiles = Object.keys(spaceMouseGamepadConfig.profiles) as SpaceMouseProfileName[];
  entry.add(settings, 'spaceMouseProfile', profiles).name('SpaceMouse · perfil').onFinishChange(save);
  entry.add(settings, 'deadzone', 0, 0.5, 0.01).name('SpaceMouse · zona muerta').onFinishChange(save);
  entry.add(settings, 'expo', 0, 1, 0.05).name('SpaceMouse · expo').onFinishChange(save);
  const modes = Object.keys(gamepadConfig.modes) as GamepadStickMode[];
  entry.add(settings, 'gamepadMode', modes).name('Mando · modo').onFinishChange(save);
  entry
    .add(
      {
        restablecer: () => {
          // La calibración se conserva: se gestiona en la página de dispositivos
          Object.assign(settings, { ...defaultInputSettings(), calibration: settings.calibration });
          save();
          refresh();
        },
      },
      'restablecer',
    )
    .name('Restablecer entrada');

  function refresh(): void {
    for (const controller of gui.controllersRecursive()) controller.updateDisplay();
  }

  let visible = false;
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Backquote') return;
    visible = !visible;
    gui.show(visible);
  });

  return { refresh };
}
