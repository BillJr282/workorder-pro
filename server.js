// server.js — WorkOrder Pro
// Express + uuid + flat-file JSON storage (data.json)
// Routes: /api/workorders (CRUD), /api/procedures (CRUD),
//         attach/detach procedures to work orders, PATCH responses

const express = require("express");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));

// ---------- Data layer ----------
const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
  let data;
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    data = JSON.parse(raw);
  } catch (e) {
    data = {};
  }
  // Backfill shape
  if (!Array.isArray(data.workorders)) data.workorders = [];
  if (!Array.isArray(data.procedures)) data.procedures = [];
  // Backfill per-workorder fields
  data.workorders.forEach((w) => {
    if (!Array.isArray(w.procedures)) w.procedures = [];
    if (!Array.isArray(w.activity)) w.activity = [];
  });
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function logActivity(wo, message) {
  wo.activity = wo.activity || [];
  wo.activity.push({
    id: uuidv4(),
    at: new Date().toISOString(),
    message,
  });
}

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
  const { title, description, status, priority, assignee } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });
  const wo = {
    id: uuidv4(),
    title,
    description: description || "",
    status: status || "open",
    priority: priority || "medium",
    assignee: assignee || "",
    procedures: [],
    activity: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  logActivity(wo, `Work order created: ${title}`);
  data.workorders.push(wo);
  saveData(data);
  res.status(201).json(wo);
});

app.put("/api/workorders/:id", (req, res) => {
  const data = loadData();
  const wo = data.workorders.find((w) => w.id === req.params.id);
  if (!wo) return res.status(404).json({ error: "Not found" });
  const { title, description, status, priority, assignee } = req.body || {};
  if (title !== undefined) wo.title = title;
  if (description !== undefined) wo.description = description;
  if (status !== undefined && status !== wo.status) {
    logActivity(wo, `Status changed to ${status}`);
    wo.status = status;
  }
  if (priority !== undefined) wo.priority = priority;
  if (assignee !== undefined) wo.assignee = assignee;
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

// ---------- Procedures (NEW) ----------
// A procedure is a reusable template:
// { id, name, description, fields: [{id, type, label, required, options?}], createdAt, updatedAt }
// Field types: "checkbox", "text", "number", "passfail"

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
  if (fields !== undefined && Array.isArray(fields)) {
    p.fields = fields.map(normalizeField);
  }
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

function normalizeField(f) {
  const allowed = ["checkbox", "text", "number", "passfail", "date", "signature", "photo"];
  return {
    id: f.id || uuidv4(),
    type: allowed.includes(f.type) ? f.type : "text",
    label: f.label || "Untitled field",
    required: !!f.required,
  };
}

// ---------- Attach / Detach procedures to work orders ----------
// POST /api/workorders/:id/procedures  body: { procedureId }
// Snapshots the procedure structure onto the WO at attach time.

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
    fields: p.fields.map((f) => ({ ...f })), // snapshot
    responses: {}, // fieldId -> value
    status: "in_progress", // in_progress | complete
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

// PATCH responses for a procedure instance (debounced from client)
// body: { responses: { fieldId: value, ... }, status?: "in_progress"|"complete" }
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
// ---------- AI Procedure Generator ----------
const ALLOWED_FIELD_TYPES = ["checkbox", "text", "number", "passfail", "date", "signature", "photo"];

const AI_SYSTEM_PROMPT = `You are an expert in industrial maintenance, safety inspections, and equipment service procedures. You design checklist-style procedures used by technicians.

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
  * "checkbox" for simple yes/done items ("Wear safety glasses", "Wheel chocks placed")
  * "passfail" for inspection items that can pass or fail ("Brake pedal firmness", "Hydraulic hose condition")
  * "number" for measurements and counts ("Tire pressure (PSI)", "Engine hours", "Oil level")
  * "text" for short free-form notes ("Notes", "Observed defects", "Operator name")
  * "date" for dates ("Last service date", "Inspection date")
  * "signature" for sign-offs (typically 1-2 at the end: "Technician signature", "Supervisor signature")
  * "photo" for visual evidence ("Photo of damage", "Before photo", "After photo")
- Mark "required: true" for safety-critical items and any signature fields. Otherwise required: false.
- Aim for 8-20 fields total. Order them logically (pre-checks → main inspection → measurements → sign-off).
- Be specific and industry-realistic. Use real maintenance/inspection terminology.
- Output ONLY the JSON object. No explanation, no code fences.`;

app.post("/api/procedures/generate", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });
  }
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt (string) required" });
  }
  if (prompt.length > 1000) {
    return res.status(400).json({ error: "prompt too long (max 1000 chars)" });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: "user", content: "Create a procedure for: " + prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!r.ok) {
      const errText = await r.text();
      console.error("Anthropic API error", r.status, errText);
      return res.status(502).json({ error: "AI provider error: " + r.status });
    }

    const data = await r.json();
    const text = (data.content && data.content[0] && data.content[0].text) || "";

    // Extract JSON (handle accidental code fences just in case)
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error("Failed to parse AI JSON:", text);
      return res.status(502).json({ error: "AI returned non-JSON response" });
    }

    // Validate + sanitize
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
    clearTimeout(timeoutId);
    if (e.name === "AbortError") {
      return res.status(504).json({ error: "AI request timed out" });
    }
    console.error("Generate failed", e);
    return res.status(500).json({ error: "Generate failed: " + e.message });
  }
});
// ---------- Static files (must come AFTER API routes) ----------
app.use(express.static(path.join(__dirname, "public")));

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`WorkOrder Pro listening on ${PORT}`);
});
