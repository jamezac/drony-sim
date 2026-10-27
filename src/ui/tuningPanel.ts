// Panel de ajuste en vivo (tecla `). Modifica directamente los objetos de core/config.ts,
// así puedes ver al instante qué hace cada ganancia del PID mientras vuelas.
//
// Para experimentar: sube mucho "Velocidad angular · kp" y verás el dron vibrar (oscilación);
// bájalo mucho y lo notarás "blando", tardando en corregir. Ese equilibrio es ajustar un PID.

import GUI from 'three/addons/libs/lil-gui.module.min.js';
import {
  controlConfig,
  inputConfig,
  modesConfig,
  spaceMouseGamepadConfig,
  type SpaceMouseProfileName,
} from '../core/config';
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

export function createTuningPanel(input: InputManager): void {
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

  const spaceMouse = gui.addFolder('SpaceMouse');
  const profiles = Object.keys(spaceMouseGamepadConfig.profiles) as SpaceMouseProfileName[];
  spaceMouse.add(input, 'profile', profiles).name('Perfil');
  spaceMouse.add(inputConfig.spaceMouse, 'deadzone', 0, 0.5, 0.01).name('Zona muerta');
  spaceMouse.add(inputConfig.spaceMouse, 'expo', 0, 1, 0.05).name('Expo');

  let visible = false;
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Backquote') return;
    visible = !visible;
    gui.show(visible);
  });
}
