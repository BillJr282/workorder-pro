const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

function load() {
  if (!fs.existsSync(DATA)) {
    const d = { workorders: [], procedures: [], nextId: 1 };
    fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
    return d;
  }
  const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
  if (!d.procedures) d.procedures = [];
  return d;
}
function save(d) { fs.writeFileSync(DATA, JSON.stringify(d, null, 2)); }
function now() { return new Date().toISOString(); }

/* ---------- Work Orders ---------- */

app.get("/api/workorders", (q, r) => r.json(load().workorders));

app.get("/api/workorders/:id", (q, r) => {
  const w = load().workorders.find(x => x.id === q.params.id);
  w ? r.json(w) : r.status(404).json({ error: "Not found" });
});

app.post("/api/workorders", (q, r) => {
  const d = load();
  const w = {
    id: uuidv4(),
    woNumber: "WO-" + String(d.nextId).padStart(4, "0"),
    ...q.body,
    createdAt: now(), updatedAt: now(),
    comments: [], parts: [], procedures: [],
    activity: [{ text: "Created by " + (q.body.assignee || "Bill"), time: now() }]
  };
  d.workorders.push(w); d.nextId++; save(d); r.status(201).json(w);
});

app.put("/api/workorders/:id", (q, r) => {
  const d = load();
  const i = d.workorders.findIndex(x => x.id === q.params.id);
  if (i < 0) return r.status(404).json({ error: "Not found" });
  d.workorders[i] = { ...d.workorders[i], ...q.body, id: q.params.id, updatedAt: now() };
  save(d); r.json(d.workorders[i]);
});

app.delete("/api/workorders/:id", (q, r) => {
  const d = load();
  d.workorders = d.workorders.filter(x => x.id !== q.params.id);
  save(d); r.json({ success: true });
});

app.post("/api/workorders/:id/comments", (q, r) => {
  const d = load();
  const w = d.workorders.find(x => x.id === q.params.id);
  if (!w) return r.status(404).json({ error: "Not found" });
  const c = { id: uuidv4(), author: q.body.author || "Bill", text: q.body.text, time: now() };
  w.comments.push(c);
  w.activity.push({ text: (q.body.author || "Bill") + " added a comment", time: now() });
  w.updatedAt = now();
  save(d); r.json(c);
});

/* ---------- Procedures (NEW) ---------- */

app.get("/api/procedures", (q, r) => r.json(load().procedures));

app.get("/api/procedures/:id", (q, r) => {
  const p = load().procedures.find(x => x.id === q.params.id);
  p ? r.json(p) : r.status(404).json({ error: "Not found" });
});

app.post("/api/procedures", (q, r) => {
  const d = load();
  const p = {
    id: uuidv4(),
    title: q.body.title || "Untitled Procedure",
    description: q.body.description || "",
    sections: Array.isArray(q.body.sections) ? q.body.sections : [],
    createdBy: q.body.createdBy || "Bill",
    createdAt: now(),
    updatedAt: now()
  };
  d.procedures.push(p); save(d); r.status(201).json(p);
});

app.put("/api/procedures/:id", (q, r) => {
  const d = load();
  const i = d.procedures.findIndex(x => x.id === q.params.id);
  if (i < 0) return r.status(404).json({ error: "Not found" });
  d.procedures[i] = {
    ...d.procedures[i],
    title: q.body.title ?? d.procedures[i].title,
    description: q.body.description ?? d.procedures[i].description,
    sections: q.body.sections ?? d.procedures[i].sections,
    updatedAt: now()
  };
  save(d); r.json(d.procedures[i]);
});

app.delete("/api/procedures/:id", (q, r) => {
  const d = load();
  d.procedures = d.procedures.filter(x => x.id !== q.params.id);
  d.workorders.forEach(w => {
    if (Array.isArray(w.procedures)) {
      w.procedures = w.procedures.filter(a => a.procedureId !== q.params.id);
    }
  });
  save(d); r.json({ success: true });
});

/* ---------- Attach / detach procedures to a work order ---------- */

app.post("/api/workorders/:id/procedures", (q, r) => {
  const d = load();
  const w = d.workorders.find(x => x.id === q.params.id);
  if (!w) return r.status(404).json({ error: "Work order not found" });
  const p = d.procedures.find(x => x.id === q.body.procedureId);
  if (!p) return r.status(404).json({ error: "Procedure not found" });

  if (!Array.isArray(w.procedures)) w.procedures = [];

  const fieldCount = (p.sections || []).reduce((n, s) => n + (s.fields || []).length, 0);

  const attachment = {
    attachmentId: uuidv4(),
    procedureId: p.id,
    title: p.title,
    description: p.description,
    sections: JSON.parse(JSON.stringify(p.sections || [])),
    responses: {},
    completed: false,
    completedBy: null,
    completedAt: null,
    attachedAt: now(),
    attachedBy: q.body.attachedBy || "Bill"
  };
  w.procedures.push(attachment);
  w.activity.push({
    text: (q.body.attachedBy || "Bill") +
      " attached procedure \u201C" + p.title + "\u201D (" + fieldCount + " fields)",
    time: now()
  });
  w.updatedAt = now();
  save(d); r.status(201).json(attachment);
});

app.delete("/api/workorders/:id/procedures/:attachmentId", (q, r) => {
  const d = load();
  const w = d.workorders.find(x => x.id === q.params.id);
  if (!w) return r.status(404).json({ error: "Work order not found" });
  const before = (w.procedures || []).length;
  w.procedures = (w.procedures || []).filter(a => a.attachmentId !== q.params.attachmentId);
  if (w.procedures.length === before) return r.status(404).json({ error: "Attachment not found" });
  w.activity.push({ text: "Procedure detached from work order", time: now() });
  w.updatedAt = now();
  save(d); r.json({ success: true });
});

app.patch("/api/workorders/:id/procedures/:attachmentId/responses", (q, r) => {
  const d = load();
  const w = d.workorders.find(x => x.id === q.params.id);
  if (!w) return r.status(404).json({ error: "Work order not found" });
  const a = (w.procedures || []).find(x => x.attachmentId === q.params.attachmentId);
  if (!a) return r.status(404).json({ error: "Attachment not found" });

  a.responses = { ...(a.responses || {}), ...(q.body.responses || {}) };

  if (typeof q.body.completed === "boolean") {
    a.completed = q.body.completed;
    if (q.body.completed) {
      a.completedBy = q.body.completedBy || "Bill";
      a.completedAt = now();
      w.activity.push({
        text: a.completedBy + " completed procedure \u201C" + a.title + "\u201D",
        time: now()
      });
    } else {
      a.completedBy = null;
      a.completedAt = null;
    }
  }

  w.updatedAt = now();
  save(d); r.json(a);
});

/* ---------- Export / Import ---------- */

app.get("/api/export", (q, r) => {
  r.setHeader("Content-Disposition", "attachment; filename=workorder-backup.json");
  r.json(load());
});

app.post("/api/import", (q, r) => {
  save(q.body);
  r.json({ success: true, count: (q.body.workorders || []).length });
});

app.listen(PORT, "0.0.0.0", () => {
  const nets = require("os").networkInterfaces();
  console.log("\n  WorkOrder Pro is running!");
  console.log("  Open this in your browser: http://localhost:" + PORT + "\n");
  for (const n of Object.values(nets).flat())
    if (n.family === "IPv4" && !n.internal)
      console.log("  Others on your network: http://" + n.address + ":" + PORT);
  console.log("");
});
