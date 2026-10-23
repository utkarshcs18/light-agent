/**
 * In-memory lights for the Alexa+ demo and tests.
 * armMiss drops the next scheduler apply so a spoken line can show a retry.
 */

import type { DeviceInfo, LightConnector, LightState, Power } from "../types.js";

export class MockConnector implements LightConnector {
  private devices: DeviceInfo[];
  private states = new Map<string, LightState>();
  private armed = new Set<string>();

  constructor(devices: DeviceInfo[]) {
    this.devices = devices;
    for (const device of devices) {
      this.states.set(device.id, {
        power: "off",
        brightness: 50,
        hue: 0,
        saturation: 0,
      });
    }
  }

  private require(id: string): LightState {
    const state = this.states.get(id);
    if (!state) throw new Error(`Unknown light: ${id}`);
    return state;
  }

  async listLights(): Promise<DeviceInfo[]> {
    return this.devices;
  }

  async getState(id: string): Promise<LightState> {
    return { ...this.require(id) };
  }

  async setPower(id: string, power: Power): Promise<void> {
    this.require(id).power = power;
  }

  async setBrightness(id: string, brightness: number): Promise<void> {
    this.require(id).brightness = brightness;
  }

  async setColor(id: string, hue: number, saturation: number): Promise<void> {
    const state = this.require(id);
    state.hue = hue;
    state.saturation = saturation;
  }

  armMiss(id: string): void {
    this.require(id);
    this.armed.add(id);
  }

  consumeMiss(id: string): boolean {
    if (!this.armed.has(id)) return false;
    this.armed.delete(id);
    return true;
  }
}
