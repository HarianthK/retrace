// Deploys, then proves the live site is really serving these files.
// Run: node scripts/deploy.mjs
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SITE = "https://retrace-llm.vercel.app"
const FILES = ["index.html", "app.js", "samples/weather-agent.json"]

const digest = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex").slice(0, 12)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function deployOnce() {
  try {
    execFileSync("vercel", ["deploy", "--prod", "--yes"], { cwd: ROOT, stdio: "pipe", shell: true })
    return null
  } catch (err) {
    const out = String(err.stdout ?? "") + String(err.stderr ?? "")
    const said = out.match(/"message":\s*"([^"]+)"/)
    return said ? said[1] : "deploy failed"
  }
}

// The CLI answers "Not authorized" on a first call often enough to be normal,
// and the same call straight after goes through.
let failure = deployOnce()
if (failure) {
  console.log(`first attempt: ${failure}. Trying once more.`)
  failure = deployOnce()
  if (failure) {
    console.error(`deploy failed twice: ${failure}`)
    process.exit(1)
  }
}
console.log("deployed, now checking what the site actually serves")

const want = new Map(FILES.map((f) => [f, digest(readFileSync(join(ROOT, f), "utf8"))]))
const deadline = Date.now() + 120000
let stale = [...FILES]

while (stale.length && Date.now() < deadline) {
  const still = []
  for (const file of stale) {
    const res = await fetch(`${SITE}/${file}?cache=${Date.now()}`, { cache: "no-store" })
    const live = res.ok ? digest(await res.text()) : "unreachable"
    if (live !== want.get(file)) still.push(file)
  }
  stale = still
  if (stale.length) await sleep(4000)
}

if (stale.length) {
  console.error(`\nthese are still the old copies after two minutes: ${stale.join(", ")}`)
  console.error("the deploy reported success, so do not trust it without looking")
  process.exit(1)
}

for (const file of FILES) console.log(`  matches  ${file}`)
console.log(`\n${SITE} is serving exactly what is in this folder`)
