// Entorno: suelo, efecto suelo y viento.

import { Vector3 } from 'three';
import { droneConfig, windConfig, type WindLevel } from '../core/config';
import { Random } from '../core/random';
import { headingOf, type DroneState } from './drone';

const UP = new Vector3(0, 1, 0);

/** Niveles de viento en orden (la tecla V los recorre) */
export const WIND_LEVELS: WindLevel[] = ['calm', 'moderate', 'strong'];

/** Nombres en la URL (?wind=...), en español porque los escribe el usuario */
const WIND_URL_NAMES: Record<string, WindLevel> = { calma: 'calm', moderado: 'moderate', fuerte: 'strong' };

export function parseWindLevel(value: string | null): WindLevel | null {
  // hasOwn: evita que nombres heredados como "constructor" cuenten como válidos
  return value !== null && Object.hasOwn(WIND_URL_NAMES, value) ? WIND_URL_NAMES[value] : null;
}

export function nextWindLevel(level: WindLevel): WindLevel {
  return WIND_LEVELS[(WIND_LEVELS.indexOf(level) + 1) % WIND_LEVELS.length];
}

/**
 * Contacto con el suelo (plano y = 0). Posado sobre sus patas, el dron no se hunde, no resbala
 * y no puede inclinarse ni girar: se conserva solo el rumbo. Si el empuje supera al peso, la
 * integración lo eleva por encima del reposo y deja de estar en el suelo.
 */
export function applyGroundContact(state: DroneState): void {
  const rest = droneConfig.restHeight;
  if (state.position.y > rest) {
    state.onGround = false;
    return;
  }
  state.position.y = rest;
  state.velocity.set(0, Math.max(0, state.velocity.y), 0);
  state.orientation.setFromAxisAngle(UP, headingOf(state.orientation));
  state.angularVelocity.set(0, 0, 0);
  state.onGround = true;
}

/**
 * Efecto suelo: cerca del suelo las hélices empujan más, porque el aire que mandan hacia abajo
 * rebota (modelo de Cheeseman-Bennett: T_suelo / T = 1 / (1 − (R / 4h)²)).
 * Se nota como un "colchón" al aterrizar: el dron no quiere bajar los últimos centímetros.
 * @param height altura de las hélices sobre el suelo (m)
 */
export function groundEffectFactor(height: number): number {
  const ratio = droneConfig.propRadius / (4 * Math.max(height, 1e-3));
  if (ratio >= 1) return droneConfig.groundEffectMax;
  return Math.min(droneConfig.groundEffectMax, 1 / (1 - ratio * ratio));
}

/**
 * Viento = viento medio + ráfagas. Las ráfagas son un proceso de Ornstein-Uhlenbeck: ruido que
 * "recuerda" su valor anterior unos segundos, así sube y baja de forma suave y realista, en vez
 * de saltar al azar en cada paso.
 */
export class Wind {
  /** Velocidad del aire (m/s, mundo): hacia dónde se mueve el aire */
  readonly velocity = new Vector3();
  level: WindLevel;
  private readonly gust = new Vector3();
  private random: Random;

  constructor(level: WindLevel = windConfig.defaultLevel, seed: number = windConfig.seed) {
    this.level = level;
    this.random = new Random(seed);
    this.update(0);
  }

  /** Velocidad media del nivel actual (sin ráfagas) */
  get meanSpeed(): number {
    return windConfig.levels[this.level].speed;
  }

  update(dt: number): Vector3 {
    const { speed, gustStd } = windConfig.levels[this.level];
    // Discretización exacta del proceso de O-U: misma varianza sea cual sea el dt
    const decay = Math.exp(-dt / windConfig.gustSeconds);
    const noise = gustStd * Math.sqrt(1 - decay * decay);
    this.gust.x = this.gust.x * decay + noise * this.random.gaussian();
    this.gust.z = this.gust.z * decay + noise * this.random.gaussian();
    this.gust.y = this.gust.y * decay + noise * windConfig.verticalGustRatio * this.random.gaussian();

    const direction = windConfig.towardHeading;
    this.velocity.set(-Math.sin(direction) * speed, 0, -Math.cos(direction) * speed).add(this.gust);
    return this.velocity;
  }

  /** Vuelve a empezar las ráfagas desde cero (con la misma semilla: mismo viento). */
  reset(seed: number = windConfig.seed): void {
    this.random = new Random(seed);
    this.gust.set(0, 0, 0);
    this.update(0);
  }
}
