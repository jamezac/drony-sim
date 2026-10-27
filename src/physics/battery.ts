// Batería. Lo importante para aprender no es la química, sino el hábito: vigilar el porcentaje y
// volver con margen. Un DJI avisa al 30 %, vuelve solo a casa al ~15 % y aterriza donde esté al 10 %.
//
// - Potencia: P = k·Σ T^1,5 por motor (más empuje cuesta MÁS que proporcionalmente: subir rápido
//   o volar en Sport vacía la batería mucho antes que un hover tranquilo).
// - Tensión: baja con la carga y además "cae" al pedir mucha corriente (resistencia interna).

import { batteryConfig } from '../core/config';

export class Battery {
  energyWh: number;
  voltage: number = batteryConfig.fullVoltage;
  /** Potencia que se está consumiendo ahora (W) */
  power = 0;

  constructor(percent = 100) {
    this.energyWh = (batteryConfig.capacityWh * percent) / 100;
    this.updateVoltage();
  }

  get percent(): number {
    return (this.energyWh / batteryConfig.capacityWh) * 100;
  }

  get depleted(): boolean {
    return this.energyWh <= 0;
  }

  /**
   * @param motorThrust empuje real de cada motor (N)
   * @param motorsOn si los motores están armados (parado solo consume la electrónica)
   */
  update(motorThrust: readonly number[], motorsOn: boolean, dt: number): void {
    const { powerPerThrust, avionicsPower, drainMultiplier } = batteryConfig;
    let motors = 0;
    if (motorsOn) for (const thrust of motorThrust) motors += powerPerThrust * Math.pow(Math.max(thrust, 0), 1.5);
    this.power = avionicsPower + motors;
    this.energyWh = Math.max(0, this.energyWh - (this.power * dt * drainMultiplier) / 3600);
    this.updateVoltage();
  }

  private updateVoltage(): void {
    const { fullVoltage, emptyVoltage, capacityWh, internalResistance } = batteryConfig;
    const openCircuit = emptyVoltage + (fullVoltage - emptyVoltage) * (this.energyWh / capacityWh);
    const current = this.power / openCircuit;
    this.voltage = openCircuit - internalResistance * current;
  }
}
