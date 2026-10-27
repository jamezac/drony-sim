// Punto de entrada del simulador: une entrada, simulación (paso fijo) y render.
//
// Cada frame:
//   1. Se leen los sticks y botones (una vez por frame).
//   2. La física avanza en pasos fijos de 1/240 s (pueden ser 0, 1, 4, 5... según el frame).
//   3. Se dibuja interpolando entre los dos últimos pasos de física.

import * as THREE from 'three';
import { flightConfig, simConfig } from './core/config';
import { noActions, type ControlActions } from './core/controlInput';
import { FixedStepLoop } from './core/loop';
import { Simulation } from './core/simulation';
import { FLIGHT_MODE_LABELS } from './control/modes';
import { headingOf } from './physics/drone';
import { parseDemoName } from './input/demoInput';
import { InputManager } from './input/inputManager';
import { ChaseCamera } from './render/cameras';
import { DroneModel } from './render/droneModel';
import { createWorld } from './render/scene';
import { Hud } from './ui/hud';
import { createTuningPanel } from './ui/tuningPanel';
import './style.css';

// Fotogramas a renderizar antes de avisar a `npm run check` de que la página está lista
const FRAMES_BEFORE_READY = 10;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id}`);
  return element as T;
}

const demo = parseDemoName(new URLSearchParams(window.location.search).get('demo'));

const world = createWorld(byId<HTMLCanvasElement>('scene'));
const drone = new DroneModel();
world.scene.add(drone.group);
const chase = new ChaseCamera();
const hud = new Hud(byId('hud'));

const sim = new Simulation();
const input = new InputManager(demo);
const loop = new FixedStepLoop(1 / simConfig.physicsHz, simConfig.maxFrameSeconds);
createTuningPanel(input);

function resize(): void {
  const { innerWidth: width, innerHeight: height } = window;
  world.renderer.setSize(width, height, false);
  chase.setAspect(width / height);
}
window.addEventListener('resize', resize);
resize();
chase.snap(sim.state.position, headingOf(sim.state.orientation));

// Pose interpolada que se dibuja
const pose = { position: new THREE.Vector3(), orientation: new THREE.Quaternion(), motorThrust: sim.state.motorThrust };

// Acciones pulsadas que aún no ha consumido ningún paso de física (un frame puede no tener pasos)
let pendingActions: ControlActions = noActions();
let lastTimeMs: number | null = null;
let frames = 0;

/** ¿La página muestra ya lo que tiene que mostrar? (lo espera `npm run check`) */
function isReady(): boolean {
  if (frames < FRAMES_BEFORE_READY) return false;
  if (demo !== 'hover') return true;
  const hovering = sim.phase === 'flying' && sim.state.velocity.length() < 0.05;
  return hovering && Math.abs(sim.altitude - flightConfig.takeoffAltitude) < 0.05;
}

world.renderer.setAnimationLoop((timeMs: number) => {
  const frameSeconds = lastTimeMs === null ? 0 : (timeMs - lastTimeMs) / 1000;
  lastTimeMs = timeMs;

  const frameInput = input.sample(frameSeconds);
  if (frameInput.reset) {
    sim.reset();
    chase.snap(sim.state.position, headingOf(sim.state.orientation));
  }
  pendingActions = {
    toggleMotors: pendingActions.toggleMotors || frameInput.actions.toggleMotors,
    takeoffLand: pendingActions.takeoffLand || frameInput.actions.takeoffLand,
  };

  const alpha = loop.advance(frameSeconds, (dt) => {
    sim.step(dt, { sticks: frameInput.sticks, actions: pendingActions });
    pendingActions = noActions();
  });

  // Interpolación entre el paso anterior y el actual: movimiento suave a cualquier fps
  pose.position.lerpVectors(sim.previous.position, sim.state.position, alpha);
  pose.orientation.slerpQuaternions(sim.previous.orientation, sim.state.orientation, alpha);
  drone.update(pose, frameSeconds);
  chase.update(pose.position, headingOf(pose.orientation), frameSeconds);
  world.followWithSun(pose.position);

  const { velocity, position } = sim.state;
  hud.update({
    mode: FLIGHT_MODE_LABELS[sim.mode],
    phase: sim.phase,
    altitude: sim.altitude,
    distance: Math.hypot(position.x, position.z),
    horizontalSpeed: Math.hypot(velocity.x, velocity.z),
    verticalSpeed: velocity.y,
    spaceMouseConnected: frameInput.spaceMouseConnected,
  });

  world.renderer.render(world.scene, chase.camera);
  frames++;
  if (!window.__dronyReady && isReady()) window.__dronyReady = true;
});
