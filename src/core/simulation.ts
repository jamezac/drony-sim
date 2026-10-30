// La simulación completa sin navegador: estado del dron + máquina de estados + controlador +
// física + entorno (viento, efecto suelo) + batería + choques con los obstáculos del escenario.
// No sabe nada de Three.js más allá de sus tipos matemáticos, así que se puede probar en Vitest.

import { Vector3 } from 'three';
import { FlightController } from '../control/flightController';
import { FlightStateMachine, type FlightPhase } from '../control/flightState';
import type { MissionPlan } from '../control/mission';
import { ModeBlender, modeParams, type FlightModeName } from '../control/modes';
import { Battery } from '../physics/battery';
import { resolveCollisions, type Collider, type CrashTarget } from '../physics/collisions';
import { copyDroneState, createDroneState, MOTOR_COUNT, tiltOf, type DroneState } from '../physics/drone';
import { stepDynamics, type AirConditions } from '../physics/dynamics';
import { applyGroundContact, groundEffectFactor, Wind } from '../physics/environment';
import { collisionConfig, droneConfig, simConfig, windConfig, type WindLevel } from './config';
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

/** Cómo y cuándo se estrelló el dron */
export interface CrashInfo {
  target: CrashTarget;
  /** Velocidad del impacto (m/s) */
  speed: number;
  /** Momento del choque (tiempo de simulación, s) */
  time: number;
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
  /** Obstáculos del escenario actual */
  private colliders: readonly Collider[] = [];
  /** El choque que ha estrellado el dron, o null */
  crash: CrashInfo | null = null;
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

  /** Obstáculos con los que puede chocar el dron (los del escenario). */
  setColliders(colliders: readonly Collider[]): void {
    this.colliders = colliders;
  }

  /** Plan de la misión de waypoints (se copia: editarlo después no cambia el que se vuela). */
  setMissionPlan(plan: MissionPlan): void {
    this.controller.mission.setPlan(plan);
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
        missionReady: this.controller.mission.plan.waypoints.length > 0,
        missionEnd: this.controller.missionEnd,
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
    const impact = resolveCollisions(this.state, this.colliders);
    // Golpe contra el suelo: la velocidad justo antes de que el contacto la anule
    const wasAirborne = !this.state.onGround;
    const verticalImpact = Math.max(0, -this.state.velocity.y);
    const skid = Math.hypot(this.state.velocity.x, this.state.velocity.z);
    const tilt = tiltOf(this.state.orientation);
    applyGroundContact(this.state);
    this.detectCrash(impact.speed, impact.label, wasAirborne && this.state.onGround, verticalImpact, skid, tilt);

    const motorsOn = this.flight.phase !== 'disarmed' && this.flight.phase !== 'crashed';
    this.battery.update(this.state.motorThrust, motorsOn, dt);
    this.time += dt;
  }

  /**
   * ¿Ha sido el golpe lo bastante fuerte para romper hélices? Contra un obstáculo basta un choque
   * moderado; contra el suelo, las patas aguantan aterrizajes firmes, pero no una caída, ni
   * tocarlo muy inclinado o boca abajo (lo primero que llega al suelo son las hélices).
   */
  private detectCrash(
    obstacleSpeed: number,
    obstacle: CrashTarget | null,
    touchedGround: boolean,
    verticalImpact: number,
    skid: number,
    tilt: number,
  ): void {
    if (this.crash) return;
    const { obstacleCrashSpeed, groundCrashSpeed, groundSkidCrashSpeed, groundCrashTilt } = collisionConfig;
    if (obstacle && obstacleSpeed > obstacleCrashSpeed) {
      this.crashInto(obstacle, obstacleSpeed);
    } else if (touchedGround && tilt > groundCrashTilt) {
      this.crashInto('vuelco', verticalImpact);
    } else if (touchedGround && (verticalImpact > groundCrashSpeed || skid > groundSkidCrashSpeed)) {
      this.crashInto('suelo', Math.max(verticalImpact, skid));
    }
  }

  private crashInto(target: CrashTarget, speed: number): void {
    this.crash = { target, speed, time: this.time };
    this.flight.crash();
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
    this.crash = null;
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
