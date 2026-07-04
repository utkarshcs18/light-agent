/**
 * types.ts - shared contracts used across the whole app.
 * The LightConnector interface is the key seam: connectors (mock/kasa) implement it,
 * and the agent + scheduler depend only on it.
 *
 * TODO: define and export
 *   - type Power = "on" | "off"
 *   - interface LightState  { power; brightness?; hue?; saturation? }
 *   - interface DeviceInfo  { id; alias?; host; model?; mac? }
 *   - interface LightConnector { listLights, getState, setPower, setBrightness, setColor }
 *   - type TaskAction = setPower | setBrightness | setColor | cycleColor
 *   - type TaskStatus = "active" | "error" | "stopped"
 *   - interface ScheduledTask { id; lightId; description; intervalMs; action; status; runCount; lastRun?; lastError? }
 *
 * See CLAUDE.md for the architecture overview.
 */

// Power state of light
export type Power = "on" | "off";

// State of light can be in 
export interface LightState {
    power: Power;
    brightness?: number; //0-100
    hue?: number; //0-360
    saturation?: number; //0-100
}

// Device info
export interface DeviceInfo {
    id: string; // eg: "living-room-light"
    alias?: string; // original name of the light
    host?: string; // ip address of the light
    model?: string; // model of the light
    mac?: string; // mac address of the light
}