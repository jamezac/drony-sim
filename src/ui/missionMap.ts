// Mapa de la misión (tecla M), como la pantalla de waypoints del DJI Fly: vista desde arriba con
// los obstáculos del escenario (los edificios, con su altura), el despegue (H) y el dron.
// Clic en el mapa: añadir un punto a la altura elegida. Clic sobre un punto: quitarlo. Rueda: zoom.
// Con el mapa abierto el vuelo se pausa, como con el menú de lecciones.
//
// Igual que el radar: +X a la derecha y −Z arriba (hacia donde miras al despegar).

import { limitsConfig, missionConfig } from '../core/config';
import { MISSION_FINISH_LABELS, missionLength, type MissionFinish, type MissionPlan } from '../control/mission';
import type { Collider, ObstacleKind } from '../physics/collisions';
import { button, element, Modal } from './menus';
import { cssColor, drawDroneIcon } from './radar';

const RANGES = [25, 50, 75, 110, 180]; // m: media anchura del mapa; la rueda pasa de una a otra
const GRID_STEPS = [5, 10, 20, 50]; // m: la cuadrícula más fina que deja unas 5 líneas a cada lado
const POINT_RADIUS = 10; // px
const PICK_RADIUS = 12; // px: un clic tan cerca de un punto lo quita

const OBSTACLE_COLORS: Partial<Record<ObstacleKind, string>> = {
  árbol: '#2f7d4a',
  edificio: '#56606b',
  muro: '#7a6a5a',
  fuente: '#3a7ca5',
  puerta: '#ff9f43',
};
const OBSTACLE_COLOR = '#4a5560';
const POINT_COLORS = { pending: '#3fb6ff', next: '#ffb74d', done: '#3fcf8e' };

/** Lo que el mapa necesita saber del vuelo al abrirse (con el mapa abierto, la simulación está parada) */
export interface MissionMapView {
  colliders: readonly Collider[];
  drone: { x: number; z: number; altitude: number; heading: number };
  /** Por qué no se puede empezar ahora la misión, o null si se puede */
  blocked: string | null;
  /** Misión en curso: el punto al que va; null si no hay misión en curso */
  activeIndex: number | null;
  /** Velocidad máxima del modo actual (m/s): la misión no va más rápido */
  modeMaxSpeed: number;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Hasta dónde llegan los obstáculos (m desde el despegue) */
function collidersExtent(colliders: readonly Collider[]): number {
  let extent = 0;
  for (const c of colliders) {
    const corners = c.kind === 'box' ? [c.min, c.max] : [c];
    for (const p of corners) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.z));
  }
  return extent;
}

/** Fila con etiqueta, valor y control (deslizador o desplegable) */
function field(label: string, control: HTMLElement, value?: HTMLElement): HTMLElement {
  const root = element('label', 'mission-field');
  const header = element('span', 'mission-field-label', label);
  if (value) header.append(value);
  root.append(header, control);
  return root;
}

function slider(min: number, max: number, step: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  return input;
}

export class MissionMap extends Modal {
  private readonly plan: MissionPlan;
  private readonly onToggleMission: () => void;
  private view: MissionMapView | null = null;
  private range = RANGES[1];
  /** Altura de los puntos nuevos (m) */
  private newAltitude = missionConfig.defaultAltitude;

  /** Lo que se muestra en la ventana (se crea una vez y se reutiliza al abrirla) */
  private readonly content: HTMLElement[];
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly altitudeInput = slider(missionConfig.minAltitude, limitsConfig.maxAltitude, 1);
  private readonly altitudeValue = element('output', '');
  private readonly speedInput = slider(missionConfig.minSpeed, missionConfig.maxSpeed, 0.5);
  private readonly speedValue = element('output', '');
  private readonly finishSelect = document.createElement('select');
  private readonly summary = element('p', 'mission-summary');
  private readonly status = element('p', 'mission-status');
  private readonly flyButton = button('Volar la misión');
  private readonly addDroneButton = button('Añadir donde está el dron', true);
  private readonly undoButton = button('Quitar el último', true);
  private readonly clearButton = button('Borrar todos', true);
  private readonly colors = {
    text: cssColor('--text', '#e6edf3'),
    muted: cssColor('--muted', '#8b98a5'),
    accent: cssColor('--accent', '#3fb6ff'),
    background: cssColor('--bg', '#0f1419'),
    nose: '#ff7a1a',
  };

  /**
   * @param plan el plan que se edita (es del simulador: se edita en el sitio)
   * @param onToggleMission volar el plan, o detener la misión en curso
   */
  constructor(root: HTMLElement, plan: MissionPlan, onToggleMission: () => void) {
    super(root);
    this.plan = plan;
    this.onToggleMission = onToggleMission;
    this.panel.classList.add('mission-modal');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('No se pudo crear el canvas 2D del mapa');
    this.context = context;
    this.canvas.className = 'mission-canvas';

    for (const [value, label] of Object.entries(MISSION_FINISH_LABELS)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this.finishSelect.append(option);
    }
    this.bindEvents();

    const close = button('Cerrar (M)', true);
    close.addEventListener('click', () => this.close());
    const editActions = element('div', 'wizard-actions');
    editActions.append(this.addDroneButton, this.undoButton, this.clearButton);
    const flyActions = element('div', 'wizard-actions');
    flyActions.append(this.flyButton, close);
    const side = element('div', 'mission-side');
    side.append(
      field('Altura de los puntos nuevos', this.altitudeInput, this.altitudeValue),
      field('Velocidad', this.speedInput, this.speedValue),
      field('Al terminar', this.finishSelect),
      this.summary,
      editActions,
      this.status,
      flyActions,
    );
    const layout = element('div', 'mission-layout');
    layout.append(this.canvas, side);
    this.content = [
      element('h2', 'modal-title', 'Misión de waypoints'),
      element(
        'p',
        'modal-subtitle',
        'Clic en el mapa: añadir un punto a la altura elegida. Clic sobre un punto: quitarlo. Rueda: zoom. ' +
          'El dron va de punto en punto en línea recta, con el morro hacia donde va, y no esquiva obstáculos: ' +
          'pon los puntos por encima (los edificios llevan su altura). Mover los sticks te devuelve el control.',
      ),
      layout,
    ];
    window.addEventListener('resize', () => this.isOpen && this.draw());
  }

  open(view: MissionMapView): void {
    this.view = view;
    // Zoom: con puntos, para que quepan ellos y el dron con margen; sin puntos, todo el escenario
    const { drone } = view;
    const { waypoints } = this.plan;
    const extent = waypoints.length
      ? 1.3 * Math.max(Math.hypot(drone.x, drone.z), ...waypoints.map((w) => Math.hypot(w.x, w.z)))
      : Math.max(collidersExtent(view.colliders), 1.3 * Math.hypot(drone.x, drone.z));
    this.range = RANGES.find((r) => r >= Math.max(extent, RANGES[1])) ?? RANGES[RANGES.length - 1];
    this.openWith(...this.content);
    this.refresh();
  }

  toggle(view: () => MissionMapView): void {
    if (this.isOpen) this.close();
    else this.open(view());
  }

  private get active(): boolean {
    return this.view?.activeIndex != null;
  }

  private bindEvents(): void {
    this.altitudeInput.addEventListener('input', () => {
      this.newAltitude = Number(this.altitudeInput.value);
      this.refresh();
    });
    this.speedInput.addEventListener('input', () => {
      this.plan.speed = Number(this.speedInput.value);
      this.refresh();
    });
    this.finishSelect.addEventListener('change', () => {
      this.plan.finish = this.finishSelect.value as MissionFinish;
    });
    this.addDroneButton.addEventListener('click', () => {
      // Como en un DJI: vuelas hasta el sitio y lo guardas como punto, con su altura
      if (!this.view) return;
      const { x, z, altitude } = this.view.drone;
      this.addPoint(x, z, Math.max(missionConfig.minAltitude, Math.round(altitude)));
    });
    this.undoButton.addEventListener('click', () => {
      this.plan.waypoints.pop();
      this.refresh();
    });
    this.clearButton.addEventListener('click', () => {
      this.plan.waypoints.length = 0;
      this.refresh();
    });
    this.flyButton.addEventListener('click', () => this.onToggleMission());
    this.canvas.addEventListener('click', (event) => this.onMapClick(event));
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const index = RANGES.indexOf(this.range) + Math.sign(event.deltaY);
        this.range = RANGES[Math.max(0, Math.min(RANGES.length - 1, index))];
        this.draw();
      },
      { passive: false },
    );
  }

  private onMapClick(event: MouseEvent): void {
    if (this.active) return;
    const rect = this.canvas.getBoundingClientRect();
    const half = rect.width / 2;
    const scale = half / this.range;
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const hit = this.plan.waypoints.findIndex((w) => Math.hypot(half + w.x * scale - px, half + w.z * scale - py) <= PICK_RADIUS);
    if (hit >= 0) {
      this.plan.waypoints.splice(hit, 1);
      this.refresh();
    } else {
      this.addPoint(roundTo((px - half) / scale, 0.1), roundTo((py - half) / scale, 0.1), this.newAltitude);
    }
  }

  private addPoint(x: number, z: number, altitude: number): void {
    const { waypoints } = this.plan;
    if (waypoints.length >= missionConfig.maxWaypoints || Math.hypot(x, z) > limitsConfig.maxDistance) return;
    waypoints.push({ x, z, altitude });
    this.refresh();
  }

  /** Pone los controles y los textos de acuerdo con el plan, y redibuja. */
  private refresh(): void {
    const view = this.view;
    if (!view) return;
    const { waypoints } = this.plan;
    const active = this.active;
    this.altitudeInput.value = String(this.newAltitude);
    this.altitudeValue.textContent = `${this.newAltitude} m`;
    this.speedInput.value = String(this.plan.speed);
    this.speedValue.textContent = `${this.plan.speed.toFixed(1)} m/s`;
    this.finishSelect.value = this.plan.finish;
    for (const control of [this.altitudeInput, this.speedInput, this.finishSelect]) control.disabled = active;
    this.addDroneButton.disabled = active || waypoints.length >= missionConfig.maxWaypoints;
    this.undoButton.disabled = active || waypoints.length === 0;
    this.clearButton.disabled = active || waypoints.length === 0;

    if (waypoints.length === 0) {
      this.summary.textContent = 'Sin puntos: haz clic en el mapa para poner el primero.';
    } else {
      const speed = Math.min(this.plan.speed, view.modeMaxSpeed);
      const length = missionLength(waypoints, view.drone);
      const limited = this.plan.speed > view.modeMaxSpeed ? ` · el modo actual la limita a ${view.modeMaxSpeed} m/s` : '';
      const count = waypoints.length === 1 ? '1 punto' : `${waypoints.length} puntos`;
      this.summary.textContent = `${count} · ${Math.round(length)} m desde el dron · unos ${Math.round(length / speed)} s${limited}`;
    }

    const blocked = waypoints.length === 0 ? 'Añade al menos un punto.' : view.blocked;
    this.flyButton.textContent = active ? 'Detener la misión' : 'Volar la misión';
    this.flyButton.disabled = !active && blocked !== null;
    this.status.textContent = active
      ? `Misión en curso, hacia el punto ${(view.activeIndex ?? 0) + 1} de ${waypoints.length}. Detenla para editarla.`
      : (blocked ?? 'Lista: el dron irá primero al punto 1.');
    this.status.classList.toggle('mission-status-blocked', !active && blocked !== null);
    this.draw();
  }

  private draw(): void {
    const view = this.view;
    const size = this.canvas.clientWidth;
    if (!view || size === 0) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const pixels = Math.round(size * dpr);
    if (this.canvas.width !== pixels) this.canvas.width = this.canvas.height = pixels;
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const half = size / 2;
    const scale = half / this.range;
    const toX = (x: number) => half + x * scale;
    const toY = (z: number) => half + z * scale;

    const gridStep = this.drawGrid(size, half, scale);
    this.drawObstacles(view.colliders, scale, toX, toY);

    // Límite de distancia (como el de DJI): fuera de él no se pueden poner puntos
    ctx.strokeStyle = this.colors.muted;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(half, half, limitsConfig.maxDistance * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Despegue (H)
    ctx.fillStyle = this.colors.accent;
    ctx.beginPath();
    ctx.arc(half, half, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this.colors.background;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', half, half + 0.5);

    this.drawRoute(view, toX, toY);
    const { drone } = view;
    drawDroneIcon(ctx, toX(drone.x), toY(drone.z), -Math.sin(drone.heading), -Math.cos(drone.heading), this.colors.text, this.colors.nose);
    this.drawLabels(size, gridStep);
  }

  /** Cuadrícula; devuelve su paso (m). */
  private drawGrid(size: number, half: number, scale: number): number {
    const ctx = this.context;
    const step = GRID_STEPS.find((s) => s >= this.range / 5) ?? GRID_STEPS[GRID_STEPS.length - 1];
    ctx.strokeStyle = this.colors.muted;
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let m = -Math.floor(this.range / step) * step; m <= this.range; m += step) {
      ctx.moveTo(half + m * scale, 0);
      ctx.lineTo(half + m * scale, size);
      ctx.moveTo(0, half + m * scale);
      ctx.lineTo(size, half + m * scale);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    return step;
  }

  /** Rótulos en las esquinas, encima de todo y con fondo para que se lean sobre los obstáculos. */
  private drawLabels(size: number, gridStep: number): void {
    const ctx = this.context;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const label = (text: string, x: number, y: number, align: 'left' | 'right') => {
      const width = ctx.measureText(text).width + 8;
      const left = align === 'left' ? x : x - width;
      ctx.fillStyle = this.colors.background;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(left, y - 9, width, 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.colors.muted;
      ctx.textAlign = 'left';
      ctx.fillText(text, left + 4, y);
    };
    label('↑ hacia donde miras al despegar', 4, 13, 'left');
    label(`cuadros de ${gridStep} m`, size - 4, size - 13, 'right');
  }

  private drawObstacles(
    colliders: readonly Collider[],
    scale: number,
    toX: (x: number) => number,
    toY: (z: number) => number,
  ): void {
    const ctx = this.context;
    for (const c of colliders) {
      ctx.fillStyle = OBSTACLE_COLORS[c.label] ?? OBSTACLE_COLOR;
      if (c.kind === 'box') {
        ctx.fillRect(toX(c.min.x), toY(c.min.z), (c.max.x - c.min.x) * scale, (c.max.z - c.min.z) * scale);
      } else {
        ctx.beginPath();
        ctx.arc(toX(c.x), toY(c.z), Math.max(c.radius * scale, 1.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Altura de los edificios, si caben: es lo que hay que librar
    ctx.fillStyle = this.colors.text;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of colliders) {
      if (c.kind !== 'box' || c.label !== 'edificio') continue;
      const width = (c.max.x - c.min.x) * scale;
      const height = (c.max.z - c.min.z) * scale;
      if (width < 30 || height < 14) continue;
      ctx.fillText(`${Math.round(c.max.y)} m`, toX((c.min.x + c.max.x) / 2), toY((c.min.z + c.max.z) / 2));
    }
  }

  /** Línea del recorrido (discontinua desde el dron hasta el punto al que va) y los puntos numerados. */
  private drawRoute(view: MissionMapView, toX: (x: number) => number, toY: (z: number) => number): void {
    const ctx = this.context;
    const { waypoints } = this.plan;
    if (waypoints.length === 0) return;
    const next = view.activeIndex ?? 0;
    ctx.strokeStyle = this.colors.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(toX(view.drone.x), toY(view.drone.z));
    ctx.lineTo(toX(waypoints[next].x), toY(waypoints[next].z));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    waypoints.forEach((w, i) => (i === 0 ? ctx.moveTo(toX(w.x), toY(w.z)) : ctx.lineTo(toX(w.x), toY(w.z))));
    ctx.stroke();

    ctx.font = 'bold 11px system-ui, sans-serif';
    waypoints.forEach((w, i) => {
      const x = toX(w.x);
      const y = toY(w.z);
      const state = view.activeIndex === null ? 'pending' : i < next ? 'done' : i === next ? 'next' : 'pending';
      ctx.fillStyle = POINT_COLORS[state];
      ctx.beginPath();
      ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.colors.background;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y + 0.5);
      ctx.fillStyle = this.colors.text;
      ctx.textAlign = 'left';
      ctx.fillText(`${w.altitude} m`, x + POINT_RADIUS + 3, y);
    });
  }
}
