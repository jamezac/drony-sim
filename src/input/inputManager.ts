// Une todas las fuentes de entrada en un único ControlInput por frame:
// SpaceMouse (Gamepad API) + teclado, o un guion de demo si la URL lleva ?demo=...

import { inputConfig, spaceMouseGamepadConfig, type SpaceMouseProfileName } from '../core/config';
import { neutralSticks, type ControlInput } from '../core/controlInput';
import { DemoInput, type DemoName } from './demoInput';
import { KeyboardInput } from './keyboard';
import { combineSticks, spaceMouseSticks } from './mapping';
import { findSpaceMouseGamepad } from './spaceMouseGamepad';

export interface FrameInput extends ControlInput {
  /** Reiniciar la simulación (tecla R) */
  reset: boolean;
  spaceMouseConnected: boolean;
}

export class InputManager {
  private readonly keyboard = new KeyboardInput();
  private readonly demo: DemoInput | null;
  profile: SpaceMouseProfileName = spaceMouseGamepadConfig.defaultProfile;
  private takeoffButtonWasPressed = false;

  constructor(demo: DemoName | null = null) {
    this.demo = demo ? new DemoInput(demo) : null;
  }

  sample(dt: number): FrameInput {
    const keyboard = this.keyboard.sample(dt);
    if (this.demo) {
      return { ...this.demo.sample(), reset: false, spaceMouseConnected: false };
    }

    const pad = findSpaceMouseGamepad();
    let spaceMouse = neutralSticks();
    let takeoffButton = false;
    if (pad) {
      const { profiles, buttons } = spaceMouseGamepadConfig;
      spaceMouse = spaceMouseSticks(pad.axes, profiles[this.profile], inputConfig.spaceMouse);
      // Solo cuenta el momento de pulsar (flanco), no mantenerlo pulsado
      const pressed = pad.buttons[buttons.takeoffLand]?.pressed ?? false;
      takeoffButton = pressed && !this.takeoffButtonWasPressed;
      this.takeoffButtonWasPressed = pressed;
    }

    return {
      sticks: combineSticks(keyboard.sticks, spaceMouse),
      actions: {
        toggleMotors: keyboard.actions.toggleMotors,
        takeoffLand: keyboard.actions.takeoffLand || takeoffButton,
      },
      reset: keyboard.actions.reset,
      spaceMouseConnected: pad !== null,
    };
  }
}
