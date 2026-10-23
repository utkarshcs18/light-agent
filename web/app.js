/**
 * Alexa+ page. A real MCP client: initialize, tools/list, tools/call.
 * Protocol: Streamable HTTP, 2025-11-25. The page never touches a bulb itself.
 */

const mcp = {
  nextId: 0,
  sessionId: null,
  handshake: [],
  calls: [],
  onLog: null,

  headers() {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return headers;
  },

  note(method, detail, ok) {
    const entry = { method, detail, ok };
    if (method === "tools/call") {
      this.calls.push(entry);
      if (this.calls.length > 4) this.calls.shift();
    } else if (!this.handshake.some((item) => item.method === method)) {
      this.handshake.push(entry);
    }
    this.onLog?.([...this.handshake, ...this.calls]);
  },

  async request(method, params, options = {}) {
    const id = ++this.nextId;
    let res;
    try {
      res = await fetch(mcpUrl(), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
    } catch {
      throw new Error("The light agent isn't running. Run npm run agent, then refresh this page.");
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const payload = await readPayload(res);
    if (res.status === 404 && !options.retried) {
      this.sessionId = null;
      await ensureSession(true);
      return this.request(method, params, { ...options, retried: true });
    }
    const detail = params && params.name ? params.name : "";
    if (!options.quiet) this.note(method === "tools/call" ? "tools/call" : method, detail, res.ok && !payload.error);
    if (!res.ok || payload.error) {
      const message = payload.error?.message || mcpFailure(method, res.status);
      throw new Error(message);
    }
    return payload.result ?? {};
  },

  async notify(method) {
    const res = await fetch(mcpUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method }),
    });
    await res.text();
    this.note(method, "", res.ok);
  },
};

const els = {
  mic: document.querySelector("#mic"),
  reply: document.querySelector("#reply"),
  heard: document.querySelector("#heard"),
  lights: document.querySelector("#lights"),
  proofCustomer: document.querySelector("#proof-customer"),
  proofChecks: document.querySelector("#proof-checks"),
  proofModels: document.querySelector("#proof-models"),
  proofTries: document.querySelector("#proof-tries"),
  proofLoops: document.querySelector("#proof-loops"),
  presence: document.querySelector("#presence"),
  situation: document.querySelector("#situation"),
  trace: document.querySelector("#trace"),
  protocol: document.querySelector("#protocol"),
  link: document.querySelector("#link"),
  form: document.querySelector("#say-form"),
  input: document.querySelector("#say"),
  stage: document.querySelector(".stage"),
};

let inflight = 0;
let paintToken = 0;
let recognition = null;
let listening = false;
let linkLabel = "Connecting";
let selectedLight = null;
let lastBoard = null;
let lastSky = null;
let polling = false;
let sessionOpen = null;

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void poll(true);
});

els.lights.addEventListener("click", (event) => {
  const button = event.target.closest("[data-act]");
  const card = event.target.closest("[data-id]");
  if (!card) return;
  if (button) {
    actOnLight(card.dataset.id, button.dataset.act);
    return;
  }
  focusLight(card.dataset.id);
});

els.trace.addEventListener("click", (event) => {
  if (event.target.closest(".show-all")) {
    focusLight(null);
    return;
  }
  const lane = event.target.closest("[data-lane]");
  if (lane && event.target.closest(".lane-watch")) focusLight(lane.dataset.lane);
});

mcp.onLog = renderProtocol;

document.querySelectorAll("[data-utterance]").forEach((button) => {
  button.addEventListener("click", () => {
    submitUtterance(button.dataset.utterance);
  });
});

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  submitUtterance(text);
});

els.mic.addEventListener("click", toggleMic);

window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
  event.preventDefault();
  toggleMic();
});

boot().catch((err) => {
  els.link.textContent = "MCP offline";
  els.reply.textContent = err instanceof Error ? err.message : String(err);
});

async function boot() {
  await ensureSession(true);
  await poll(true);
  setInterval(() => {
    void poll();
  }, 400);
}

async function ensureSession(force) {
  if (!force && mcp.sessionId) return;
  if (!sessionOpen) {
    sessionOpen = openSession().finally(() => {
      sessionOpen = null;
    });
  }
  await sessionOpen;
}

async function openSession() {
  mcp.sessionId = null;
  await mcp.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "alexa-plus-light-agent", version: "1.0.0" },
  }, { retried: true });
  await mcp.notify("notifications/initialized");
  const listed = await mcp.request("tools/list", {}, { retried: true });
  const count = Array.isArray(listed.tools) ? listed.tools.length : 0;
  linkLabel = `Connected · ${count} tools`;
  els.link.textContent = linkLabel;
  document.body.classList.add("is-live");
}

async function submitUtterance(text) {
  els.heard.textContent = text;
  els.reply.textContent = "One moment.";
  inflight += 1;
  const token = ++paintToken;
  setBusy(true);
  try {
    const compiled = asBoard(await mcp.request("tools/call", {
      name: "compile_intention",
      arguments: { utterance: text },
    }));
    let board = compiled;
    if (compiled.compiled?.tool && !compiled.alreadyDone) {
      let args = compiled.compiled.arguments || {};
      if (compiled.compiled.tool === "match_weather" && !args.place) {
        els.reply.textContent = "Checking the sky where you are.";
        const position = await here();
        if (position) args = { ...args, ...position };
      }
      board = asBoard(await mcp.request("tools/call", {
        name: compiled.compiled.tool,
        arguments: args,
      }));
    }
    if (token === paintToken) {
      paint(board);
      if (board.speech) say(board.speech);
    }
  } catch (err) {
    if (token === paintToken) {
      els.reply.textContent = err instanceof Error ? err.message : String(err);
    }
  } finally {
    inflight -= 1;
    setBusy(false);
  }
}

async function poll(force = false) {
  if (polling || (!force && (document.hidden || inflight > 0))) return;
  polling = true;
  const token = paintToken;
  try {
    const result = await mcp.request("tools/call", {
      name: "loop_status",
      arguments: {},
    }, { quiet: true });
    if (inflight > 0 || token !== paintToken) return;
    els.link.textContent = linkLabel;
    paint(asBoard(result));
  } catch {
    els.link.textContent = "MCP reconnecting";
  } finally {
    polling = false;
  }
}

function paint(board) {
  lastBoard = board;
  if (board.sky) lastSky = board.sky;
  renderPresence(board);
  renderSituation(board);
  renderProof(board);
  renderLights(board.lights || [], board.tasks || [], board.events || []);
  renderTrace(board.lights || [], board.events || [], board.tasks || []);
  if (board.speech) {
    els.reply.textContent = board.speech;
    els.reply.classList.remove("is-said");
    void els.reply.offsetWidth;
    els.reply.classList.add("is-said");
  }
  const cycling = (board.lights || []).filter((light) =>
    (board.tasks || []).some((task) => task.lightId === light.id && task.status === "active" && task.actionType === "cycleColor")
  );
  const away = board.presence?.mode === "away";
  document.body.classList.toggle("is-away", away);
  document.documentElement.classList.toggle("has-many-loops", !away && cycling.length > 1);
  document.documentElement.classList.toggle("has-three-loops", !away && cycling.length > 2);
  const glow = away ? "rgba(255, 176, 32, 0.22)" : cycling[0] ? bulbColor(cycling[0].state) : "rgba(94, 176, 255, 0.28)";
  const glowB = cycling[1] ? bulbColor(cycling[1].state) : glow;
  const glowC = cycling[2] ? bulbColor(cycling[2].state) : glowB;
  document.documentElement.style.setProperty("--glow", glow);
  document.documentElement.style.setProperty("--glow-b", glowB);
  document.documentElement.style.setProperty("--glow-c", glowC);
  const gaps = (board.tasks || [])
    .filter((task) => task.status === "active" && task.actionType === "cycleColor")
    .map((task) => task.intervalMs)
    .filter((ms) => ms > 0);
  const gap = gaps.length ? Math.min(...gaps) : 2000;
  const glide = Math.max(280, Math.min(700, Math.round(gap * 0.18)));
  document.documentElement.style.setProperty("--color-glide", `${glide}ms`);
}

function renderPresence(board) {
  const presence = board.presence;
  if (!presence || !els.presence) return;
  const away = presence.mode === "away";
  els.presence.className = away ? "presence is-away" : "presence is-home";
  els.presence.replaceChildren(
    document.createTextNode(away ? "Away" : "Home"),
    el("span", {}, [
      away
        ? "I saved the room. The lights stay off until you say you're back."
        : "The line under this is what the bulbs are doing right now.",
    ])
  );
}

function renderSituation(board) {
  if (!els.situation) return;
  const lights = board.lights || [];
  const cycling = (board.tasks || []).filter((task) => task.status === "active" && task.actionType === "cycleColor");
  if (board.presence?.mode === "away" && !cycling.length) {
    els.situation.textContent = "You are away, so nothing is cycling. Those checks only keep the lights off.";
    return;
  }
  if (cycling.length) {
    const names = cycling.map((task) => pretty(task.lightId));
    const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    els.situation.textContent = `${who} ${names.length > 1 ? "are" : "is"} cycling. Each lamp shows the color that bulb just confirmed.`;
    return;
  }
  if (lastSky && skyHeld(lights, lastSky.hue)) {
    const from =
      lastSky.source === "browser"
        ? "from this browser's location"
        : lastSky.source === "network"
          ? "from this network, because the browser did not share a location"
          : lastSky.source === "timezone"
            ? "from the timezone, because no location could be read"
            : "the city you named";
    els.situation.textContent = `${lastSky.place} is ${lastSky.summary}, ${from}. The lamps are still ${lastSky.swatch}.`;
    return;
  }
  const on = lights.filter((light) => light.state?.power === "on");
  if (!lights.length) {
    els.situation.textContent = "No bulbs are connected yet.";
    return;
  }
  if (!on.length) {
    els.situation.textContent = "Every light is off.";
    return;
  }
  const bits = on.map((light) => `${light.alias || pretty(light.id)} · hue ${Math.round(light.state.hue ?? 0)}`);
  const moved = lastSky ? ` The earlier sky color from ${lastSky.place} is no longer on the bulbs.` : "";
  els.situation.textContent = `Right now: ${bits.join(". ")}.${moved}`;
}

function skyHeld(lights, hue) {
  const on = lights.filter((light) => light.state?.power === "on");
  if (!on.length) return false;
  return on.every((light) => hueGap(light.state.hue ?? 0, hue) < 18);
}

function hueGap(a, b) {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

function renderProof(board) {
  const tasks = board.tasks || [];
  const proof = board.proof || {};
  const verified = tasks.reduce((sum, task) => sum + (task.runCount || 0), 0);
  const active = tasks.filter((task) => task.status === "active" && task.actionType === "cycleColor").length;
  if (proof.customer) els.proofCustomer.textContent = proof.customer;
  setStat(els.proofChecks, proof.verifiedRuns ?? verified);
  setStat(els.proofModels, proof.modelCalls ?? 0);
  const tries = proof.maxAttempts ?? 3;
  const backoff = proof.backoffMs || [200, 400];
  setStat(els.proofTries, tries);
  els.proofTries.nextElementSibling.textContent = `tries, ${backoff[0]}ms then ${backoff[1]}ms`;
  setStat(els.proofLoops, active);
}

function renderLights(lights, tasks, events) {
  if (!lights.length) {
    els.lights.replaceChildren(el("p", { class: "empty" }, ["No lights yet. Run npm run setup, or stay on the mock connector."]));
    return;
  }
  if (els.lights.querySelector(".empty")) els.lights.replaceChildren();

  const seen = new Set();
  for (const light of lights) {
    seen.add(light.id);
    const mine = tasks.filter((task) => task.lightId === light.id);
    const active = mine.find((task) => task.status === "active");
    const heldOff = active?.description === "presence:away";
    const loopText = !active
      ? "No color loop"
      : heldOff
        ? "Held off · not cycling"
        : `${actionLabel(active.actionType)} · ${every(active.intervalMs)} · ${active.runCount} verified`;
    let card = els.lights.querySelector(`[data-id="${CSS.escape(light.id)}"]`);
    if (!card) {
      card = el("article", { class: "light", "data-id": light.id }, [
        el("div", { class: "bulb" }),
        el("div", { class: "light-copy" }, [
          el("h2", {}, [light.alias || pretty(light.id)]),
          el("p", { class: "meta" }, [""]),
          el("p", { class: "loop-line" }, [""]),
        ]),
        el("div", { class: "acts" }, [
          el("button", { type: "button", "data-act": "cycle" }, ["Cycle"]),
          el("button", { type: "button", "data-act": "drop" }, ["Drop write"]),
          el("button", { type: "button", "data-act": "power" }, ["Off"]),
          el("button", { type: "button", "data-act": "stop" }, ["Stop"]),
        ]),
        el("span", { class: "phase-pill" }, [""]),
      ]);
      els.lights.append(card);
    }
    const looping = active?.actionType === "cycleColor";
    const selected = selectedLight === light.id;
    card.className = "light" + (light.state.power === "on" ? " is-on" : " is-off") + (looping ? " is-looping" : "") + (selected ? " is-selected" : "");
    card.setAttribute("aria-pressed", selected ? "true" : "false");
    card.style.setProperty("--bulb", bulbColor(light.state));
    card.style.setProperty("--bulb-glow", bulbGlow(light.state));
    card.querySelector("h2").textContent = light.alias || pretty(light.id);
    card.querySelector(".meta").textContent = describeState(light.state);
    const loop = card.querySelector(".loop-line");
    loop.textContent = loopText;
    loop.className = active ? "loop-line" : "loop-line muted";
    const power = card.querySelector('[data-act="power"]');
    power.textContent = light.state.power === "on" ? "Off" : "On";
    const stop = card.querySelector('[data-act="stop"]');
    stop.disabled = !active;
    const pill = card.querySelector(".phase-pill");
    const phase = light.state.power === "on" ? "On" : "Off";
    const nextClass = light.state.power === "on" ? "phase-pill phase-verified" : "phase-pill is-idle";
    if (pill.textContent !== phase) {
      pill.textContent = phase;
      pill.className = nextClass;
      void pill.offsetWidth;
      pill.classList.add("is-fresh");
    } else if (pill.className.replace(" is-fresh", "") !== nextClass) {
      pill.className = nextClass;
    }
  }
  for (const card of els.lights.querySelectorAll("[data-id]")) {
    if (!seen.has(card.dataset.id)) card.remove();
  }
}

function renderTrace(lights, events, tasks) {
  const note = els.trace.querySelector(".trace-note");
  const showAll = els.trace.querySelector(".show-all");
  const active = (tasks || []).filter((task) => task.status === "active").length;
  if (selectedLight) {
    note.textContent = `Watching ${pretty(selectedLight)}. The other lights keep their own lanes.`;
  } else if (active > 1) {
    note.textContent = `${active} loops, each in its own lane. Tap a lamp to watch one.`;
  } else {
    note.textContent = "Each light keeps its own checks. Tap a lamp to watch one.";
  }
  showAll.hidden = !selectedLight;

  const lanes = els.trace.querySelector(".lanes");
  const seen = new Set();
  for (const light of lights) {
    seen.add(light.id);
    const mine = events.filter((event) => event.lightId === light.id);
    const ticks = groupTicks(mine);
    const latest = ticks[ticks.length - 1];
    const older = historyTicks(ticks);
    let lane = lanes.querySelector(`[data-lane="${CSS.escape(light.id)}"]`);
    if (!lane) {
      lane = el("article", { class: "lane", "data-lane": light.id }, [
        el("div", { class: "lane-top" }, [
          el("button", { type: "button", class: "lane-watch" }, [""]),
          el("span", { class: "lane-live" }, [""]),
        ]),
        el("div", { class: "stepper", role: "list" }),
        el("p", { class: "lane-meta" }, [""]),
        el("ol", { class: "tick-log" }),
      ]);
      lanes.append(lane);
    }
    const looping = (tasks || []).some((task) => task.lightId === light.id && task.status === "active");
    lane.className = "lane" + (looping ? " is-live" : "") + (selectedLight === light.id ? " is-focus" : "") + (selectedLight && selectedLight !== light.id ? " is-dim" : "");
    lane.style.setProperty("--lane", bulbColor(light.state));
    lane.querySelector(".lane-watch").textContent = light.alias || pretty(light.id);
    lane.querySelector(".lane-live").textContent = looping ? "Looping" : "Idle";
    const stepper = lane.querySelector(".stepper");
    const meta = lane.querySelector(".lane-meta");
    const log = lane.querySelector(".tick-log");
    stepper.replaceChildren();
    log.replaceChildren();
    if (!latest) {
      meta.textContent = "No tick yet. Cycle this light and the checks stay here.";
      continue;
    }
    latest.phases.forEach((phase, index) => {
      const now = index === latest.phases.length - 1 ? " is-now" : "";
      stepper.append(el("span", { class: `step phase-${phase}${now}`, role: "listitem" }, [phase]));
    });
    const detail = latest.detail ? `${latest.detail} · ` : "";
    meta.textContent = `${clock(latest.at)} · attempt ${latest.attempt} · ${detail}no model`;
    for (const tick of older) {
      log.append(el("li", {}, [
        el("time", {}, [clock(tick.at)]),
        el("span", {}, [tick.phases.join(" → ")]),
      ]));
    }
  }
  for (const lane of lanes.querySelectorAll("[data-lane]")) {
    if (!seen.has(lane.dataset.lane)) lane.remove();
  }
}

function historyTicks(ticks) {
  const older = ticks.slice(0, -1);
  const notable = older.filter((tick) =>
    tick.phases.some((phase) => phase === "mismatch" || phase === "retry" || phase === "failed")
  );
  const plain = older.filter((tick) => !notable.includes(tick));
  const picked = [];
  for (const tick of [...notable.slice(-2), ...plain.slice(-3)]) {
    if (!picked.includes(tick)) picked.push(tick);
  }
  return picked.slice(-4).reverse();
}

function groupTicks(events) {
  const ticks = [];
  let current = null;
  for (const event of events) {
    if (!current || current.done) {
      current = { at: event.at, phases: [], attempt: event.attempt, detail: "", done: false };
      ticks.push(current);
    }
    current.phases.push(event.phase);
    current.attempt = event.attempt;
    current.at = event.at;
    if (event.detail) current.detail = event.detail;
    if (event.phase === "verified" || event.phase === "failed") current.done = true;
  }
  return ticks;
}

function focusLight(id) {
  selectedLight = id && selectedLight === id ? null : id;
  if (lastBoard) {
    renderLights(lastBoard.lights || [], lastBoard.tasks || [], lastBoard.events || []);
    renderTrace(lastBoard.lights || [], lastBoard.events || [], lastBoard.tasks || []);
  }
}

async function actOnLight(id, act) {
  const board = lastBoard || { lights: [], tasks: [] };
  selectedLight = id;
  if (act === "cycle") {
    await callTool("schedule_recurring_task", {
      lightId: id,
      description: `cycle ${id} color`,
      action: { type: "cycleColor" },
      intervalSeconds: 5,
    });
    return;
  }
  if (act === "drop") {
    await callTool("simulate_miss", { id });
    return;
  }
  if (act === "power") {
    const light = (board.lights || []).find((item) => item.id === id);
    const power = light?.state?.power === "on" ? "off" : "on";
    await callTool("set_power", { ids: [id], power });
    return;
  }
  if (act === "stop") {
    const tasks = (board.tasks || []).filter((task) => task.lightId === id && task.status === "active");
    for (const task of tasks) await callTool("cancel_scheduled_task", { taskId: task.id });
  }
}

async function callTool(name, args) {
  const token = ++paintToken;
  inflight += 1;
  setBusy(true);
  try {
    const board = asBoard(await mcp.request("tools/call", { name, arguments: args }));
    if (token === paintToken) {
      paint(board);
      if (board.speech) say(board.speech);
    }
  } catch (err) {
    if (token === paintToken) {
      els.reply.textContent = err instanceof Error ? err.message : String(err);
    }
  } finally {
    inflight -= 1;
    setBusy(false);
  }
}

function setStat(node, value) {
  const next = String(value);
  if (node.textContent === next) return;
  node.textContent = next;
  node.classList.remove("is-bump");
  void node.offsetWidth;
  node.classList.add("is-bump");
}

function clock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function renderProtocol(entries) {
  els.protocol.replaceChildren();
  for (const entry of entries) {
    const label = entry.detail ? `${entry.method}  ${entry.detail}` : entry.method;
    els.protocol.append(el("span", { class: entry.ok ? "call ok" : "call bad" }, [label]));
  }
}

function asBoard(result) {
  const text = (result.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  try {
    const board = JSON.parse(text);
    return board && typeof board === "object" ? board : { speech: text, lights: [], tasks: [], events: [] };
  } catch {
    return { speech: text, lights: [], tasks: [], events: [] };
  }
}

function here() {
  if (!navigator.geolocation) return Promise.resolve(null);
  const ask = (options) =>
    new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;
          const onEarth = Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);
          resolve(onEarth ? { latitude, longitude } : null);
        },
        () => resolve(null),
        options
      );
    });
  return ask({ enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }).then((precise) =>
    precise || ask({ enableHighAccuracy: false, timeout: 5000, maximumAge: 60_000 })
  );
}

function mcpUrl() {
  if (location.port === "8787") return new URL("/mcp", location.origin).href;
  return "http://127.0.0.1:8787/mcp";
}

function mcpFailure(method, status) {
  if (status === 405) return "The light agent did not accept that call. Refresh http://127.0.0.1:8787";
  if (status === 404) return "The light agent restarted. Refresh this page and say it again.";
  return `MCP ${method} failed (${status})`;
}

async function readPayload(res) {
  const text = await res.text();
  if (!text.trim()) return {};
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/event-stream") || text.includes("\ndata:") || text.startsWith("data:")) {
    const messages = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].result || messages[i].error) return messages[i];
    }
    return messages.length ? messages[messages.length - 1] : {};
  }
  return JSON.parse(text);
}

function say(text) {
  if (!text || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = speechSynthesis.getVoices().find((item) => /en[-_]US/i.test(item.lang));
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function toggleMic() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) {
    els.input.focus();
    els.reply.textContent = "This browser has no speech recognition. Type instead.";
    return;
  }
  if (listening && recognition) {
    recognition.stop();
    return;
  }
  recognition = new Rec();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.onstart = () => {
    listening = true;
    document.body.classList.add("is-listening");
    els.heard.textContent = "Listening…";
  };
  recognition.onend = () => {
    listening = false;
    document.body.classList.remove("is-listening");
  };
  recognition.onerror = () => {
    listening = false;
    document.body.classList.remove("is-listening");
    els.reply.textContent = "I couldn't use the microphone. Type the line instead.";
  };
  recognition.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript?.trim();
    if (text) submitUtterance(text);
  };
  recognition.start();
}

function setBusy(busy) {
  document.body.classList.toggle("is-thinking", busy);
  els.mic.disabled = busy;
}

function bulbColor(state) {
  if (!state || state.power !== "on") return "hsl(220 8% 22%)";
  const colored = (state.saturation ?? 0) >= 8;
  const hue = colored ? (state.hue ?? 40) : 38;
  const saturation = colored ? state.saturation : 62;
  const lightness = Math.max(50, Math.min(66, 30 + (state.brightness ?? 78) * 0.32));
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function bulbGlow(state) {
  if (!state || state.power === "off") return "transparent";
  return bulbColor(state);
}

function describeState(state) {
  if (!state || state.power === "off") return "Off";
  const bits = ["On", `${state.brightness ?? 0}%`];
  if ((state.saturation ?? 0) > 0) bits.push(`hue ${Math.round(state.hue ?? 0)}`);
  return bits.join(" · ");
}

function actionLabel(type) {
  if (type === "cycleColor") return "Cycling color";
  if (type === "setPower") return "Power";
  if (type === "setBrightness") return "Brightness";
  if (type === "setColor") return "Color";
  return type;
}

function every(ms) {
  if (ms % 60000 === 0) return `every ${ms / 60000} min`;
  if (ms % 1000 === 0) return `every ${ms / 1000}s`;
  return `every ${ms} ms`;
}

function pretty(id) {
  return String(id)
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === "class") node.className = value;
    else if (key === "style") node.setAttribute("style", value);
    else node.setAttribute(key, value);
  }
  for (const child of children || []) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
