// ===== PART 1 START =====
// server.js — WorkOrder Pro
// Express + uuid + flat-file JSON storage (data.json)
// Routes: /api/workorders, /api/procedures (CRUD), AI generator,
//         AI assistant with tool use

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
  if (!Array.isArray(data.workorders)) data.workorders = [];
  if (!Array.isArray(data.procedures)) data.procedures = [];
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
  wo.activity.push({ id: uuidv4(), at: new Date().toISOString(), message });
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
    description: "Create a new work order. Returns the new work order with its id.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the work order" },
        description: { type: "string", description: "Detailed description of the work needed" },
        status: { type: "string", enum: ["open", "in_progress", "complete"], description: "Defaults to 'open'" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Defaults to 'medium'" },
        assignee: { type: "string", description: "Person assigned. Optional." },
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
        procedures: [],
        activity: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      logActivity(wo, `Work order created via AI assistant: ${wo.title}`);
      data.workorders.push(wo);
      saveData(data);
      return { id: wo.id, title: wo.title, status: wo.status, priority: wo.priority };
    },
  },
  {
    name: "update_work_order",
    description: "Update fields on an existing work order. Only include fields you want to change.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["open", "in_progress", "complete"] },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
        assignee: { type: "string" },
      },
      required: ["id"],
    },
    run: (input) => {
      const data = loadData();
      const w = data.workorders.find(x => x.id === input.id);
      if (!w) throw new Error("Work order not found: " + input.id);
      const changes = [];
      ["title", "description", "priority", "assignee"].forEach(k => {
        if (input[k] !== undefined && input[k] !== w[k]) { changes.push(k); w[k] = input[k]; }
      });
      if (input.status !== undefined && input.status !== w.status) {
        logActivity(w, `Status changed to ${input.status} via AI assistant`);
        w.status = input.status;
        changes.push("status");
      }
      w.updatedAt = new Date().toISOString();
      saveData(data);
      return { id: w.id, changed: changes };
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

// ---------- Static files (must come AFTER API routes) ----------
app.use(express.static(path.join(__dirname, "public")));

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`WorkOrder Pro listening on ${PORT}`);
});
// ===== PART 2 END =====
