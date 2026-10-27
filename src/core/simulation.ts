// La simulación completa sin navegador: estado del dron + máquina de estados + controlador + física.
// No sabe nada de Three.js más allá de sus tipos matemáticos, así que se puede probar en Vitest.

import { FlightController } from '../control/flightController';
import { FlightStateMachine, type FlightPhase } from '../control/flightState';
import { ModeBlender, modeParams, type FlightModeName } from '../control/modes';
import { copyDroneState, createDroneState, type DroneState } from '../physics/drone';
import { stepDynamics } from '../physics/dynamics';
import { applyGroundContact } from '../physics/environment';
import { droneConfig, simConfig } from './config';
import type { ControlInput } from './controlInput';

export class Simulation {
  readonly state: DroneState = createDroneState();
  /** Estado del paso anterior: el render interpola entre este y `state` */
  readonly previous: DroneState = createDroneState();
  readonly controller = new FlightController();
  private flight = new FlightStateMachine();
  private currentMode: FlightModeName;
  /** Límites efectivos: pasan de un modo a otro de forma gradual */
  private readonly blender: ModeBlender;
  time = 0;

  constructor(mode: FlightModeName = 'normal') {
    this.currentMode = mode;
    this.blender = new ModeBlender(modeParams(mode));
  }

  get mode(): FlightModeName {
    return this.currentMode;
  }

  /** Cambia de modo en cualquier momento, también en vuelo (los límites cambian suavemente). */
  setMode(mode: FlightModeName): void {
    this.currentMode = mode;
  }

  get phase(): FlightPhase {
    return this.flight.phase;
  }

  /** Altura sobre el suelo (m), 0 posado */
  get altitude(): number {
    return this.state.position.y - droneConfig.restHeight;
  }

  step(dt: number, input: ControlInput): void {
    copyDroneState(this.previous, this.state);
    const phase = this.flight.update(
      { sticks: input.sticks, actions: input.actions, onGround: this.state.onGround, altitude: this.altitude },
      dt,
    );
    const limits = this.blender.update(modeParams(this.currentMode), dt);
    const commands = this.controller.update(this.state, phase, input.sticks, limits, dt);
    stepDynamics(this.state, commands, dt);
    applyGroundContact(this.state);
    this.time += dt;
  }

  reset(): void {
    const fresh = createDroneState();
    copyDroneState(this.state, fresh);
    copyDroneState(this.previous, fresh);
    this.flight = new FlightStateMachine();
    this.controller.reset(this.state);
    this.blender.snap(modeParams(this.currentMode));
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
