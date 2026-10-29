// Acro (o "Manual"): el modo de los drones FPV de carreras y freestyle, sin ayudas.
//
// En los demás modos el controlador decide la inclinación: sueltas el stick y se nivela. En Acro
// el stick pide VELOCIDAD DE GIRO (°/s): con el stick en el centro el dron no gira, pero se queda
// con la inclinación que tenga, aunque sea boca abajo. Así se hacen los flips: stick a fondo un
// momento, el dron da la vuelta, y se suelta cuando vuelve a estar horizontal.
//
// El throttle también es directo: no hay barómetro que mantenga la altura. Y el empuje va en el
// "arriba" del dron, así que al inclinarlo parte del empuje se va al lado y el dron cae si no le
// das más gas. Por eso en un flip se corta el gas (si no, empujaría hacia abajo al estar boca
// abajo) y se vuelve a dar al terminar.

import { droneConfig, simConfig, type AcroAxisRates } from '../core/config';
import { MOTOR_COUNT } from '../physics/drone';

const DEG = Math.PI / 180;

/**
 * Velocidad de giro pedida por un stick, con la fórmula "Betaflight rates" (la clásica):
 *   - expo: suaviza el centro, x·|x|³·expo + x·(1 − expo)
 *   - RC rate: 200 °/s por unidad de stick (la pendiente en el centro)
 *   - super rate: multiplica por 1 / (1 − |x|·superRate), que crece hacia los extremos.
 *     Así el centro es preciso y a fondo gira muy rápido.
 * @param stick −1..1
 * @returns rad/s, con el signo del stick
 */
export function acroRate(stick: number, rates: AcroAxisRates): number {
  const magnitude = Math.min(1, Math.abs(stick));
  const command = Math.sign(stick) * magnitude;
  const shaped = command * magnitude ** 3 * rates.expo + command * (1 - rates.expo);
  const superFactor = 1 / Math.min(1, Math.max(0.01, 1 - magnitude * rates.superRate));
  return 200 * rates.rcRate * shaped * superFactor * DEG;
}

/** Velocidad de giro máxima (rad/s), con el stick a fondo */
export function maxAcroRate(rates: AcroAxisRates): number {
  return acroRate(1, rates);
}

/**
 * Throttle híbrido: el SpaceMouse (y el teclado) vuelven al centro, así que el centro es el empuje
 * de hover y el stick suma (hasta el máximo de los motores) o resta (hasta 0). Con empuje 0 el
 * mezclador aún puede girar el dron: prioriza la actitud (como el "airmode" de Betaflight).
 * @param throttle −1..1
 * @returns empuje total (N)
 */
export function acroThrust(throttle: number): number {
  const hover = droneConfig.mass * simConfig.gravity;
  const max = droneConfig.maxThrustPerMotor * MOTOR_COUNT;
  const t = Math.max(-1, Math.min(1, throttle));
  return t >= 0 ? hover + t * (max - hover) : hover * (1 + t);
}
