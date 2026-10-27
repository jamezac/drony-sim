// Conexión con el SpaceMouse mediante WebHID (solo Chrome/Edge, y requiere localhost o HTTPS).

import { spaceMouseConfig } from '../core/config';
import { applyReport, createSpaceMouseState, type SpaceMouseState } from './spaceMouseReport';

export type SpaceMouseReportListener = (state: SpaceMouseState, reportId: number, data: DataView) => void;
export type SpaceMouseStatusListener = (connected: boolean) => void;

export function isWebHidSupported(): boolean {
  return 'hid' in navigator;
}

/** ¿Tiene el dispositivo la colección HID de ejes (y no es otra interfaz del receptor)? */
function hasMultiAxisCollection(device: HIDDevice): boolean {
  return device.collections.some(
    (c) => c.usagePage === spaceMouseConfig.usagePage && c.usage === spaceMouseConfig.usage,
  );
}

function isSpaceMouse(device: HIDDevice): boolean {
  const vendorIds: readonly number[] = spaceMouseConfig.vendorIds;
  return vendorIds.includes(device.vendorId) && hasMultiAxisCollection(device);
}

export class SpaceMouse {
  private device: HIDDevice | null = null;
  private state: SpaceMouseState = createSpaceMouseState();
  private readonly reportListeners = new Set<SpaceMouseReportListener>();
  private readonly statusListeners = new Set<SpaceMouseStatusListener>();

  constructor() {
    if (!isWebHidSupported()) return;
    // El Wireless se duerme o se desconecta: reaccionamos a ambos casos
    navigator.hid.addEventListener('disconnect', (event) => {
      if (event.device === this.device) {
        this.device = null;
        this.state = createSpaceMouseState();
        this.notifyStatus();
      }
    });
    navigator.hid.addEventListener('connect', (event) => {
      if (!this.device && isSpaceMouse(event.device)) {
        void this.open(event.device);
      }
    });
  }

  get connected(): boolean {
    return this.device?.opened ?? false;
  }

  get currentDevice(): HIDDevice | null {
    return this.device;
  }

  getState(): SpaceMouseState {
    return this.state;
  }

  onReport(listener: SpaceMouseReportListener): void {
    this.reportListeners.add(listener);
  }

  onStatusChange(listener: SpaceMouseStatusListener): void {
    this.statusListeners.add(listener);
  }

  /** Abre el diálogo del navegador para elegir el dispositivo. Debe llamarse desde un clic. */
  async requestDevice(): Promise<boolean> {
    const filters = spaceMouseConfig.vendorIds.map((vendorId) => ({
      vendorId,
      usagePage: spaceMouseConfig.usagePage,
      usage: spaceMouseConfig.usage,
    }));
    const devices = await navigator.hid.requestDevice({ filters });
    const device = devices.find(isSpaceMouse);
    return device ? this.open(device) : false;
  }

  /** Reconecta sin diálogo si el usuario ya dio permiso en una sesión anterior. */
  async reconnect(): Promise<boolean> {
    const devices = await navigator.hid.getDevices();
    const device = devices.find(isSpaceMouse);
    return device ? this.open(device) : false;
  }

  private readonly handleInputReport = (event: HIDInputReportEvent): void => {
    this.state = applyReport(this.state, event.reportId, event.data);
    for (const listener of this.reportListeners) {
      listener(this.state, event.reportId, event.data);
    }
  };

  private async open(device: HIDDevice): Promise<boolean> {
    if (this.device === device && device.opened) return true;
    // Si cambiamos de dispositivo, soltamos el anterior para no duplicar eventos
    this.device?.removeEventListener('inputreport', this.handleInputReport);
    if (!device.opened) {
      await device.open();
    }
    this.device = device;
    device.addEventListener('inputreport', this.handleInputReport);
    this.notifyStatus();
    return true;
  }

  private notifyStatus(): void {
    for (const listener of this.statusListeners) {
      listener(this.connected);
    }
  }
}
