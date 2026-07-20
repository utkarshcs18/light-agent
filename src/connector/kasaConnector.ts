/**
 * kasaConnector.ts - real TP-Link Kasa bulbs via `tplink-smarthome-api`.
 *
 * Implements LightConnector by resolving a friendly id -> host from the registry and driving the
 * bulb over the LAN. Bulbs must already be on your WiFi (onboard once via the Kasa app). KL/LB
 * bulbs only, not Tapo.
 */

// tplink-smarthome-api is CommonJS; its named exports use Object.defineProperty getters
// that Node's ESM loader doesn't surface as named imports. Import the default (the module's
// exports object) and destructure Client from it so it resolves at runtime.
import tplink from "tplink-smarthome-api";
import type { Bulb } from "tplink-smarthome-api";
import type { DeviceInfo, LightConnector, LightState, Power } from "../types.js";

const { Client } = tplink;

export class KasaConnector implements LightConnector {
  private client = new Client();
  private devices: DeviceInfo[];
  // Cache resolved Bulb handles so we don't re-query the device on every call.
  private bulbs = new Map<string, Bulb>();

  constructor(devices: DeviceInfo[]) {
    this.devices = devices;
  }

  async listLights(): Promise<DeviceInfo[]> {
    return this.devices;
  }

  async getState(id: string): Promise<LightState> {
    const bulb = await this.getBulb(id);
    const info = await bulb.getSysInfo();
    const ls = info.light_state;
    // When off, the bulb reports the target color under dft_on_state.
    const color = ls.on_off === 1 ? ls : ls.dft_on_state ?? ls;
    return {
      power: ls.on_off === 1 ? "on" : "off",
      brightness: color.brightness,
      hue: color.hue,
      saturation: color.saturation,
    };
  }

  async setPower(id: string, power: Power): Promise<void> {
    const bulb = await this.getBulb(id);
    await bulb.setPowerState(power === "on");
  }

  async setBrightness(id: string, brightness: number): Promise<void> {
    const bulb = await this.getBulb(id);
    await bulb.lighting.setLightState({ on_off: 1, brightness });
  }

  async setColor(id: string, hue: number, saturation: number): Promise<void> {
    const bulb = await this.getBulb(id);
    // color_temp: 0 tells the bulb to use HSV rather than a white temperature.
    await bulb.lighting.setLightState({ on_off: 1, hue, saturation, color_temp: 0 });
  }

  /** Resolve a friendly id to a connected Bulb handle (cached). */
  private async getBulb(id: string): Promise<Bulb> {
    const cached = this.bulbs.get(id);
    if (cached) return cached;

    const device = this.devices.find((d) => d.id === id);
    if (!device) throw new Error(`Unknown light: ${id}`);
    if (!device.host)
      throw new Error(`Light ${id} has no host in lights.json - re-run \`npm run setup\`.`);

    const dev = await this.client.getDevice({ host: device.host });
    if (dev.deviceType !== "bulb")
      throw new Error(`Device ${id} at ${device.host} is not a bulb (got ${dev.deviceType}).`);

    const bulb = dev as Bulb;
    this.bulbs.set(id, bulb);
    return bulb;
  }
}
