import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostedMemoryExtension, type MemoryStore } from "../hosted.js";
import { createMemoryRuntime } from "../index.js";

test("daily logs use calendar days across daylight-saving transitions", (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-09T04:30:00Z") });
	const runtime = createMemoryRuntime({ timeZone: "America/New_York" });
	assert.equal(runtime.todayStr(), "2026-03-09");
	assert.equal(runtime.yesterdayStr(), "2026-03-08");
});

function store() {
	let revision = 0;
	let files: Record<string, string> = {};
	const receipts = new Map<string, unknown>();
	const backend: MemoryStore = {
		async read(operation) {
			return {
				revision,
				files: structuredClone(files),
				...(operation && receipts.has(operation.id) ? { result: receipts.get(operation.id) } : {}),
			};
		},
		async commit(expected, next, operation, result) {
			if (receipts.has(operation.id)) return { committed: true, result: receipts.get(operation.id) };
			if (expected !== revision) return { committed: false };
			files = structuredClone(next);
			revision++;
			receipts.set(operation.id, result);
			return { committed: true, result };
		},
	};
	return { backend, files: () => files };
}

function extension(backend: MemoryStore) {
	const tools = new Map<string, any>();
	const hooks = new Map<string, any>();
	createHostedMemoryExtension({ store: backend, timeZone: "Asia/Shanghai" })({
		registerTool: (tool: any) => tools.set(tool.name, tool),
		on: (event: string, hook: any) => hooks.set(event, hook),
	} as any);
	return {
		call: (name: string, id: string, args: unknown, signal = new AbortController().signal) =>
			tools.get(name).execute(id, args, signal, undefined, { sessionManager: { getSessionId: () => "session-a" } }),
		context: () => hooks.get("context")({ messages: [] }, {}),
		hooks,
	};
}

test("student namespaces stay isolated and new sessions recall the same student", async () => {
	const a = store(),
		b = store();
	const alice = extension(a.backend),
		bob = extension(b.backend);
	await alice.call("memory_write", "a1", { target: "long_term", content: "先给提示" });
	await bob.call("memory_write", "b1", { target: "long_term", content: "完整推导" });
	assert.match(JSON.stringify(await extension(a.backend).context()), /先给提示/);
	assert.doesNotMatch(JSON.stringify(await alice.context()), /完整推导/);
	assert.doesNotMatch(JSON.stringify(await bob.context()), /先给提示/);
	assert.equal(alice.hooks.has("session_shutdown"), false);
	assert.equal(
		alice.hooks.has("before_agent_start"),
		false,
		"memory must be transient context, not a persisted session message",
	);
});

test("concurrent sessions retry CAS without losing writes; replay is idempotent", async () => {
	const db = store();
	const a = extension(db.backend),
		b = extension(db.backend);
	await Promise.all([
		a.call("memory_write", "a1", { target: "long_term", content: "偏好一" }),
		b.call("memory_write", "b1", { target: "long_term", content: "偏好二" }),
	]);
	await extension(db.backend).call("memory_write", "a1", { target: "long_term", content: "偏好一" });
	assert.equal(db.files()["MEMORY.md"].split("偏好一").length, 2);
	assert.match(db.files()["MEMORY.md"], /偏好二/);
});

test("forget and recovery commit together; restore survives restart and is idempotent", async () => {
	const db = store();
	const a = extension(db.backend);
	await a.call("memory_write", "a1", { target: "long_term", content: "过时的偏好" });
	const removed = await a.call("memory_forget", "a2", { match: "过时" });
	assert.doesNotMatch(db.files()["MEMORY.md"], /过时/);
	assert.equal(Object.keys(db.files()).filter((key) => key.startsWith("recovery/")).length, 1);
	const fresh = extension(db.backend);
	await fresh.call("memory_restore", "a3", { recoveryId: removed.details.recoveryId });
	await fresh.call("memory_restore", "a4", { recoveryId: removed.details.recoveryId });
	assert.equal(db.files()["MEMORY.md"].split("过时的偏好").length, 2);
});

test("failed commit does not publish memory; cancellation prevents writes", async () => {
	const db = store();
	const a = extension({
		...db.backend,
		commit: async () => {
			throw new Error("storage unavailable");
		},
	});
	await assert.rejects(
		a.call("memory_write", "a1", { target: "long_term", content: "不能保存" }),
		/storage unavailable/,
	);
	assert.deepEqual(db.files(), {});
	const abort = new AbortController();
	abort.abort();
	await assert.rejects(
		extension(db.backend).call("memory_write", "a2", { target: "long_term", content: "取消" }, abort.signal),
	);
	assert.deepEqual(db.files(), {});
});

test("hosted search is scoped Chinese keyword search and does not expose recovery files", async () => {
	const db = store(),
		a = extension(db.backend);
	await a.call("memory_write", "a1", { target: "long_term", content: "喜欢几何图形解释" });
	const found = await a.call("memory_search", "a2", { query: "几何", limit: 5 });
	assert.equal(typeof found.content[0].text, "string");
	assert.match(JSON.stringify(found), /喜欢几何图形解释/);
	await a.call("memory_forget", "a3", { match: "几何" });
	assert.doesNotMatch(JSON.stringify(await a.call("memory_search", "a4", { query: "几何" })), /喜欢几何图形解释/);
	await assert.rejects(
		a.call("memory_write", "a5", { target: "long_term", content: "覆盖", mode: "overwrite" }),
		/overwrite/,
	);
});
