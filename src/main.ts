// Punto de entrada del simulador: une entrada, simulación (paso fijo), lecciones y render.
//
// Cada frame:
//   1. Se leen los sticks y botones (una vez por frame).
//   2. La física avanza en pasos fijos de 1/240 s (pueden ser 0, 1, 4, 5... según el frame).
//      Con un menú o los resultados abiertos, la simulación se pausa.
//   3. Si hay una lección en curso, se comprueba su objetivo.
//   4. Se dibuja interpolando entre los dos últimos pasos de física.

import * as THREE from 'three';
import { flightConfig, simConfig } from './core/config';
import { noActions, type ControlActions } from './core/controlInput';
import { FixedStepLoop } from './core/loop';
import { loadInputSettings, SETTINGS_STORAGE_KEY } from './core/settings';
import { Simulation } from './core/simulation';
import { modeParams, nextMode, parseModeName } from './control/modes';
import { headingOf, tiltOf } from './physics/drone';
import { nextWindLevel, parseWindLevel } from './physics/environment';
import { parseDemoName } from './input/demoInput';
import { InputManager } from './input/inputManager';
import { ChaseCamera, PilotCamera, type CameraMode } from './render/cameras';
import { DroneModel } from './render/droneModel';
import { MarkerLayer } from './render/markers';
import { createWorld } from './render/scene';
import { Windsock } from './render/windsock';
import { frameFromSimulation } from './training/lessonFrame';
import { LessonRun } from './training/lessonRun';
import { findLesson, nextLesson, type LessonDefinition } from './training/lessons';
import { loadRecords, saveIfRecord } from './training/records';
import { Hud } from './ui/hud';
import { LessonPanel } from './ui/lessonPanel';
import { LessonMenu, ResultsDialog } from './ui/menus';
import { StickView } from './ui/stickView';
import { TelemetryGraph } from './ui/telemetryGraph';
import { createTuningPanel } from './ui/tuningPanel';
import { activeWarnings } from './ui/warnings';
import './style.css';

// Fotogramas a renderizar antes de avisar a `npm run check` de que la página está lista
const FRAMES_BEFORE_READY = 10;
// ?demo=sticks mueve los sticks a los 4 s; damos 1,5 s más para que se vea el dron moviéndose
const STICKS_DEMO_READY_SECONDS = 5.5;
// ?demo=rth pulsa "volver a casa" a los 8 s; a los 11 ya está subiendo o volviendo
const RTH_DEMO_READY_SECONDS = 11;
// Con viento el dron nunca está del todo quieto: se espera a que lleve un rato en hover
const WINDY_HOVER_READY_SECONDS = 8;
const RAD_TO_DEG = 180 / Math.PI;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id}`);
  return element as T;
}

// Parámetros de la URL: ?demo=hover|sticks|rth (vuelo automático), ?mode=cine|normal|sport|atti,
// ?wind=calma|moderado|fuerte, ?battery=25 (batería inicial en %), ?graph=1,
// ?lesson=<id> (empezar una lección), ?menu=lecciones (abrir el menú de lecciones)
const params = new URLSearchParams(window.location.search);
const demo = parseDemoName(params.get('demo'));

// --- Escena ---
const world = createWorld(byId<HTMLCanvasElement>('scene'));
const drone = new DroneModel();
const windsock = new Windsock();
const markers = new MarkerLayer();
world.scene.add(drone.group, windsock.group, markers.group);
const chase = new ChaseCamera();
const pilot = new PilotCamera();
let cameraMode: CameraMode = 'chase';

// --- Simulación y entrada ---
const batteryParam = Number(params.get('battery'));
const sim = new Simulation({
  mode: parseModeName(params.get('mode')) ?? 'normal',
  wind: parseWindLevel(params.get('wind')) ?? undefined,
  batteryPercent: batteryParam > 0 && batteryParam <= 100 ? batteryParam : 100,
});
const input = new InputManager(loadInputSettings(), demo);
const loop = new FixedStepLoop(1 / simConfig.physicsHz, simConfig.maxFrameSeconds);
const tuningPanel = createTuningPanel(input);

// Si los ajustes cambian en otra pestaña (p. ej. al calibrar en devices.html), se aplican aquí al momento
window.addEventListener('storage', (event) => {
  if (event.key !== SETTINGS_STORAGE_KEY) return;
  Object.assign(input.settings, loadInputSettings());
  tuningPanel.refresh();
});

// --- Interfaz ---
const hudRoot = byId('hud');
const hud = new Hud(hudRoot, () => menu.open(loadRecords()));
const stickView = new StickView(hudRoot);
const graph = new TelemetryGraph(hudRoot, params.get('graph') === '1');
const lessonPanel = new LessonPanel(hudRoot);
const menu = new LessonMenu(hudRoot, (lesson) => startLesson(lesson));
const results = new ResultsDialog(hudRoot, {
  retry: () => lessonRun && startLesson(lessonRun.lesson),
  next: () => {
    const next = lessonRun && nextLesson(lessonRun.lesson);
    if (next) startLesson(next);
  },
  menu: () => {
    results.close();
    menu.open(loadRecords());
  },
  freeFlight: () => endLesson(),
});

// --- Lecciones ---
let lessonRun: LessonRun | null = null;
/** Tiempo de simulación en el último frame: la lección avanza con él (no corre con la pausa) */
let lastSimTime = 0;

function snapCameras(): void {
  chase.snap(sim.state.position, headingOf(sim.state.orientation));
  pilot.snap(sim.state.position);
}

function startLesson(lesson: LessonDefinition): void {
  const { mode, wind, camera, airborne } = lesson.setup;
  sim.resetWith({ mode, wind, batteryPercent: 100 });
  if (airborne) sim.spawnFlying(airborne);
  cameraMode = camera;
  snapCameras();
  lessonRun = new LessonRun(lesson);
  lastSimTime = sim.time;
  menu.close();
  results.close();
}

/** Deja la lección y vuelve al vuelo libre (el dron sigue donde está). */
function endLesson(): void {
  lessonRun = null;
  markers.clear();
  lessonPanel.hide();
  results.close();
}

function updateLesson(frameSticks: Parameters<typeof frameFromSimulation>[1]): void {
  if (!lessonRun) return;
  const wasRunning = lessonRun.status === 'running';
  lessonRun.update(frameFromSimulation(sim, frameSticks), sim.time - lastSimTime);
  lastSimTime = sim.time;
  markers.sync(lessonRun.markers());
  markers.follow(sim.state.position.x, sim.state.position.z);
  lessonPanel.show(lessonRun.view);

  if (wasRunning && lessonRun.status !== 'running') {
    const completed = lessonRun.status === 'completed';
    const rating = completed ? lessonRun.rating() : null;
    const seconds = lessonRun.elapsed;
    const newRecord = completed && rating ? saveIfRecord(lessonRun.lesson.id, { stars: rating.stars, seconds }) : false;
    results.show({
      lesson: lessonRun.lesson,
      completed,
      failure: lessonRun.failure,
      rating,
      seconds,
      newRecord,
      hasNext: nextLesson(lessonRun.lesson) !== null,
    });
  }
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyL' && !results.isOpen) {
    if (menu.isOpen) menu.close();
    else menu.open(loadRecords());
  } else if (event.code === 'Escape') {
    if (menu.isOpen) menu.close();
    else if (lessonRun) endLesson();
  }
});

const initialLesson = findLesson(params.get('lesson'));
if (initialLesson) startLesson(initialLesson);
if (params.get('menu') === 'lecciones') menu.open(loadRecords());

// --- Bucle principal ---
function resize(): void {
  const { innerWidth: width, innerHeight: height } = window;
  world.renderer.setSize(width, height, false);
  chase.setAspect(width / height);
  pilot.setAspect(width / height);
}
window.addEventListener('resize', resize);
resize();
snapCameras();

// Pose interpolada que se dibuja
const pose = { position: new THREE.Vector3(), orientation: new THREE.Quaternion(), motorThrust: sim.state.motorThrust };

// Acciones pulsadas que aún no ha consumido ningún paso de física (un frame puede no tener pasos)
let pendingActions: ControlActions = noActions();
let lastTimeMs: number | null = null;
let frames = 0;

/** ¿La página muestra ya lo que tiene que mostrar? (lo espera `npm run check`) */
function isReady(): boolean {
  if (frames < FRAMES_BEFORE_READY) return false;
  if (demo === 'sticks') return sim.phase === 'flying' && sim.time > STICKS_DEMO_READY_SECONDS;
  if (demo === 'rth') return sim.phase === 'returning' && sim.time > RTH_DEMO_READY_SECONDS;
  if (demo !== 'hover') return true;
  if (sim.wind.meanSpeed > 0) return sim.phase === 'flying' && sim.time > WINDY_HOVER_READY_SECONDS;
  const hovering = sim.phase === 'flying' && sim.state.velocity.length() < 0.05;
  return hovering && Math.abs(sim.altitude - flightConfig.takeoffAltitude) < 0.05;
}

world.renderer.setAnimationLoop((timeMs: number) => {
  const frameSeconds = lastTimeMs === null ? 0 : (timeMs - lastTimeMs) / 1000;
  lastTimeMs = timeMs;
  const paused = menu.isOpen || results.isOpen;

  const frameInput = input.sample(frameSeconds);
  if (frameInput.reset) {
    if (lessonRun) startLesson(lessonRun.lesson);
    else {
      sim.reset();
      snapCameras();
    }
  }
  if (frameInput.toggleCamera) cameraMode = cameraMode === 'chase' ? 'pilot' : 'chase';
  // En una lección el modo, el viento y el RTH los fija la lección
  if (!lessonRun) {
    if (frameInput.modeRequest) {
      sim.setMode(frameInput.modeRequest === 'next' ? nextMode(sim.mode) : frameInput.modeRequest);
    }
    if (frameInput.cycleWind) sim.setWind(nextWindLevel(sim.wind.level));
  }
  pendingActions = {
    toggleMotors: pendingActions.toggleMotors || frameInput.actions.toggleMotors,
    takeoffLand: pendingActions.takeoffLand || frameInput.actions.takeoffLand,
    returnHome: !lessonRun && (pendingActions.returnHome || frameInput.actions.returnHome),
  };

  let alpha = 1;
  if (!paused) {
    alpha = loop.advance(frameSeconds, (dt) => {
      sim.step(dt, { sticks: frameInput.sticks, actions: pendingActions });
      pendingActions = noActions();
    });
    updateLesson(frameInput.sticks);
  }

  // Interpolación entre el paso anterior y el actual: movimiento suave a cualquier fps
  pose.position.lerpVectors(sim.previous.position, sim.state.position, alpha);
  pose.orientation.slerpQuaternions(sim.previous.orientation, sim.state.orientation, alpha);
  drone.update(pose, paused ? 0 : frameSeconds);
  chase.update(pose.position, headingOf(pose.orientation), frameSeconds);
  pilot.update(pose.position, frameSeconds);
  world.followWithSun(pose.position);
  windsock.update(sim.wind.velocity, frameSeconds);

  const { velocity, position } = sim.state;
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  const gps = modeParams(sim.mode).positionHold;
  const distance = Math.hypot(position.x, position.z);
  const wind = sim.wind.velocity;
  hud.update({
    mode: sim.mode,
    gps,
    phase: sim.phase,
    rthStage: sim.controller.rthStage,
    batteryPercent: sim.battery.percent,
    batteryVoltage: sim.battery.voltage,
    windLevel: sim.wind.level,
    windX: wind.x,
    windZ: wind.z,
    warnings: activeWarnings({
      batteryPercent: sim.battery.percent,
      phase: sim.phase,
      forcedLanding: sim.forcedLanding,
      gps,
      altitude: sim.altitude,
      distance,
      windSpeed: Math.hypot(wind.x, wind.z),
    }),
    altitude: sim.altitude,
    distance,
    horizontalSpeed,
    verticalSpeed: velocity.y,
    x: pose.position.x,
    z: pose.position.z,
    heading: headingOf(pose.orientation),
    spaceMouseConnected: frameInput.spaceMouseConnected,
    gamepadName: frameInput.gamepadName,
    camera: cameraMode,
  });
  stickView.update(frameInput.sticks);

  const { telemetry } = sim.controller;
  graph.push({
    altitude: sim.altitude,
    altitudeSetpoint: telemetry.altitudeSetpoint,
    speed: horizontalSpeed,
    speedSetpoint: telemetry.horizontalSpeedSetpoint,
    tilt: tiltOf(sim.state.orientation) * RAD_TO_DEG,
    tiltSetpoint: telemetry.desiredTilt * RAD_TO_DEG,
  });

  world.renderer.render(world.scene, cameraMode === 'chase' ? chase.camera : pilot.camera);
  frames++;
  if (!window.__dronyReady && isReady()) window.__dronyReady = true;
});
