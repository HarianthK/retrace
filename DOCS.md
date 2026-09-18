# Notes on Retrace

## Where the sample came from

`samples/weather-agent.json` was not typed by hand. It was produced by the
OpenTelemetry Python SDK with the OpenInference semantic-conventions package,
building five spans the way an instrumentor would and exporting them with
`span.to_json()`. That keeps the sample honest: the timestamps, ids, the
`StatusCode.` prefixes and the attribute names are exactly what a real
export contains. `samples/weather-agent.otlp.json` is the same five spans
rewritten into OTLP by a short script, so the second reader is checked on the
same data and must produce the same tree.

## Telling the shapes apart

Nothing in the file says which exporter wrote it, so the reader looks at the
outline. A document with `resourceSpans` is OTLP. An object with a `name` and
a `context` or `span_id` is one SDK span; a list is many of them; a `data`
or `spans` list is a Phoenix-style envelope. The console exporter prints
objects back to back with no commas, which is not JSON, so there is a small
scanner that walks the text and cuts it at the top-level braces, skipping
braces inside strings. It is only used when `JSON.parse` fails.

## Attribute names come in two styles

The conventions define dotted keys, and the SDK exports them that way. A
Phoenix export nests them (`{"llm": {"model_name": ...}}`), and OTLP wraps
every value in a typed object (`{"stringValue": ...}`). Everything is
flattened to dotted keys on the way in, so the rest of the page only knows
one style. Messages are then rebuilt from those keys with one regular
expression per message part, which is the reverse of what an instrumentor
does when it emits them.

## What gets its own section

Messages come first when they exist, because that is what a person opening
the file wants to read. `input.value` and `output.value` are shown only when
there are no messages, since for an LLM span they hold the same conversation
as raw JSON. Tools offered, invocation parameters and exception events each
get a section. Everything else goes into a plain table at the bottom, minus
the keys already shown, so nothing in the file is hidden.

## Several files, one list

A day of exports is a folder of files, and the same span can appear in two
of them when a collector rotates files mid-trace. Every dropped file is read
on its own, its spans are added to one list, and a span whose trace id and
span id have been seen already is skipped. A file that does not parse is
named in the status line and the rest still load; the page only refuses when
nothing at all was found. The check drops the SDK sample, the RAG sample and
the OTLP copy of the first together and must show two traces of five and
four spans, not three traces or ten spans.

## The check

`scripts/check.mjs` serves the folder, opens the page in headless Chrome and
drops the file in through the same event the drop zone handles, then reads
the tree rows, the facts and the messages back out of the DOM. Both samples
must give the same tree, the second LLM span must show the cache-read count,
and the guardrail span must carry the error flag. That is the only way the
page has been checked, and it was run before every deploy.
