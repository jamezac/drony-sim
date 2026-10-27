import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { mixMotors } from '../src/control/mixer';
import { droneConfig } from '../src/core/config';
import { computeBodyTorque } from '../src/physics/dynamics';

const weight = droneConfig.mass * 9.81;
const out = [0, 0, 0, 0];

describe('mixMotors', () => {
  it('en hover reparte el empuje a partes iguales', () => {
    mixMotors(weight, new Vector3(), out);
    for (const thrust of out) expect(thrust).toBeCloseTo(weight / 4);
  });

  it('es la inversa de computeBodyTorque cuando no satura', () => {
    const torque = new Vector3(0.02, 0.005, -0.03);
    mixMotors(weight, torque, out);
    const produced = computeBodyTorque(out, new Vector3());
    expect(produced.x).toBeCloseTo(torque.x, 6);
    expect(produced.y).toBeCloseTo(torque.y, 6);
    expect(produced.z).toBeCloseTo(torque.z, 6);
    expect(out.reduce((a, b) => a + b)).toBeCloseTo(weight);
  });

  it('un torque de roll (z) sube un lado y baja el otro', () => {
    // +z del cuerpo apunta atrás: torque positivo levanta el lado derecho (alabeo a la izquierda)
    mixMotors(weight, new Vector3(0, 0, 0.02), out);
    const [frontLeft, frontRight, rearLeft, rearRight] = out;
    expect(frontRight).toBeGreaterThan(frontLeft);
    expect(rearRight).toBeGreaterThan(rearLeft);
  });

  it('saturado, nunca se sale de [0, máximo] y conserva el signo de los torques', () => {
    const torque = new Vector3(1, 0, 1); // muchísimo más de lo que pueden dar los motores
    mixMotors(weight, torque, out);
    for (const thrust of out) {
      expect(thrust).toBeGreaterThanOrEqual(0);
      expect(thrust).toBeLessThanOrEqual(droneConfig.maxThrustPerMotor);
    }
    const produced = computeBodyTorque(out, new Vector3());
    expect(produced.x).toBeGreaterThan(0);
    expect(produced.z).toBeGreaterThan(0);
  });
});
