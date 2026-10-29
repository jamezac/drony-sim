// Avisos del HUD, ordenados por importancia (el HUD enseña los dos primeros).
// Imitan los del DJI Fly: lo que de verdad hace perder un dron es ignorar la batería y el viento.

import { batteryConfig, limitsConfig, windConfig } from '../core/config';
import type { FlightPhase } from '../control/flightState';

export interface WarningInput {
  batteryPercent: number;
  phase: FlightPhase;
  forcedLanding: boolean;
  gps: boolean;
  /** Acro: sin auto-nivelado (tampoco tiene GPS) */
  acro: boolean;
  /** En una lección el modo lo fija la lección: no se puede cambiar */
  inLesson: boolean;
  altitude: number;
  distance: number;
  windSpeed: number;
}

export function activeWarnings(input: WarningInput): string[] {
  const { batteryPercent, phase, forcedLanding, gps, acro, inLesson, altitude, distance, windSpeed } = input;
  const warnings: string[] = [];
  const percent = Math.round(batteryPercent);
  const onGround = phase === 'disarmed' || phase === 'armed';

  if (forcedLanding) {
    warnings.push('Batería crítica: aterrizaje forzoso. No se puede cancelar.');
  } else if (phase === 'returning') {
    warnings.push(
      batteryPercent <= batteryConfig.rthPercent
        ? `Batería baja (${percent} %): volviendo a casa. Pulsa H para cancelar.`
        : 'Volviendo a casa (RTH). Pulsa H o mueve los sticks para cancelar.',
    );
  } else if (batteryPercent <= batteryConfig.lowPercent) {
    warnings.push(
      onGround
        ? `Batería baja (${percent} %). Pulsa R para empezar con una nueva.`
        : `Batería baja (${percent} %): vuelve pronto.`,
    );
  }
  if (acro) {
    const escape = inLesson ? '' : ' Pulsa 2 o el botón dcho. para volver a Normal.';
    warnings.push(`Modo Acro: al soltar los sticks no se nivela ni mantiene la altura.${escape}`);
  } else if (!gps) {
    warnings.push('Modo ATTI: sin GPS el dron deriva y no hay RTH. Al soltar los sticks no frena: corrige tú.');
  }
  if (altitude >= limitsConfig.maxAltitude - 1) warnings.push(`Altura máxima (${limitsConfig.maxAltitude} m)`);
  if (distance >= limitsConfig.maxDistance - 5) warnings.push('Límite de distancia: no puede alejarse más');
  if (windSpeed >= windConfig.strongWindWarning) warnings.push('Viento fuerte: al dron puede costarle volver');
  return warnings;
}
