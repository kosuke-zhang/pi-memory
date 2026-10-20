# pi-memory

This fork adds a **hosted SDK API for Pi 1.3.0**. Install this fork's built tarball;
`npm:pi-memory` still refers to upstream. The CLI instructions below describe the
standalone filesystem mode, not the hosted storage contract.

## Hosted applications

```ts
import { createHostedMemoryExtension, MEMORY_TOOLS } from "pi-memory/hosted";

const memory = createHostedMemoryExtension({
  timeZone: "Asia/Shanghai",
  store: studentBoundStore,
});
// Add { name: "pi-memory", factory: memory } to ResourceLoader extensionFactories.
// Include MEMORY_TOOLS in the SDK tool allowlist and initial active tools.
```

Create the extension through its factory for every AgentSession. Bind the store
to the authenticated student on the server; never let model arguments choose a
student, path or namespace. Sessions of the same student share a store.

`MemoryStore.read(operation?, signal?)` returns `{ revision, files, result? }`.
`files` contains Markdown documents and recovery JSON. If an operation already
committed, `result` is its original tool result. The host must durably reserve
each operation on its first read, enforce authorization/budget, and reject reuse
of an id with a different signature. Context reads have no operation but still
require authorization.

`commit(revision, files, operation, result, signal?)` must atomically validate
the current execution authorization, check the operation reservation/signature,
compare the revision, and save **all documents plus the result receipt**.
A replay returns the original result. Conflicts return `{ committed: false }`.
Successful commits return `{ committed: true, result }`. Keep receipts for the
entire execution/replay window. Only explicit CAS conflicts retry (four attempts);
unknown commit outcomes and transport failures propagate.

Hosted behavior:

- Reuses the Markdown mutation logic for long-term memory, daily logs,
  scratchpad, atomic forget/recovery and repeatable restore.
- Fresh bounded memory enters Pi's transient `context` hook as untrusted
  user-channel data; it is not copied into persisted session messages.
- Literal keyword search supports Chinese substrings and excludes recovery
  documents. Hosted mode does **not** run QMD or provide semantic search.
- No exit summary, background model calls, timers, shell processes or disk I/O.
  Writes happen inside the main agent's ordinary tool loop.
- No whole-document overwrite; correct obsolete facts with forget and append.
- Limits: 512 documents, 128 KiB per document, 1 MiB total. Capacity failures
  are explicit. Forget removes active memory, not recovery or conversation history.

The process environment is not a tenant-switching API. Runtime state is
instance-owned via `createMemoryRuntime()`, but standalone filesystem mode does
not coordinate distributed writers. Hosted applications must use the store above.

Build and verify without external model calls:

```sh
npm ci --ignore-scripts
npm run build
npm test                         # requires Bun
npm run test:hosted
npm pack
```

The package ships JavaScript/declarations for direct SDK imports. Build before
loading a local checkout. Historical module-global helper exports and old SDK
aliases are not retained.

## Standalone CLI

[![npm version](https://img.shields.io/npm/v/pi-memory?color=cb3837&logo=npm)](https://www.npmjs.com/package/pi-memory)
[![npm downloads](https://img.shields.io/npm/dm/pi-memory?color=cb3837&logo=npm)](https://www.npmjs.com/package/pi-memory)
[![license](https://img.shields.io/npm/l/pi-memory)](LICENSE)

**The most popular memory extension for [pi](https://github.com/earendil-works/pi/)** — listed in the [official pi package directory](https://pi.dev/packages?name=pi-memory), with semantic search powered by [qmd](https://github.com/tobi/qmd).

Thanks to https://github.com/skyfallsin/pi-mem for inspiration.

Your coding agent forgets everything between sessions. pi-memory gives it a memory: durable facts and decisions, a running daily log, and a scratchpad of things to come back to — all as plain markdown files you can read, edit, and commit. With optional [qmd](https://github.com/tobi/qmd) it also gets keyword, semantic, and hybrid **search** across everything it has ever remembered.

## What it feels like

```text
# Session 1
you ▸ I always use pnpm in this repo, never npm. Remember that.
pi  ▸ Got it — saved to long-term memory.   (writes MEMORY.md)

# …days later, brand new session…
you ▸ add prettier as a dev dependency
pi  ▸ pnpm add -D prettier
      (recalled your package-manager preference from memory — no reminder needed)
```

Everything lives in `~/.pi/agent/memory/` as markdown, so you can also just `cat` it:

```bash
$ cat ~/.pi/agent/memory/MEMORY.md
<!-- 2026-06-07 10:12:03 [a1b2c3d4] -->
#preference [[package-manager]] Always use pnpm in this repo, never npm.
```

## Installation

```bash
# Install from npm (recommended)
pi install npm:pi-memory

# …or from a local checkout
pi install ./pi-memory
```

That's it — the six core tools (`memory_write`, `memory_forget`, `memory_restore`,
`memory_read`, `scratchpad`, `memory_status`) work immediately with no other setup.
Search is opt-in below.

### Optional: enable search with qmd

`memory_search` (and selective injection) need [qmd](https://github.com/tobi/qmd). Either install method works:

```bash
npm install -g @tobilu/qmd                      # no Bun required
bun install -g https://github.com/tobi/qmd      # ensure ~/.bun/bin is on PATH
```

When qmd is present, the extension **automatically creates** the `pi-memory`
collection and path contexts on the next session start — no manual step. Run
`memory_status` any time to confirm qmd, the collection, and embeddings are ready.

Semantic/deep modes need vector embeddings; the extension keeps them current
automatically (`qmd embed` runs in the background at session start and after
writes). The very first embed downloads the embedding model, so semantic search
may take a minute to come online on a fresh install. To set the collection up
by hand:

```bash
qmd collection add ~/.pi/agent/memory --name pi-memory
qmd context add /daily "Daily append-only work logs organized by date" -c pi-memory
qmd context add / "Curated long-term memory: decisions, preferences, facts, lessons" -c pi-memory
qmd embed
```

Without qmd, the core tools still work fully — only `memory_search` and selective injection require it.

## Tools

| Tool | Description |
|------|-------------|
| `memory_write` | Write to MEMORY.md (long-term) or daily log |
| `memory_forget` | Delete matching entries and create a durable recovery record |
| `memory_restore` | Restore a deletion using the recovery ID returned by `memory_forget` |
| `memory_read` | Read any memory file or list daily logs |
| `scratchpad` | Add/done/undo/clear/list checklist items |
| `memory_search` | Search across all memory files (requires qmd) |
| `memory_status` | Health check: where files live, qmd/collection/embeddings state, active config |

### memory_search modes

| Mode | Speed | Method | Best for |
|------|-------|--------|----------|
| `keyword` | ~30ms | BM25 | Specific terms, dates, names, #tags, [[links]] |
| `semantic` | ~2s | Vector search | Related concepts, different wording |
| `deep` | ~10s | Hybrid + reranking | When other modes miss |

If the first search doesn't find what you need, try rephrasing or switching modes.

## File layout

```
~/.pi/agent/memory/
  MEMORY.md              # Curated long-term memory
  SCRATCHPAD.md           # Checklist of things to fix/remember
  daily/
    2026-02-15.md         # Daily append-only log
    2026-02-14.md
    ...
  recovery/
    <recovery-id>.json    # Complete payload and restore state for a memory_forget deletion
```

## How it works

### Context injection

Before every agent turn, the following are injected into the system prompt (in priority order):

1. **Open scratchpad items** (up to 2K chars)
2. **Today's daily log** (up to 3K chars, tail)
3. **MEMORY.md** (up to 4K chars, middle-truncated)
4. **Yesterday's daily log** (up to 3K chars, tail — lowest priority, trimmed first)

Total injection is capped at 16K chars.

### KV cache-stable snapshot (default)

Local prefix-caching runtimes (llama.cpp, vLLM, MLX) invalidate from the first divergent token onward. If the injected memory block changes turn-to-turn, every subsequent user / assistant / tool token gets reprocessed — effectively the entire conversation history each turn.

To keep the prefix byte-stable, the extension snapshots the memory context at deliberate checkpoints and emits the same bytes for every turn in between. Snapshots refresh on:

- **`session_start`** — fresh snapshot per session
- **`session_before_compact`** — handoff is written then snapshot refreshes (one intentional cache boundary at compaction)
- **`session_start`** is the only checkpoint in `stable` mode. Long-term writes and day rollovers do **not** re-render the block: a refresh rewrites the tail of the system prompt and voids the prefix cache for the whole conversation, which is the cost the snapshot exists to avoid, paid on the most common in-session event. The written fact is already in tool-call history, and `memory_read` / `memory_search` reach the files directly.
- **Deletions and restores** intentionally refresh the snapshot. These are rare, authority-changing operations: forgotten content must disappear from the prompt immediately, and pi does not copy deleted content into a persisted correction message merely to preserve the cache.
- Set `PI_MEMORY_SNAPSHOT=refresh` for the old behaviour (refresh on long-term write and day rollover, with a `Snapshot <reason> at <hh:mm:ss>` caveat line).

`memory_write` with `target: daily` and `scratchpad` writes do **not** mark dirty — they're high-frequency and the write content is already echoed via tool-call args. The model can always call `memory_read` / `memory_search` for the authoritative latest state.

Set `PI_MEMORY_SNAPSHOT=per-turn` to opt out and restore the old per-turn rebuild behavior, including automatic per-prompt qmd search injection.

### Selective injection (opt-in via `per-turn` mode)

When `PI_MEMORY_SNAPSHOT=per-turn` is set and qmd is available, the extension automatically searches memory using the user's prompt before each turn. The top 3 keyword results are injected alongside the standard context. This surfaces relevant past decisions without an explicit `memory_search` call, at the cost of busting the KV cache every turn (the search is prompt-dependent and cannot be cached).

The search has a 3-second timeout and fails silently. In the default `stable` mode, the model gets the same capability by calling `memory_search` on demand.

### Tags and links

Use `#tags` and `[[wiki-links]]` in memory content to improve searchability:

```markdown
#decision [[database-choice]] Chose PostgreSQL for all backend services.
#preference [[editor]] User prefers Neovim with LazyVim config.
#lesson [[api-versioning]] URL prefix versioning (/v1/) avoids CDN cache issues.
```

These are content conventions, not enforced metadata. qmd's full-text indexing makes them searchable for free.

### Session handoff

When the context window compacts, the extension automatically captures a handoff entry in today's daily log:

```markdown
<!-- HANDOFF 2026-02-15 14:30:00 [a1b2c3d4] -->
## Session Handoff
**Open scratchpad items:**
- [ ] Fix auth bug
- [ ] Review PR #42
**Recent daily log context:**
...last 15 lines of today's log...
```

This ensures in-progress context survives compaction and is visible in the next turn (via today's daily log injection).

### Other behavior

- **Persistence**: Memory files are plain markdown on disk — readable, editable, and git-friendly.
- **Recoverable deletion**: `memory_forget` stores complete deleted entries under `recovery/` before changing memory and returns a recovery ID that `memory_restore` can use. Recovery JSON is outside qmd's `**/*.md` index.
- **Tool response previews**: Write/scratchpad tools return size-capped previews instead of full file contents.
- **qmd auto-setup**: On first session start with qmd available, the extension creates the collection and path contexts automatically.
- **qmd re-indexing**: After every write, a debounced `qmd update` runs in the background (fire-and-forget, non-blocking) unless disabled via `PI_MEMORY_QMD_UPDATE`.
- **qmd embeddings**: Vector embeddings for semantic/deep search are kept current automatically — `qmd embed` (incremental) runs in the background after each re-index and as a catch-up at session start. Disabled along with re-indexing via `PI_MEMORY_QMD_UPDATE`.
- **Graceful degradation**: If qmd is not installed, core tools work fine. `memory_search` returns install instructions.

### Configuration

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `PI_MEMORY_DIR` | path | `~/.pi/agent/memory` | Override the memory storage directory |
| `PI_MEMORY_SNAPSHOT` | `stable`, `refresh`, `per-turn` | `stable` | `stable` snapshots once at session start and never re-renders it (deletions append a correction); `refresh` also re-renders on long-term writes and day rollover; `per-turn` rebuilds every turn (legacy behavior) |
| `PI_MEMORY_QMD_UPDATE` | `background`, `manual`, `off` | `background` | Controls automatic `qmd update` + `qmd embed` after writes |
| `PI_MEMORY_QMD_SEARCH_TIMEOUT_MS` | positive integer (milliseconds) | `60000` | Sets the timeout for explicit `memory_search` qmd queries |
| `PI_MEMORY_EMBED_PROBE_TIMEOUT_MS` | positive integer (milliseconds) | `15000` | Sets the timeout for the `memory_status` embeddings readiness probe. Raise it on slower machines if the probe reports `unknown` |
| `PI_MEMORY_NO_SEARCH` | `1` | unset | Disable selective injection in `per-turn` mode (no effect in `stable` mode) |
| `PI_MEMORY_SUMMARIZE_TRANSITIONS` | `1`, `true`, `yes`, `on` | unset | Also write exit summaries during lifecycle transitions (`/reload`, `/new`, `/resume`, `/fork`). By default these transitions skip summaries for speed. |
| `PI_MEMORY_EXIT_SUMMARY` | `0`, `off`, `false`, `no` to disable | unset (enabled) | Disable the exit summary on real quit (Ctrl+D, `/quit`, session end). Quitting then does no LLM call and no `qmd update`, so it is instant; explicit `memory_write` during sessions is unaffected. |
| `PI_MEMORY_EXIT_SUMMARY_MODEL` | `provider/model-id` | unset (session model) | Model used to write the exit summary, e.g. a cheaper/faster one. Unresolvable specs fall back to the session model with a warning. |
| `PI_MEMORY_EXIT_SUMMARY_REASONING_EFFORT` | `minimal`/`low`/`medium`/`high`/`xhigh`/`max`/`none`/`off` | `low` | Reasoning effort for the exit-summary LLM call. Some providers reject certain values (e.g. Baseten GLM-5.2 only accepts `high`/`max`/`none` and returns HTTP 400 for `low`, silently breaking exit summaries). Set this to a value your `PI_MEMORY_EXIT_SUMMARY_MODEL` accepts. Use `off` to omit the parameter and let the provider apply its own default. |
| `PI_MEMORY_EXIT_SUMMARY_TIMEOUT_MS` | positive integer (milliseconds) | `10000` | Self-imposed timeout for exit-summary generation on quit. Pi awaits shutdown handlers with no timeout, so a hanging provider would otherwise block quitting indefinitely. On expiry nothing is persisted. |

## Troubleshooting

Run the `memory_status` tool first — it reports most of these at a glance.

| Symptom | Cause | Fix |
|---------|-------|-----|
| `memory_search` says qmd is required | qmd not installed or not on `PATH` | Install qmd (`npm install -g @tobilu/qmd`); if installed via Bun, ensure `~/.bun/bin` is on `PATH` |
| Search returns nothing for terms you know exist | Index is stale | A background `qmd update` runs after writes; if disabled (`PI_MEMORY_QMD_UPDATE=off`), run `qmd update` manually |
| “need embeddings” on semantic/deep search | Vectors not built yet | Embedding starts automatically in the background — retry shortly. If `PI_MEMORY_QMD_UPDATE` is `manual`/`off`, run `qmd embed` yourself |
| Collection `pi-memory` missing | Auto-setup didn't run (qmd installed mid-session) | Run any `memory_search` (auto-creates it) or `qmd collection add ~/.pi/agent/memory --name pi-memory` |
| qmd works in the shell but not from pi on Windows | Broken `.cmd`/`.ps1` shims | The extension bypasses them by invoking qmd's JS entry with `node`; make sure the npm global `node_modules` dir is on `PATH` |
| Memory isn't being injected after a write | The snapshot is taken once per session and deliberately not re-rendered | The write is visible in tool-call history; use `memory_read` / `memory_search` for the current state, or set `PI_MEMORY_SNAPSHOT=refresh` (costs a full prompt reprocess per write) |

## Running tests

```bash
# Unit tests (no LLM, no qmd — fast, deterministic). Requires Bun.
npm test

# End-to-end tests (requires pi + API key, optionally qmd)
npm run test:e2e

# Recall effectiveness eval (requires pi + API key + qmd)
npm run test:eval

# Pin provider/model for cheaper eval runs
PI_E2E_PROVIDER=openai PI_E2E_MODEL=gpt-4o-mini npm run test:eval

# Multiple runs for statistical robustness
EVAL_RUNS=3 npm run test:eval
```

All tests back up and restore existing memory files.

### Test levels

| Level | Command | Requirements | What it tests |
|-------|---------|-------------|---------------|
| Unit | `npm test` (`test/unit.test.ts`) | Bun | Context builder, truncation, handoff, scratchpad parsing, qmd plumbing |
| E2E | `npm run test:e2e` (`test/e2e.ts`) | pi + API key | Tool registration, write/recall, scratchpad lifecycle, search |
| Eval | `npm run test:eval` (`test/eval-recall.ts`) | pi + API key + qmd | Recall accuracy with vs without selective injection |

## Development

`index.ts` owns the Markdown runtime; `hosted.ts` adds the transactional SDK
boundary. Run `npm run build` before installing this fork from a local checkout.

```bash
# Test with pi directly
pi -p -e ./index.ts "remember: I prefer dark mode"

# Verify memory was written
cat ~/.pi/agent/memory/MEMORY.md
```

## Publishing (maintainers)

Releases are tag-driven. Pushing a `v*` tag runs the publish workflow, which
lints, builds, runs the unit tests, verifies the tag matches `package.json`,
and then publishes to npm.

```bash
# Bump version + create the matching git tag (updates package.json)
npm version patch   # or minor / major

# Push the commit and tag — this triggers .github/workflows/publish-npm.yml
git push --follow-tags

# Verify the published install
pi install npm:pi-memory
```

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
