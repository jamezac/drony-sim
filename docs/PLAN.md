# Plan del proyecto: Drony Sim 🚁

## Contexto

Drony Sim es un simulador 3D de cuadricóptero en el navegador (TypeScript + Three.js + Vite) para **aprender a pilotar un DJI tipo Mini antes de comprar uno**, y de paso entender la física de vuelo, los PID y los gráficos 3D.

El único dispositivo analógico del usuario es un **SpaceMouse Wireless**: no tiene gamepad ni radio RC. Por eso el SpaceMouse pasa a ser el **control principal desde el MVP**, con el teclado como respaldo y el gamepad preparado para el futuro.

**Estado actual (sin commit):** el esqueleto está a medias. Ya están instaladas las dependencias (`three`, `vite@8`, `typescript@6`, `vitest@5`, `eslint@10`, `typescript-eslint`, `@types/three`, `@types/w3c-web-hid`). `package.json` tiene los scripts `dev/build/test/lint` y `tsconfig.json` está en modo `strict` con `src` y `tests` incluidos. Ya existen:
- `src/core/config.ts`: vendor IDs y escala de ejes del SpaceMouse
- `src/input/spaceMouseReport.ts`: decodificación pura de los reports HID
- `src/input/spaceMouse.ts`: conexión WebHID
- `tests/spaceMouseReport.test.ts`

Faltan: `index.html`, la página de prueba, la configuración de ESLint/Vite, `npm run check`, y ejecutar los tests y el build por primera vez.

**Comprobado en tu equipo:**
- Chrome está en `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe` (Windows).
- No hay ningún Chrome dentro de WSL.
- La red de WSL está en modo `nat`.
- Has elegido usar el **Chrome de Windows** para el check. Eso requiere activar la red mirrored (fase 0).

**Resultado buscado:** un simulador que sea jugable en cada fase y cuya sensación de vuelo se parezca a la de un DJI. Al final tendrá lecciones guiadas que entrenan las habilidades reales: hover, orientación, nose-in, circuitos y aterrizaje de precisión.

---

## 1. Principios que guían todas las fases

1. **Jugable en cada fase.** Ninguna fase termina sin poder abrir el navegador y volar.
2. **Primero la sensación, después los gráficos.** Los parámetros se ajustan imitando un DJI: frenado al soltar, inclinación máxima, velocidades por modo.
3. **Capas separadas: física / control / input / render / UI.**
   - La física y el control solo importan `Vector3` y `Quaternion` de `three`: nada del DOM ni de WebGL.
   - Así toda la simulación se puede ejecutar en Node (sin navegador) dentro de Vitest.
4. **Paso de física fijo de 240 Hz**, desacoplado del render. El render interpola entre el estado anterior y el actual.
5. **Todo número ajustable vive en `core/config.ts`.**
6. **Tests para todo lo que sea lógica pura.** Habrá una función `simulate(segundos, entradas)` para probar el vuelo completo sin navegador.
7. **Determinismo.** Las ráfagas de viento usan un generador aleatorio con semilla, así las lecciones y los tests son reproducibles.
8. **Sin reservar memoria nueva en cada paso de física.** Se reutilizan vectores temporales para evitar tirones del recolector de basura (GC) a 240 Hz.

---

## 2. Arquitectura

### Flujo de datos de cada frame

```
requestAnimationFrame
  └─ InputManager.sample()        teclado + SpaceMouse (+ gamepad)  →  ControlInput {throttle,yaw,pitch,roll ∈ [-1,1], acciones}
  └─ FixedLoop (acumulador)       N pasos de 1/240 s:
        Simulation.step(dt, input)
          ├─ FlightController     máquina de estados + modo de vuelo + PID en cascada  →  empuje de 4 motores
          ├─ Dynamics             motores (retardo) → fuerzas/torques → integra el estado
          └─ Environment          gravedad, viento, efecto suelo, contacto con el suelo, límites
  └─ render(alpha)                interpola el estado → modelo 3D, cámara, HUD
```

### Estructura de carpetas final

Amplía la de `CLAUDE.md`. Las marcadas con ★ son añadidos nuevos.

```
index.html                 simulador
devices.html             ★ página de prueba y calibración de dispositivos
src/
  main.ts                  conecta todas las piezas: loop + input + simulación + render + UI
  devices.ts             ★ entrada de devices.html
  core/
    config.ts              todos los parámetros
    loop.ts                acumulador de paso fijo (lógica pura, testeable con un reloj falso)
    simulation.ts        ★ estado + controlador + entorno; step(dt, input). Sin DOM.
    random.ts            ★ PRNG con semilla (mulberry32)
    settings.ts          ★ ajustes del usuario persistidos en localStorage (calibración, mapeo, modo)
  physics/
    drone.ts               DroneState: posición, velocidad, cuaternión, velocidad angular (en ejes del cuerpo), empuje de los motores, batería
    dynamics.ts            motores, fuerzas, torques, integración
    environment.ts         viento/ráfagas, efecto suelo, suelo, límites
    collisions.ts        ★ (fase 7) esfera del dron contra colliders estáticos
  control/
    pid.ts                 PID genérico
    mixer.ts             ★ mezcla para cuadricóptero en X: empuje + torques → 4 motores
    flightController.ts    cascada posición → velocidad → actitud → velocidad angular
    flightState.ts       ★ máquina de estados: DESARMADO → ARMADO → DESPEGANDO → VOLANDO → ATERRIZANDO / RTH / ESTRELLADO
    modes.ts               Cine, Normal, Sport, ATTI, Acro (parámetros y comportamiento)
  input/
    inputManager.ts        mezcla las fuentes → ControlInput
    mapping.ts             zona muerta, expo, inversión, perfiles, filtro anti-acoplamiento, Modo 1/2
    keyboard.ts          ★ teclado con rampa (simula un stick analógico)
    spaceMouse.ts          (ya existe) WebHID
    spaceMouseReport.ts    (ya existe) decodificación pura
    gamepad.ts           ★ Gamepad API (mando o radio RC en el futuro)
  render/
    scene.ts               renderer, cielo, luces, sombras, suelo con cuadrícula, referencias visuales
    droneModel.ts          dron procedural, hélices animadas, morro visible
    cameras.ts             tercera persona, FPV, línea de visión
    markers.ts           ★ (fase 5) objetivos, puertas, trayectorias
    scenarios/           ★ (fase 7) park.ts, city.ts, obstacles.ts
  ui/
    hud.ts                 telemetría estilo DJI Fly
    stickView.ts         ★ visualizador de los 2 sticks virtuales
    menus.ts               inicio, pausa, ajustes, lecciones
    tuningPanel.ts       ★ panel de desarrollo (lil-gui, viene incluido en three/addons) para ajustar PID en vivo
  training/
    lessons.ts             lecciones definidas como datos + comprobadores de objetivos
    scoring.ts             métricas y estrellas
tests/                     un *.test.ts por cada módulo puro
scripts/check.ts         ★ npm run check: Chrome invisible → capturas + errores de consola
.check/                  ★ capturas generadas (en .gitignore)
docs/PLAN.md             ★ copia de este plan dentro del repo
```

### Convenciones físicas

| Concepto | Convención |
|---|---|
| Mundo | Three.js, mano derecha, **Y arriba**. Home = origen. |
| Cuerpo del dron | x = derecha, y = arriba, **−z = morro (adelante)** |
| Pitch | Rotación sobre x del cuerpo. Stick adelante → morro abajo → avanza. |
| Roll | Rotación sobre z del cuerpo. Yaw: rotación sobre y. |
| Orientación | Cuaternión normalizado en cada paso. Ángulos de Euler solo para mostrar en el HUD. |
| Unidades | SI internamente (m, s, kg, N, rad). Grados solo en la UI. |
| Integración | Euler semi-implícito a 240 Hz. Cuaternión: q += ½·q⊗(0,ω)·dt y luego normalizar. |
| Rotación | Ecuaciones de Euler: I·ω̇ = τ − ω × (I·ω), con tensor de inercia diagonal. |

### Parámetros de referencia (estilo DJI Mini, aproximados y ajustables)

| Parámetro | Valor inicial |
|---|---|
| Masa | 0,249 kg |
| Distancia en diagonal entre motores | ~0,21 m (brazo 0,105 m) |
| Radio de hélice | ~0,06 m |
| Relación empuje/peso | ~2,5 (≈1,5 N máx. por motor; hover ≈0,61 N) |
| Constante de tiempo del motor | ~0,03 s |
| Altura de despegue automático | 1,2 m (igual que DJI) |

| Modo | Vel. horizontal | Subida / bajada | Inclinación máx. | Yaw máx. |
|---|---|---|---|---|
| Cine | ~6 m/s | 1,5 / 1,5 m/s | ~15° | ~30°/s |
| Normal | ~10 m/s | 3 / 3 m/s | ~25° | ~60°/s |
| Sport | ~16 m/s | 5 / 3,5 m/s | ~35° | ~130°/s |

**Arrastre derivado, no inventado.** En vuelo a velocidad máxima constante, la componente horizontal del empuje iguala al arrastre: m·g·tan(θ) = c·v². Así que c = m·g·tan(35°)/16² ≈ 0,0067 kg/m. Con eso la velocidad máxima de Sport sale sola de la física.

---

## 3. Fases

Cada fase indica: **objetivo**, **qué habilidad de piloto practicas**, **archivos**, **claves técnicas**, **tests** y **criterio de "hecho"**.

### Fase 0: Esqueleto y prueba del SpaceMouse (en curso)

**Objetivo:** confirmar que Chrome/Edge en Windows puede leer el SpaceMouse Wireless por WebHID, y dejar listas todas las herramientas.

**Archivos:**
- `vite.config.ts`: puerto 5173 con `strictPort`, entradas múltiples (`index.html` + `devices.html`) y config de Vitest (`environment: 'node'`, `include: tests/**/*.test.ts`)
- `eslint.config.js`: configuración plana con `@eslint/js` + `typescript-eslint` recomendado + `globals.browser`
- `index.html` + `src/main.ts`: escena mínima de Three.js (cubo girando) que valida el stack, con un enlace a "Probar dispositivos"
- `devices.html` + `src/devices.ts`, que es la página de prueba. Muestra:
  - si WebHID está disponible y si el contexto es seguro
  - el botón "Conectar SpaceMouse"
  - los datos del dispositivo: nombre, vendorId, productId y colecciones HID
  - 6 barras de ejes con el valor bruto y el normalizado
  - el estado de los botones
  - la frecuencia de reports (Hz)
  - un log de reports en crudo (id + bytes en hex), para diagnosticar el formato

**Correcciones a `src/input/spaceMouse.ts`:**
- No registrar el listener `inputreport` dos veces si se llama a `open()` de nuevo.
- Escuchar `navigator.hid` `connect/disconnect`, porque el Wireless se duerme o se desconecta.
- El receptor inalámbrico puede exponer varias interfaces HID. Elegir la que tenga la colección `usagePage 0x01 / usage 0x08` (controlador multieje).

**Documentación:**
- `CLAUDE.md`: SpaceMouse como entrada principal, nueva hoja de ruta, nota de WebHID.
- `README.md`: cómo ejecutar el proyecto.
- `docs/PLAN.md`: copia de este plan.

**`npm run check`:** se crea en esta fase. El detalle está en la sección 4.

**Prerrequisito que haces tú una vez:**
1. Crea o edita `C:\Users\<tú>\.wslconfig` con estas dos líneas:
   ```
   [wsl2]
   networkingMode=mirrored
   ```
2. En PowerShell ejecuta `wsl --shutdown` y vuelve a abrir la terminal.

Con esto WSL y Windows comparten `localhost` en los dos sentidos.

**Ojo:** WebHID solo funciona en un **contexto seguro**. Hay que abrir `http://localhost:5173`, **no** la IP de WSL. Si el driver 3DxWare bloquea el acceso, el plan B es el SDK web de 3Dconnexion, que se comunica con el driver.

**Captura esperada:**
- `index`: un cubo 3D iluminado y el enlace a dispositivos.
- `devices`: "WebHID disponible ✓", el botón Conectar y las 6 barras de ejes a cero.

**Hecho cuando:** `npm run test`, `lint`, `build` y `check` pasan sin errores. Además, **tú** mueves cada eje en `devices.html` y me dices los signos y los valores máximos en bruto. Con eso ajusto `axisFullScale` y el mapeo por defecto.

**Resultado (completada):**
- Con 3DxWare abierto, WebHID no recibe datos. El SpaceMouse se lee por la **Gamepad API**.
- El receptor `256f:c652` aparece como 2 gamepads: el **#1 (6 ejes, 2 botones) es el SpaceMouse** y el #0 (0 ejes) es la interfaz de ratón.
- Hay además un mando virtual `beef:046d` con un hat switch fijo en ≈1,286, que hay que ignorar.
- Ejes del SpaceMouse: 0 desplazar a la derecha (+), 1 desplazar adelante (−), 2 subir (−), 3 inclinar adelante (−), 4 inclinar a la derecha (−), 5 girar en horario (+, máx ~0,87). Botones: izquierdo 0, derecho 1.
- Acoplamiento medido entre ejes, pico respecto al eje dominante: hasta ~40 %. El filtro anti-acoplamiento de la fase 2 hará falta.

---

### Fase 1: MVP volable (modo Normal)

**Objetivo:** despegar, hacer hover, moverse y aterrizar con el SpaceMouse y con el teclado, con sensación de DJI en modo Normal.

**Practicas:** despegue, hover estable, frenado al soltar y aterrizaje. La base de todo.

**Archivos:**
- `core/loop.ts`, `core/simulation.ts`, `core/config.ts` (ampliado)
- `physics/drone.ts`, `dynamics.ts`, `environment.ts` (gravedad + suelo)
- `control/pid.ts`, `mixer.ts`, `flightController.ts`, `flightState.ts`, `modes.ts` (solo Normal)
- `input/inputManager.ts`, `mapping.ts` (zona muerta + expo básicas), `keyboard.ts`
- `render/scene.ts`, `droneModel.ts`, `cameras.ts` (solo tercera persona)
- `ui/hud.ts` (mínimo: altura, velocidad, estado) y `ui/tuningPanel.ts`
- `main.ts`

**Claves técnicas:**
- **Bucle de paso fijo:** un acumulador. El tiempo de frame se recorta a 0,1 s como máximo para evitar la "espiral de la muerte" (el render no da abasto, se acumulan cada vez más pasos y todo se congela). El render interpola: lerp para la posición y slerp para el cuaternión.
- **Dinámica:**
  - motores con retardo de primer orden y empuje limitado entre 0 y el máximo
  - el empuje total va en el eje y del cuerpo
  - torque de roll/pitch = posición del motor × empuje
  - torque de yaw = ±k·empuje, que se alterna según el sentido de giro de cada hélice
  - arrastre cuadrático lineal y arrastre angular
- **Control en cascada.** Es la idea central de los PID en drones: cada lazo controla al de debajo, y el interior es el más rápido.
  1. Stick → **velocidad deseada** en el marco del rumbo: el stick adelante mueve el dron hacia su morro, como en DJI. El cambio de velocidad está limitado (aceleración máxima), lo que da un frenado suave.
  2. Al soltar, el dron frena. Cuando su velocidad baja de un umbral, se fija la **posición objetivo** (position hold).
  3. Error de velocidad → aceleración deseada → **pitch/roll deseados** = atan(a/g), limitados a la inclinación máxima del modo.
  4. Throttle → velocidad vertical deseada; centrado = mantener altura. El empuje colectivo se calcula como m(g+a)/cos(inclinación).
  5. Yaw stick → velocidad de yaw. Al soltar, el dron **mantiene el rumbo**: el yaw objetivo se integra en el tiempo.
  6. **Actitud:** error del cuaternión → velocidad angular deseada. **Lazo de velocidad angular:** PID → torques → `mixer` → 4 motores, con desaturación que da prioridad a la actitud.
- **PID** con:
  - límite de salida
  - anti-windup: deja de acumular el integral si la salida está saturada
  - derivada sobre la medida, no sobre el error, para evitar el "golpe" cuando cambia el objetivo
  - filtro paso bajo opcional en la derivada
- **Máquina de estados**, inspirada en DJI:
  - `E` arranca o para los motores, como el CSC de DJI (los dos sticks abajo y hacia dentro)
  - con los motores en marcha, subir el throttle despega
  - `Espacio` hace despegue o aterrizaje automático a 1,2 m
  - si mantienes el throttle abajo en el suelo durante 2 s, los motores se paran
- **Escena:**
  - suelo de 200×200 m con textura de cuadrícula generada por código
  - helipuerto "H" en el home
  - postes o conos cada 10 m, que dan referencia de profundidad
  - luz direccional con **sombra del dron**: es la mejor pista para juzgar la altura al aterrizar
  - niebla suave
- **Modelo del dron:** procedural (cuerpo, brazos y hélices que giran según el empuje) con el morro claramente distinto (color + cámara). Es vital para saber la orientación.
- **Cámara de tercera persona:** sigue al dron con un muelle suave y gira con su yaw con algo de retraso.
- **Mapeo por defecto del SpaceMouse** (medido en la fase 0, en `spaceMouseGamepadConfig`). Perfil **"Traslación"**:
  - levantar o hundir la tapa → throttle
  - girar la tapa → yaw
  - desplazar adelante o atrás → pitch
  - desplazar a los lados → roll
  - botón izquierdo → despegue/aterrizaje
  - botón derecho → cambiar modo (desde la fase 3)

  El perfil "Inclinación" (inclinar la tapa → pitch/roll) queda disponible. No es el de por defecto porque, al subir la tapa, se inclina adelante un ~41 % y cada corrección de altura cabecearía el dron.
- **Teclado:** `W/S`, `A/D` y flechas. Al pulsar, el valor sube en rampa (~0,3 s hasta el máximo) y al soltar vuelve al centro rápido. `R` reinicia.
- **Panel de ajuste** (tecla `` ` ``): lil-gui para modificar las ganancias PID y los límites en vivo. Así ves por ti mismo qué hace cada ganancia.

**Tests:**
- `pid`: respuesta a un escalón, saturación, anti-windup
- `mixer`: el hover reparte el empuje a partes iguales; un torque de roll sube un lado y baja el otro
- `dynamics`: la caída libre da g; el empuje de hover deja la aceleración en 0; el cuaternión sigue normalizado
- `loop`: número de pasos con un reloj falso; recorte de frames largos
- `flightController` vía `simulate()`:
  - el hover mantiene la altura con error < 5 cm durante 10 s
  - con el stick adelante, el dron alcanza ~10 m/s sin pasar de 25° de inclinación
  - al soltar, frena y se queda quieto con deriva < 0,3 m
  - el despegue automático llega a 1,2 m

**Modo demo para el check:** `?demo=hover` inyecta una entrada programada (despegue automático y luego sticks soltados). Así la captura muestra el dron en vuelo sin que nadie lo pilote.

**Captura esperada** (`/?demo=hover`): el dron en hover a ~1,2 m sobre la H, con su sombra en el suelo, la cuadrícula, el cielo y el HUD mínimo marcando H ≈ 1,2 m.

**Hecho cuando:** vuelas con el SpaceMouse en Chrome a 60 fps, el hover es estable al soltar, el dron frena como un DJI y aterrizas sobre la H.

---

### Fase 2: Entrada completa y configurable

**Objetivo:** que el SpaceMouse resulte cómodo y preciso, y dejar preparado el soporte de mando.

**Practicas:** control fino. Una buena zona muerta y una buena expo permiten correcciones pequeñas en hover.

**Archivos:** `input/mapping.ts` (completo), `input/gamepad.ts`, `core/settings.ts`, `ui/stickView.ts`, y una página de ajustes de entrada dentro del juego que reutiliza la lógica de `devices.ts`.

**Claves técnicas:**
- **Zona muerta con reescalado:** fuera de la zona muerta, el valor empieza en 0, sin salto.
- **Expo:** salida = (1−e)·x + e·x³. Suave cerca del centro, completa a fondo.
- **Inversión y sensibilidad** por eje.
- **Filtro anti-acoplamiento:** atenúa los ejes que estén muy por debajo del eje dominante. Resuelve el problema clave del SpaceMouse: inclinar la tapa sin subir ni girar a la vez.
- **Perfiles del SpaceMouse:**
  - "Inclinación": pitch/roll con la rotación de la tapa
  - "Traslación": pitch/roll desplazando la tapa
  - cada perfil se puede probar y elegir
- **Asistente de calibración:** captura el centro en reposo y el rango de cada eje.
- Todo se guarda en `localStorage` dentro de try/catch, con valores por defecto si falla.
- **Gamepad API** con Modo 2 (por defecto) y Modo 1.
  - Sin mando no se puede probar físicamente, así que se cubre con tests de mapeo.
  - Prioridad baja dentro de la fase.
- **Visualizador de sticks:** dos cuadrados que muestran dónde estarían los sticks de una radio DJI en Modo 2. Te ayuda a construir el modelo mental que usarás con la radio real aunque vueles con el SpaceMouse.

**Tests:** zona muerta, expo, anti-acoplamiento, perfiles, Modo 1↔2, y migración/valores por defecto de los ajustes.

**Captura esperada:** la página de ajustes de entrada con el asistente de calibración; en `/?demo=hover`, el visualizador de sticks en una esquina.

**Hecho cuando:** puedes mantener el hover y hacer movimientos lentos de 1 eje sin mover los otros.

**Decisión (al empezar la fase):** el filtro anti-acoplamiento se aplaza. En las pruebas de vuelo de la fase 1, la zona muerta (0,12) ya evita que el dron derive al subir o bajar. Prioridades: visualizador de sticks → ajustes guardados → calibración → mando genérico.

---

### Fase 3: HUD estilo DJI Fly y modos Cine / Sport / ATTI

**Objetivo:** tener toda la telemetría a la vista y los 4 modos de vuelo de DJI.

**Practicas:** adaptarte a cada modo y aprender ATTI, que es lo que pasa cuando un DJI pierde el GPS: el dron deriva y te toca corregir.

**Archivos:** `ui/hud.ts` (completo), `control/modes.ts` (todos los modos), `ui/tuningPanel.ts` (añade gráfica).

**Claves técnicas:**
- **HUD** como capa HTML/CSS sobre el canvas, con:
  - H (altura), D (distancia al home), V.H y V.V (velocidades horizontal y vertical)
  - batería, modo y "GPS" (en ATTI muestra "Sin GPS")
  - estado de los motores
  - **radar de orientación**: rumbo del dron + flecha al home + posición del piloto. Clave para el nose-in.
  - avisos
- **Modos:**
  - Cine: límites bajos + más expo + aceleración suave
  - Sport: límites altos
  - **ATTI**: stick → ángulo de inclinación directo. Al soltar se nivela pero **sigue con su inercia**, y en la fase 4 también con el viento. La altura se sigue manteniendo.
- **Cambio de modo:** teclas `1` a `4` o botón derecho del SpaceMouse. Los límites cambian de forma gradual para evitar tirones.
- **Gráfica en vivo** (objetivo frente a valor medido) de altura, velocidad y ángulos. Así ves cómo responde cada PID.

**Tests:** cada modo respeta sus límites de velocidad e inclinación; en ATTI el dron conserva la velocidad al soltar los sticks y no vuelve a su posición.

**Captura esperada** (`/?demo=hover&mode=atti`): el HUD completo, con el radar, el modo "ATTI" y el aviso "Sin GPS".

**Hecho cuando:** cambias de modo en vuelo y notas claramente la diferencia, y aprendes a parar el dron a mano en ATTI.

---

### Fase 4: Entorno (viento, efecto suelo, batería y RTH)

**Objetivo:** que haya condiciones reales que obliguen a corregir.

**Practicas:**
- volar con viento: en GPS el dron se inclina contra el viento sin moverse; en ATTI te toca compensar a ti
- gestionar la batería
- usar el RTH

**Archivos:** `physics/environment.ts`, `core/random.ts`, `control/flightState.ts` (añade RTH), `render/scene.ts` (manga de viento).

**Claves técnicas:**
- **Viento:** un vector base + ráfagas con ruido filtrado (proceso de Ornstein-Uhlenbeck) usando el generador con semilla. El arrastre se calcula con la velocidad **relativa al aire**. Hay niveles: calma, moderado y fuerte.
- **Efecto suelo:** el empuje se multiplica por 1/(1−(R/4h)²), con límite, cuando h es menor que ~2 diámetros de hélice. Produce el "colchón" que notas al aterrizar.
- **Batería:**
  - el consumo es proporcional a empuje^1,5
  - la tensión cae con la carga
  - se muestra el %
  - avisos al 30 %, RTH forzado al 15 % y aterrizaje forzado al 10 %, como en DJI
  - un multiplicador de tiempo en `config` evita esperar 30 minutos
- **RTH (`H`):** sube a la altura de RTH (30 m), gira hacia el home, vuela hasta él, desciende y aterriza. Moviendo los sticks se cancela.
- **Límites:** altura máxima de 120 m (el límite legal habitual) y distancia máxima, con aviso.
- **Manga de viento** en el home: aprender a leer el viento es una habilidad real.

**Tests:**
- con viento constante en Normal, el dron mantiene la posición con error < 0,5 m
- en ATTI deriva en la dirección del viento
- el RTH termina posado en el home
- el consumo de batería es coherente
- el efecto suelo aumenta el empuje cerca del suelo

**Captura esperada** (`/?demo=hover&wind=moderado`): la manga de viento inclinada y el dron inclinado contra el viento, sin desplazarse.

**Hecho cuando:** un hover con viento moderado en ATTI cuesta pero se puede, y el RTH funciona de principio a fin.

---

### Fase 5: Lecciones y puntuación

**Objetivo:** pasar de "volar sin más" a entrenar con objetivos medibles.

**Archivos:** `training/lessons.ts`, `training/scoring.ts`, `render/markers.ts`, `ui/menus.ts`.

**Claves técnicas:**
- **Cada lección es un objeto de datos:**
  - título e instrucciones en español
  - configuración inicial: posición, modo, viento
  - objetivos con funciones comprobadoras puras sobre el historial de estados
- **Puntuación:** desviación media (RMS), tiempo, suavidad (cuánto se mueven los sticks), y precisión y velocidad vertical en el aterrizaje → 1 a 3 estrellas. Los récords se guardan en `localStorage`.

**Lecciones**, en orden de dificultad y siguiendo lo que se practica con un DJI real:

1. Despegue y aterrizaje
2. Hover dentro de un cubo de 1 m durante 10 s
3. Control de altura: subir a 5 m y bajar a 2 m
4. Yaw de 360° en el sitio sin desplazarse
5. Cuadrado con la cola hacia ti (tail-in)
6. Hover y cuadrado **nose-in**: los controles se sienten invertidos
7. Círculo/órbita alrededor de un poste
8. Ocho
9. Aterrizaje de precisión en la H
10. Hover en ATTI con viento

**Tests:** los comprobadores de cada lección, con trayectorias sintéticas; la puntuación.

**Captura esperada:** el menú de lecciones; en `/?lesson=hover`, el cubo objetivo, el panel de instrucciones y el cronómetro.

**Decisión (durante la fase):** la vista del piloto (fase 6) se adelanta. Las lecciones de orientación (cuadrado, nose-in, círculo, ocho y aterrizaje de precisión) no tienen sentido con la cámara de seguimiento, que siempre va detrás del dron. En la fase 6 quedan la FPV, el gimbal y la imagen en miniatura.

**Hecho cuando:** puedes jugar las 10 lecciones de principio a fin desde el menú.

---

### Fase 6: Cámaras FPV y línea de visión

**Objetivo:** practicar las dos formas reales de volar un DJI.
- **Pantalla del móvil (FPV):** es como vuelas casi siempre.
- **Línea de visión (VLOS):** es obligatoria legalmente en muchos países, y la orientación es mucho más difícil.

**Archivos:** `render/cameras.ts`.

**Claves técnicas:**
- **FPV con gimbal estabilizado:** el horizonte se mantiene nivelado, como en DJI. Hay una opción de cámara fija al cuerpo. `Q/E` mueven el pitch del gimbal.
- **Vista del piloto:** cámara a 1,7 m de altura en el home, siguiendo al dron con la mirada.
- **Imagen en miniatura (PiP)** de la FPV mientras vuelas en VLOS.
- `C` cambia de cámara.

**Captura esperada:**
- `?camera=fpv`: la vista FPV con el horizonte nivelado.
- `?camera=pilot`: el dron pequeño en el cielo, visto desde 1,7 m, con la FPV en miniatura.

**Hecho cuando:** completas las lecciones 2 y 6 usando solo la vista del piloto.

---

### Fase 7: Escenarios, colisiones y crash

**Objetivo:** volar en entornos con obstáculos y que equivocarse tenga consecuencias.

**Archivos:** `render/scenarios/park.ts`, `city.ts`, `obstacles.ts`; `physics/collisions.ts`.

**Claves técnicas:**
- **Escenarios** definidos como datos, con geometría procedural (sin assets externos al principio).
- **Colisiones propias:** el dron es una esfera y choca contra AABB (cajas alineadas a los ejes), cilindros (árboles, postes) y el suelo. Solo se evaluaría `rapier3d` si se queda corto.
- **Crash:** si la velocidad de impacto supera un umbral, las hélices se paran, el dron cae y aparece una pantalla con el motivo y la opción de reintentar.

**Tests:** detección de colisiones esfera-AABB y esfera-cilindro; umbrales de crash; aterrizaje suave = no es crash.

**Captura esperada** (`?scenario=parque&demo=hover`): el parque con árboles y puertas visibles alrededor del dron.

**Añadido durante la fase:** lecciones 11 (circuito en el parque) y 12 (pista de obstáculos), con puertas reales que hay que cruzar por dentro, sin pasar por encima.

**Hecho cuando:** completas un circuito de puertas en el parque, y chocar con un árbol provoca un crash.

---

### Fase 8: Acro y funciones inteligentes

**Objetivo:** lo avanzado.

**Archivos:** `control/modes.ts` y `control/acro.ts` (Acro), `control/orbit.ts` (Órbita), `control/mission.ts` y `ui/missionMap.ts` (Waypoints), `control/flightState.ts` (fases `orbiting` y `mission`).

**Claves técnicas:**
- **Acro:**
  - stick → velocidad angular con rates estilo Betaflight (RC rate, super rate, expo)
  - sin auto-nivelado
  - throttle directo
- **Throttle híbrido para el SpaceMouse:** su throttle vuelve al centro, así que en Acro el centro equivale al empuje de hover y el stick suma o resta empuje.
- **Órbita (POI)** con radio y velocidad configurables.
- **Waypoints:** se colocan puntos en un mapa y el dron vuela la misión.

**Captura esperada** (`?demo=orbit`): el dron orbitando el poste y el HUD mostrando "Órbita · R 10 m".

**Hecho (parte C, Waypoints):**
- **Mapa** con la tecla `M`; el vuelo se pausa mientras está abierto. Muestra:
  - los obstáculos del escenario, con la altura de los edificios
  - el despegue (H), el dron y el límite de distancia
- **Planificar:**
  - clic para poner un punto (a la altura elegida) y clic sobre él para quitarlo
  - botón para añadir la posición actual del dron
  - velocidad de la misión y acción final: quedarse, RTH o aterrizar
- **Vuelo:** seguimiento de cada tramo como un piloto automático:
  - avanza a lo largo de la línea y corrige el desvío lateral hacia ella
  - frena antes de cada giro, a una velocidad de paso que depende de lo cerrado que sea (((1 + cos θ)/2)²)
  - empieza a girar antes de llegar al punto, para que la inercia no lo saque por fuera
  - la altura cambia poco a poco a lo largo del tramo
- **Interrumpir:** los sticks cancelan la misión, como en el RTH; `H` vuelve a casa y `Espacio` aterriza.
- **En la escena:** bolas y mástiles de colores (pasado, siguiente, pendiente) y la ruta en el aire.
- **Capturas:** `?demo=mission` y `?menu=mision` (el mapa).

**Hecho (parte B, Órbita):** tecla `O` con el centro 10 m delante del morro; los sticks ajustan radio, velocidad/sentido y altura; prealimentación de la aceleración centrípeta y del giro; poste y círculo en la escena; captura `?demo=orbit`.

**Hecho (parte A, Acro):** tecla `5` (fuera del ciclo del botón; desde Acro el botón vuelve a Normal), rates Betaflight ajustables en el panel, throttle híbrido, FPV fija al cuerpo, crash al tocar el suelo boca abajo, lección 13 ("Primer flip") y captura `?mode=acro&demo=flip`.

**Hecho cuando:** puedes hacer un flip en Acro, y la órbita y los waypoints vuelan solos.

---

## 4. Verificación visual: `npm run check`

### Qué hace `scripts/check.ts`

Se ejecuta con `node scripts/check.ts`: Node 24 entiende TypeScript directamente. Usa `playwright-core`, que **no descarga navegadores**, y tu Chrome de Windows. Pasos:

1. **Arranca Vite por código** (`createServer` de Vite) en el puerto **5174**. Así no choca con tu `npm run dev` en el 5173.
2. **Lanza tu Chrome de Windows en modo invisible** desde WSL: `/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe`, que se puede cambiar con la variable de entorno `CHROME_PATH`. Las opciones son:
   - `--headless=new`
   - `--remote-debugging-port=9223`
   - `--window-size=1280,720`
   - `--no-first-run`
   - `--user-data-dir` con un **perfil temporal propio** en `%TEMP%\drony-check`. Así no interfiere con tu Chrome abierto ni con tu perfil.
3. Espera a que responda `http://localhost:9223/json/version` y se conecta con `chromium.connectOverCDP(...)`.
   - No usa `launch()` porque Playwright lanza Chrome comunicándose por una "tubería" interna, y esa vía no funciona entre WSL y Windows.
   - La red mirrored es la que permite que WSL vea el puerto 9223 de Windows, y que Chrome vea el Vite de WSL.
4. **Para cada página de la lista** (un array al principio del script que crece con cada fase: `index`, `devices`, `?demo=hover`…):
   - recoge los `console.error`, los `pageerror` (excepciones no capturadas), las peticiones fallidas y las respuestas ≥ 400
   - los `console.warn` los recoge aparte, como información
   - navega y espera a que `window.__dronyReady === true`, que la app activa tras renderizar unos frames (y en demo, cuando llega al estado buscado), con un límite de 15 s
   - guarda la captura en `.check/<nombre>.png`
5. **Informe en consola** por página: ✓ o ✗, los errores con su origen y la ruta de la captura.
   - Termina con **código 1** si hay errores o si se agotó el tiempo de espera de alguna página.
6. **Limpieza:** `browser.close()` (vía CDP cierra el Chrome de Windows), cierra Vite y lo elimina todo también si algo falla (`try/finally`).

**Otros cambios:**
- `package.json`: `"check": "node scripts/check.ts"` y la dependencia `playwright-core`.
- `.gitignore`: `.check/`.
- `eslint.config.js`: `scripts/` con `globals.node`.
- `src/vite-env.d.ts`: declara `window.__dronyReady`.
- Los puertos y la ruta de Chrome son configuración de herramientas, no de la simulación: van como constantes al principio de `scripts/check.ts`, no en `core/config.ts`.

**Limitación:** en modo invisible no hay SpaceMouse. El check valida que la página se renderiza y que no hay errores; el control se sigue probando a mano.

### Ciclo de revisión, tras cada mejora grande

Cuenta como "mejora grande" cualquier cambio visible: cada fase y cada pieza importante dentro de ella (escena, dron, HUD, cámara…).

1. `npm run test` y `npm run lint`.
2. `npm run check`.
3. **Miro las capturas** (abro los PNG) y las comparo con la "Captura esperada" de la fase.
4. Si hay errores o la captura no muestra lo pedido, corrijo y vuelvo al paso 1.
5. **Máximo 3 rondas.** Si a la tercera no está, paro y te muestro los errores, las capturas y mi diagnóstico, en lugar de seguir dando vueltas.
6. **Listo** = 0 errores de consola + la captura muestra lo pedido.

---

## 5. Riesgos y cómo mitigarlos

| Riesgo | Mitigación |
|---|---|
| El driver 3DxWare bloquea WebHID | **Confirmado en la fase 0:** con 3DxWare abierto, WebHID no recibe datos. **Solución:** leer el SpaceMouse por la **Gamepad API**, que funciona con el driver abierto. WebHID queda como alternativa. |
| Ejes acoplados en el SpaceMouse | Zona muerta, filtro anti-acoplamiento, perfiles (fase 2) y lecciones de un solo eje. |
| PID difíciles de ajustar | Cascada con ganancias conservadoras, panel en vivo, gráficas y tests con `simulate()`. |
| La sensación no se parece a DJI | Valores de referencia en `config`, el arrastre derivado de la física y ajuste iterativo con tu opinión. |
| Acceder por la IP de WSL desactiva WebHID | Usar siempre `localhost:5173`. Documentado en `CLAUDE.md`. |
| `npm run check` no conecta con el Chrome de Windows (la red mirrored no está activa, o Windows 10 no la soporta) | El script lo detecta y muestra un mensaje claro de qué falta. Plan B: Chrome instalado en WSL con `channel: 'chrome'`. |
| WebGL invisible sin GPU produce capturas negras | Primero se usa la GPU de Windows. Si falla, se usa `--enable-unsafe-swiftshader` (WebGL por software). |
| Que el alcance crezca sin control | Regla de "jugable en cada fase". Las ideas nuevas van a un apartado de ideas futuras, no a la fase en curso. |

**Ideas futuras (fuera de alcance):** repetición y fantasma de tu mejor vuelo, registro de vuelo con gráficas, aviso de obstáculos tipo APAS, terreno real, VR.

---

## 6. Forma de trabajar

- **Una rama por fase** (`fase-0-esqueleto`, `fase-1-mvp`…) con commits pequeños en español, y merge a `main` al cerrar la fase. Haré commit solo cuando me lo pidas o lo apruebes.
- Al empezar cada fase, explico brevemente los conceptos nuevos (física, PID, 3D) y cómo se relacionan con un DJI real.
- Al cerrar cada fase, actualizo `CLAUDE.md`, `README.md` y `docs/PLAN.md`.

## 7. Verificación

En **cada fase**:
1. `npm run test`: todos los tests en verde, incluidos los de vuelo completo con `simulate()`.
2. `npm run lint` y `npm run build`: sin errores (el build ya incluye `tsc` en modo `strict`).
3. `npm run check`: 0 errores de consola, y las capturas de `.check/` coinciden con la "Captura esperada" (ciclo de la sección 4, máximo 3 rondas).
4. Prueba manual: `npm run dev`, abrir **Chrome en Windows → `http://localhost:5173`** y comprobar el criterio de "hecho" de la fase, volando de verdad con el SpaceMouse.

**Verificación inmediata (fase 0):**
- Los 5 tests de `spaceMouseReport` pasan.
- `npm run check` termina con ✓ en `index` y `devices`, y las capturas muestran el cubo y el panel de dispositivos.
- Tú abres `devices.html`, mueves la tapa y me pasas los signos y los máximos de cada eje para fijar el mapeo.
