// HUD estilo DJI Fly: estado, modo, GPS, batería, viento, telemetría, avisos y radar de orientación.
// H = altura, D = distancia al home, V.H / V.V = velocidad horizontal / vertical.

import { batteryConfig, type WindLevel } from '../core/config';
import { FLIGHT_PHASE_LABELS, type FlightPhase } from '../control/flightState';
import { FLIGHT_MODE_LABELS, type FlightModeName } from '../control/modes';
import { RTH_STAGE_LABELS, type RthStage } from '../control/rth';
import { CAMERA_LABELS, type CameraMode } from '../render/cameras';
import { keyLabelFrom } from './keyLabels';
import { Radar } from './radar';
import { SETTINGS_KEY_CODE } from './tuningPanel';

const WIND_LEVEL_LABELS: Record<WindLevel, string> = {
  calm: 'calma',
  moderate: 'moderado',
  strong: 'fuerte',
};

// Avisos a la vez como máximo: más serían ruido
const MAX_WARNINGS = 2;

export interface HudData {
  mode: FlightModeName;
  /** Si el modo actual usa el GPS (todos menos ATTI) */
  gps: boolean;
  phase: FlightPhase;
  rthStage: RthStage;
  batteryPercent: number;
  batteryVoltage: number;
  windLevel: WindLevel;
  /** Viento en este momento (m/s, mundo), con ráfagas */
  windX: number;
  windZ: number;
  warnings: string[];
  altitude: number;
  distance: number;
  horizontalSpeed: number;
  verticalSpeed: number;
  /** Posición horizontal y rumbo, para el radar */
  x: number;
  z: number;
  heading: number;
  spaceMouseConnected: boolean;
  gamepadName: string | null;
  camera: CameraMode;
  /** Inclinación del gimbal (grados), se muestra en la FPV */
  gimbalDegrees: number;
}

function element(tag: string, className: string, text = ''): HTMLElement {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}

function metric(label: string): { root: HTMLElement; value: HTMLElement } {
  const root = element('div', 'hud-metric');
  const value = element('span', 'hud-metric-value', '–');
  root.append(element('span', 'hud-metric-label', label), value);
  return { root, value };
}

export class Hud {
  private readonly mode = element('span', 'hud-mode');
  private readonly phase = element('span', 'hud-phase');
  private readonly gps = element('p', 'hud-gps');
  private readonly battery = element('p', 'hud-battery');
  private readonly wind = element('p', 'hud-wind');
  private readonly altitude = metric('H');
  private readonly distance = metric('D');
  private readonly horizontalSpeed = metric('V.H');
  private readonly verticalSpeed = metric('V.V');
  /** Columna central de arriba con los avisos */
  private readonly center = element('div', 'hud-center');
  private readonly warnings = element('div', 'hud-warnings');
  /** Avisos que se están mostrando, para no rehacer el DOM en cada frame */
  private warningsKey = '';
  private readonly input = element('p', 'hud-input');
  private readonly gamepad = element('p', 'hud-input hud-input-on');
  private readonly camera = element('p', 'hud-input');
  /** Símbolo de la tecla de ajustes en el teclado del usuario (º, |, `...) */
  // Con aspecto de tecla: símbolos como | se confundirían con los separadores del texto
  private readonly settingsKey = element('kbd', 'hud-key', keyLabelFrom(null, SETTINGS_KEY_CODE));
  private readonly radar: Radar;

  constructor(root: HTMLElement, onOpenLessons: () => void) {
    const panel = element('div', 'hud-panel');
    const status = element('p', 'hud-status');
    status.append(this.mode, this.phase);
    const metrics = element('div', 'hud-metrics');
    metrics.append(this.altitude.root, this.distance.root, this.horizontalSpeed.root, this.verticalSpeed.root);
    panel.append(element('h1', 'hud-title', 'Drony Sim'), status, this.gps, this.battery, this.wind, metrics);

    const inputPanel = element('div', 'hud-panel hud-input-panel');
    inputPanel.append(this.input, this.gamepad, this.camera);

    const help = element(
      'p',
      'hud-help',
      'Espacio / botón izq.: despegar o aterrizar · E: motores · H: volver a casa · 1-4 / botón dcho.: modo · ' +
        'W/S: altura · A/D: giro · ↑↓←→: mover · C: cámara · Q/Z: gimbal · P: miniatura · V: viento · R: reiniciar · ' +
        'G: gráfica · ',
    );
    const lessons = element('button', 'link-button', 'Lecciones (L)');
    lessons.addEventListener('click', onOpenLessons);
    const devicesLink = document.createElement('a');
    devicesLink.href = '/devices.html';
    devicesLink.textContent = 'Dispositivos';
    // La tecla y su descripción, siempre en la misma línea
    const settings = element('span', 'hud-nowrap');
    settings.append(this.settingsKey, ': ajustes');
    help.append(settings, ' · ', lessons, ' · ', devicesLink);

    this.center.append(this.warnings);
    root.append(panel, this.center, inputPanel, help);
    this.radar = new Radar(root);
  }

  /** Pone el símbolo real de la tecla de ajustes (se conoce de forma asíncrona, ver ui/keyLabels) */
  setSettingsKeyLabel(label: string): void {
    this.settingsKey.textContent = label;
  }

  update(data: HudData): void {
    this.mode.textContent = FLIGHT_MODE_LABELS[data.mode];
    this.mode.dataset.mode = data.mode;
    const stage = data.phase === 'returning' ? ` · ${RTH_STAGE_LABELS[data.rthStage]}` : '';
    this.phase.textContent = ` · ${FLIGHT_PHASE_LABELS[data.phase]}${stage}`;
    this.gps.textContent = data.gps ? '● GPS: mantiene la posición' : '○ Sin GPS: no mantiene la posición';
    this.gps.classList.toggle('hud-gps-off', !data.gps);

    this.altitude.value.textContent = `${data.altitude.toFixed(1)} m`;
    this.distance.value.textContent = `${data.distance.toFixed(1)} m`;
    this.horizontalSpeed.value.textContent = `${data.horizontalSpeed.toFixed(1)} m/s`;
    this.verticalSpeed.value.textContent = `${data.verticalSpeed.toFixed(1)} m/s`;

    const percent = Math.round(data.batteryPercent);
    this.battery.textContent = `Batería ${percent} % · ${data.batteryVoltage.toFixed(1)} V`;
    this.battery.dataset.level =
      data.batteryPercent <= batteryConfig.rthPercent ? 'critical' : data.batteryPercent <= batteryConfig.lowPercent ? 'low' : 'ok';
    const windSpeed = Math.hypot(data.windX, data.windZ);
    this.wind.textContent = `Viento ${WIND_LEVEL_LABELS[data.windLevel]} · ${windSpeed.toFixed(1)} m/s`;

    const shown = data.warnings.slice(0, MAX_WARNINGS);
    const key = shown.join('|');
    if (key !== this.warningsKey) {
      this.warningsKey = key;
      this.warnings.replaceChildren(...shown.map((w) => element('p', 'hud-warning', `⚠ ${w}`)));
    }

    this.input.textContent = data.spaceMouseConnected
      ? '● SpaceMouse conectado'
      : '○ SpaceMouse: mueve la tapa para activarlo';
    this.input.classList.toggle('hud-input-on', data.spaceMouseConnected);
    // El nombre que da el navegador incluye vendor/product: nos quedamos con la parte legible
    this.gamepad.hidden = data.gamepadName === null;
    this.gamepad.textContent = `● Mando: ${data.gamepadName?.split('(')[0].trim() ?? ''}`;
    const gimbal = data.camera === 'fpv' ? ` · gimbal ${Math.round(data.gimbalDegrees)}° (Q/Z)` : '';
    this.camera.textContent = `${CAMERA_LABELS[data.camera]}${gimbal} (C)`;

    this.radar.update(data.x, data.z, data.heading, data.windX, data.windZ);
  }
}
