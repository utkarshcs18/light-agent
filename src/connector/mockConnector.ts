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
