// La simulación completa sin navegador: estado del dron + máquina de estados + controlador +
// física + entorno (viento, efecto suelo) + batería.
// No sabe nada de Three.js más allá de sus tipos matemáticos, así que se puede probar en Vitest.

import { FlightController } from '../control/flightController';
import { FlightStateMachine, type FlightPhase } from '../control/flightState';
import { ModeBlender, modeParams, type FlightModeName } from '../control/modes';
import { Battery } from '../physics/battery';
import { copyDroneState, createDroneState, MOTOR_COUNT, type DroneState } from '../physics/drone';
import { stepDynamics, type AirConditions } from '../physics/dynamics';
import { applyGroundContact, groundEffectFactor, Wind } from '../physics/environment';
import { Vector3 } from 'three';
import { droneConfig, simConfig, windConfig, type WindLevel } from './config';
import type { ControlInput } from './controlInput';

export interface SimulationOptions {
  mode?: FlightModeName;
  wind?: WindLevel;
  /** Batería inicial (%), útil para practicar el RTH por batería baja */
  batteryPercent?: number;
}

/** Dónde y cómo empezar en el aire */
export interface AirborneStart {
  x: number;
  /** Altura sobre el suelo (m) */
  altitude: number;
  z: number;
  heading: number;
}

const MOTORS_OFF = new Array<number>(MOTOR_COUNT).fill(0);
const UP = new Vector3(0, 1, 0);

export class Simulation {
  readonly state: DroneState = createDroneState();
  /** Estado del paso anterior: el render interpola entre este y `state` */
  readonly previous: DroneState = createDroneState();
  readonly controller = new FlightController();
  readonly wind: Wind;
  battery: Battery;
  private flight = new FlightStateMachine();
  private currentMode: FlightModeName;
  /** Límites efectivos: pasan de un modo a otro de forma gradual */
  private readonly blender: ModeBlender;
  private initialBattery: number;
  private readonly air: AirConditions;
  time = 0;

  constructor(options: SimulationOptions | FlightModeName = {}) {
    const { mode = 'normal', wind = windConfig.defaultLevel, batteryPercent = 100 } =
      typeof options === 'string' ? { mode: options } : options;
    this.currentMode = mode;
    this.blender = new ModeBlender(modeParams(mode));
    this.wind = new Wind(wind);
    this.initialBattery = batteryPercent;
    this.battery = new Battery(batteryPercent);
    this.air = { wind: this.wind.velocity, thrustFactor: 1 };
  }

  get mode(): FlightModeName {
    return this.currentMode;
  }

  /** Cambia de modo en cualquier momento, también en vuelo (los límites cambian suavemente). */
  setMode(mode: FlightModeName): void {
    this.currentMode = mode;
  }

  setWind(level: WindLevel): void {
    this.wind.level = level;
  }

  get phase(): FlightPhase {
    return this.flight.phase;
  }

  /** Aterrizaje forzoso por batería crítica en curso */
  get forcedLanding(): boolean {
    return this.flight.forcedLanding;
  }

  /** Altura sobre el suelo (m), 0 posado */
  get altitude(): number {
    return this.state.position.y - droneConfig.restHeight;
  }

  step(dt: number, input: ControlInput): void {
    copyDroneState(this.previous, this.state);
    this.wind.update(dt);

    const phase = this.flight.update(
      {
        sticks: input.sticks,
        actions: input.actions,
        onGround: this.state.onGround,
        altitude: this.altitude,
        gps: modeParams(this.currentMode).positionHold,
        batteryPercent: this.battery.percent,
        rthArrived: this.controller.rthArrived,
      },
      dt,
    );
    const limits = this.blender.update(modeParams(this.currentMode), dt);
    let commands = this.controller.update(this.state, phase, input.sticks, limits, dt);

    // Sin batería los motores se paran, esté donde esté el dron
    if (this.battery.depleted) {
      this.flight.forceDisarm();
      commands = MOTORS_OFF;
    }

    // Efecto suelo según la altura (las hélices están solo ~2 cm por encima del centro de masas)
    this.air.thrustFactor = groundEffectFactor(this.state.position.y);
    stepDynamics(this.state, commands, dt, this.air);
    applyGroundContact(this.state);
    this.battery.update(this.state.motorThrust, this.flight.phase !== 'disarmed', dt);
    this.time += dt;
  }

  /** Cambia modo, viento y batería inicial y vuelve a empezar (al iniciar una lección). */
  resetWith(options: SimulationOptions): void {
    if (options.mode) this.currentMode = options.mode;
    if (options.wind) this.wind.level = options.wind;
    if (options.batteryPercent !== undefined) this.initialBattery = options.batteryPercent;
    this.reset();
  }

  /** Coloca el dron volando, quieto y con los motores al empuje de hover. */
  spawnFlying(start: AirborneStart): void {
    const { state } = this;
    state.position.set(start.x, droneConfig.restHeight + start.altitude, start.z);
    state.velocity.set(0, 0, 0);
    state.orientation.setFromAxisAngle(UP, start.heading);
    state.angularVelocity.set(0, 0, 0);
    state.motorThrust.fill((droneConfig.mass * simConfig.gravity) / MOTOR_COUNT);
    state.onGround = false;
    copyDroneState(this.previous, state);
    this.flight.startFlying();
    this.controller.reset(state);
  }

  /** Vuelve al inicio: dron posado en el home, batería como al empezar y las mismas ráfagas. */
  reset(): void {
    const fresh = createDroneState();
    copyDroneState(this.state, fresh);
    copyDroneState(this.previous, fresh);
    this.flight = new FlightStateMachine();
    this.controller.reset(this.state);
    this.blender.snap(modeParams(this.currentMode));
    this.battery = new Battery(this.initialBattery);
    this.wind.reset();
    this.time = 0;
  }
}

/**
 * Ejecuta la simulación `seconds` segundos con una entrada que depende del tiempo.
 * Pensada para tests: permite comprobar un vuelo completo sin navegador.
 */
export function simulate(sim: Simulation, seconds: number, inputAt: (t: number) => ControlInput): void {
  const dt = 1 / simConfig.physicsHz;
  const steps = Math.round(seconds * simConfig.physicsHz);
  for (let i = 0; i < steps; i++) sim.step(dt, inputAt(sim.time));
}
