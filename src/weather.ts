/**
 * Current sky from Open-Meteo, mapped to a bulb color.
 * No API key. A named city wins. Otherwise the browser's coordinates,
 * then this machine's network location. WEATHER_CITY is only a last resort.
 */

export interface SkyColor {
  hue: number;
  saturation: number;
  brightness: number;
  summary: string;
  swatch: string;
}

export interface WeatherLook extends SkyColor {
  place: string;
  /** Where the place name came from, so a wrong city can be explained. */
  source: "browser" | "network" | "city" | "timezone";
}

export function skyColor(code: number, isDay: boolean): SkyColor {
  if (code === 0) {
    return isDay
      ? { hue: 42, saturation: 85, brightness: 92, summary: "clear", swatch: "a warm gold" }
      : { hue: 228, saturation: 58, brightness: 34, summary: "a clear night", swatch: "a deep night blue" };
  }
  if (code === 1 || code === 2) {
    return {
      hue: 204,
      saturation: 40,
      brightness: isDay ? 74 : 42,
      summary: "partly cloudy",
      swatch: "a soft blue",
    };
  }
  if (code === 3) {
    return { hue: 214, saturation: 18, brightness: 58, summary: "overcast", swatch: "a cool gray" };
  }
  if (code === 45 || code === 48) {
    return { hue: 200, saturation: 12, brightness: 64, summary: "foggy", swatch: "a pale gray" };
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return { hue: 216, saturation: 74, brightness: 48, summary: "raining", swatch: "a deep blue" };
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { hue: 198, saturation: 16, brightness: 88, summary: "snowing", swatch: "a bright white" };
  }
  if (code >= 95) {
    return { hue: 274, saturation: 70, brightness: 42, summary: "stormy", swatch: "a storm purple" };
  }
  return { hue: 210, saturation: 32, brightness: 60, summary: "changing", swatch: "a mild blue" };
}

export function placeFromTimeZone(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const city = timeZone.split("/").pop() ?? "London";
  return city.replace(/_/g, " ");
}

export interface WeatherQuery {
  place?: string;
  latitude?: number;
  longitude?: number;
}

const NOT_A_PLACE =
  /^(me|you|us|here|there|home|house|my location|this location|my place|the room|outside|nearby)$/i;

/** A spoken "place" such as "for me" is not a city. */
export function cityName(raw?: string): string | undefined {
  const name = raw?.trim();
  if (!name || NOT_A_PLACE.test(name)) return undefined;
  return name;
}

export async function currentWeather(query?: string | WeatherQuery): Promise<WeatherLook> {
  const options: WeatherQuery = typeof query === "string" ? { place: query } : (query ?? {});
  const named = cityName(options.place);
  if (named) {
    try {
      return forecastAt(await geocode(named), "city");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message.includes("couldn't find") ? message : `I couldn't read the sky for ${named}.`);
    }
  }

  if (isCoord(options.latitude) && isCoord(options.longitude) && onEarth(options.latitude, options.longitude)) {
    const name = (await reverseName(options.latitude, options.longitude)) ?? "where you are";
    return forecastAt({ name, latitude: options.latitude, longitude: options.longitude }, "browser");
  }

  const here = await locateByIp();
  if (here) return forecastAt(here, "network");

  const fallback = cityName(process.env.WEATHER_CITY) || placeFromTimeZone();
  return forecastAt(await geocode(fallback), "timezone");
}

async function forecastAt(
  located: { name: string; latitude: number; longitude: number },
  source: WeatherLook["source"]
): Promise<WeatherLook> {
  const forecast = new URL("https://api.open-meteo.com/v1/forecast");
  forecast.searchParams.set("latitude", String(located.latitude));
  forecast.searchParams.set("longitude", String(located.longitude));
  forecast.searchParams.set("current", "weather_code,is_day");
  forecast.searchParams.set("timezone", "auto");

  const body = await getJson(forecast);
  const current = body.current as { weather_code?: number; is_day?: number } | undefined;
  if (!current || typeof current.weather_code !== "number") {
    throw new Error(`Weather for ${located.name} did not include a sky code.`);
  }
  return {
    place: located.name,
    source,
    ...skyColor(current.weather_code, current.is_day !== 0),
  };
}

function isCoord(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function onEarth(latitude: number, longitude: number): boolean {
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);
}

async function geocode(name: string): Promise<{ name: string; latitude: number; longitude: number }> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const body = await getJson(url);
  const hit = (body.results as { name?: string; latitude?: number; longitude?: number }[] | undefined)?.[0];
  if (!hit || hit.latitude == null || hit.longitude == null || !hit.name) {
    throw new Error(`I couldn't find a place called ${name}.`);
  }
  return { name: hit.name, latitude: hit.latitude, longitude: hit.longitude };
}

async function locateByIp(): Promise<{ name: string; latitude: number; longitude: number } | null> {
  const sources = ["https://ipwho.is/", "https://get.geojs.io/v1/ip/geo.json"];
  for (const source of sources) {
    try {
      const body = await getJson(new URL(source));
      if (body.success === false) continue;
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      if (!isCoord(latitude) || !isCoord(longitude) || !onEarth(latitude, longitude)) continue;
      const city = typeof body.city === "string" ? body.city.trim() : "";
      return { name: city || "where you are", latitude, longitude };
    } catch {
      continue;
    }
  }
  return null;
}

async function reverseName(latitude: number, longitude: number): Promise<string | null> {
  const named = await nominatimName(latitude, longitude);
  if (named) return named;
  try {
    const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("localityLanguage", "en");
    const body = await getJson(url);
    const city = [body.city, body.locality, body.principalSubdivision].find((item) => typeof item === "string" && item.trim());
    return typeof city === "string" ? city.trim() : null;
  } catch {
    return null;
  }
}

async function nominatimName(latitude: number, longitude: number): Promise<string | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "light-agent/1.0 (local lighting demo)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { address?: Record<string, string> };
    const address = body.address ?? {};
    return address.city || address.town || address.village || address.suburb || address.state || null;
  } catch {
    return null;
  }
}

async function getJson(url: URL): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Weather lookup failed (${response.status}).`);
  return (await response.json()) as Record<string, unknown>;
}
