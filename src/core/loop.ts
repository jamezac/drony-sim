// Bucle de paso fijo. La física siempre avanza en pasos de exactamente 1/240 s, aunque el
// navegador dibuje a 60, 144 o 30 fps. Así el vuelo se comporta igual en cualquier pantalla y
// los PID (ajustados para un dt concreto) no se vuelven inestables con frames irregulares.
//
// El tiempo sobrante que no llega a un paso completo se guarda para el siguiente frame, y el
// render interpola entre los dos últimos estados con `alpha` para que el movimiento sea suave.

export class FixedStepLoop {
  private readonly stepSeconds: number;
  private readonly maxFrameSeconds: number;
  private accumulator = 0;

  constructor(stepSeconds: number, maxFrameSeconds: number) {
    this.stepSeconds = stepSeconds;
    this.maxFrameSeconds = maxFrameSeconds;
  }

  /**
   * Avanza el tiempo de un frame llamando a `step` tantas veces como pasos completos quepan.
   * @returns alpha (0..1): fracción de paso que sobra, para interpolar el render
   */
  advance(frameSeconds: number, step: (dt: number) => void): number {
    this.accumulator += Math.min(Math.max(frameSeconds, 0), this.maxFrameSeconds);
    while (this.accumulator >= this.stepSeconds) {
      step(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
    }
    return this.accumulator / this.stepSeconds;
  }
}
