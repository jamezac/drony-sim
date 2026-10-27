// Gráfica en vivo (tecla G): objetivo (discontinuo) frente a valor real (continuo) de los
// últimos 10 s. Es la mejor forma de VER un PID trabajando:
// - Si la línea real persigue a la discontinua con retraso, el lazo es lento (kp bajo).
// - Si se pasa y oscila alrededor, es demasiado agresivo (kp alto, falta amortiguar).
// - Si se queda siempre un poco por debajo, falta integral (ki).
// En ATTI no hay objetivo de velocidad: ese lazo no existe sin GPS.

const HISTORY = 600; // muestras (~10 s a 60 fps)
const WIDTH = 360; // px CSS
const STRIP_HEIGHT = 70;
const STRIP_GAP = 8;

export interface TelemetrySample {
  altitude: number;
  altitudeSetpoint: number | null;
  speed: number;
  speedSetpoint: number | null;
  tilt: number; // grados
  tiltSetpoint: number; // grados
}

interface Strip {
  title: string;
  /** Rango mínimo del eje vertical, para que el ruido pequeño no parezca enorme */
  minRange: number;
  value: (s: TelemetrySample) => number;
  setpoint: (s: TelemetrySample) => number | null;
}

const STRIPS: Strip[] = [
  { title: 'Altura (m)', minRange: 1, value: (s) => s.altitude, setpoint: (s) => s.altitudeSetpoint },
  { title: 'Velocidad horizontal (m/s)', minRange: 2, value: (s) => s.speed, setpoint: (s) => s.speedSetpoint },
  { title: 'Inclinación (°)', minRange: 5, value: (s) => s.tilt, setpoint: (s) => s.tiltSetpoint },
];

function cssColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export class TelemetryGraph {
  private readonly panel = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly samples: TelemetrySample[] = [];
  private readonly colors = {
    text: cssColor('--text', '#e6edf3'),
    muted: cssColor('--muted', '#8b98a5'),
    border: cssColor('--border', '#2c3640'),
    accent: cssColor('--accent', '#3fb6ff'),
  };

  constructor(root: HTMLElement, visible: boolean) {
    this.panel.className = 'graph';
    this.panel.hidden = !visible;
    const legend = document.createElement('p');
    legend.className = 'graph-legend';
    legend.innerHTML = '<span class="graph-key graph-key-real"></span> real · <span class="graph-key graph-key-target"></span> objetivo · G: ocultar';
    this.panel.append(this.canvas, legend);
    root.append(this.panel);

    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('No se pudo crear el canvas 2D de la gráfica');
    this.context = context;

    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyG') this.panel.hidden = !this.panel.hidden;
    });
  }

  push(sample: TelemetrySample): void {
    this.samples.push(sample);
    if (this.samples.length > HISTORY) this.samples.shift();
    if (!this.panel.hidden) this.draw();
  }

  private draw(): void {
    const height = STRIPS.length * (STRIP_HEIGHT + STRIP_GAP);
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (this.canvas.width !== WIDTH * dpr) {
      this.canvas.width = WIDTH * dpr;
      this.canvas.height = height * dpr;
    }
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, WIDTH, height);
    STRIPS.forEach((strip, i) => this.drawStrip(strip, i * (STRIP_HEIGHT + STRIP_GAP)));
  }

  private drawStrip(strip: Strip, top: number): void {
    const ctx = this.context;
    const plotTop = top + 14;
    const plotHeight = STRIP_HEIGHT - 16;

    // Escala vertical: lo que se ve (valor y objetivo), con un rango mínimo
    let low = Infinity;
    let high = -Infinity;
    for (const sample of this.samples) {
      for (const v of [strip.value(sample), strip.setpoint(sample)]) {
        if (v === null) continue;
        low = Math.min(low, v);
        high = Math.max(high, v);
      }
    }
    if (!Number.isFinite(low)) [low, high] = [0, strip.minRange];
    const middle = (low + high) / 2;
    const range = Math.max(high - low, strip.minRange) * 1.15;
    low = middle - range / 2;
    const toY = (v: number): number => plotTop + plotHeight - ((v - low) / range) * plotHeight;
    const toX = (i: number): number => (i / (HISTORY - 1)) * WIDTH;

    ctx.fillStyle = this.colors.muted;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(strip.title, 0, top + 10);
    ctx.textAlign = 'right';
    const last = this.samples.at(-1);
    if (last) ctx.fillText(strip.value(last).toFixed(1), WIDTH, top + 10);
    ctx.strokeStyle = this.colors.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, plotTop + 0.5, WIDTH - 1, plotHeight - 1);

    // Objetivo: discontinuo, con huecos donde el lazo no está activo (null)
    ctx.strokeStyle = this.colors.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    let drawing = false;
    this.samples.forEach((sample, i) => {
      const v = strip.setpoint(sample);
      if (v === null) {
        drawing = false;
        return;
      }
      if (drawing) ctx.lineTo(toX(i), toY(v));
      else ctx.moveTo(toX(i), toY(v));
      drawing = true;
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Valor real: continuo
    ctx.strokeStyle = this.colors.text;
    ctx.beginPath();
    this.samples.forEach((sample, i) => {
      const y = toY(strip.value(sample));
      if (i === 0) ctx.moveTo(toX(i), y);
      else ctx.lineTo(toX(i), y);
    });
    ctx.stroke();
  }
}
