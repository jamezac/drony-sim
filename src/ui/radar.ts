// Radar de orientación, como el del DJI Fly. Vista desde arriba, centrada en ti (el piloto,
// de pie en el punto de despegue). "Arriba" es hacia donde miras al despegar (−Z del mundo).
//
// Lo importante no es dónde está el dron, sino hacia dónde apunta su MORRO respecto a ti:
// - Cola hacia ti (tail-in): adelante es alejarse y derecha es tu derecha. Fácil.
// - Morro hacia ti (nose-in): todo se ve invertido; adelante lo acerca y su derecha es tu izquierda.
//   Es de lo que más cuesta al aprender, y por eso el radar lo avisa.

import { ORIENTATION_LABELS, orientationToPilot } from '../training/orientation';

const RANGES = [10, 25, 50, 100, 200, 500]; // m: escala del radar según lo lejos que esté
const SIZE = 150; // px CSS

export function cssColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export class Radar {
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly label = document.createElement('p');
  private readonly colors = {
    text: cssColor('--text', '#e6edf3'),
    muted: cssColor('--muted', '#8b98a5'),
    border: cssColor('--border', '#2c3640'),
    accent: cssColor('--accent', '#3fb6ff'),
    nose: '#ff7a1a',
  };

  constructor(root: HTMLElement) {
    const panel = document.createElement('div');
    panel.className = 'radar';
    this.canvas.className = 'radar-canvas';
    this.label.className = 'radar-label';
    panel.append(this.canvas, this.label);
    root.append(panel);

    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('No se pudo crear el canvas 2D del radar');
    this.context = context;
  }

  /** @param windX,windZ viento (m/s, mundo): se dibuja como una flecha hacia donde sopla */
  update(x: number, z: number, heading: number, windX = 0, windZ = 0): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (this.canvas.width !== SIZE * dpr) this.canvas.width = this.canvas.height = SIZE * dpr;
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const center = SIZE / 2;
    const radius = SIZE / 2 - 10;
    const distance = Math.hypot(x, z);
    const range = RANGES.find((r) => r >= distance * 1.2) ?? RANGES[RANGES.length - 1];

    // Cruz y anillos de distancia (gris medio: el color de borde no se ve sobre el fondo oscuro)
    ctx.strokeStyle = this.colors.muted;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center, center - radius);
    ctx.lineTo(center, center + radius);
    ctx.moveTo(center - radius, center);
    ctx.lineTo(center + radius, center);
    ctx.stroke();
    ctx.globalAlpha = 0.6;
    for (const fraction of [0.5, 1]) {
      ctx.beginPath();
      ctx.arc(center, center, radius * fraction, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.colors.muted;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${range} m`, SIZE - 4, SIZE - 4);

    // Tú, en el punto de despegue
    ctx.fillStyle = this.colors.accent;
    ctx.beginPath();
    ctx.arc(center, center, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillText('tú · H', center, center + 16);

    // Dron: +X a la derecha y −Z arriba. Si se sale de la escala, se dibuja en el borde.
    const scale = Math.min(radius / range, distance > 0 ? radius / distance : Infinity);
    const droneX = center + x * scale;
    const droneY = center + z * scale;
    const forwardX = -Math.sin(heading);
    const forwardY = -Math.cos(heading);
    this.drawDrone(droneX, droneY, forwardX, forwardY);

    this.drawWind(windX, windZ);

    const orientation = orientationToPilot(x, z, heading);
    this.label.textContent = ORIENTATION_LABELS[orientation];
    this.label.classList.toggle('radar-warning', orientation === 'noseIn');
  }

  /** Flecha de viento en la esquina superior izquierda, más larga cuanto más sopla. */
  private drawWind(windX: number, windZ: number): void {
    const speed = Math.hypot(windX, windZ);
    if (speed < 0.5) return;
    const ctx = this.context;
    const centerX = 18;
    const centerY = 18;
    const length = Math.min(14, 5 + speed);
    const dirX = windX / speed;
    const dirY = windZ / speed; // +Z del mundo es hacia abajo en el radar
    const tipX = centerX + dirX * length;
    const tipY = centerY + dirY * length;
    ctx.strokeStyle = this.colors.muted;
    ctx.fillStyle = this.colors.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - dirX * length, centerY - dirY * length);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - dirX * 6 - dirY * 4, tipY - dirY * 6 + dirX * 4);
    ctx.lineTo(tipX - dirX * 6 + dirY * 4, tipY - dirY * 6 - dirX * 4);
    ctx.closePath();
    ctx.fill();
  }

  private drawDrone(x: number, y: number, forwardX: number, forwardY: number): void {
    drawDroneIcon(this.context, x, y, forwardX, forwardY, this.colors.text, this.colors.nose);
  }
}

/** Triángulo con la punta (morro) en naranja hacia donde apunta el dron (también en el mapa de la misión). */
export function drawDroneIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  forwardX: number,
  forwardY: number,
  bodyColor: string,
  noseColor: string,
): void {
  const length = 11;
  const half = 7;
  const rightX = -forwardY;
  const rightY = forwardX;
  const tipX = x + forwardX * length;
  const tipY = y + forwardY * length;
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(x - forwardX * 5 + rightX * half, y - forwardY * 5 + rightY * half);
  ctx.lineTo(x - forwardX * 5 - rightX * half, y - forwardY * 5 - rightY * half);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = noseColor;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
  ctx.fill();
}
