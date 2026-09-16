// Serves the folder, opens the page in headless Chrome, loads a sample file, prints what was rendered.
// Run: node scripts/check.mjs [samples/weather-agent.json]
import { spawn } from "node:child_process"
import http from "node:http"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const sample = process.argv[2] || "samples/weather-agent.json"
const server = http.createServer((req, res) => {
  const file = req.url.split("?")[0] === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0])
  try { res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : "text/html"); res.end(readFileSync(join(ROOT, file))) }
  catch { res.statusCode = 404; res.end() }
}).listen(4178)
const CHROME = "C:/Users/HARIANTH/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe"
const chrome = spawn(CHROME, ["--headless", "--disable-gpu", "--remote-debugging-port=9334", "http://localhost:4178/"], { stdio: "ignore" })
await new Promise((r) => setTimeout(r, 1500))
const targets = await (await fetch("http://localhost:9334/json")).json()
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl)
let id = 0
const send = (method, params = {}) => new Promise((resolve) => { const me = ++id; const on = (e) => { const m = JSON.parse(e.data); if (m.id === me) { ws.removeEventListener("message", on); resolve(m.result) } }; ws.addEventListener("message", on); ws.send(JSON.stringify({ id: me, method, params })) })
await new Promise((r) => ws.addEventListener("open", r))
await new Promise((r) => setTimeout(r, 800))
// Feed the file through the same load() path the drop zone uses, via a fetch of the served sample.
await send("Runtime.evaluate", { expression: `fetch(${JSON.stringify("/" + sample)}).then(r => r.text()).then(t => { const f = new File([t], ${JSON.stringify(sample)}); const dt = new DataTransfer(); dt.items.add(f); document.getElementById("drop").dispatchEvent(new DragEvent("drop", { dataTransfer: dt })) })`, awaitPromise: true })
await new Promise((r) => setTimeout(r, 800))
const r = await send("Runtime.evaluate", { expression: `JSON.stringify({
  status: document.getElementById("status").textContent,
  title: document.getElementById("treeTitle").textContent,
  rows: [...document.querySelectorAll("#tree .span")].map(r => r.querySelector(".kind").textContent + " " + r.querySelector(".name").textContent + " " + r.querySelector(".time").textContent + " @" + r.style.paddingLeft),
  detail: document.querySelector("#detail h2").textContent,
  facts: [...document.querySelectorAll("#detail .facts div")].map(d => d.textContent),
  headings: [...document.querySelectorAll("#detail h3")].map(h => h.textContent),
})`, returnByValue: true })
const out = JSON.parse(r.result.value)
console.log(JSON.stringify(out, null, 1))
// Click the second LLM span and read its messages.
await send("Runtime.evaluate", { expression: `[...document.querySelectorAll("#tree .span")].filter(r => r.querySelector(".kind").textContent === "LLM")[1].click()` })
const r2 = await send("Runtime.evaluate", { expression: `JSON.stringify({ detail: document.querySelector("#detail h2").textContent, facts: [...document.querySelectorAll("#detail .facts div")].map(d => d.textContent), messages: [...document.querySelectorAll("#detail .msg")].map(m => m.textContent.split(String.fromCharCode(10)).join(" ").trim().slice(0, 90)) })`, returnByValue: true })
console.log(JSON.stringify(JSON.parse(r2.result.value), null, 1))
chrome.kill(); server.close(); process.exit(0)
