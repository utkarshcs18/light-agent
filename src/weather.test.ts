import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cityName, skyColor } from "./weather.js";

describe("weather colors", () => {
  it("turns a clear day gold and a clear night blue", () => {
    assert.equal(skyColor(0, true).swatch, "a warm gold");
    assert.equal(skyColor(0, false).swatch, "a deep night blue");
  });

  it("does not treat 'for me' as a city", () => {
    assert.equal(cityName("me"), undefined);
    assert.equal(cityName("my location"), undefined);
    assert.equal(cityName("Paris"), "Paris");
  });

  it("turns rain deep blue and a storm purple", () => {
    assert.equal(skyColor(63, true).summary, "raining");
    assert.equal(skyColor(63, true).hue, 216);
    assert.equal(skyColor(95, true).swatch, "a storm purple");
  });
});
