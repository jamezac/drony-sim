// HUD mínimo (fase 1): estado, telemetría básica y ayuda de controles.
// Usa los nombres del DJI Fly: H = altura, D = distancia al home, V.H / V.V = velocidades.
// El HUD completo (radar de orientación, batería, avisos) llega en la fase 3.

import { FLIGHT_PHASE_LABELS, type FlightPhase } from '../control/flightState';

export interface HudData {
  mode: string;
  phase: FlightPhase;
  altitude: number;
  distance: number;
  horizontalSpeed: number;
  verticalSpeed: number;
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
  private readonly status = element('p', 'hud-status');
  private readonly altitude = metric('H');
  private readonly distance = metric('D');
  private readonly horizontalSpeed = metric('V.H');
  private readonly verticalSpeed = metric('V.V');
  private readonly input = element('p', 'hud-input');
  private readonly gamepad = element('p', 'hud-input hud-input-on');

  constructor(root: HTMLElement) {
    const panel = element('div', 'hud-panel');
    const metrics = element('div', 'hud-metrics');
    metrics.append(this.altitude.root, this.distance.root, this.horizontalSpeed.root, this.verticalSpeed.root);
    panel.append(element('h1', 'hud-title', 'Drony Sim'), this.status, metrics);

    const inputPanel = element('div', 'hud-panel hud-input-panel');
    inputPanel.append(this.input, this.gamepad);

    const help = element(
      'p',
      'hud-help',
      'Espacio / botón izq.: despegar o aterrizar · E: motores · W/S: altura · A/D: giro · ' +
        '↑↓←→: mover · R: reiniciar · `: ajustes · ',
    );
    const devicesLink = document.createElement('a');
    devicesLink.href = '/devices.html';
    devicesLink.textContent = 'Dispositivos';
    help.append(devicesLink);

    root.append(panel, inputPanel, help);
  }

  update(data: HudData): void {
    this.status.textContent = `${data.mode} · ${FLIGHT_PHASE_LABELS[data.phase]}`;
    this.altitude.value.textContent = `${data.altitude.toFixed(1)} m`;
    this.distance.value.textContent = `${data.distance.toFixed(1)} m`;
    this.horizontalSpeed.value.textContent = `${data.horizontalSpeed.toFixed(1)} m/s`;
    this.verticalSpeed.value.textContent = `${data.verticalSpeed.toFixed(1)} m/s`;
    this.input.textContent = data.spaceMouseConnected
      ? '● SpaceMouse conectado'
      : '○ SpaceMouse: mueve la tapa para activarlo';
    this.input.classList.toggle('hud-input-on', data.spaceMouseConnected);
    // El nombre que da el navegador incluye vendor/product: nos quedamos con la parte legible
    this.gamepad.hidden = data.gamepadName === null;
    this.gamepad.textContent = `● Mando: ${data.gamepadName?.split('(')[0].trim() ?? ''}`;
  }
}
