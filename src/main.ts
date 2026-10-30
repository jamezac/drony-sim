// Punto de entrada del simulador: une entrada, simulación (paso fijo), lecciones y render.
//
// Cada frame:
//   1. Se leen los sticks y botones (una vez por frame).
//   2. La física avanza en pasos fijos de 1/240 s (pueden ser 0, 1, 4, 5... según el frame).
//      Con un menú o los resultados abiertos, la simulación se pausa.
//   3. Si hay una lección en curso, se comprueba su objetivo.
//   4. Se dibuja interpolando entre los dos últimos pasos de física.

import * as THREE from 'three';
import { flightConfig, fpvSettings, renderConfig, simConfig } from './core/config';
import { noActions, type ControlActions } from './core/controlInput';
import { FixedStepLoop } from './core/loop';
import { loadInputSettings, SETTINGS_STORAGE_KEY } from './core/settings';
import { Simulation } from './core/simulation';
import { FLIGHT_PHASE_LABELS } from './control/flightState';
import { createMissionPlan, type MissionPlan } from './control/mission';
import { modeParams, nextMode, parseModeName } from './control/modes';
import { describeCrash } from './physics/collisions';
import { headingOf, tiltOf } from './physics/drone';
import { nextWindLevel, parseWindLevel } from './physics/environment';
import { parseDemoName } from './input/demoInput';
import { InputManager } from './input/inputManager';
import {
  ChaseCamera,
  FpvCamera,
  nextCamera,
  parseCameraMode,
  PilotCamera,
  pipRect,
  type CameraMode,
} from './render/cameras';
import { DroneModel } from './render/droneModel';
import { MarkerLayer } from './render/markers';
import { createWorld } from './render/scene';
import { buildScenarioView, disposeScenarioView } from './render/scenarioView';
import { Windsock } from './render/windsock';
import {
  buildScenario,
  nextScenario,
  parseScenarioName,
  scenarioColliders,
  type Scenario,
  type ScenarioName,
} from './scenarios/scenarios';
import type { MarkerSpec } from './training/goals';
import { frameFromSimulation } from './training/lessonFrame';
import { LessonRun } from './training/lessonRun';
import { findLesson, nextLesson, type LessonDefinition } from './training/lessons';
import { loadRecords, saveIfRecord } from './training/records';
import { Hud } from './ui/hud';
import { CrashOverlay } from './ui/crashOverlay';
import { LessonPanel } from './ui/lessonPanel';
import { PipFrame } from './ui/pipFrame';
import { LessonMenu, ResultsDialog } from './ui/menus';
import { MissionMap, type MissionMapView } from './ui/missionMap';
import { StickView } from './ui/stickView';
import { TelemetryGraph } from './ui/telemetryGraph';
import { keyLabel } from './ui/keyLabels';
import { createTuningPanel, SETTINGS_KEY_CODE } from './ui/tuningPanel';
import { activeWarnings } from './ui/warnings';
import './style.css';

// Fotogramas a renderizar antes de avisar a `npm run check` de que la página está lista
const FRAMES_BEFORE_READY = 10;
// ?demo=crash se estrella hacia los 6 s; se espera a que el dron esté ya caído
const CRASH_DEMO_READY_SECONDS = 2;
// ?demo=sticks mueve los sticks a los 4 s; damos 1,5 s más para que se vea el dron moviéndose
const STICKS_DEMO_READY_SECONDS = 5.5;
// ?demo=rth pulsa "volver a casa" a los 8 s; a los 11 ya está subiendo o volviendo
const RTH_DEMO_READY_SECONDS = 11;
// ?demo=orbit pulsa O a los 6,5 s; a los 12 ya lleva un buen trozo de círculo
const ORBIT_DEMO_READY_SECONDS = 12;
// ?demo=mission empieza la misión a los 4 s; a los 14,5 va del punto 2 al 3, con el resto por delante
const MISSION_DEMO_READY_SECONDS = 14.5;
// El recorrido de ?demo=mission: delante del despegue (que mira a −Z) y de vuelta a casa
const DEMO_MISSION: MissionPlan = {
  waypoints: [
    { x: 0, z: -15, altitude: 6 },
    { x: 12, z: -28, altitude: 10 },
    { x: 26, z: -12, altitude: 8 },
    { x: 12, z: 2, altitude: 5 },
  ],
  speed: 5,
  finish: 'home',
};
// ?demo=flip: la captura se hace con el dron ya muy inclinado, en mitad del flip
const FLIP_DEMO_READY_TILT = (120 * Math.PI) / 180;
// Con viento el dron nunca está del todo quieto: se espera a que lleve un rato en hover
const WINDY_HOVER_READY_SECONDS = 8;
const RAD_TO_DEG = 180 / Math.PI;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id}`);
  return element as T;
}

// Parámetros de la URL: ?demo=hover|sticks|rth|crash|flip|orbit|mission (vuelo automático),
// ?mode=cine|normal|sport|atti|acro, ?wind=calma|moderado|fuerte, ?battery=25 (batería inicial en %), ?graph=1,
// ?lesson=<id> (empezar una lección), ?menu=lecciones|mision (abrir el menú de lecciones o el mapa de la misión),
// ?camera=chase|pilot|fpv, ?scenario=libre|parque|ciudad|obstaculos
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
const fpv = new FpvCamera();
let cameraMode: CameraMode = parseCameraMode(params.get('camera')) ?? 'chase';
/** Miniatura de la FPV en las vistas exteriores (tecla P) */
let pipEnabled = true;
// La sombra se calcula una vez por frame, aunque se dibuje dos veces (vista principal + miniatura)
world.renderer.shadowMap.autoUpdate = false;

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
const pipFrame = new PipFrame(hudRoot);
const crashOverlay = new CrashOverlay(hudRoot);

// --- Misión de waypoints: el plan lo edita el mapa (tecla M) ---
const missionPlan = createMissionPlan();
/** El botón del mapa pidió volar (o detener) la misión: lo consume el siguiente paso de física */
let missionRequested = false;

// --- Escenario ---
let scenario: Scenario = buildScenario('libre');
let scenarioView: THREE.Group | null = null;

/** Cambia de escenario: modelos 3D, obstáculos de la física y conos de referencia. */
function loadScenario(name: ScenarioName): void {
  if (scenarioView) {
    world.scene.remove(scenarioView);
    disposeScenarioView(scenarioView);
  }
  scenario = buildScenario(name);
  scenarioView = buildScenarioView(scenario);
  world.scene.add(scenarioView);
  sim.setColliders(scenarioColliders(scenario.objects));
  world.setReferenceCones(scenario.showReferenceCones);
  // Los puntos se ponen pensando en los obstáculos de un escenario: en otro no valen
  missionPlan.waypoints.length = 0;
}
loadScenario(parseScenarioName(params.get('scenario')) ?? 'libre');
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
const missionMap = new MissionMap(hudRoot, missionPlan, () => {
  // Se vuela una copia: lo que se edite después en el mapa no cambia la misión en curso
  if (sim.phase !== 'mission') sim.setMissionPlan(missionPlan);
  missionRequested = true;
  missionMap.close();
});

/** Lo que el mapa de la misión enseña del vuelo (se abre con la simulación en pausa). */
function missionMapView(): MissionMapView {
  const { positionHold: gps, maxSpeed } = modeParams(sim.mode);
  const { phase } = sim;
  const inAir = (phase === 'flying' || phase === 'orbiting') && sim.altitude > flightConfig.airborneHeight;
  const onGround = phase === 'disarmed' || phase === 'armed' || phase === 'flying';
  return {
    colliders: scenarioColliders(scenario.objects),
    drone: {
      x: sim.state.position.x,
      z: sim.state.position.z,
      altitude: sim.altitude,
      heading: headingOf(sim.state.orientation),
    },
    blocked: !gps
      ? 'Sin GPS (ATTI, Acro) no hay misiones: pasa a Normal (2).'
      : phase === 'mission' || inAir
        ? null
        : phase === 'crashed'
          ? 'El dron está estrellado: pulsa R para reiniciar.'
          : onGround
            ? 'Despega primero (Espacio) y abre el mapa ya en el aire.'
            : `Espera a que acabe la maniobra automática (${FLIGHT_PHASE_LABELS[phase].toLowerCase()}).`,
    activeIndex: phase === 'mission' ? sim.controller.mission.index : null,
    modeMaxSpeed: maxSpeed,
  };
}

// Símbolo real de la tecla de ajustes en el teclado del usuario (º en España, | en Latinoamérica,
// ` en EE. UU....). Se vuelve a consultar al volver a la ventana, por si cambió el idioma del teclado.
function refreshKeyLabels(): void {
  void keyLabel(SETTINGS_KEY_CODE).then((label) => {
    hud.setSettingsKeyLabel(label);
    tuningPanel.setKeyLabel(label);
  });
}
refreshKeyLabels();
window.addEventListener('focus', refreshKeyLabels);

// --- Lecciones ---
let lessonRun: LessonRun | null = null;
/** Tiempo de simulación en el último frame: la lección avanza con él (no corre con la pausa) */
let lastSimTime = 0;

function snapCameras(): void {
  chase.snap(sim.state.position, headingOf(sim.state.orientation));
  pilot.snap(sim.state.position);
  fpv.snap();
}

function startLesson(lesson: LessonDefinition): void {
  const { mode, wind, camera, airborne, scenario: lessonScenario = 'libre' } = lesson.setup;
  if (scenario.name !== lessonScenario) loadScenario(lessonScenario);
  sim.resetWith({ mode, wind, batteryPercent: 100 });
  if (airborne) sim.spawnFlying(airborne);
  cameraMode = camera;
  snapCameras();
  lessonRun = new LessonRun(lesson);
  lastSimTime = sim.time;
  missionMap.close();
  menu.close();
  results.close();
}

/** En vuelo libre, durante una órbita: el punto de interés (un poste) y el círculo en el suelo. */
function orbitMarkers(): MarkerSpec[] {
  if (sim.phase !== 'orbiting') return [];
  const { center, radius } = sim.controller.orbit;
  // Radio redondeado: los marcadores solo se rehacen cuando cambia de verdad
  return [
    { kind: 'pole', x: center.x, z: center.z, height: 6 },
    { kind: 'groundCircle', x: center.x, z: center.z, radius: Math.round(radius * 10) / 10 },
  ];
}

/** En vuelo libre, los puntos de la misión planificada y, durante la misión, cuáles faltan. */
function missionMarkers(): MarkerSpec[] {
  const { waypoints } = missionPlan;
  const next = sim.phase === 'mission' ? sim.controller.mission.index : null;
  const state = (i: number) => (next === null || i > next ? 'pending' : i === next ? 'next' : 'done');
  const route: MarkerSpec[] = waypoints.length > 1 ? [{ kind: 'route', points: waypoints }] : [];
  return [
    ...route,
    ...waypoints.map((w, i): MarkerSpec => ({ kind: 'waypoint', x: w.x, z: w.z, altitude: w.altitude, state: state(i) })),
  ];
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
  if (event.code === 'KeyL' && !results.isOpen && !missionMap.isOpen) {
    if (menu.isOpen) menu.close();
    else menu.open(loadRecords());
  } else if (event.code === 'KeyM' && !lessonRun && !menu.isOpen && !results.isOpen) {
    // En una lección no hay misiones: harían el ejercicio por ti
    missionMap.toggle(missionMapView);
  } else if (event.code === 'Escape') {
    if (missionMap.isOpen) missionMap.close();
    else if (menu.isOpen) menu.close();
    else if (lessonRun) endLesson();
  }
});

const initialLesson = findLesson(params.get('lesson'));
if (initialLesson) startLesson(initialLesson);
// ?demo=mission: el recorrido ya está planificado (la demo pulsa "volar" en vez de usar el mapa)
if (demo === 'mission') {
  Object.assign(missionPlan, { ...DEMO_MISSION, waypoints: DEMO_MISSION.waypoints.map((w) => ({ ...w })) });
  sim.setMissionPlan(missionPlan);
}
if (params.get('menu') === 'lecciones') menu.open(loadRecords());
if (params.get('menu') === 'mision' && !lessonRun) missionMap.open(missionMapView());

// --- Bucle principal ---
const viewport = { width: 1, height: 1 };

function resize(): void {
  viewport.width = window.innerWidth;
  viewport.height = window.innerHeight;
  world.renderer.setSize(viewport.width, viewport.height, false);
  chase.setAspect(viewport.width / viewport.height);
  pilot.setAspect(viewport.width / viewport.height);
}

/**
 * Dibuja la vista principal y, en las vistas exteriores, la miniatura de la FPV encima.
 * La miniatura se dibuja en un rectángulo de la misma imagen (scissor): no hace falta otro canvas.
 */
function render(): void {
  const { renderer, scene } = world;
  renderer.shadowMap.needsUpdate = true;
  const { width, height } = viewport;
  if (cameraMode === 'fpv') fpv.setAspect(width / height);
  const main = cameraMode === 'chase' ? chase.camera : cameraMode === 'pilot' ? pilot.camera : fpv.camera;
  renderer.render(scene, main);

  const showPip = pipEnabled && cameraMode !== 'fpv';
  const rect = showPip ? pipRect(width, height) : null;
  pipFrame.update(rect, fpv.pitch * RAD_TO_DEG);
  if (!rect) return;
  fpv.setAspect(rect.width / rect.height);
  renderer.setScissorTest(true);
  renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
  renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
  renderer.render(scene, fpv.camera);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);
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
  // Con el mapa abierto la simulación está parada: ya se ve lo que hay que ver
  if (missionMap.isOpen) return true;
  if (demo === 'sticks') return sim.phase === 'flying' && sim.time > STICKS_DEMO_READY_SECONDS;
  if (demo === 'rth') return sim.phase === 'returning' && sim.time > RTH_DEMO_READY_SECONDS;
  if (demo === 'crash') return sim.crash !== null && sim.time - sim.crash.time > CRASH_DEMO_READY_SECONDS;
  if (demo === 'flip') return tiltOf(sim.state.orientation) > FLIP_DEMO_READY_TILT;
  if (demo === 'orbit') return sim.phase === 'orbiting' && sim.time > ORBIT_DEMO_READY_SECONDS;
  if (demo === 'mission') return sim.phase === 'mission' && sim.time > MISSION_DEMO_READY_SECONDS;
  if (demo !== 'hover') return true;
  if (sim.wind.meanSpeed > 0) return sim.phase === 'flying' && sim.time > WINDY_HOVER_READY_SECONDS;
  const hovering = sim.phase === 'flying' && sim.state.velocity.length() < 0.05;
  return hovering && Math.abs(sim.altitude - flightConfig.takeoffAltitude) < 0.05;
}

world.renderer.setAnimationLoop((timeMs: number) => {
  const frameSeconds = lastTimeMs === null ? 0 : (timeMs - lastTimeMs) / 1000;
  lastTimeMs = timeMs;
  const paused = menu.isOpen || results.isOpen || missionMap.isOpen;

  const frameInput = input.sample(frameSeconds);
  if (frameInput.reset) {
    if (lessonRun) startLesson(lessonRun.lesson);
    else {
      sim.reset();
      snapCameras();
    }
  }
  if (frameInput.toggleCamera) cameraMode = nextCamera(cameraMode);
  if (frameInput.togglePip) pipEnabled = !pipEnabled;
  // En una lección el modo, el viento y el RTH los fija la lección
  if (!lessonRun) {
    if (frameInput.modeRequest) {
      sim.setMode(frameInput.modeRequest === 'next' ? nextMode(sim.mode) : frameInput.modeRequest);
    }
    if (frameInput.cycleWind) sim.setWind(nextWindLevel(sim.wind.level));
    if (frameInput.cycleScenario) {
      loadScenario(nextScenario(scenario.name));
      sim.reset();
      snapCameras();
    }
  }
  pendingActions = {
    toggleMotors: pendingActions.toggleMotors || frameInput.actions.toggleMotors,
    takeoffLand: pendingActions.takeoffLand || frameInput.actions.takeoffLand,
    // En una lección el RTH, la órbita y la misión no están: harían el ejercicio por ti
    returnHome: !lessonRun && (pendingActions.returnHome || frameInput.actions.returnHome),
    orbit: !lessonRun && (pendingActions.orbit || frameInput.actions.orbit),
    mission: !lessonRun && (pendingActions.mission || frameInput.actions.mission || missionRequested),
  };
  missionRequested = false;

  let alpha = 1;
  if (!paused) {
    alpha = loop.advance(frameSeconds, (dt) => {
      sim.step(dt, { sticks: frameInput.sticks, actions: pendingActions });
      pendingActions = noActions();
    });
    updateLesson(frameInput.sticks);
  }
  if (!lessonRun) markers.sync([...orbitMarkers(), ...missionMarkers()]);

  // Interpolación entre el paso anterior y el actual: movimiento suave a cualquier fps
  pose.position.lerpVectors(sim.previous.position, sim.state.position, alpha);
  pose.orientation.slerpQuaternions(sim.previous.orientation, sim.state.orientation, alpha);
  drone.update(pose, paused ? 0 : frameSeconds);
  // Estrellado o muy inclinado (un flip), el rumbo del dron deja de tener sentido: la cámara no lo sigue
  const followHeading = !sim.crash && tiltOf(pose.orientation) < renderConfig.chaseFollowMaxTilt;
  chase.update(pose.position, followHeading ? headingOf(pose.orientation) : null, frameSeconds);
  pilot.update(pose.position, frameSeconds);
  // En Acro la cámara va fija al cuerpo, como en un dron FPV: un gimbal no puede seguir un flip
  const { positionHold: gps, selfLevel } = modeParams(sim.mode);
  const stabilized = fpvSettings.stabilized && selfLevel;
  fpv.update(pose.position, pose.orientation, headingOf(pose.orientation), frameInput.gimbal, frameSeconds, stabilized);
  world.followWithSun(pose.position);
  windsock.update(sim.wind.velocity, frameSeconds);

  const { velocity, position } = sim.state;
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
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
      acro: !selfLevel,
      inLesson: lessonRun !== null,
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
    gimbalDegrees: fpv.pitch * RAD_TO_DEG,
    scenario: scenario.label,
    orbit: sim.phase === 'orbiting' ? { radius: sim.controller.orbit.radius, speed: sim.controller.orbit.speed } : null,
    mission:
      sim.phase === 'mission'
        ? { index: sim.controller.mission.index, count: sim.controller.mission.plan.waypoints.length }
        : null,
  });
  // En una lección, el crash se cuenta en la pantalla de resultados
  crashOverlay.update(sim.crash && !lessonRun ? describeCrash(sim.crash.target, sim.crash.speed) : null);
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

  render();
  frames++;
  if (!window.__dronyReady && isReady()) window.__dronyReady = true;
});
