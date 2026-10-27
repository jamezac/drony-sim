// HUD estilo DJI Fly: estado, modo, GPS, telemetría, avisos y radar de orientación.
// H = altura, D = distancia al home, V.H / V.V = velocidad horizontal / vertical.
// La batería llega en la fase 4, cuando se simule (no mostramos un dato inventado).

import { FLIGHT_PHASE_LABELS, type FlightPhase } from '../control/flightState';
import { FLIGHT_MODE_LABELS, type FlightModeName } from '../control/modes';
import { Radar } from './radar';

export interface HudData {
  mode: FlightModeName;
  /** Si el modo actual usa el GPS (todos menos ATTI) */
  gps: boolean;
  phase: FlightPhase;
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
  private readonly altitude = metric('H');
  private readonly distance = metric('D');
  private readonly horizontalSpeed = metric('V.H');
  private readonly verticalSpeed = metric('V.V');
  private readonly warning = element('p', 'hud-warning');
  private readonly input = element('p', 'hud-input');
  private readonly gamepad = element('p', 'hud-input hud-input-on');
  private readonly radar: Radar;

  constructor(root: HTMLElement) {
    const panel = element('div', 'hud-panel');
    const status = element('p', 'hud-status');
    status.append(this.mode, this.phase);
    const metrics = element('div', 'hud-metrics');
    metrics.append(this.altitude.root, this.distance.root, this.horizontalSpeed.root, this.verticalSpeed.root);
    panel.append(element('h1', 'hud-title', 'Drony Sim'), status, this.gps, metrics);

    const inputPanel = element('div', 'hud-panel hud-input-panel');
    inputPanel.append(this.input, this.gamepad);

    const help = element(
      'p',
      'hud-help',
      'Espacio / botón izq.: despegar o aterrizar · E: motores · 1-4 / botón dcho.: modo · W/S: altura · ' +
        'A/D: giro · ↑↓←→: mover · R: reiniciar · G: gráfica · `: ajustes · ',
    );
    const devicesLink = document.createElement('a');
    devicesLink.href = '/devices.html';
    devicesLink.textContent = 'Dispositivos';
    help.append(devicesLink);

    root.append(panel, this.warning, inputPanel, help);
    this.radar = new Radar(root);
  }

  update(data: HudData): void {
    this.mode.textContent = FLIGHT_MODE_LABELS[data.mode];
    this.mode.dataset.mode = data.mode;
    this.phase.textContent = ` · ${FLIGHT_PHASE_LABELS[data.phase]}`;
    this.gps.textContent = data.gps ? '● GPS: mantiene la posición' : '○ Sin GPS: no mantiene la posición';
    this.gps.classList.toggle('hud-gps-off', !data.gps);

    this.altitude.value.textContent = `${data.altitude.toFixed(1)} m`;
    this.distance.value.textContent = `${data.distance.toFixed(1)} m`;
    this.horizontalSpeed.value.textContent = `${data.horizontalSpeed.toFixed(1)} m/s`;
    this.verticalSpeed.value.textContent = `${data.verticalSpeed.toFixed(1)} m/s`;

    this.warning.hidden = data.gps;
    this.warning.textContent = '⚠ Modo ATTI: sin GPS el dron deriva. Al soltar los sticks no frena: corrige tú.';

    this.input.textContent = data.spaceMouseConnected
      ? '● SpaceMouse conectado'
      : '○ SpaceMouse: mueve la tapa para activarlo';
    this.input.classList.toggle('hud-input-on', data.spaceMouseConnected);
    // El nombre que da el navegador incluye vendor/product: nos quedamos con la parte legible
    this.gamepad.hidden = data.gamepadName === null;
    this.gamepad.textContent = `● Mando: ${data.gamepadName?.split('(')[0].trim() ?? ''}`;

    this.radar.update(data.x, data.z, data.heading);
  }
}
