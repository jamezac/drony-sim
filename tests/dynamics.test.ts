import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { droneConfig } from '../src/core/config';
import { createDroneState, headingOf } from '../src/physics/drone';
import { integrate, stepDynamics, updateMotors } from '../src/physics/dynamics';
import { applyGroundContact } from '../src/physics/environment';

const dt = 1 / 240;
const hover = (droneConfig.mass * 9.81) / 4;

function airborneState() {
  const state = createDroneState();
  state.position.set(0, 10, 0);
  state.onGround = false;
  return state;
}

describe('dinámica', () => {
  it('en caída libre (y aún lento, sin arrastre apreciable) acelera a g', () => {
    const state = airborneState();
    for (let i = 0; i < 24; i++) integrate(state, dt); // 0,1 s
    expect(state.velocity.y).toBeCloseTo(-0.981, 2);
  });

  it('con el empuje de hover la aceleración es 0', () => {
    const state = airborneState();
    state.motorThrust.fill(hover);
    for (let i = 0; i < 240; i++) integrate(state, dt);
    expect(state.velocity.length()).toBeLessThan(1e-9);
    expect(state.position.y).toBeCloseTo(10, 9);
  });

  it('los motores siguen al pedido con su constante de tiempo (~63 % en τ)', () => {
    const state = airborneState();
    const steps = Math.round(droneConfig.motorTimeConstant / dt);
    for (let i = 0; i < steps; i++) updateMotors(state, [1, 1, 1, 1], dt);
    expect(state.motorThrust[0]).toBeCloseTo(1 - Math.exp(-(steps * dt) / droneConfig.motorTimeConstant), 3);
  });

  it('más empuje delante levanta el morro', () => {
    const state = airborneState();
    for (let i = 0; i < 24; i++) stepDynamics(state, [hover * 1.1, hover * 1.1, hover * 0.9, hover * 0.9], dt);
    const nose = new Vector3(0, 0, -1).applyQuaternion(state.orientation);
    expect(nose.y).toBeGreaterThan(0);
  });

  it('el cuaternión sigue normalizado tras girar mucho', () => {
    const state = airborneState();
    state.angularVelocity.set(3, 5, -4);
    for (let i = 0; i < 2400; i++) integrate(state, dt);
    expect(state.orientation.length()).toBeCloseTo(1, 9);
  });

  it('el par de las hélices en horario (0 y 3) gira el dron en antihorario visto desde arriba', () => {
    const state = airborneState();
    for (let i = 0; i < 48; i++) stepDynamics(state, [hover * 1.2, hover * 0.8, hover * 0.8, hover * 1.2], dt);
    expect(headingOf(state.orientation)).toBeGreaterThan(0);
  });
});

describe('contacto con el suelo', () => {
  it('posado no se hunde ni se inclina, y conserva el rumbo', () => {
    const state = createDroneState();
    state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), 1);
    state.velocity.set(1, -2, 0);
    state.position.y = -0.1;
    applyGroundContact(state);
    expect(state.position.y).toBe(droneConfig.restHeight);
    expect(state.velocity.length()).toBe(0);
    expect(state.onGround).toBe(true);
    expect(headingOf(state.orientation)).toBeCloseTo(1);
  });

  it('por encima del reposo no está en el suelo', () => {
    const state = airborneState();
    applyGroundContact(state);
    expect(state.onGround).toBe(false);
  });
});
