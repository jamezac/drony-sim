// Radar de orientación, como el del DJI Fly. Vista desde arriba, centrada en ti (el piloto,
// de pie en el punto de despegue). "Arriba" es hacia donde miras al despegar (−Z del mundo).
//
// Lo importante no es dónde está el dron, sino hacia dónde apunta su MORRO respecto a ti:
// - Cola hacia ti (tail-in): adelante es alejarse y derecha es tu derecha. Fácil.
// - Morro hacia ti (nose-in): todo se ve invertido; adelante lo acerca y su derecha es tu izquierda.
//   Es de lo que más cuesta al aprender, y por eso el radar lo avisa.

const RANGES = [10, 25, 50, 100, 200, 500]; // m: escala del radar según lo lejos que esté
const SIZE = 150; // px CSS
const NOSE_IN_COS = Math.cos(Math.PI / 4); // dentro de ±45° cuenta como morro/cola hacia ti
const NEAR_PILOT = 2; // m: tan cerca que no tiene sentido hablar de orientación

export type Orientation = 'near' | 'noseIn' | 'tailIn' | 'side';

export const ORIENTATION_LABELS: Record<Orientation, string> = {
  near: 'Sobre el punto de despegue',
  noseIn: 'Morro hacia ti (nose-in): los controles se ven invertidos',
  tailIn: 'Cola hacia ti: los controles coinciden con lo que ves',
  side: 'De lado respecto a ti',
};

/**
 * ¿Hacia dónde apunta el morro respecto al piloto (en el origen)?
 * @param x posición del dron en el mundo
 * @param z posición del dron en el mundo
 * @param heading rumbo del dron (rad; 0 = morro hacia −Z)
 */
export function orientationToPilot(x: number, z: number, heading: number): Orientation {
  const distance = Math.hypot(x, z);
  if (distance < NEAR_PILOT) return 'near';
  // Coseno del ángulo entre el morro y la dirección dron → piloto
  const cos = (-Math.sin(heading) * -x + -Math.cos(heading) * -z) / distance;
  if (cos > NOSE_IN_COS) return 'noseIn';
  if (cos < -NOSE_IN_COS) return 'tailIn';
  return 'side';
}

function cssColor(name: string, fallback: string): string {
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

  update(x: number, z: number, heading: number): void {
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

    const orientation = orientationToPilot(x, z, heading);
    this.label.textContent = ORIENTATION_LABELS[orientation];
    this.label.classList.toggle('radar-warning', orientation === 'noseIn');
  }

  /** Triángulo con la punta (morro) en naranja hacia donde apunta el dron. */
  private drawDrone(x: number, y: number, forwardX: number, forwardY: number): void {
    const ctx = this.context;
    const length = 11;
    const half = 7;
    const rightX = -forwardY;
    const rightY = forwardX;
    const tipX = x + forwardX * length;
    const tipY = y + forwardY * length;
    ctx.fillStyle = this.colors.text;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(x - forwardX * 5 + rightX * half, y - forwardY * 5 + rightY * half);
    ctx.lineTo(x - forwardX * 5 - rightX * half, y - forwardY * 5 - rightY * half);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = this.colors.nose;
    ctx.beginPath();
    ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
