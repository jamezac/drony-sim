// Página de dispositivos: prueba del SpaceMouse (WebHID y Gamepad API), calibración y
// asistente de mapeo. Muestra ejes, botones y reports en crudo para diagnosticar problemas.

import { spaceMouseConfig } from './core/config';
import { isWebHidSupported, SpaceMouse } from './input/spaceMouse';
import { normalizeAxis, type SpaceMouseAxes } from './input/spaceMouseReport';
import { createAxisRow, setBar, type AxisRow } from './ui/axisBars';
import { CalibrationPanel } from './ui/calibrationPanel';
import { MappingWizard } from './ui/mappingWizard';
import './style.css';

const MAX_LOG_LINES = 50;
const BUTTON_COUNT = 2;

const AXES: { key: keyof SpaceMouseAxes; label: string }[] = [
  { key: 'tx', label: 'TX · desplazar lateral' },
  { key: 'ty', label: 'TY · desplazar adelante/atrás' },
  { key: 'tz', label: 'TZ · subir/hundir' },
  { key: 'rx', label: 'RX · inclinar adelante/atrás' },
  { key: 'ry', label: 'RY · inclinar lateral' },
  { key: 'rz', label: 'RZ · girar' },
];

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id}`);
  return element as T;
}

function setStatus(element: HTMLElement, ok: boolean, text: string): void {
  element.textContent = `${ok ? '✓' : '✗'} ${text}`;
  element.className = `status-row ${ok ? 'ok' : 'bad'}`;
}

function hex(value: number, digits = 4): string {
  return `0x${value.toString(16).padStart(digits, '0')}`;
}

// --- Compatibilidad ---
const supported = isWebHidSupported();
setStatus(
  byId('webhid-status'),
  supported,
  supported ? 'WebHID disponible' : 'WebHID no disponible: usa Chrome o Edge',
);
setStatus(
  byId('secure-status'),
  window.isSecureContext,
  window.isSecureContext
    ? 'Contexto seguro'
    : 'Contexto no seguro: abre la página en http://localhost:5173, no por IP',
);

// --- Filas de ejes ---
const axisRows = new Map<keyof SpaceMouseAxes, AxisRow>();
const axesContainer = byId('axes');
for (const { key, label } of AXES) {
  axisRows.set(key, createAxisRow(axesContainer, label));
}

// Máximo absoluto visto en cada eje: sirve para ajustar axisFullScale
const maxSeen: SpaceMouseAxes = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
byId('reset-max-webhid').addEventListener('click', () => {
  for (const { key } of AXES) maxSeen[key] = 0;
});

// --- SpaceMouse ---
const spaceMouse = new SpaceMouse();
const connectButton = byId<HTMLButtonElement>('connect');
const deviceStatus = byId('device-status');
const deviceInfo = byId('device-info');
const log = byId('log');
const logLines: string[] = [];
let reportsThisSecond = 0;

connectButton.disabled = !supported;

function showDevice(connected: boolean): void {
  const device = spaceMouse.currentDevice;
  if (!connected || !device) {
    setStatus(deviceStatus, false, 'Sin conectar');
    deviceInfo.textContent = '';
    return;
  }
  setStatus(deviceStatus, true, `Conectado: ${device.productName}`);
  const collections = device.collections
    .map((c) => `${hex(c.usagePage ?? 0, 2)}/${hex(c.usage ?? 0, 2)}`)
    .join(', ');
  deviceInfo.textContent =
    `vendorId ${hex(device.vendorId)} · productId ${hex(device.productId)} · colecciones ${collections}`;
}

spaceMouse.onStatusChange(showDevice);
spaceMouse.onReport((_state, reportId, data) => {
  reportsThisSecond++;
  const bytes = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  logLines.unshift(`#${reportId}  ${bytes}`);
  logLines.length = Math.min(logLines.length, MAX_LOG_LINES);
});

connectButton.addEventListener('click', () => {
  spaceMouse.requestDevice().catch((error: unknown) => {
    setStatus(deviceStatus, false, `Error al conectar: ${String(error)}`);
  });
});

showDevice(false);
if (supported) {
  spaceMouse.reconnect().catch((error: unknown) => {
    setStatus(deviceStatus, false, `Error al reconectar: ${String(error)}`);
  });
}

// --- Frecuencia de reports ---
const reportRate = byId('report-rate');
setInterval(() => {
  reportRate.textContent = spaceMouse.connected ? `· ${reportsThisSecond} reports/s` : '';
  reportsThisSecond = 0;
}, 1000);

// --- Gamepad API ---
// En Windows el navegador puede exponer el SpaceMouse como "gamepad" de 6 ejes por Raw Input,
// que no necesita acceso exclusivo: es la alternativa si el driver 3DxWare bloquea WebHID.
const gamepadStatus = byId('gamepad-status');
const gamepadsContainer = byId('gamepads');
let gamepadLayout = '';
let gamepadRows: AxisRow[][] = [];
let gamepadTitles: HTMLElement[] = [];
// Máximo absoluto visto en cada eje de cada gamepad (se reinicia con el mismo botón)
let gamepadMax: number[][] = [];
byId('reset-max').addEventListener('click', () => {
  gamepadMax = gamepadMax.map((axes) => axes.map(() => 0));
});

function renderGamepads(): void {
  const pads = navigator.getGamepads().filter((pad) => pad !== null);
  // Reconstruimos las filas solo si cambian los mandos o su número de ejes
  const layout = pads.map((pad) => `${pad.index}:${pad.id}:${pad.axes.length}`).join('|');
  if (layout !== gamepadLayout) {
    gamepadLayout = layout;
    gamepadsContainer.replaceChildren();
    gamepadTitles = [];
    gamepadMax = pads.map((pad) => pad.axes.map(() => 0));
    gamepadRows = pads.map((pad) => {
      const title = document.createElement('p');
      title.className = 'status-row';
      gamepadsContainer.append(title);
      gamepadTitles.push(title);
      return pad.axes.map((_, i) => createAxisRow(gamepadsContainer, `Eje ${i}`));
    });
  }

  if (pads.length === 0) {
    setStatus(gamepadStatus, false, 'Ningún gamepad detectado: mueve la tapa o pulsa un botón del SpaceMouse');
    return;
  }
  setStatus(gamepadStatus, true, `${pads.length} gamepad(s) detectado(s)`);
  pads.forEach((pad, p) => {
    const pressed = pad.buttons.flatMap((button, i) => (button.pressed ? [i] : []));
    const title = gamepadTitles[p];
    if (title) {
      title.textContent = `#${pad.index} · ${pad.id} · botones pulsados: ${pressed.length ? pressed.join(', ') : 'ninguno'}`;
    }
    pad.axes.forEach((value, i) => {
      const max = gamepadMax[p];
      if (max) max[i] = Math.max(max[i] ?? 0, Math.abs(value));
      const row = gamepadRows[p]?.[i];
      const outOfRange = Math.abs(value) > 1 ? ' · fuera de rango' : '';
      if (row) setBar(row, value, `${value.toFixed(3)} · máx ${(max?.[i] ?? 0).toFixed(2)}${outOfRange}`);
    });
  });
}

// Instantánea de todos los gamepads (ejes y botones pulsados) para pegarla en el chat
const copyGamepadsStatus = byId('copy-gamepads-status');
byId('copy-gamepads').addEventListener('click', () => {
  const snapshot = navigator
    .getGamepads()
    .filter((pad) => pad !== null)
    .map((pad) => ({
      index: pad.index,
      id: pad.id,
      mapping: pad.mapping,
      axes: pad.axes.map((value) => Math.round(value * 1000) / 1000),
      pressed: pad.buttons.flatMap((button, i) => (button.pressed ? [i] : [])),
    }));
  navigator.clipboard
    .writeText(JSON.stringify(snapshot))
    .then(() => setStatus(copyGamepadsStatus, true, `Copiado (${snapshot.length} gamepad(s))`))
    .catch(() => setStatus(copyGamepadsStatus, false, 'No se pudo copiar al portapapeles'));
});

// --- Calibración y asistente de mapeo (usan la Gamepad API) ---
const calibration = new CalibrationPanel(byId('calibration'));
const wizard = new MappingWizard(byId('wizard'));

// --- Refresco de la vista una vez por frame (no por report) ---
const buttonsView = byId('buttons');
let frames = 0;

function render(nowMs: number): void {
  const { axes, buttons } = spaceMouse.getState();
  for (const { key } of AXES) {
    const raw = axes[key];
    maxSeen[key] = Math.max(maxSeen[key], Math.abs(raw));
    const n = normalizeAxis(raw, spaceMouseConfig.axisFullScale);
    const row = axisRows.get(key);
    if (row) setBar(row, n, `${raw} · ${n.toFixed(2)} · máx ${maxSeen[key]}`);
  }

  renderGamepads();
  calibration.update(nowMs);
  wizard.update(nowMs);

  const labels: string[] = [];
  for (let i = 0; i < BUTTON_COUNT; i++) {
    labels.push(`Botón ${i + 1}: ${buttons & (1 << i) ? '●' : '○'}`);
  }
  buttonsView.textContent = `${labels.join('   ')}   (máscara ${hex(buttons, 2)})`;

  log.textContent = logLines.join('\n');

  if (++frames === 2) window.__dronyReady = true;
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
