/**
 * setup.ts - `npm run setup` entry point: discover, name, and persist Kasa bulbs.
 *
 * TODO:
 *   - new Client() from "tplink-smarthome-api"
 *   - client.startDiscovery({ deviceTypes: ["bulb"], discoveryTimeout: 5000 })
 *       .on("device-new", (d) => collect { id: slug(d.alias), alias: d.alias, host: d.host, model: d.model, mac: d.mac })
 *   - After discovery stops (~5s), prompt (readline) for a friendly id per bulb (default = slug(alias)).
 *   - saveLights(found) to write lights.json, then exit.
 *
 * Reminder: this only finds bulbs already on your WiFi; onboard them once via the Kasa app first.
 */
