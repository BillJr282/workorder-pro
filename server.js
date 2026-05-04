// ===== PART 1 START =====
// server.js — WorkOrder Pro
// Express + uuid + flat-file JSON storage (data.json)
// Routes: /api/workorders, /api/procedures (CRUD), AI generator,
//         AI assistant with tool use

// ===== TICKET 10 PART 1 START =====
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
// ===== TICKET 10 PART 1 END (block A) =====

// ---------- Data layer ----------
// DATA_DIR lets us point storage at a Railway volume mount (e.g. /data).
// If unset, falls back to the project root for local dev.
const DATA_DIR = process.env.DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
const DATA_FILE = path.join(DATA_DIR, "data.json");

// One-time migration: if DATA_DIR is set and we have no data.json there yet,
// but a legacy data.json exists in the repo root, copy it in so we don't lose it.
(function migrateLegacyDataFile() {
  try {
    if (DATA_DIR === __dirname) return; // nothing to migrate
    if (fs.existsSync(DATA_FILE)) return; // volume already has data
    const legacy = path.join(__dirname, "data.json");
    if (fs.existsSync(legacy)) {
      fs.copyFileSync(legacy, DATA_FILE);
      console.log(`[startup] Migrated data.json from repo root to ${DATA_FILE}`);
    }
  } catch (e) {
    console.error("[startup] data.json migration failed:", e.message);
  }
})();

console.log(`[startup] DATA_FILE = ${DATA_FILE}`);

function loadData() {
  let data;
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    data = JSON.parse(raw);
  } catch (e) {
    data = {};
  function loadData() {
  let data;
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    data = JSON.parse(raw);
  } catch (e) {
    data = {};
  }
  if (!Array.isArray(data.workorders)) data.workorders = [];
  if (!Array.isArray(data.procedures)) data.procedures = [];
  // ---- Ticket 10: users + sessions ----
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.sessions)) data.sessions = [];
  // Prune expired sessions on every load
  const now = Date.now();
  data.sessions = data.sessions.filter(s => !s.expiresAt || s.expiresAt > now);
  data.workorders.forEach((w) => {
  data.workorders.forEach((w) => {
    if (!Array.isArray(w.procedures)) w.procedures = [];
    if (!Array.isArray(w.activity)) w.activity = [];
    // ---- Ticket 8 migration: customer / asset / parts / labor / costs / totals ----
    if (typeof w.customerName !== "string") w.customerName = "";
    if (typeof w.workType !== "string") w.workType = "";
    if (!w.asset || typeof w.asset !== "object") {
      w.asset = { name: "", serialNumber: "", unitNumber: "", hours: null, make: "", model: "" };
    } else {
      if (typeof w.asset.name !== "string") w.asset.name = "";
      if (typeof w.asset.serialNumber !== "string") w.asset.serialNumber = "";
      if (typeof w.asset.unitNumber !== "string") w.asset.unitNumber = "";
      if (w.asset.hours === undefined) w.asset.hours = null;
      if (typeof w.asset.make !== "string") w.asset.make = "";
      if (typeof w.asset.model !== "string") w.asset.model = "";
    }
    if (!Array.isArray(w.parts)) w.parts = [];
    if (!Array.isArray(w.labor)) w.labor = [];
    if (!Array.isArray(w.otherCosts)) w.otherCosts = [];
    w.parts = w.parts.map(normalizePart);
    w.labor = w.labor.map(normalizeLabor);
    w.otherCosts = w.otherCosts.map(normalizeOtherCost);
    w.totals = computeTotals(w);
  });
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function logActivity(wo, message) {
  wo.activity = wo.activity || [];
  wo.activity.push({ id: uuidv4(), at: new Date().toISOString(), message });
}
// ---------- Ticket 8 helpers: parts / labor / costs / totals ----------
const ALLOWED_WORK_TYPES = ["", "repair", "install", "maintenance", "inspection"];

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function round2(x) {
  return Math.round(x * 100) / 100;
}

function normalizePart(p) {
  p = p || {};
  const quantity = n(p.quantity);
  const unitCost = n(p.unitCost);
  return {
    id: p.id || uuidv4(),
    partNumber: typeof p.partNumber === "string" ? p.partNumber : "",
    description: typeof p.description === "string" ? p.description : "",
    quantity,
    unitCost,
    lineTotal: round2(quantity * unitCost),
  };
}

function normalizeLabor(l) {
  l = l || {};
  const hours = n(l.hours);
  const hourlyRate = n(l.hourlyRate);
  return {
    id: l.id || uuidv4(),
    technician: typeof l.technician === "string" ? l.technician : "",
    date: typeof l.date === "string" ? l.date : "",
    hours,
    hourlyRate,
    lineTotal: round2(hours * hourlyRate),
  };
}

function normalizeOtherCost(o) {
  o = o || {};
  return {
    id: o.id || uuidv4(),
    description: typeof o.description === "string" ? o.description : "",
    amount: round2(n(o.amount)),
  };
}

function normalizeAsset(a) {
  a = a || {};
  return {
    name: typeof a.name === "string" ? a.name : "",
    serialNumber: typeof a.serialNumber === "string" ? a.serialNumber : "",
    unitNumber: typeof a.unitNumber === "string" ? a.unitNumber : "",
    hours: a.hours === null || a.hours === "" || a.hours === undefined ? null : n(a.hours),
    make: typeof a.make === "string" ? a.make : "",
    model: typeof a.model === "string" ? a.model : "",
  };
}

function computeTotals(wo) {
  const parts = (wo.parts || []).reduce((s, p) => s + n(p.lineTotal), 0);
  const labor = (wo.labor || []).reduce((s, l) => s + n(l.lineTotal), 0);
  const other = (wo.otherCosts || []).reduce((s, o) => s + n(o.amount), 0);
  const grand = parts + labor + other;
  return { parts: round2(parts), labor: round2(labor), other: round2(other), grand: round2(grand) };
}

function applyWorkOrderUpdates(wo, body) {
  // Mutates wo with any provided new-schema fields. Returns array of changed keys.
  const changed = [];
  if (body.customerName !== undefined && body.customerName !== wo.customerName) {
    wo.customerName = String(body.customerName || "");
    changed.push("customerName");
  }
  if (body.workType !== undefined) {
    const wt = ALLOWED_WORK_TYPES.includes(body.workType) ? body.workType : "";
    if (wt !== wo.workType) { wo.workType = wt; changed.push("workType"); }
  }
  if (body.asset !== undefined && body.asset && typeof body.asset === "object") {
    wo.asset = normalizeAsset(body.asset);
    changed.push("asset");
  }
  if (Array.isArray(body.parts)) {
    wo.parts = body.parts.map(normalizePart);
    changed.push("parts");
  }
  if (Array.isArray(body.labor)) {
    wo.labor = body.labor.map(normalizeLabor);
    changed.push("labor");
  }
  if (Array.isArray(body.otherCosts)) {
    wo.otherCosts = body.otherCosts.map(normalizeOtherCost);
    changed.push("otherCosts");
  }
  if (changed.length) wo.totals = computeTotals(wo);
  return changed;
}
    // ---------- Ticket 10: Auth helpers + middleware ----------
const SESSION_COOKIE = "wopsid";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const ALLOWED_ROLES = ["admin", "tech"];

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, createdAt: u.createdAt };
}

function findUserByUsername(data, username) {
  if (!username) return null;
  const lc = String(username).toLowerCase();
  return data.users.find(u => u.username.toLowerCase() === lc) || null;
}

function newSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

function createSession(data, userId) {
  const sid = newSessionId();
  const session = { id: sid, userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
  data.sessions.push(session);
  return session;
}

function destroySession(data, sid) {
  const idx = data.sessions.findIndex(s => s.id === sid);
  if (idx !== -1) data.sessions.splice(idx, 1);
}

function getSessionUser(data, req) {
  const sid = req.cookies && req.cookies[SESSION_COOKIE];
  if (!sid) return null;
  const session = data.sessions.find(s => s.id === sid);
  if (!session) return null;
  if (session.expiresAt && session.expiresAt < Date.now()) return null;
  const user = data.users.find(u => u.id === session.userId);
  return user || null;
}

function setSessionCookie(res, sid) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

// Routes that don't require auth
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/setup-status",
  "/api/setup",
  "/api/login",
  "/api/logout",
  "/api/me",
]);

function requireAuth(req, res, next) {
  if (!req.path.startsWith("/api/")) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  const data = loadData();
  const user = getSessionUser(data, req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.currentUser = user;
  req.dataCache = data;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser || req.currentUser.role !== "admin") {
    return res.status(403).json({ error: "Admin role required" });
  }
  next();
}

app.use(requireAuth);
// ===== TICKET 10 PART 1 END (block B) =====
// ---------- Health ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ---------- Work Orders ----------
app.get("/api/workorders", (req, res) => {
  const data = loadData();
  res.json(data.workorders);
});

app.get("/api/workorders/:id", (req, res) => {
  const data = loadData();
  const wo = data.workorders.find((w) => w.id === req.params.id);
  if (!wo) return res.status(404).json({ error: "Not found" });
  res.json(wo);
});

app.post("/api/workorders", (req, res) => {
  const data = loadData();
  const body = req.body || {};
  const { title, description, status, priority, assignee } = body;
  if (!title) return res.status(400).json({ error: "title required" });
  const wo = {
    id: uuidv4(),
    title,
    description: description || "",
    status: status || "open",
    priority: priority || "medium",
    assignee: assignee || "",
    customerName: "",
    workType: "",
    asset: normalizeAsset({}),
    parts: [],
    labor: [],
    otherCosts: [],
    totals: { parts: 0, labor: 0, other: 0, grand: 0 },
    procedures: [],
    activity: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  applyWorkOrderUpdates(wo, body);
  logActivity(wo, `Work order created: ${title}`);
  data.workorders.push(wo);
  saveData(data);
  res.status(201).json(wo);
});

app.put("/api/workorders/:id", (req, res) => {
  const data = loadData();
  const wo = data.workorders.find((w) => w.id === req.params.id);
  if (!wo) return res.status(404).json({ error: "Not found" });
  const body = req.body || {};
  const { title, description, status, priority, assignee } = body;
  if (title !== undefined) wo.title = title;
  if (description !== undefined) wo.description = description;
  if (status !== undefined && status !== wo.status) {
    logActivity(wo, `Status changed to ${status}`);
    wo.status = status;
  }
  if (priority !== undefined) wo.priority = priority;
  if (assignee !== undefined) wo.assignee = assignee;
  applyWorkOrderUpdates(wo, body);
  wo.updatedAt = new Date().toISOString();
  saveData(data);
  res.json(wo);
});

app.delete("/api/workorders/:id", (req, res) => {
  const data = loadData();
  const idx = data.workorders.findIndex((w) => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const [removed] = data.workorders.splice(idx, 1);
  saveData(data);
  res.json({ ok: true, removed });
});

// ---------- Procedures ----------
const ALLOWED_FIELD_TYPES = ["checkbox", "text", "number", "passfail", "date", "signature", "photo"];

function normalizeField(f) {
  return {
    id: f.id || uuidv4(),
    type: ALLOWED_FIELD_TYPES.includes(f.type) ? f.type : "text",
    label: f.label || "Untitled field",
    required: !!f.required,
  };
}

app.get("/api/procedures", (req, res) => {
  const data = loadData();
  res.json(data.procedures);
});

app.get("/api/procedures/:id", (req, res) => {
  const data = loadData();
  const p = data.procedures.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(p);
});

app.post("/api/procedures", (req, res) => {
  const data = loadData();
  const { name, description, fields } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  const p = {
    id: uuidv4(),
    name,
    description: description || "",
    fields: Array.isArray(fields) ? fields.map(normalizeField) : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  data.procedures.push(p);
  saveData(data);
  res.status(201).json(p);
});

app.put("/api/procedures/:id", (req, res) => {
  const data = loadData();
  const p = data.procedures.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const { name, description, fields } = req.body || {};
  if (name !== undefined) p.name = name;
  if (description !== undefined) p.description = description;
  if (fields !== undefined && Array.isArray(fields)) p.fields = fields.map(normalizeField);
  p.updatedAt = new Date().toISOString();
  saveData(data);
  res.json(p);
});

app.delete("/api/procedures/:id", (req, res) => {
  const data = loadData();
  const idx = data.procedures.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const [removed] = data.procedures.splice(idx, 1);
  saveData(data);
  res.json({ ok: true, removed });
});

app.post("/api/workorders/:id/procedures", (req, res) => {
  const data = loadData();
  const wo = data.workorders.find((w) => w.id === req.params.id);
  if (!wo) return res.status(404).json({ error: "Work order not found" });
  const { procedureId } = req.body || {};
  const p = data.procedures.find((x) => x.id === procedureId);
  if (!p) return res.status(404).json({ error: "Procedure not found" });
  const instance = {
    instanceId: uuidv4(),
    procedureId: p.id,
    name: p.name,
    description: p.description,
    fields: p.fields.map((f) => ({ ...f })),
    responses: {},
    status: "in_progress",
    attachedAt: new Date().toISOString(),
    completedAt: null,
  };
  wo.procedures.push(instance);
  logActivity(wo, `Procedure attached: ${p.name}`);
  wo.updatedAt = new Date().toISOString();
  saveData(data);
  res.status(201).json(instance);
});

app.delete("/api/workorders/:id/procedures/:instanceId", (req, res) => {
  const data = loadData();
  const wo = data.workorders.find((w) => w.id === req.params.id);
  if (!wo) return res.status(404).json({ error: "Work order not found" });
  const idx = wo.procedures.findIndex((p) => p.instanceId === req.params.instanceId);
  if (idx === -1) return res.status(404).json({ error: "Procedure instance not found" });
  const [removed] = wo.procedures.splice(idx, 1);
  logActivity(wo, `Procedure detached: ${removed.name}`);
  wo.updatedAt = new Date().toISOString();
  saveData(data);
  res.json({ ok: true, removed });
});

app.patch("/api/workorders/:id/procedures/:instanceId", (req, res) => {
  const data = loadData();
  const wo = data.workorders.find((w) => w.id === req.params.id);
  if (!wo) return res.status(404).json({ error: "Work order not found" });
  const inst = wo.procedures.find((p) => p.instanceId === req.params.instanceId);
  if (!inst) return res.status(404).json({ error: "Procedure instance not found" });
  const { responses, status } = req.body || {};
  if (responses && typeof responses === "object") {
    inst.responses = { ...inst.responses, ...responses };
  }
  if (status && (status === "in_progress" || status === "complete")) {
    if (status === "complete" && inst.status !== "complete") {
      inst.completedAt = new Date().toISOString();
      logActivity(wo, `Procedure completed: ${inst.name}`);
    }
    if (status === "in_progress" && inst.status === "complete") {
      inst.completedAt = null;
      logActivity(wo, `Procedure reopened: ${inst.name}`);
    }
    inst.status = status;
  }
  wo.updatedAt = new Date().toISOString();
  saveData(data);
  res.json(inst);
});
// ===== PART 1 END =====
// ===== PART 2 START =====
// ===== TICKET 10 PART 2 START =====
// ---------- Auth endpoints ----------

// Tells frontend whether the system has been initialized
app.get("/api/setup-status", (req, res) => {
  const data = loadData();
  res.json({ needsSetup: data.users.length === 0 });
});

// First-admin bootstrap. Only works while users[] is empty.
app.post("/api/setup", async (req, res) => {
  const data = loadData();
  if (data.users.length > 0) {
    return res.status(400).json({ error: "Setup already complete" });
  }
  const { username, password, displayName } = req.body || {};
  if (!username || typeof username !== "string" || !/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
    return res.status(400).json({ error: "Invalid username (2-32 chars: letters, numbers, . _ -)" });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const user = {
      id: uuidv4(),
      username: username.trim(),
      displayName: (displayName && String(displayName).trim()) || username.trim(),
      role: "admin",
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    };
    data.users.push(user);
    const session = createSession(data, user.id);
    saveData(data);
    setSessionCookie(res, session.id);
    res.status(201).json({ user: publicUser(user) });
  } catch (e) {
    console.error("Setup error", e);
    res.status(500).json({ error: "Setup failed" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const data = loadData();
  if (data.users.length === 0) {
    return res.status(400).json({ error: "System not initialized. Complete setup first." });
  }
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }
  const user = findUserByUsername(data, username);
  if (!user) {
    // constant-time-ish to avoid leaking whether username exists
    await bcrypt.compare("dummy", "$2a$10$abcdefghijklmnopqrstuv");
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const ok = await bcrypt.compare(password, user.passwordHash || "");
  if (!ok) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const session = createSession(data, user.id);
  saveData(data);
  setSessionCookie(res, session.id);
  res.json({ user: publicUser(user) });
});

// Logout
app.post("/api/logout", (req, res) => {
  const data = loadData();
  const sid = req.cookies && req.cookies[SESSION_COOKIE];
  if (sid) {
    destroySession(data, sid);
    saveData(data);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Who am I
app.get("/api/me", (req, res) => {
  const data = loadData();
  const user = getSessionUser(data, req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  res.json({ user: publicUser(user) });
});

// ===== TICKET 10 PART 2 END =====
// ---------- AI: Procedure Generator (existing) ----------
const AI_PROCEDURE_SYSTEM_PROMPT = `You are an expert in industrial maintenance, safety inspections, and equipment service procedures. You design checklist-style procedures used by technicians.

When given a description of a procedure to create, respond with ONLY a single JSON object (no prose, no markdown fences) with this exact shape:

{
  "name": "Short procedure title (5-60 chars)",
  "description": "One-sentence description of what this procedure covers",
  "fields": [
    { "type": "<one of: checkbox|text|number|passfail|date|signature|photo>", "label": "Field label", "required": true|false }
  ]
}

Rules:
- Choose the most appropriate field type for each step:
  * "checkbox" for simple yes/done items
  * "passfail" for inspection items that can pass or fail
  * "number" for measurements and counts
  * "text" for short free-form notes
  * "date" for dates
  * "signature" for sign-offs (typically 1-2 at the end)
  * "photo" for visual evidence
- Mark "required: true" for safety-critical items and any signature fields. Otherwise required: false.
- Aim for 8-20 fields total. Order them logically (pre-checks → main inspection → measurements → sign-off).
- Be specific and industry-realistic. Output ONLY the JSON object.`;

async function callAnthropic(body, timeoutMs = 30000) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured on the server");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!r.ok) {
      const errText = await r.text();
      throw new Error("Anthropic " + r.status + ": " + errText.slice(0, 200));
    }
    return await r.json();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

app.post("/api/procedures/generate", async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "prompt (string) required" });
  if (prompt.length > 1000) return res.status(400).json({ error: "prompt too long (max 1000 chars)" });
  try {
    const data = await callAnthropic({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      system: AI_PROCEDURE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: "Create a procedure for: " + prompt }],
    });
    const text = (data.content && data.content[0] && data.content[0].text) || "";
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    let parsed;
    try { parsed = JSON.parse(jsonStr); }
    catch (e) {
      console.error("Failed to parse AI JSON:", text);
      return res.status(502).json({ error: "AI returned non-JSON response" });
    }
    const name = typeof parsed.name === "string" ? parsed.name.slice(0, 100) : "Generated Procedure";
    const description = typeof parsed.description === "string" ? parsed.description.slice(0, 500) : "";
    const rawFields = Array.isArray(parsed.fields) ? parsed.fields : [];
    const fields = rawFields.slice(0, 50).map((f) => ({
      type: ALLOWED_FIELD_TYPES.includes(f && f.type) ? f.type : "checkbox",
      label: (f && typeof f.label === "string" ? f.label : "Untitled field").slice(0, 200),
      required: !!(f && f.required),
    }));
    res.json({ name, description, fields });
  } catch (e) {
    console.error("Generate failed", e);
    if (e.name === "AbortError") return res.status(504).json({ error: "AI request timed out" });
    return res.status(500).json({ error: e.message });
  }
});

// ---------- AI Assistant (tool use) ----------
const ASSISTANT_SYSTEM_PROMPT = `You are the WorkOrder Pro AI assistant. You help maintenance technicians and supervisors manage work orders and procedures by calling tools.

GENERAL BEHAVIOR:
- Be concise. Maintenance staff are busy — short, useful answers, not paragraphs.
- When the user asks for something actionable, call the appropriate tool. Don't just describe what you would do.
- When listing items, summarize don't dump. "You have 5 open work orders, 2 high priority. The hydraulic forklift one looks urgent." not a giant table.
- After completing an action, briefly confirm what was done.
- If a request is ambiguous (e.g. "delete the work order" but multiple match), ask which one before calling a tool.
- For destructive actions (delete_work_order, detach_procedure), call the tool — the system will pause for user confirmation automatically.

WORK ORDER FIELDS:
- status: "open" | "in_progress" | "complete"
- priority: "low" | "medium" | "high" | "urgent"
- assignee: free-text name (current users are "bill" and "serina")
- customerName: free-text customer name (e.g. "Acme Corp")
- workType: "" | "repair" | "install" | "maintenance" | "inspection"
- asset: { name, serialNumber, unitNumber, hours, make, model } — the equipment being worked on; hours captured at time of WO creation
- parts: list of { partNumber, description, quantity, unitCost, lineTotal } — line items
- labor: list of { technician, date, hours, hourlyRate, lineTotal } — all labor is billable
- otherCosts: list of { description, amount } — travel, fees, subcontractors, etc.
- totals: { parts, labor, other, grand } — server-computed in CAD; never set directly

CURRENCY: All money values are CAD. No tax handling.

TOOLS FOR LINE ITEMS:
- Use add_part / add_labor / add_other_cost to append a single row to a work order.
- Use remove_part / remove_labor / remove_other_cost to delete a row by its row id (DESTRUCTIVE — system will confirm).
- Use set_work_order_customer / set_work_order_asset / set_work_order_work_type for those header fields.
- create_work_order and update_work_order also accept customerName, workType, and asset directly.

PROCEDURES:
- A procedure is a reusable checklist template with fields (checkbox, text, number, passfail, date, signature, photo).
- Attaching a procedure to a work order takes a snapshot at that moment.
- When asked to "create and attach a procedure" for a work order, you may use create_procedure_from_description which creates AND attaches in one step.

Always use real IDs from list/get tools — never invent IDs.`;

// ---------- Tool registry ----------
// Each tool: { name, description, input_schema, run(input) -> string|object, destructive? }
const TOOLS = [
  {
    name: "list_work_orders",
    description: "List all work orders. Returns id, title, status, priority, assignee, and number of attached procedures for each.",
    input_schema: { type: "object", properties: {}, required: [] },
    run: () => {
      const data = loadData();
      return data.workorders.map(w => ({
        id: w.id, title: w.title, status: w.status, priority: w.priority,
        assignee: w.assignee, procedureCount: (w.procedures || []).length,
      }));
    },
  },
  {
    name: "get_work_order",
    description: "Get full details of a single work order, including its description, attached procedures, responses, and activity log.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: ({ id }) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === id);
      if (!w) throw new Error("Work order not found: " + id);
      return w;
    },
  },
  {
    name: "create_work_order",
    description: "Create a new work order. Returns the new work order with its id. May include customer, asset, and work type at creation time.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the work order" },
        description: { type: "string", description: "Detailed description of the work needed" },
        status: { type: "string", enum: ["open", "in_progress", "complete"], description: "Defaults to 'open'" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Defaults to 'medium'" },
        assignee: { type: "string", description: "Person assigned. Optional." },
        customerName: { type: "string", description: "Free-text customer name. Optional." },
        workType: { type: "string", enum: ["", "repair", "install", "maintenance", "inspection"], description: "Optional." },
        asset: {
          type: "object",
          description: "Equipment being worked on. Optional.",
          properties: {
            name: { type: "string" },
            serialNumber: { type: "string" },
            unitNumber: { type: "string" },
            hours: { type: "number" },
            make: { type: "string" },
            model: { type: "string" },
          },
        },
      },
      required: ["title"],
    },
    run: (input) => {
      const data = loadData();
      const wo = {
        id: uuidv4(),
        title: input.title,
        description: input.description || "",
        status: input.status || "open",
        priority: input.priority || "medium",
        assignee: input.assignee || "",
        customerName: "",
        workType: "",
        asset: normalizeAsset({}),
        parts: [],
        labor: [],
        otherCosts: [],
        totals: { parts: 0, labor: 0, other: 0, grand: 0 },
        procedures: [],
        activity: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      applyWorkOrderUpdates(wo, input);
      logActivity(wo, `Work order created via AI assistant: ${wo.title}`);
      data.workorders.push(wo);
      saveData(data);
      return { id: wo.id, title: wo.title, status: wo.status, priority: wo.priority, totals: wo.totals };
    },
  },
  {
    name: "update_work_order",
    description: "Update fields on an existing work order. Only include fields you want to change. May include customer, asset, work type.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["open", "in_progress", "complete"] },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
        assignee: { type: "string" },
        customerName: { type: "string" },
        workType: { type: "string", enum: ["", "repair", "install", "maintenance", "inspection"] },
        asset: {
          type: "object",
          properties: {
            name: { type: "string" },
            serialNumber: { type: "string" },
            unitNumber: { type: "string" },
            hours: { type: "number" },
            make: { type: "string" },
            model: { type: "string" },
          },
        },
      },
      required: ["id"],
    },
    run: (input) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === input.id);
      if (!w) throw new Error("Work order not found: " + input.id);
      const changes = [];
      ["title", "description", "priority", "assignee"].forEach(k => {
        if (input[k] !== undefined && input[k] !== w[k]) {
          changes.push(k);
          w[k] = input[k];
        }
      });
      if (input.status !== undefined && input.status !== w.status) {
        logActivity(w, `Status changed to ${input.status} via AI assistant`);
        w.status = input.status;
        changes.push("status");
      }
      const moreChanges = applyWorkOrderUpdates(w, input);
      moreChanges.forEach(c => { if (!changes.includes(c)) changes.push(c); });
      w.updatedAt = new Date().toISOString();
      saveData(data);
      return { id: w.id, changed: changes, totals: w.totals };
    },
  },
  {
    name: "delete_work_order",
    description: "Permanently delete a work order. DESTRUCTIVE — the system will require user confirmation before running.",
    destructive: true,
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    run: ({ id }) => {
      const data = loadData();
      const idx = data.workorders.findIndex(w => w.id === id);
      if (idx === -1) throw new Error("Work order not found: " + id);
      const [removed] = data.workorders.splice(idx, 1);
      saveData(data);
      return { id: removed.id, title: removed.title, deleted: true };
    },
  },
  {
    name: "list_procedures",
    description: "List all procedures in the library. Returns id, name, description, and field count for each.",
    input_schema: { type: "object", properties: {}, required: [] },
    run: () => {
      const data = loadData();
      return data.procedures.map(p => ({
        id: p.id, name: p.name, description: p.description, fieldCount: (p.fields || []).length,
      }));
    },
  },
  {
    name: "get_procedure",
    description: "Get full details of a single procedure including its fields.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: ({ id }) => {
      const data = loadData();
      const p = data.procedures.find(x => x.id === id);
      if (!p) throw new Error("Procedure not found: " + id);
      return p;
    },
  },
  {
    name: "create_procedure",
    description: "Create a new procedure template. Use this when the user describes specific fields they want.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ALLOWED_FIELD_TYPES },
              label: { type: "string" },
              required: { type: "boolean" },
            },
            required: ["type", "label"],
          },
        },
      },
      required: ["name", "fields"],
    },
    run: (input) => {
      const data = loadData();
      const p = {
        id: uuidv4(),
        name: input.name,
        description: input.description || "",
        fields: (input.fields || []).map(normalizeField),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      data.procedures.push(p);
      saveData(data);
      return { id: p.id, name: p.name, fieldCount: p.fields.length };
    },
  },
  {
    name: "attach_procedure",
    description: "Attach an existing procedure from the library to a work order. Snapshots the procedure structure.",
    input_schema: {
      type: "object",
      properties: {
        workOrderId: { type: "string" },
        procedureId: { type: "string" },
      },
      required: ["workOrderId", "procedureId"],
    },
    run: ({ workOrderId, procedureId }) => {
      const data = loadData();
      const wo = data.workorders.find(w => w.id === workOrderId);
      if (!wo) throw new Error("Work order not found: " + workOrderId);
      const p = data.procedures.find(x => x.id === procedureId);
      if (!p) throw new Error("Procedure not found: " + procedureId);
      const instance = {
        instanceId: uuidv4(),
        procedureId: p.id,
        name: p.name,
        description: p.description,
        fields: p.fields.map(f => ({ ...f })),
        responses: {},
        status: "in_progress",
        attachedAt: new Date().toISOString(),
        completedAt: null,
      };
      wo.procedures.push(instance);
      logActivity(wo, `Procedure attached via AI assistant: ${p.name}`);
      wo.updatedAt = new Date().toISOString();
      saveData(data);
      return { instanceId: instance.instanceId, name: instance.name };
    },
  },
  {
    name: "detach_procedure",
    description: "Detach a procedure instance from a work order. DESTRUCTIVE — system will require user confirmation.",
    destructive: true,
    input_schema: {
      type: "object",
      properties: {
        workOrderId: { type: "string" },
        instanceId: { type: "string" },
      },
      required: ["workOrderId", "instanceId"],
    },
    run: ({ workOrderId, instanceId }) => {
      const data = loadData();
      const wo = data.workorders.find(w => w.id === workOrderId);
      if (!wo) throw new Error("Work order not found");
      const idx = wo.procedures.findIndex(p => p.instanceId === instanceId);
      if (idx === -1) throw new Error("Procedure instance not found");
      const [removed] = wo.procedures.splice(idx, 1);
      logActivity(wo, `Procedure detached via AI assistant: ${removed.name}`);
      wo.updatedAt = new Date().toISOString();
      saveData(data);
      return { detached: removed.name };
    },
  },
  {
    name: "mark_procedure_complete",
    description: "Mark a procedure instance as complete or reopen it.",
    input_schema: {
      type: "object",
      properties: {
        workOrderId: { type: "string" },
        instanceId: { type: "string" },
        status: { type: "string", enum: ["complete", "in_progress"] },
      },
      required: ["workOrderId", "instanceId", "status"],
    },
    run: ({ workOrderId, instanceId, status }) => {
      const data = loadData();
      const wo = data.workorders.find(w => w.id === workOrderId);
      if (!wo) throw new Error("Work order not found");
      const inst = wo.procedures.find(p => p.instanceId === instanceId);
      if (!inst) throw new Error("Procedure instance not found");
      if (status === "complete" && inst.status !== "complete") {
        inst.completedAt = new Date().toISOString();
        logActivity(wo, `Procedure completed via AI assistant: ${inst.name}`);
      }
      if (status === "in_progress" && inst.status === "complete") {
        inst.completedAt = null;
        logActivity(wo, `Procedure reopened via AI assistant: ${inst.name}`);
      }
      inst.status = status;
      wo.updatedAt = new Date().toISOString();
      saveData(data);
      return { instanceId, status };
    },
  },
{
    name: "set_work_order_customer",
    description: "Set the customerName on a work order.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        customerName: { type: "string" },
      },
      required: ["id", "customerName"],
    },
    run: ({ id, customerName }) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === id);
      if (!w) throw new Error("Work order not found: " + id);
      applyWorkOrderUpdates(w, { customerName });
      w.updatedAt = new Date().toISOString();
      logActivity(w, `Customer set to "${customerName}" via AI assistant`);
      saveData(data);
      return { id, customerName: w.customerName };
    },
  },
  {
    name: "set_work_order_asset",
    description: "Set asset fields on a work order. Provide any subset of {name, serialNumber, unitNumber, hours, make, model} — omitted fields are left unchanged.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        serialNumber: { type: "string" },
        unitNumber: { type: "string" },
        hours: { type: "number" },
        make: { type: "string" },
        model: { type: "string" },
      },
      required: ["id"],
    },
    run: (input) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === input.id);
      if (!w) throw new Error("Work order not found: " + input.id);
      const merged = { ...w.asset };
      ["name", "serialNumber", "unitNumber", "hours", "make", "model"].forEach(k => {
        if (input[k] !== undefined) merged[k] = input[k];
      });
      applyWorkOrderUpdates(w, { asset: merged });
      w.updatedAt = new Date().toISOString();
      logActivity(w, `Asset updated via AI assistant`);
      saveData(data);
      return { id: input.id, asset: w.asset };
    },
  },
  {
    name: "set_work_order_work_type",
    description: "Set the workType on a work order.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        workType: { type: "string", enum: ["", "repair", "install", "maintenance", "inspection"] },
      },
      required: ["id", "workType"],
    },
    run: ({ id, workType }) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === id);
      if (!w) throw new Error("Work order not found: " + id);
      applyWorkOrderUpdates(w, { workType });
      w.updatedAt = new Date().toISOString();
      logActivity(w, `Work type set to "${workType}" via AI assistant`);
      saveData(data);
      return { id, workType: w.workType };
    },
  },
  {
    name: "add_part",
    description: "Add a single part line item to a work order. Returns the new row including its id and lineTotal (CAD).",
    input_schema: {
      type: "object",
      properties: {
        workOrderId: { type: "string" },
        partNumber: { type: "string" },
        description: { type: "string" },
        quantity: { type: "number" },
        unitCost: { type: "number", description: "Cost per unit in CAD" },
      },
      required: ["workOrderId", "description", "quantity", "unitCost"],
    },
    run: (input) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === input.workOrderId);
      if (!w) throw new Error("Work order not found: " + input.workOrderId);
      const row = normalizePart({
        partNumber: input.partNumber,
        description: input.description,
        quantity: input.quantity,
        unitCost: input.unitCost,
      });
      w.parts.push(row);
      w.totals = computeTotals(w);
      w.updatedAt = new Date().toISOString();
      logActivity(w, `Part added via AI assistant: ${row.description} (qty ${row.quantity})`);
      saveData(data);
      return { row, totals: w.totals };
    },
  },
  {
    name: "remove_part",
    description: "Remove a part line item from a work order by its row id. DESTRUCTIVE — system will require user confirmation.",
    destructive: true,
    input_schema: {
      type: "object",
      properties: {
        workOrderId: { type: "string" },
        partId: { type: "string" },
      },
      required: ["workOrderId", "partId"],
    },
    run: ({ workOrderId, partId }) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === workOrderId);
      if (!w) throw new Error("Work order not found: " + workOrderId);
      const idx = w.parts.findIndex(p => p.id === partId);
      if (idx === -1) throw new Error("Part not found: " + partId);
      const [removed] = w.parts.splice(idx, 1);
      w.totals = computeTotals(w);
      w.updatedAt = new Date().toISOString();
      logActivity(w, `Part removed via AI assistant: ${removed.description}`);
      saveData(data);
      return { removed, totals: w.totals };
    },
  },
  {
    name: "add_labor",
    description: "Add a single labor line item to a work order. All labor is billable. Returns the new row in CAD.",
    input_schema: {
      type: "object",
      properties: {
        workOrderId: { type: "string" },
        technician: { type: "string" },
        date: { type: "string", description: "ISO date string (YYYY-MM-DD)" },
        hours: { type: "number" },
        hourlyRate: { type: "number", description: "CAD per hour" },
      },
      required: ["workOrderId", "hours", "hourlyRate"],
    },
    run: (input) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === input.workOrderId);
      if (!w) throw new Error("Work order not found: " + input.workOrderId);
      const row = normalizeLabor({
        technician: input.technician,
        date: input.date,
        hours: input.hours,
        hourlyRate: input.hourlyRate,
      });
      w.labor.push(row);
      w.totals = computeTotals(w);
      w.updatedAt = new Date().toISOString();
      logActivity(w, `Labor added via AI assistant: ${row.hours}h @ $${row.hourlyRate}/h`);
      saveData(data);
      return { row, totals: w.totals };
    },
  },
  {
    name: "remove_labor",
    description: "Remove a labor line item from a work order by its row id. DESTRUCTIVE — system will require user confirmation.",
    destructive: true,
    input_schema: {
      type: "object",
      properties: {
        workOrderId: { type: "string" },
        laborId: { type: "string" },
      },
      required: ["workOrderId", "laborId"],
    },
    run: ({ workOrderId, laborId }) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === workOrderId);
      if (!w) throw new Error("Work order not found: " + workOrderId);
      const idx = w.labor.findIndex(l => l.id === laborId);
      if (idx === -1) throw new Error("Labor entry not found: " + laborId);
      const [removed] = w.labor.splice(idx, 1);
      w.totals = computeTotals(w);
      w.updatedAt = new Date().toISOString();
      logActivity(w, `Labor removed via AI assistant: ${removed.hours}h`);
      saveData(data);
      return { removed, totals: w.totals };
    },
  },
  {
    name: "add_other_cost",
    description: "Add a single other-cost line item to a work order (travel, fees, subcontractors, etc.) in CAD.",
    input_schema: {
      type: "object",
      properties: {
        workOrderId: { type: "string" },
        description: { type: "string" },
        amount: { type: "number" },
      },
      required: ["workOrderId", "description", "amount"],
    },
    run: (input) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === input.workOrderId);
      if (!w) throw new Error("Work order not found: " + input.workOrderId);
      const row = normalizeOtherCost({
        description: input.description,
        amount: input.amount,
      });
      w.otherCosts.push(row);
      w.totals = computeTotals(w);
      w.updatedAt = new Date().toISOString();
      logActivity(w, `Other cost added via AI assistant: ${row.description} ($${row.amount})`);
      saveData(data);
      return { row, totals: w.totals };
    },
  },
  {
    name: "remove_other_cost",
    description: "Remove an other-cost line item from a work order by its row id. DESTRUCTIVE — system will require user confirmation.",
    destructive: true,
    input_schema: {
      type: "object",
      properties: {
        workOrderId: { type: "string" },
        costId: { type: "string" },
      },
      required: ["workOrderId", "costId"],
    },
    run: ({ workOrderId, costId }) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === workOrderId);
      if (!w) throw new Error("Work order not found: " + workOrderId);
      const idx = w.otherCosts.findIndex(o => o.id === costId);
      if (idx === -1) throw new Error("Other cost not found: " + costId);
      const [removed] = w.otherCosts.splice(idx, 1);
      w.totals = computeTotals(w);
      w.updatedAt = new Date().toISOString();
      logActivity(w, `Other cost removed via AI assistant: ${removed.description}`);
      saveData(data);
      return { removed, totals: w.totals };
    },
  },
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map(t => [t.name, t]));
const TOOL_DEFS_FOR_API = TOOLS.map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

// ---------- /api/assistant ----------
// Body: { messages: [{role, content}, ...], confirmedToolUseIds?: [string] }
// Returns: { messages: [...], pendingConfirmations: [{toolUseId, name, input, description}], assistantText: string, toolEvents: [{name, input, result|error}] }
app.post("/api/assistant", async (req, res) => {
  const { messages: incoming, confirmedToolUseIds } = req.body || {};
  if (!Array.isArray(incoming) || !incoming.length) return res.status(400).json({ error: "messages array required" });
  const confirmed = new Set(Array.isArray(confirmedToolUseIds) ? confirmedToolUseIds : []);

  const messages = JSON.parse(JSON.stringify(incoming)); // local working copy
  const toolEvents = [];
  const pendingConfirmations = [];

  // Replay confirmed destructive tool calls: scan history for prior pending tool_results,
  // find their matching tool_use blocks, run them now, and rewrite the tool_result content.
  if (confirmed.size > 0) {
    for (const msg of messages) {
      if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block.type !== "tool_result" || !confirmed.has(block.tool_use_id)) continue;
        // Find the tool_use definition in any earlier assistant message
        let toolUse = null;
        for (const m of messages) {
          if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
          const found = m.content.find(b => b.type === "tool_use" && b.id === block.tool_use_id);
          if (found) { toolUse = found; break; }
        }
        if (!toolUse) continue;
        const tool = TOOL_BY_NAME[toolUse.name];
        if (!tool) continue;
        try {
          const result = tool.run(toolUse.input || {});
          toolEvents.push({ name: toolUse.name, input: toolUse.input, result, confirmed: true });
          block.content = JSON.stringify(result).slice(0, 8000);
          block.is_error = false;
        } catch (e) {
          toolEvents.push({ name: toolUse.name, input: toolUse.input, error: e.message, confirmed: true });
          block.content = "Error: " + e.message;
          block.is_error = true;
        }
      }
    }
  }

  const startTs = Date.now();
  const TIMEOUT_MS = 60_000;
  const MAX_LOOPS = 8;

  try {
    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      if (Date.now() - startTs > TIMEOUT_MS) throw new Error("Assistant turn timed out");

      const apiResp = await callAnthropic({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        system: ASSISTANT_SYSTEM_PROMPT,
        tools: TOOL_DEFS_FOR_API,
        messages,
      }, 30_000);

      // Append assistant message to history
      messages.push({ role: "assistant", content: apiResp.content });

      if (apiResp.stop_reason !== "tool_use") {
        // Done — no more tool calls requested
        break;
      }

      // Process each tool_use block
      const toolUseBlocks = (apiResp.content || []).filter(b => b.type === "tool_use");
      const toolResults = [];
      let pausedForConfirmation = false;

      for (const tu of toolUseBlocks) {
        const tool = TOOL_BY_NAME[tu.name];
        if (!tool) {
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Error: unknown tool " + tu.name, is_error: true });
          continue;
        }

        // Destructive tools require explicit confirmation
        if (tool.destructive && !confirmed.has(tu.id)) {
          pendingConfirmations.push({
            toolUseId: tu.id,
            name: tu.name,
            input: tu.input,
            description: tool.description.split(".")[0],
          });
          // Tell the model the user must confirm; do not actually execute
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: "PENDING USER CONFIRMATION. The user will be asked to approve this destructive action before it runs. End your turn now and wait.",
          });
          pausedForConfirmation = true;
          continue;
        }

        try {
          const result = tool.run(tu.input || {});
          toolEvents.push({ name: tu.name, input: tu.input, result });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(result).slice(0, 8000),
          });
        } catch (e) {
          toolEvents.push({ name: tu.name, input: tu.input, error: e.message });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: "Error: " + e.message,
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });

      if (pausedForConfirmation) break;
    }

    // Extract final assistant text
    let assistantText = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && Array.isArray(m.content)) {
        const textBlocks = m.content.filter(b => b.type === "text").map(b => b.text);
        if (textBlocks.length) { assistantText = textBlocks.join("\n"); break; }
      } else if (m.role === "assistant" && typeof m.content === "string") {
        assistantText = m.content; break;
      }
    }

    res.json({ messages, assistantText, toolEvents, pendingConfirmations });
  } catch (e) {
    console.error("Assistant error", e);
    res.status(500).json({ error: e.message });
  }
});
// ===== TICKET 10 PART 3 START =====
// ---------- Users (admin-only) ----------

// List all users (admin-only). Sessions are not exposed.
app.get("/api/users", requireAdmin, (req, res) => {
  const data = req.dataCache || loadData();
  const list = data.users
    .map(publicUser)
    .sort((a, b) => a.username.localeCompare(b.username));
  res.json(list);
});

// Create a new user (admin-only)
app.post("/api/users", requireAdmin, async (req, res) => {
  const data = loadData();
  const { username, password, displayName, role } = req.body || {};
  if (!username || typeof username !== "string" || !/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
    return res.status(400).json({ error: "Invalid username (2-32 chars: letters, numbers, . _ -)" });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: "Role must be admin or tech" });
  }
  if (findUserByUsername(data, username)) {
    return res.status(409).json({ error: "Username already exists" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const user = {
      id: uuidv4(),
      username: username.trim(),
      displayName: (displayName && String(displayName).trim()) || username.trim(),
      role,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    };
    data.users.push(user);
    saveData(data);
    res.status(201).json(publicUser(user));
  } catch (e) {
    console.error("Create user error", e);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Update a user (admin-only). Body may include any of: displayName, role, password.
app.put("/api/users/:id", requireAdmin, async (req, res) => {
  const data = loadData();
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const { displayName, role, password } = req.body || {};

  // Last-admin guard: don't let an admin demote themselves if they're the only admin
  if (role !== undefined && role !== user.role) {
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: "Role must be admin or tech" });
    }
    if (user.role === "admin" && role !== "admin") {
      const adminCount = data.users.filter(u => u.role === "admin").length;
      if (adminCount <= 1) {
        return res.status(400).json({ error: "Cannot demote the last admin" });
      }
    }
    user.role = role;
  }

  if (displayName !== undefined) {
    user.displayName = (String(displayName).trim()) || user.username;
  }

  if (password !== undefined) {
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    user.passwordHash = await bcrypt.hash(password, 10);
    // Invalidate all sessions for this user when password changes
    data.sessions = data.sessions.filter(s => s.userId !== user.id);
  }

  saveData(data);
  res.json(publicUser(user));
});

// Delete a user (admin-only). Cannot delete self or last admin.
app.delete("/api/users/:id", requireAdmin, (req, res) => {
  const data = loadData();
  const idx = data.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  const target = data.users[idx];

  if (req.currentUser && target.id === req.currentUser.id) {
    return res.status(400).json({ error: "Cannot delete your own account" });
  }
  if (target.role === "admin") {
    const adminCount = data.users.filter(u => u.role === "admin").length;
    if (adminCount <= 1) {
      return res.status(400).json({ error: "Cannot delete the last admin" });
    }
  }

  data.users.splice(idx, 1);
  // Invalidate all sessions for the deleted user
  data.sessions = data.sessions.filter(s => s.userId !== target.id);
  saveData(data);
  res.json({ ok: true, removed: publicUser(target) });
});

// ===== TICKET 10 PART 3 END =====
// ---------- Static files (must come AFTER API routes) ----------
app.use(express.static(path.join(__dirname, "public")));

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`WorkOrder Pro listening on ${PORT}`);
});
// ===== PART 2 END =====

