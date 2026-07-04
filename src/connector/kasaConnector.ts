/**
 * kasaConnector.ts - real TP-Link Kasa bulbs via `tplink-smarthome-api`.
 *
 * TODO:
 *   - class KasaConnector implements LightConnector (constructed with the DeviceInfo[] registry).
 *   - Resolve friendly id -> host from the registry; new Client() from "tplink-smarthome-api".
 *   - const bulb = await client.getDevice({ host });  // returns Bulb | Plug -> narrow/cast to Bulb
 *   - setPower:      await bulb.setPowerState(power === "on")
 *   - setBrightness: await (bulb as any).lighting.setLightState({ brightness })
 *   - setColor:      await (bulb as any).lighting.setLightState({ hue, saturation, color_temp: 0 })
 *   - getState:      read bulb.getSysInfo()/getPowerState() and map to LightState
 *   - Optional discover() helper: client.startDiscovery({ deviceTypes: ["bulb"], discoveryTimeout }).
 *
 * Note: bulbs must already be on WiFi (onboard once via the Kasa app). KL/LB only, not Tapo.
 */
