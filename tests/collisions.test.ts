import { describe, expect, it } from 'vitest';
import { collisionConfig, droneConfig } from '../src/core/config';
import { collideSphere, resolveCollisions, type Collider } from '../src/physics/collisions';
import { createDroneState } from '../src/physics/drone';

const box: Collider = { label: 'edificio', kind: 'box', min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 3, z: 2 } };
const trunk: Collider = { label: 'árbol', kind: 'cylinder', x: 0, z: 0, radius: 0.2, bottom: 0, top: 4 };
const crown: Collider = { label: 'árbol', kind: 'sphere', x: 0, y: 6, z: 0, radius: 2 };

describe('collideSphere', () => {
  it('caja: sin tocar no hay contacto; tocando una cara, la normal sale de esa cara', () => {
    expect(collideSphere({ x: -1, y: 1, z: 1 }, 0.17, box)).toBeNull();
    const contact = collideSphere({ x: -0.1, y: 1, z: 1 }, 0.17, box);
    expect(contact?.normal.x).toBeCloseTo(-1);
    expect(contact?.depth).toBeCloseTo(0.07);
  });

  it('caja: con el centro dentro, sale por la cara más cercana', () => {
    const contact = collideSphere({ x: 1.9, y: 1, z: 1 }, 0.17, box);
    expect(contact?.normal.x).toBeCloseTo(1);
    expect(contact?.depth).toBeCloseTo(0.27);
  });

  it('cilindro: choque por el lado y por encima de la tapa', () => {
    const side = collideSphere({ x: 0.3, y: 2, z: 0 }, 0.17, trunk);
    expect(side?.normal.x).toBeCloseTo(1);
    expect(side?.depth).toBeCloseTo(0.07);
    const top = collideSphere({ x: 0.1, y: 4.1, z: 0 }, 0.17, trunk);
    expect(top?.normal.y).toBeCloseTo(1);
    expect(collideSphere({ x: 0, y: 4.5, z: 0 }, 0.17, trunk)).toBeNull();
  });

  it('cilindro: con el centro dentro, sale por el lado', () => {
    const contact = collideSphere({ x: 0.1, y: 2, z: 0 }, 0.17, trunk);
    expect(contact?.normal.x).toBeCloseTo(1);
    expect(contact?.depth).toBeCloseTo(0.27);
  });

  it('esfera (copa de árbol)', () => {
    expect(collideSphere({ x: 0, y: 6, z: 2.1 }, 0.17, crown)?.normal.z).toBeCloseTo(1);
    expect(collideSphere({ x: 0, y: 6, z: 2.5 }, 0.17, crown)).toBeNull();
  });
});

describe('resolveCollisions', () => {
  function droneAt(x: number, y: number, z: number, vx: number) {
    const state = createDroneState();
    state.position.set(x, y, z);
    state.velocity.set(vx, 0, 0);
    state.onGround = false;
    return state;
  }

  it('saca al dron del obstáculo, informa del impacto y rebota un poco', () => {
    const state = droneAt(-0.1, 1, 1, 5);
    const impact = resolveCollisions(state, [box]);
    expect(impact.speed).toBeCloseTo(5);
    expect(impact.label).toBe('edificio');
    expect(state.position.x).toBeCloseTo(-droneConfig.collisionRadius);
    expect(state.velocity.x).toBeCloseTo(-5 * collisionConfig.restitution);
    expect(state.angularVelocity.length()).toBeGreaterThan(0); // sale girando
  });

  it('si ya se alejaba no cuenta como impacto', () => {
    const state = droneAt(-0.1, 1, 1, -1);
    expect(resolveCollisions(state, [box]).speed).toBe(0);
  });

  it('lejos de todo no toca nada', () => {
    const state = droneAt(10, 1, 10, 5);
    expect(resolveCollisions(state, [box, trunk, crown])).toEqual({ speed: 0, label: null });
    expect(state.velocity.x).toBe(5);
  });
});
