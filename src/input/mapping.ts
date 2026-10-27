// Mapeo de entrada: de valores crudos de un dispositivo a sticks virtuales (−1..1).
//
// - Zona muerta: por debajo de un umbral el stick vale 0. Evita que el dron se mueva por ruido
//   o por el acoplamiento del SpaceMouse (al mover un eje se mueven un poco los demás).
//   Se reescala para que justo fuera de la zona muerta el valor empiece en 0 (sin salto).
// - Expo: curva cúbica. Cerca del centro responde suave (correcciones finas en hover) y a
//   fondo sigue llegando a ±1. Las radios de DJI y de FPV usan lo mismo.

import type { AxisBinding, StickName } from '../core/config';
import { neutralSticks, type Sticks } from '../core/controlInput';

export interface StickShaping {
  deadzone: number;
  expo: number;
}

const STICKS: StickName[] = ['throttle', 'yaw', 'pitch', 'roll'];

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function applyDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return (Math.sign(value) * (magnitude - deadzone)) / (1 - deadzone);
}

export function applyExpo(value: number, expo: number): number {
  return (1 - expo) * value + expo * value * value * value;
}

/** Valor de un eje del gamepad según su asignación: escalado, invertido y recortado a ±1. */
export function readAxis(axes: readonly number[], binding: AxisBinding): number {
  const raw = (axes[binding.axis] ?? 0) / binding.fullScale;
  return clampUnit(binding.invert ? -raw : raw);
}

export function shapeStick(value: number, shaping: StickShaping): number {
  return applyExpo(applyDeadzone(clampUnit(value), shaping.deadzone), shaping.expo);
}

/** Sticks a partir de los ejes del SpaceMouse y un perfil de asignación. */
export function spaceMouseSticks(
  axes: readonly number[],
  profile: Record<StickName, AxisBinding>,
  shaping: StickShaping,
): Sticks {
  const sticks = neutralSticks();
  for (const stick of STICKS) sticks[stick] = shapeStick(readAxis(axes, profile[stick]), shaping);
  return sticks;
}

/** Combina dos fuentes: en cada stick gana la que más se aparta del centro. */
export function combineSticks(a: Sticks, b: Sticks): Sticks {
  const sticks = neutralSticks();
  for (const stick of STICKS) sticks[stick] = Math.abs(a[stick]) >= Math.abs(b[stick]) ? a[stick] : b[stick];
  return sticks;
}
