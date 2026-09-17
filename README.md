# Retrace

Drop in a trace of an LLM app and see what it did. The page reads an
OpenTelemetry trace as JSON and shows the spans as a tree with timing, then
for the span you pick: the model, the token counts, the conversation that was
sent and what came back, the tool calls, the tools that were offered, and any
error. Nothing leaves your browser.

Live at [retrace-llm.vercel.app](https://retrace-llm.vercel.app). Press
"Load the sample" to see a small agent run: two model calls, a tool call and
a guardrail that timed out.

## Why

Tracing an LLM app with OpenTelemetry gives you a file full of spans whose
attributes are dotted keys like `llm.input_messages.2.message.tool_calls.0.tool_call.function.name`.
Phoenix and the other observability tools read those beautifully, but they
need a server running, and often what you have is one JSON file from a test
run or a bug report. I wanted to open that file and read the conversation
without setting anything up.

## What it reads

Three shapes, told apart by their outline:

- What the OpenTelemetry Python SDK's `span.to_json()` produces: one object,
  a list of them, or the objects printed one after another by the console
  exporter with nothing between them.
- OTLP JSON, the `resourceSpans` document the collector's file exporter and
  most SDK JSON exporters write.
- A Phoenix export, where the attributes are nested objects instead of dotted
  keys.

Attributes are read by the [OpenInference](https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md)
conventions when they are present: span kind, model and provider, token
counts with the cache and reasoning details, input and output messages with
their content blocks and tool calls, the tools offered, and the invocation
parameters. A span without them still shows its name, timing, status and
whatever attributes it has.

The find box above the tree searches span names and every attribute value,
messages included, dims the spans that do not match, and Enter jumps to the
first one that does. In a long agent run that is how you get from "which call
mentioned the refund" to the call.

## Running it

Static files, no build. Open the folder from any local web server; the sample
is fetched, so `file://` will not load it.

    npx serve .

`node scripts/check.mjs samples/weather-agent.json` opens the page in headless
Chrome, drops the file in, and prints the tree and the detail pane as text.
`node scripts/deploy.mjs` deploys to Vercel and checks the live files match.

## Notes

See [DOCS.md](DOCS.md) for the reasoning.
