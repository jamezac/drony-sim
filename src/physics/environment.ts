// Entorno: de momento solo el suelo. El viento y el efecto suelo llegan en la fase 4.

import { Vector3 } from 'three';
import { droneConfig } from '../core/config';
import { headingOf, type DroneState } from './drone';

const UP = new Vector3(0, 1, 0);

/**
 * Contacto con el suelo (plano y = 0). Posado sobre sus patas, el dron no se hunde, no resbala
 * y no puede inclinarse ni girar: se conserva solo el rumbo. Si el empuje supera al peso, la
 * integración lo eleva por encima del reposo y deja de estar en el suelo.
 */
export function applyGroundContact(state: DroneState): void {
  const rest = droneConfig.restHeight;
  if (state.position.y > rest) {
    state.onGround = false;
    return;
  }
  state.position.y = rest;
  state.velocity.set(0, Math.max(0, state.velocity.y), 0);
  state.orientation.setFromAxisAngle(UP, headingOf(state.orientation));
  state.angularVelocity.set(0, 0, 0);
  state.onGround = true;
}
