// Parámetros ajustables del simulador. Nada de números mágicos fuera de aquí.
// Los objetos sin `as const` se pueden modificar en vivo desde el panel de ajuste (tecla `).

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Simulación
// ---------------------------------------------------------------------------

export const simConfig = {
  // Paso de física fijo. 240 Hz da margen de sobra a los lazos de control más rápidos.
  physicsHz: 240,
  // Si un frame tarda más que esto (pestaña en segundo plano, tirón), se recorta para no
  // acumular cientos de pasos y congelar la página ("espiral de la muerte")
  maxFrameSeconds: 0.1,
  gravity: 9.81,
} as const;

// ---------------------------------------------------------------------------
// Dron (inspirado en un DJI Mini, ~250 g). Valores aproximados.
// ---------------------------------------------------------------------------

export const droneConfig = {
  mass: 0.249, // kg
  // Distancia del centro a cada motor. La diagonal motor-motor de un Mini es ~0,21 m.
  armLength: 0.105, // m
  propRadius: 0.06, // m (hélices de ~4,7")
  // Momentos de inercia (kg·m²) sobre los ejes del cuerpo: x = derecha, y = arriba, z = atrás.
  // El yaw (y) tiene más inercia porque los motores están lejos de ese eje.
  inertia: { x: 6e-4, y: 1.1e-3, z: 6e-4 },
  // Empuje máximo por motor. Con 1,53 N la relación empuje/peso es ~2,5 (hover ≈ 0,61 N por motor).
  maxThrustPerMotor: 1.53, // N
  // Los motores no cambian de empuje al instante: retardo de primer orden
  motorTimeConstant: 0.03, // s
  // Par de reacción de cada hélice por newton de empuje (genera el yaw)
  yawTorquePerThrust: 0.016, // N·m/N
  // Arrastre cuadrático F = −c·|v|·v. No es inventado: sale de que a la velocidad máxima de
  // Sport (16 m/s) con la inclinación máxima (35°) el empuje horizontal iguala al arrastre:
  // c = m·g·tan(35°) / 16² ≈ 0,0067 kg/m
  linearDrag: 0.0067, // kg/m
  angularDrag: 5e-5, // N·m·s/rad
  // Altura del centro de masas cuando el dron está posado
  restHeight: 0.03, // m
  // Empuje de los motores al ralentí (armados, en el suelo), como fracción del máximo
  idleThrustFraction: 0.04,
  // Efecto suelo: cerca del suelo el aire que empujan las hélices "rebota" y da más empuje.
  // Factor máximo (pegado al suelo); a más de ~2 diámetros de hélice ya casi no se nota.
  groundEffectMax: 1.3,
  // Para chocar, el dron es una esfera que envuelve brazos y hélices (brazo 0,105 + hélice 0,06)
  collisionRadius: 0.17, // m
} as const;

// ---------------------------------------------------------------------------
// Colisiones y crash
// ---------------------------------------------------------------------------

export const collisionConfig = {
  // Al chocar se pierde casi toda la velocidad contra la superficie (0 = se queda pegado, 1 = rebota igual)
  restitution: 0.3,
  // Fracción de la velocidad a lo largo de la superficie que se conserva al rozarla
  tangentialKeep: 0.6,
  // Por encima de esta velocidad de impacto contra un obstáculo, las hélices rompen: crash
  obstacleCrashSpeed: 2.5, // m/s
  // Contra el suelo aguanta más (las patas absorben): un aterrizaje a fondo en Normal es ~3 m/s
  groundCrashSpeed: 4, // m/s vertical
  // Tocar suelo yendo muy rápido en horizontal (rozando el suelo) también es crash
  groundSkidCrashSpeed: 5, // m/s horizontal
  // Giro (rad/s) por cada m/s de impacto: el dron sale dando vueltas tras el golpe
  tumblePerSpeed: 2,
  // Tocar el suelo más inclinado que esto (p. ej. boca abajo en Acro) es crash aunque sea despacio:
  // las hélices golpean el suelo
  groundCrashTilt: 60 * DEG,
};

// ---------------------------------------------------------------------------
// Entorno: viento, límites del mundo
// ---------------------------------------------------------------------------

export type WindLevel = 'calm' | 'moderate' | 'strong';

export const windConfig = {
  // Semilla de las ráfagas: el mismo viento en cada vuelo, para poder comparar y testear
  seed: 20261026,
  // Hacia dónde sopla, con el mismo convenio que el rumbo del dron (0 = hacia −Z, π/2 = hacia −X).
  // Por defecto cruza de derecha a izquierda visto desde el despegue: la deriva se ve bien.
  towardHeading: Math.PI / 2,
  // Velocidad media y desviación típica de las ráfagas (m/s). Un DJI Mini aguanta ~10,7 m/s.
  levels: {
    calm: { speed: 0, gustStd: 0 },
    moderate: { speed: 5, gustStd: 1.5 },
    strong: { speed: 9, gustStd: 3 },
  } satisfies Record<WindLevel, { speed: number; gustStd: number }>,
  // Cuánto duran las ráfagas: tiempo de correlación del ruido (proceso de Ornstein-Uhlenbeck)
  gustSeconds: 2,
  // Las ráfagas verticales son más flojas que las horizontales
  verticalGustRatio: 0.3,
  // A partir de esta velocidad se avisa de viento fuerte
  strongWindWarning: 8, // m/s
  defaultLevel: 'calm' as WindLevel,
};

export const limitsConfig = {
  // Altura máxima legal habitual (UE, EE. UU., muchos países de Latinoamérica): el dron no sube más
  maxAltitude: 120, // m
  // Distancia máxima al despegue: el borde útil del mapa (el suelo mide 400 × 400 m)
  maxDistance: 180, // m
};

// ---------------------------------------------------------------------------
// Batería (inspirada en la de un DJI Mini 2: 2250 mAh, 7,7 V ≈ 17,3 Wh)
// ---------------------------------------------------------------------------

export const batteryConfig = {
  capacityWh: 17.3,
  fullVoltage: 8.4, // V (2 celdas Li-ion cargadas)
  emptyVoltage: 6.8, // V
  internalResistance: 0.05, // Ω: por eso la tensión cae al acelerar fuerte
  // Potencia de los motores: P = k·Σ T^1,5 (teoría del momento: cuesta más que proporcional
  // al empuje). Con k = 18,2 el hover consume ~35 W → ~29 min de vuelo, como un Mini real.
  powerPerThrust: 18.2, // W/N^1,5
  avionicsPower: 1.5, // W: electrónica, cámara, radio
  // Acelera el consumo para no esperar media hora: con 6, el hover dura ~5 min
  drainMultiplier: 6,
  // Umbrales (%), como en DJI: aviso, vuelta a casa automática y aterrizaje forzoso
  lowPercent: 30,
  rthPercent: 15,
  criticalPercent: 10,
};

// ---------------------------------------------------------------------------
// Vuelta a casa (RTH)
// ---------------------------------------------------------------------------

export const rthConfig = {
  // Altura de vuelta: por encima de árboles y obstáculos habituales. Si ya está más alto, la mantiene.
  altitude: 30, // m
  speed: 8, // m/s
  // Si está más cerca que esto, vuelve sin subir (como DJI)
  nearHomeDistance: 20, // m
  // Al llegar a este radio del despegue y casi parado, empieza a aterrizar
  arriveRadius: 0.5, // m
  arriveSpeed: 0.3, // m/s
  // Gira hacia casa antes de avanzar hasta que el error de rumbo baja de esto
  headingTolerance: 10 * DEG,
};

// ---------------------------------------------------------------------------
// Órbita (POI, "punto de interés"), como la de DJI: el dron da vueltas a un punto mirándolo
// ---------------------------------------------------------------------------

export const orbitConfig = {
  // Al empezar, el centro se pone a esta distancia delante del morro
  startRadius: 10, // m
  minRadius: 3, // m
  maxRadius: 50, // m
  // Velocidad a lo largo del círculo al empezar (positiva = hacia la derecha del dron)
  startSpeed: 2, // m/s
  maxSpeed: 8, // m/s (y nunca más que la del modo)
  // Con el stick a fondo, cuánto cambian el radio (avance/atrás) y la velocidad (lateral) por segundo
  radiusRate: 2, // m/s
  speedRate: 1.5, // m/s²
  // Para girar en círculo hace falta una aceleración hacia el centro v²/R. Se limita, así que en
  // órbitas pequeñas la velocidad máxima baja: v ≤ √(a·R)
  maxCentripetal: 3, // m/s²
  // Corrección del radio: velocidad hacia fuera o hacia dentro por cada metro de error
  radiusKp: 1, // 1/s
};

// ---------------------------------------------------------------------------
// Control: PID en cascada. Cada lazo controla al de debajo y el interior es el más rápido.
//   posición → velocidad → aceleración/inclinación → actitud → velocidad angular → motores
// Regla práctica: cada lazo ~3 veces más lento que el que tiene debajo.
// ---------------------------------------------------------------------------

export const controlConfig = {
  // Lazo interior: velocidad angular (rad/s) → aceleración angular (rad/s²)
  rate: { kp: 25, ki: 0, kd: 0, maxOutput: 300 },
  yawRate: { kp: 12, ki: 1, kd: 0, maxOutput: 60 },
  // Actitud: error de orientación (rad) → velocidad angular deseada (rad/s)
  attitude: { kp: 8, yawKp: 3, maxTiltRate: 6, maxYawRate: 3 },
  // Velocidad horizontal (m/s) → aceleración deseada (m/s²)
  velocity: { kp: 2.5, ki: 0.3, kd: 0, maxOutput: 8 },
  // Posición (m) → velocidad (m/s) cuando se mantiene el punto al soltar los sticks
  position: { kp: 1, maxSpeed: 2 },
  // Velocidad vertical (m/s) → aceleración vertical (m/s²)
  verticalSpeed: { kp: 5, ki: 2, kd: 0, maxOutput: 8 },
  // Altura (m) → velocidad vertical (m/s) cuando se mantiene la altura
  altitude: { kp: 1.5, maxSpeed: 2 },
  // Por debajo de esta velocidad horizontal, al soltar los sticks se fija el punto a mantener
  holdEngageSpeed: 0.3, // m/s
};

// ---------------------------------------------------------------------------
// Modos de vuelo. Valores aproximados de un DJI Mini.
// ---------------------------------------------------------------------------

export type FlightModeName = 'cine' | 'normal' | 'sport' | 'atti' | 'acro';

export interface FlightModeParams {
  /**
   * Con GPS (Cine/Normal/Sport) el stick pide una VELOCIDAD y al soltarlo el dron frena y
   * mantiene el punto. Sin GPS (ATTI) el stick pide una INCLINACIÓN: al soltarlo se nivela,
   * pero sigue deslizándose con la inercia (y con el viento, en la fase 4).
   */
  positionHold: boolean;
  /**
   * Auto-nivelado: al soltar los sticks el dron se pone horizontal. Sin él (Acro), el stick pide
   * VELOCIDAD DE GIRO: al soltarlo el dron se queda con la inclinación que tenga, y el throttle
   * es directo (sin mantener la altura). Los límites de abajo no se usan en Acro (ver acroConfig).
   */
  selfLevel: boolean;
  maxSpeed: number; // m/s horizontal (en ATTI la limita solo la física)
  maxClimb: number; // m/s
  maxDescent: number; // m/s
  maxTilt: number; // rad
  maxYawRate: number; // rad/s
  // Aceleración máxima del objetivo de velocidad: define lo "suave" que arranca y frena
  maxAccel: number; // m/s²
}

export const modesConfig: Record<FlightModeName, FlightModeParams> = {
  // Muy suave y lento: primeros vuelos y tomas de vídeo
  cine: {
    positionHold: true,
    selfLevel: true,
    maxSpeed: 6,
    maxClimb: 1.5,
    maxDescent: 1.5,
    maxTilt: 15 * DEG,
    maxYawRate: 30 * DEG,
    maxAccel: 2,
  },
  // El de por defecto de un DJI
  normal: {
    positionHold: true,
    selfLevel: true,
    maxSpeed: 10,
    maxClimb: 3,
    maxDescent: 3,
    maxTilt: 25 * DEG,
    maxYawRate: 60 * DEG,
    maxAccel: 5,
  },
  // Rápido: más inclinación, arranca y frena más fuerte (y tarda más en pararse)
  sport: {
    positionHold: true,
    selfLevel: true,
    maxSpeed: 16,
    maxClimb: 5,
    maxDescent: 3.5,
    maxTilt: 35 * DEG,
    maxYawRate: 130 * DEG,
    maxAccel: 8,
  },
  // Sin GPS: mantiene la altura (barómetro) pero no la posición
  atti: {
    positionHold: false,
    selfLevel: true,
    maxSpeed: 10,
    maxClimb: 3,
    maxDescent: 3,
    maxTilt: 25 * DEG,
    maxYawRate: 60 * DEG,
    maxAccel: 5,
  },
  // Sin GPS ni auto-nivelado: el dron hace exactamente lo que dicen los sticks (rates en acroConfig).
  // Estos límites solo se usan en las fases automáticas (despegue, aterrizaje) y al salir de Acro:
  // los de Sport, para que pasar de Acro a Sport no los cambie.
  acro: {
    positionHold: false,
    selfLevel: false,
    maxSpeed: 16,
    maxClimb: 5,
    maxDescent: 3.5,
    maxTilt: 35 * DEG,
    maxYawRate: 130 * DEG,
    maxAccel: 8,
  },
};

/** Rates de un eje en Acro, con la fórmula de Betaflight (ver control/acro.ts) */
export interface AcroAxisRates {
  /** Pendiente en el centro: 1 = 200 °/s por unidad de stick */
  rcRate: number;
  /** Cuánto se acelera el giro hacia los extremos: máximo = 200·rcRate / (1 − superRate) °/s */
  superRate: number;
  /** Suaviza el centro sin cambiar el máximo (0 = lineal). Ojo: la entrada ya tiene su propia expo. */
  expo: number;
}

// Acro (o "Manual"), como un dron FPV con Betaflight: los sticks piden velocidad de giro.
export const acroConfig = {
  // Alabeo y cabeceo: 500 °/s a fondo, un flip completo en menos de un segundo. Los pilotos de
  // carreras usan 700-900 °/s; para aprender es mejor algo más tranquilo.
  rollPitch: { rcRate: 1, superRate: 0.6, expo: 0 } satisfies AcroAxisRates,
  // Giro: 333 °/s a fondo
  yaw: { rcRate: 1, superRate: 0.4, expo: 0 } satisfies AcroAxisRates,
};

// Al cambiar de modo, los límites pasan del modo anterior al nuevo de forma gradual (exponencial
// con esta constante de tiempo). Así, pasar de Sport a Cine a 16 m/s no da un tirón brusco.
export const modeTransitionSeconds = 0.5;

// ---------------------------------------------------------------------------
// Fases automáticas (despegue, aterrizaje, armado)
// ---------------------------------------------------------------------------

export const flightConfig = {
  takeoffAltitude: 1.2, // m, igual que el despegue automático de DJI
  takeoffSpeed: 1, // m/s
  landingSpeed: 0.8, // m/s
  landingSlowSpeed: 0.4, // m/s por debajo de landingSlowAltitude
  landingSlowAltitude: 1, // m
  // Throttle necesario para despegar a mano con los motores en marcha
  manualTakeoffThrottle: 0.3,
  // Throttle abajo durante este tiempo, ya posado, para parar los motores
  disarmHoldSeconds: 1.5,
  disarmThrottle: -0.8,
  // Altura sobre el reposo a partir de la cual se considera que el dron ha despegado
  airborneHeight: 0.15, // m
  // Mover cualquier stick más que esto cancela el despegue/aterrizaje automático
  overrideStick: 0.3,
};

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/** Sticks virtuales (−1..1): throttle + = subir, yaw + = girar en horario, pitch + = adelante, roll + = derecha. */
export type StickName = 'throttle' | 'yaw' | 'pitch' | 'roll';

/** Cómo sale un stick virtual de un eje del gamepad. */
export interface AxisBinding {
  axis: number;
  invert: boolean;
  /** Valor del eje a fondo; se divide por él para que el gesto completo dé ±1 */
  fullScale: number;
}

export type SpaceMouseProfileName = 'translation' | 'tilt';

// SpaceMouse leído por la Gamepad API. Ejes medidos con el asistente de mapeo (fase 0):
//   0 desplazar a la derecha (+) · 1 desplazar adelante (−) · 2 subir (−)
//   3 inclinar adelante (−)      · 4 inclinar a la derecha (−) · 5 girar en horario (+, llega a ~0,87)
export const spaceMouseGamepadConfig = {
  // El receptor universal aparece como varios gamepads; el del SpaceMouse es el que tiene ejes
  minAxes: 6,
  // Por defecto "translation": en "tilt", subir la tapa la inclina adelante un ~41 %
  // y cada corrección de altura cabecearía el dron. En "translation", subir apenas afecta (~12 %).
  defaultProfile: 'translation' as SpaceMouseProfileName,
  profiles: {
    // Desplazar la tapa hacia donde quieres que vaya el dron
    translation: {
      throttle: { axis: 2, invert: true, fullScale: 1 },
      yaw: { axis: 5, invert: false, fullScale: 0.85 },
      pitch: { axis: 1, invert: true, fullScale: 1 },
      roll: { axis: 0, invert: false, fullScale: 1 },
    },
    // Inclinar la tapa como quieres que se incline el dron
    tilt: {
      throttle: { axis: 2, invert: true, fullScale: 1 },
      yaw: { axis: 5, invert: false, fullScale: 0.85 },
      pitch: { axis: 3, invert: true, fullScale: 1 },
      roll: { axis: 4, invert: true, fullScale: 1 },
    },
  } satisfies Record<SpaceMouseProfileName, Record<StickName, AxisBinding>>,
  buttons: {
    takeoffLand: 0, // botón izquierdo
    modeSwitch: 1, // botón derecho
  },
};

export type GamepadStickMode = 'mode2' | 'mode1';

// Mando genérico (Xbox, PlayStation, radio RC en modo joystick) con el mapeo "standard" del
// navegador: ejes 0/1 = stick izquierdo X/Y, 2/3 = stick derecho X/Y. En Y, arriba es −1.
export const gamepadConfig = {
  modes: {
    // Modo 2 (DJI por defecto): izquierdo = altura y giro, derecho = avance y lateral
    mode2: {
      throttle: { axis: 1, invert: true, fullScale: 1 },
      yaw: { axis: 0, invert: false, fullScale: 1 },
      pitch: { axis: 3, invert: true, fullScale: 1 },
      roll: { axis: 2, invert: false, fullScale: 1 },
    },
    // Modo 1: se intercambian altura y avance entre los dos sticks
    mode1: {
      pitch: { axis: 1, invert: true, fullScale: 1 },
      yaw: { axis: 0, invert: false, fullScale: 1 },
      throttle: { axis: 3, invert: true, fullScale: 1 },
      roll: { axis: 2, invert: false, fullScale: 1 },
    },
  } satisfies Record<GamepadStickMode, Record<StickName, AxisBinding>>,
  buttons: {
    takeoffLand: 0, // A (Xbox) / Cruz (PlayStation)
    toggleMotors: 1, // B (Xbox) / Círculo (PlayStation)
    modeSwitch: 3, // Y (Xbox) / Triángulo (PlayStation)
    returnHome: 2, // X (Xbox) / Cuadrado (PlayStation)
    gimbalDown: 4, // LB / L1, como la rueda del gimbal de la radio DJI
    gimbalUp: 5, // RB / R1
  },
};

// Valores por defecto de la entrada. Los que elige el usuario se guardan en el navegador
// (core/settings.ts) y tienen prioridad sobre estos.
export const inputConfig = {
  spaceMouse: {
    // Zona muerta: por debajo no hace nada. Ayuda con el acoplamiento entre ejes (~40 % en pico).
    deadzone: 0.12,
    // Expo: suave cerca del centro para correcciones finas, completo a fondo
    expo: 0.3,
  },
  gamepad: {
    // Los sticks de un mando vuelven peor al centro que la tapa del SpaceMouse, pero acoplan menos
    deadzone: 0.08,
    expo: 0.3,
    defaultMode: 'mode2' as GamepadStickMode,
  },
  keyboard: {
    // Tiempo para pasar de 0 a ±1 con la tecla pulsada, y para volver a 0 al soltarla
    rampUpSeconds: 0.3,
    rampDownSeconds: 0.1,
  },
};

// Calibración del SpaceMouse (devices.html)
export const calibrationConfig = {
  // Tiempo con la tapa suelta para medir el centro de cada eje
  restSeconds: 1,
  // Recorrido mínimo hacia cada lado (desde el centro) para dar un eje por calibrado
  minSpan: 0.5,
  // Por debajo de este recorrido no se divide (evita amplificar ruido de un eje sin datos)
  minUsableSpan: 0.05,
} as const;

// SpaceMouse por WebHID: alternativa, solo funciona con el driver 3DxWare cerrado
export const spaceMouseConfig = {
  // Vendor IDs USB de 3Dconnexion (el antiguo de Logitech y el actual)
  vendorIds: [0x046d, 0x256f],
  // Colección HID "controlador multieje" (Generic Desktop / Multi-axis Controller).
  // El receptor inalámbrico expone varias interfaces; esta es la que lleva los ejes.
  usagePage: 0x01,
  usage: 0x08,
  // Valor bruto aproximado del eje a fondo. Se normaliza a -1..1 dividiendo por esto.
  axisFullScale: 350,
} as const;

// Asistente de mapeo (devices.html): cómo decide que un gesto ha terminado.
// Los umbrales son relativos porque la escala que da el navegador depende del rango que
// declara el dispositivo: a fondo puede dar ±1 o bastante menos.
export const mappingWizardConfig = {
  // Pico mínimo (en -1..1) para considerar que empezó un gesto. Muy bajo a propósito.
  minPeak: 0.02,
  // La tapa se considera suelta cuando todos los ejes bajan de esta fracción del pico del gesto
  restRatio: 0.15,
  // Tiempo con la tapa suelta tras el gesto antes de pasar al siguiente paso
  restMs: 400,
} as const;

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export const renderConfig = {
  // Cámara de tercera persona: detrás y algo por encima del dron
  chaseDistance: 2.5, // m
  chaseHeight: 1, // m
  // Apunta algo por debajo del dron para que el suelo (y su sombra) entre en el encuadre
  chaseLookOffset: -0.3, // m
  chaseFov: 60, // grados
  // Vista del piloto: tú, de pie un poco por detrás del helipuerto, mirando al dron
  pilotPosition: { x: 0, z: 3 }, // m
  pilotEyeHeight: 1.7, // m
  // Algo más cerrado que la cámara de seguimiento: el ojo humano "enfoca" el dron, no ve un gran angular
  pilotFov: 45, // grados
  pilotLookStiffness: 8, // 1/s: lo rápido que la mirada sigue al dron
  // Rigidez del "muelle" que sigue al dron (1/s): más alto = sigue más pegado
  chasePositionStiffness: 6,
  chaseYawStiffness: 3,
  // Más inclinado que esto (un flip en Acro), el rumbo del dron deja de tener sentido: al pasar
  // por la vertical da media vuelta. La cámara deja de seguirlo hasta que vuelve a nivelarse.
  chaseFollowMaxTilt: 60 * DEG,
  groundSize: 400, // m
  coneSpacing: 10, // m entre conos de referencia
  coneRange: 40, // m: hasta dónde llegan los conos desde el home
  shadowRange: 8, // m: tamaño del área con sombras alrededor del dron
  // Manga de viento a la derecha y por delante del despegue: a esa distancia entra en el encuadre
  // de la cámara de seguimiento (más cerca, la manga queda por encima del borde de la imagen)
  windsockPosition: { x: 3, z: -10 }, // m
  // Velocidad del viento a la que la manga queda totalmente horizontal
  windsockFullSpeed: 8, // m/s
  // Posición del sol respecto al dron. Casi vertical: la sombra cae justo debajo y sirve de
  // referencia de altura al aterrizar (a 1,2 m se desplaza solo ~0,2 m)
  sunOffset: { x: 3, y: 20, z: 2 }, // m
  // Capa de render del dron: la ven las cámaras exteriores y la sombra, pero no la FPV
  // (la cámara está pegada al dron y vería su propio cuerpo por dentro)
  droneLayer: 1,
  // Imagen en miniatura (PiP) de la FPV, abajo a la derecha encima de los sticks (px CSS)
  pip: { width: 320, height: 180, right: 16, bottom: 210, maxWidthFraction: 0.35 },
} as const;

// ---------------------------------------------------------------------------
// Cámara FPV y gimbal (como la de un DJI Mini: 3 ejes, de −90° a +20°)
// ---------------------------------------------------------------------------

export const gimbalConfig = {
  // Campo de visión vertical. Un Mini tiene ~83° en diagonal, que en 16:9 son ~50° en vertical.
  fov: 50, // grados
  // Posición de la cámara respecto al centro del dron: bajo el morro (ejes del cuerpo, m)
  offset: { x: 0, y: -0.012, z: -0.08 },
  minPitch: -90 * DEG, // mirando en vertical hacia abajo
  maxPitch: 20 * DEG, // algo hacia arriba
  pitchRate: 60 * DEG, // rad/s con la tecla (o la rueda) a fondo
  // El gimbal sigue el giro del dron con algo de retraso (1/s): la imagen no da tirones al girar
  yawStiffness: 8,
};

// Ajustes de la FPV que se pueden cambiar en vivo (panel de ajuste)
export const fpvSettings = {
  /**
   * Gimbal estabilizado (DJI): el horizonte siempre recto. Desactivado: cámara fija al cuerpo,
   * como en un dron FPV de carreras: el horizonte se inclina con el dron.
   */
  stabilized: true,
};
