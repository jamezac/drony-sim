// Modelo 3D del dron, construido con primitivas (sin archivos externos). Tamaño real de un Mini.
//
// Lo más importante es que se vea CLARAMENTE dónde está el morro: banda naranja y cámara delante,
// luces naranjas en los brazos delanteros y verdes en los traseros. Saber hacia dónde mira el
// dron es la base del pilotaje (sobre todo en "nose-in", cuando viene hacia ti).

import * as THREE from 'three';
import { droneConfig, renderConfig } from '../core/config';
import { MOTOR_COUNT, MOTOR_YAW_DIRECTION, motorPositions } from '../physics/drone';

// Velocidad de giro VISIBLE de las hélices a empuje máximo. La real (~25 000 rpm) se vería
// como un parpadeo; esto da sensación de giro y además se ve un disco cuando van rápidas.
const VISIBLE_SPIN_RATE = 60; // rad/s

export interface DronePose {
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
  motorThrust: readonly number[];
}

function material(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
}

function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, castShadow = true): THREE.Mesh {
  const result = new THREE.Mesh(geometry, mat);
  result.castShadow = castShadow;
  return result;
}

export class DroneModel {
  readonly group = new THREE.Group();
  private readonly props: THREE.Group[] = [];
  private readonly discs: THREE.MeshStandardMaterial[] = [];

  constructor() {
    const body = mesh(new THREE.BoxGeometry(0.08, 0.05, 0.14), material(0x9aa3ab));
    const noseBand = mesh(new THREE.BoxGeometry(0.07, 0.008, 0.025), material(0xff7a1a));
    noseBand.position.set(0, 0.026, -0.055);
    const camera = mesh(new THREE.SphereGeometry(0.018, 16, 12), material(0x1d2125, { roughness: 0.3 }));
    camera.position.set(0, -0.012, -0.075);
    this.group.add(body, noseBand, camera);

    const armMaterial = material(0x7d868e);
    const motorMaterial = material(0x2b3036);
    const bladeMaterial = material(0x2b3036);
    const frontLight = material(0xff7a1a, { emissive: 0xff7a1a, emissiveIntensity: 1.5 });
    const rearLight = material(0x3fcf8e, { emissive: 0x3fcf8e, emissiveIntensity: 1.5 });

    motorPositions().forEach((r, i) => {
      const arm = mesh(new THREE.BoxGeometry(0.012, 0.01, droneConfig.armLength), armMaterial);
      arm.position.set(r.x / 2, 0, r.z / 2);
      arm.rotation.y = Math.atan2(r.x, r.z);

      const motor = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 16), motorMaterial);
      motor.position.set(r.x, 0.012, r.z);

      const light = mesh(new THREE.SphereGeometry(0.006, 8, 6), r.z < 0 ? frontLight : rearLight, false);
      light.position.set(r.x, -0.006, r.z);

      // Hélice: dos palas que giran + un disco translúcido que aparece al ir rápido
      const prop = new THREE.Group();
      prop.position.set(r.x, 0.024, r.z);
      prop.add(mesh(new THREE.BoxGeometry(droneConfig.propRadius * 2, 0.002, 0.012), bladeMaterial));
      const discMaterial = material(0x2b3036, { transparent: true, opacity: 0, depthWrite: false });
      const disc = mesh(new THREE.CircleGeometry(droneConfig.propRadius, 24), discMaterial, false);
      disc.rotation.x = -Math.PI / 2;
      prop.add(disc);
      this.props[i] = prop;
      this.discs[i] = discMaterial;

      this.group.add(arm, motor, light, prop);
    });

    // Capa propia: la ven las cámaras exteriores y la sombra, pero no la FPV (está dentro del dron)
    this.group.traverse((object) => object.layers.set(renderConfig.droneLayer));
  }

  update(pose: DronePose, dt: number): void {
    this.group.position.copy(pose.position);
    this.group.quaternion.copy(pose.orientation);
    for (let i = 0; i < MOTOR_COUNT; i++) {
      const level = pose.motorThrust[i] / droneConfig.maxThrustPerMotor;
      // El sentido visual de giro es el opuesto al par de reacción sobre el cuerpo
      this.props[i].rotation.y -= MOTOR_YAW_DIRECTION[i] * Math.sqrt(level) * VISIBLE_SPIN_RATE * dt;
      this.discs[i].opacity = Math.min(0.35, level * 0.8);
    }
  }
}
