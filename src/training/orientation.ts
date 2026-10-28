// Orientación del dron respecto al piloto (de pie en el punto de despegue, en el origen).
// La usan el radar del HUD y las lecciones de cola hacia ti (tail-in) y morro hacia ti (nose-in).
//
// - Cola hacia ti (tail-in): adelante es alejarse y derecha es tu derecha. Fácil.
// - Morro hacia ti (nose-in): todo se ve invertido; adelante lo acerca y su derecha es tu izquierda.

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

/** Rumbo con el que el morro apunta al piloto desde (x, z) */
export function headingTowardPilot(x: number, z: number): number {
  return Math.atan2(x, z);
}
