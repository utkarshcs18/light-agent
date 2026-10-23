/**
 * mockConnector.ts - in-memory LightConnector for building/testing without hardware.
 *
 * TODO:
 *   - class MockConnector implements LightConnector
 *   - Back it with a Map<string, LightState> seeded from the provided DeviceInfo[].
 *   - Each method logs what it does and mutates the in-memory state.
 *   - getState returns the stored state; unknown id -> throw.
 *
 * Import LightConnector/LightState/DeviceInfo from "../types.js".
 */

import type { LightConnector, LightState, DeviceInfo, Power } from "../types.js";

export class MockConnector implements LightConnector {
    private devices: DeviceInfo[];
    private states = new Map<string, LightState>();

    constructor(devices: DeviceInfo[]) {
        this.devices = devices;
        // Give every device a default state
        for (const device of devices) {
            this.states.set(device.id, {
                power:  "off",
                brightness: 50,
                hue: 0,
                saturation: 0,
            })
        }
    }

    // Helper: fetch device state or throw error
    private getOrThrow(id: string): LightState {
        const state = this.states.get(id);
        if (!state) throw new Error(`Unknown device: ${id}`);
        return state;
    }

    async listLights(): Promise<DeviceInfo[]> {
        return this.devices;
    }

    async getState(id: string): Promise<LightState> {
        return this.getOrThrow(id);
    }

    async setPower(id: string, power: Power): Promise<void> {
        const state = this.getOrThrow(id);
        state.power = power;
        console.log(`[Mock] Set power to ${power} for ${id}`);
    }

    async setBrightness(id: string, brightness: number): Promise<void> {
        const state = this.getOrThrow(id);
        state.brightness = brightness;
        console.log(`[Mock] Set brightness to ${brightness} for ${id}`);
    }

    async setColor(id: string, hue: number, saturation: number): Promise<void> {
        const state = this.getOrThrow(id);
        state.hue = hue;
        state.saturation = saturation;
        console.log(`[Mock] Set color to ${hue}, ${saturation} for ${id}`);
    }
}