// Une todas las fuentes de entrada en un único ControlInput por frame:
// SpaceMouse + mando genérico (Gamepad API) + teclado, o un guion de demo si la URL lleva ?demo=...

import { gamepadConfig, inputConfig, spaceMouseGamepadConfig, type FlightModeName } from '../core/config';
import { neutralSticks, type ControlInput, type Sticks } from '../core/controlInput';
import type { InputSettings } from '../core/settings';
import { DemoInput, type DemoName } from './demoInput';
import { pickStandardGamepad } from './gamepad';
import { KeyboardInput } from './keyboard';
import { combineSticks, mapSticks } from './mapping';
import { pickSpaceMousePad } from './spaceMouseGamepad';

export interface FrameInput extends ControlInput {
  /** Reiniciar la simulación (tecla R) */
  reset: boolean;
  spaceMouseConnected: boolean;
  /** Nombre del mando genérico conectado, o null */
  gamepadName: string | null;
  /** Cambio de modo pedido: un modo concreto (teclas 1-4), 'next' (botón) o null */
  modeRequest: FlightModeName | 'next' | null;
}

/** Detecta el momento de pulsar un botón (flanco), no el hecho de mantenerlo pulsado. */
class ButtonEdges {
  private readonly wasPressed = new Map<string, boolean>();

  pressed(key: string, isDown: boolean): boolean {
    const edge = isDown && !this.wasPressed.get(key);
    this.wasPressed.set(key, isDown);
    return edge;
  }
}

function isDown(pad: Gamepad, button: number): boolean {
  return pad.buttons[button]?.pressed ?? false;
}

export class InputManager {
  /** Ajustes vivos: el panel de ajuste los modifica directamente */
  readonly settings: InputSettings;
  readonly demo: DemoInput | null;
  private readonly keyboard = new KeyboardInput();
  private readonly edges = new ButtonEdges();

  constructor(settings: InputSettings, demo: DemoName | null = null) {
    this.settings = settings;
    this.demo = demo ? new DemoInput(demo) : null;
  }

  sample(dt: number): FrameInput {
    const keyboard = this.keyboard.sample(dt);
    if (this.demo) {
      return { ...this.demo.sample(dt), reset: false, spaceMouseConnected: false, gamepadName: null, modeRequest: null };
    }

    const pads = navigator.getGamepads().filter((pad) => pad !== null);
    const spaceMouse = pickSpaceMousePad(pads);
    const gamepad = pickStandardGamepad(pads);

    let spaceMouseSticks: Sticks = neutralSticks();
    let takeoffLand = keyboard.actions.takeoffLand;
    let toggleMotors = keyboard.actions.toggleMotors;
    let modeButton = false;

    if (spaceMouse) {
      const { profiles, buttons } = spaceMouseGamepadConfig;
      spaceMouseSticks = mapSticks(
        spaceMouse.axes,
        profiles[this.settings.spaceMouseProfile],
        this.settings,
        this.settings.calibration,
      );
      takeoffLand = this.edges.pressed('spaceMouse.takeoffLand', isDown(spaceMouse, buttons.takeoffLand)) || takeoffLand;
      modeButton = this.edges.pressed('spaceMouse.modeSwitch', isDown(spaceMouse, buttons.modeSwitch)) || modeButton;
    }

    let gamepadSticks: Sticks = neutralSticks();
    if (gamepad) {
      const { modes, buttons } = gamepadConfig;
      gamepadSticks = mapSticks(gamepad.axes, modes[this.settings.gamepadMode], inputConfig.gamepad);
      takeoffLand = this.edges.pressed('gamepad.takeoffLand', isDown(gamepad, buttons.takeoffLand)) || takeoffLand;
      toggleMotors = this.edges.pressed('gamepad.toggleMotors', isDown(gamepad, buttons.toggleMotors)) || toggleMotors;
      modeButton = this.edges.pressed('gamepad.modeSwitch', isDown(gamepad, buttons.modeSwitch)) || modeButton;
    }

    return {
      sticks: combineSticks(keyboard.sticks, spaceMouseSticks, gamepadSticks),
      actions: { takeoffLand, toggleMotors },
      reset: keyboard.actions.reset,
      spaceMouseConnected: spaceMouse !== null,
      gamepadName: gamepad?.id ?? null,
      modeRequest: keyboard.mode ?? (modeButton ? 'next' : null),
    };
  }
}
