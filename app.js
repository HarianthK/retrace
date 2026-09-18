// Reads a trace file in any of the common OpenTelemetry JSON shapes, turns it into
// one flat list of spans, and shows the tree. DOCS.md says why each shape is handled.
const drop = document.getElementById("drop")
const fileBox = document.getElementById("file")
const status = document.getElementById("status")
const tracesBar = document.getElementById("traces")
const work = document.getElementById("work")
const tree = document.getElementById("tree")
const treeTitle = document.getElementById("treeTitle")
const detail = document.getElementById("detail")
const findBox = document.getElementById("find")
const findCount = document.getElementById("findCount")

const KIND_COLOR = { LLM: "var(--llm)", TOOL: "var(--tool)", CHAIN: "var(--chain)", AGENT: "var(--agent)", RETRIEVER: "var(--retriever)", EMBEDDING: "var(--retriever)", RERANKER: "var(--retriever)", GUARDRAIL: "var(--bad)", EVALUATOR: "var(--ok)" }

// ---- reading the file ----------------------------------------------------

// The console exporter prints one JSON object after another with no commas between.
function parseLoose(text) {
  text = text.trim()
  try { return JSON.parse(text) } catch {}
  const objects = []
  let depth = 0, start = -1, inString = false, escape = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) { if (escape) escape = false; else if (c === "\\") escape = true; else if (c === '"') inString = false; continue }
    if (c === '"') inString = true
    else if (c === "{") { if (depth++ === 0) start = i }
    else if (c === "}") { if (--depth === 0) objects.push(JSON.parse(text.slice(start, i + 1))) }
  }
  if (!objects.length) throw new Error("This does not look like JSON.")
  return objects
}

const hex = (v) => (typeof v === "string" ? v.replace(/^0x/, "") : v == null ? null : String(v))
const nanos = (v) => Number(BigInt(v) / 1000000n)
const when = (v) => (typeof v === "string" && /^\d+$/.test(v) ? nanos(v) : typeof v === "number" ? v : Date.parse(v))

// OTLP attribute values are wrapped as {stringValue: ...}; unwrap them.
function otlpValue(v) {
  if (v == null) return null
  if ("stringValue" in v) return v.stringValue
  if ("intValue" in v) return Number(v.intValue)
  if ("doubleValue" in v) return v.doubleValue
  if ("boolValue" in v) return v.boolValue
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(otlpValue)
  if ("kvlistValue" in v) return Object.fromEntries((v.kvlistValue.values || []).map((kv) => [kv.key, otlpValue(kv.value)]))
  return null
}

// Phoenix exports keep attributes nested ({llm: {model_name}}); the conventions are dotted keys.
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out)
    else if (Array.isArray(v) && v.some((x) => x && typeof x === "object")) v.forEach((x, i) => (x && typeof x === "object" ? flatten(x, `${key}.${i}`, out) : (out[`${key}.${i}`] = x)))
    else out[key] = v
  }
  return out
}

function fromSdk(s) {
  return {
    id: hex(s.context?.span_id ?? s.span_id), traceId: hex(s.context?.trace_id ?? s.trace_id), parentId: hex(s.parent_id ?? s.parent_span_id),
    name: s.name, start: when(s.start_time), end: when(s.end_time),
    status: (s.status?.status_code ?? s.status_code ?? "UNSET").replace("StatusCode.", ""), message: s.status?.description ?? s.status_message ?? "",
    attrs: flatten(s.attributes), events: s.events || [],
  }
}

function fromOtlp(doc) {
  const out = []
  for (const rs of doc.resourceSpans || []) for (const ss of rs.scopeSpans || rs.instrumentationLibrarySpans || []) for (const s of ss.spans || []) {
    const attrs = Object.fromEntries((s.attributes || []).map((a) => [a.key, otlpValue(a.value)]))
    const code = { 0: "UNSET", 1: "OK", 2: "ERROR", STATUS_CODE_UNSET: "UNSET", STATUS_CODE_OK: "OK", STATUS_CODE_ERROR: "ERROR" }[s.status?.code ?? 0] ?? "UNSET"
    out.push({ id: s.spanId, traceId: s.traceId, parentId: s.parentSpanId || null, name: s.name, start: nanos(s.startTimeUnixNano), end: nanos(s.endTimeUnixNano), status: code, message: s.status?.message ?? "", attrs, events: s.events || [] })
  }
  return out
}

function normalise(doc) {
  if (Array.isArray(doc)) return doc.flatMap(normalise)
  if (doc.resourceSpans) return fromOtlp(doc)
  if (Array.isArray(doc.data)) return doc.data.flatMap(normalise)
  if (Array.isArray(doc.spans)) return doc.spans.flatMap(normalise)
  if (doc.name && (doc.context || doc.span_id)) return [fromSdk(doc)]
  return []
}

// ---- the tree ------------------------------------------------------------

let spans = [], selected = null, shown = []

// A span matches when the text is in its name or in any attribute value.
function matches(s, needle) {
  if (!needle) return true
  if (s.name.toLowerCase().includes(needle)) return true
  return Object.values(s.attrs).some((v) => String(v).toLowerCase().includes(needle))
}

function applyFind() {
  const needle = findBox.value.trim().toLowerCase()
  let hits = 0
  for (const row of tree.children) {
    const s = shown.find((x) => x.id === row.dataset.id)
    const hit = matches(s, needle)
    row.classList.toggle("dim", needle && !hit)
    if (hit) hits++
  }
  findCount.textContent = needle ? `${hits} of ${shown.length}` : ""
}

function traceIds() {
  const seen = new Map()
  for (const s of spans) if (!seen.has(s.traceId)) seen.set(s.traceId, spans.filter((x) => x.traceId === s.traceId))
  return [...seen.entries()].sort((a, b) => Math.min(...a[1].map((s) => s.start)) - Math.min(...b[1].map((s) => s.start)))
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") node.className = v; else if (k === "text") node.textContent = v; else if (k === "style") node.style.cssText = v; else if (k.startsWith("on")) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v) }
  node.append(...children)
  return node
}

const ms = (n) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`)
const kindOf = (s) => (s.attrs["openinference.span.kind"] || "SPAN").toUpperCase()

function showTrace(id, list) {
  const t0 = Math.min(...list.map((s) => s.start)), t1 = Math.max(...list.map((s) => s.end))
  const total = Math.max(1, t1 - t0)
  const byParent = new Map()
  for (const s of list) { const k = list.some((x) => x.id === s.parentId) ? s.parentId : null; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(s) }
  for (const v of byParent.values()) v.sort((a, b) => a.start - b.start)
  const rows = []
  const walk = (parent, depth) => { for (const s of byParent.get(parent) || []) { rows.push([s, depth]); walk(s.id, depth + 1) } }
  walk(null, 0)
  const errors = list.filter((s) => s.status === "ERROR").length
  treeTitle.textContent = `${list.length} spans, ${ms(total)}${errors ? `, ${errors} with errors` : ""}`
  tree.replaceChildren(...rows.map(([s, depth]) => {
    const kind = kindOf(s)
    const row = el("div", { class: "span", style: `padding-left:${6 + depth * 16}px`, onclick: () => select(s) },
      el("span", { class: "kind", style: `background:${KIND_COLOR[kind] || "var(--other)"}`, text: kind }),
      el("span", { class: "name" }, s.status === "ERROR" ? el("b", { text: "! " }) : "", s.name),
      el("span", { class: "time", text: ms(s.end - s.start) }),
      el("div", { class: "bar" }, el("i", { style: `left:${((s.start - t0) / total) * 100}%; width:${Math.max(0.5, ((s.end - s.start) / total) * 100)}%` })),
    )
    row.dataset.id = s.id
    return row
  }))
  work.hidden = false
  shown = list
  applyFind()
  select(rows[0]?.[0] ?? null)
}

// ---- the detail pane -----------------------------------------------------

const pretty = (text) => { try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text } }

// Rebuilds llm.input_messages.N.message.* into a list of messages.
function messages(attrs, prefix) {
  const out = []
  for (const [k, v] of Object.entries(attrs)) {
    const m = k.match(new RegExp(`^${prefix.replace(/\./g, "\\.")}\\.(\\d+)\\.message\\.(.+)$`))
    if (!m) continue
    const msg = (out[+m[1]] ??= { role: "", content: "", contents: [], tool_calls: [] })
    const rest = m[2]
    let mm
    if (rest === "role") msg.role = v
    else if (rest === "content") msg.content = v
    else if ((mm = rest.match(/^contents\.(\d+)\.message_content\.(type|text)$/))) (msg.contents[+mm[1]] ??= {})[mm[2]] = v
    else if ((mm = rest.match(/^tool_calls\.(\d+)\.tool_call\.(.+)$/))) (msg.tool_calls[+mm[1]] ??= {})[mm[2]] = v
    else if (rest === "tool_call_id") msg.tool_call_id = v
  }
  return out.filter(Boolean)
}

function messageBlock(msg) {
  const node = el("div", { class: `msg ${msg.role}` }, el("div", { class: "role", text: msg.role || "message" }))
  for (const c of msg.contents.filter(Boolean)) node.append(el("div", { class: c.type === "reasoning" ? "reasoning" : "", text: c.text ?? "" }))
  if (msg.content) node.append(el("div", { text: msg.content }))
  for (const t of msg.tool_calls.filter(Boolean)) node.append(el("div", { class: "call", text: `${t["function.name"] ?? "tool"}(${t["function.arguments"] ?? ""})` }))
  return node
}

function select(s) {
  selected = s
  for (const row of tree.children) row.classList.toggle("on", row.dataset.id === s?.id)
  if (!s) { detail.replaceChildren(el("h2", { text: "Pick a span" })); return }
  const a = s.attrs
  const facts = [[kindOf(s), "kind"], [ms(s.end - s.start), "took"], [s.status, "status"]]
  if (a["llm.model_name"]) facts.push([a["llm.model_name"], a["llm.provider"] ? `model, ${a["llm.provider"]}` : "model"])
  if (a["llm.token_count.total"] != null) facts.push([`${a["llm.token_count.prompt"] ?? "?"} + ${a["llm.token_count.completion"] ?? "?"} = ${a["llm.token_count.total"]}`, "tokens, in + out"])
  if (a["llm.token_count.prompt_details.cache_read"] != null) facts.push([a["llm.token_count.prompt_details.cache_read"], "from cache"])
  if (a["llm.token_count.completion_details.reasoning"] != null) facts.push([a["llm.token_count.completion_details.reasoning"], "reasoning tokens"])
  if (a["tool.name"]) facts.push([a["tool.name"], "tool"])
  const parts = [el("h2", { text: s.name }), el("div", { class: "facts" }, ...facts.map(([v, l]) => el("div", { class: l === "status" && v === "ERROR" ? "err" : "" }, String(v), el("small", { text: l }))))]
  if (s.message) parts.push(el("pre", { text: s.message }))

  const inMsgs = messages(a, "llm.input_messages"), outMsgs = messages(a, "llm.output_messages")
  if (inMsgs.length) parts.push(el("h3", { text: "Input messages" }), ...inMsgs.map(messageBlock))
  if (outMsgs.length) parts.push(el("h3", { text: "Output messages" }), ...outMsgs.map(messageBlock))
  if (!inMsgs.length && a["input.value"] != null) parts.push(el("h3", { text: "Input" }), el("pre", { text: pretty(String(a["input.value"])) }))
  if (!outMsgs.length && a["output.value"] != null) parts.push(el("h3", { text: "Output" }), el("pre", { text: pretty(String(a["output.value"])) }))

  // Retriever spans carry their hits as retrieval.documents.N.document.*
  const docs = []
  for (const [k, v] of Object.entries(a)) {
    const m = k.match(/^retrieval\.documents\.(\d+)\.document\.(id|content|score)$/)
    if (m) (docs[+m[1]] ??= {})[m[2]] = v
  }
  const hits = docs.filter(Boolean)
  if (hits.length) parts.push(el("h3", { text: `Documents retrieved (${hits.length})` }), ...hits.map((d) => el("div", { class: "msg tool" }, el("div", { class: "role", text: [d.id, d.score != null ? `score ${Number(d.score).toFixed(2)}` : ""].filter(Boolean).join(", ") || "document" }), el("div", { text: d.content ?? "" }))))

  const tools = Object.entries(a).filter(([k]) => /^llm\.tools\.\d+\.tool\.json_schema$/.test(k)).map(([, v]) => v)
  if (tools.length) parts.push(el("h3", { text: `Tools offered (${tools.length})` }), el("pre", { text: tools.map((t) => pretty(String(t))).join("\n\n") }))
  if (a["llm.invocation_parameters"]) parts.push(el("h3", { text: "Invocation parameters" }), el("pre", { text: pretty(String(a["llm.invocation_parameters"])) }))

  const exceptions = s.events.filter((e) => e.name === "exception")
  for (const e of exceptions) { const ea = flatten(e.attributes); parts.push(el("h3", { text: "Exception" }), el("pre", { text: `${ea["exception.type"] ?? ""}: ${ea["exception.message"] ?? ""}\n${ea["exception.stacktrace"] ?? ""}`.trim() })) }

  const shown = /^(openinference\.span\.kind|llm\.(model_name|provider|token_count\..*|input_messages\..*|output_messages\..*|tools\..*|invocation_parameters)|input\.(value|mime_type)|output\.(value|mime_type)|tool\.name|retrieval\.documents\..*)$/
  const rest = Object.entries(a).filter(([k]) => !shown.test(k))
  if (rest.length) parts.push(el("h3", { text: "Other attributes" }), el("table", {}, ...rest.map(([k, v]) => el("tr", {}, el("td", { text: k }), el("td", { text: typeof v === "string" ? v : JSON.stringify(v) })))))
  detail.replaceChildren(...parts)
}

// ---- loading -------------------------------------------------------------

// Several files at once (a folder of exports) become one list; a span that
// appears in two files is kept once, so overlapping exports do not double up.
function load(texts, label) {
  const files = Array.isArray(texts) ? texts : [texts]
  const seen = new Set()
  const problems = []
  spans = []
  for (const [i, text] of files.entries()) {
    try {
      for (const s of normalise(parseLoose(text))) {
        if (!s.id || !s.traceId || seen.has(s.traceId + s.id)) continue
        seen.add(s.traceId + s.id)
        spans.push(s)
      }
    } catch (err) { problems.push(files.length > 1 ? `file ${i + 1}: ${err.message}` : err.message) }
  }
  if (!spans.length) { status.textContent = problems[0] || "No spans found. Retrace reads OpenTelemetry spans as JSON."; return }
  status.textContent = problems.join(" ")
  const traces = traceIds()
  tracesBar.replaceChildren(...(traces.length > 1 ? traces.map(([id, list], i) => el("button", { type: "button", onclick: (e) => { for (const b of tracesBar.children) b.classList.remove("on"); e.currentTarget.classList.add("on"); showTrace(id, list) }, text: `Trace ${i + 1}: ${list.find((s) => !list.some((x) => x.id === s.parentId))?.name ?? id.slice(0, 8)} (${list.length})` })) : []))
  tracesBar.firstChild?.classList.add("on")
  document.title = `Retrace: ${label}`
  showTrace(...traces[0])
}

findBox.addEventListener("input", applyFind)
findBox.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return
  const needle = findBox.value.trim().toLowerCase()
  const first = shown.find((s) => matches(s, needle))
  if (first) select(first)
})
async function loadFiles(list) {
  const files = [...(list || [])].filter((f) => !f.name.startsWith("."))
  if (!files.length) return
  load(await Promise.all(files.map((f) => f.text())), files.length === 1 ? files[0].name : `${files.length} files`)
}
fileBox.addEventListener("change", () => loadFiles(fileBox.files))
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over") })
drop.addEventListener("dragleave", () => drop.classList.remove("over"))
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); loadFiles(e.dataTransfer.files) })
document.getElementById("sample").addEventListener("click", async () => load(await (await fetch("samples/weather-agent.json")).text(), "weather agent sample"))
if (new URLSearchParams(location.search).has("sample")) document.getElementById("sample").click()
