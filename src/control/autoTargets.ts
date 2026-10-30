// Lo que una función automática (vuelta a casa, órbita) le pide al controlador en cada paso.
// El controlador lo trata igual venga de donde venga: así cada función es solo su "plan de vuelo".

export interface AutoTargets {
  /** Velocidad horizontal objetivo (m/s, mundo) */
  velocityX: number;
  velocityZ: number;
  /**
   * Aceleración que se suma a la que pide el lazo de velocidad (m/s², mundo): prealimentación
   * ("feedforward"). Si ya se sabe qué aceleración hará falta (la centrípeta en un círculo), se
   * pide directamente y el PID solo corrige el resto, en vez de ir siempre un poco por detrás.
   */
  accelX: number;
  accelZ: number;
  /** Altura objetivo (y del mundo, m), o null si la lleva el piloto con el throttle */
  altitude: number | null;
  /** Rumbo objetivo (rad), o null para mantener el actual */
  heading: number | null;
}
