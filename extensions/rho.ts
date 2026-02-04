/**
 * Rho Extension - OpenClaw-style periodic check-ins for pi
 *
 * Rho runs periodic "heartbeat" turns where the agent checks on:
 * - Outstanding tasks and follow-ups
 * - RHO.md checklist in workspace
 * - Anything needing attention
 *
 * Named after the Greek letter ρ (rho), representing continuous presence.
 *
 * Usage:
 *   /rho status           - Show current rho state
 *   /rho enable           - Enable rho check-ins
 *   /rho disable          - Disable rho check-ins
 *   /rho now              - Trigger a check-in immediately
 *   /rho interval 30m     - Set interval (e.g., 30m, 1h, 0 to disable)
 *
 * The LLM can also use tools:
 *   - rho_control(action: "enable" | "disable" | "trigger" | "interval", interval?: string)
 *   - rho_status()
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// State stored in memory (reconstructed from session entries and persisted to disk)
interface RhoState {
	enabled: boolean;
	intervalMs: number;
	lastCheckAt: number | null;
	nextCheckAt: number | null;
	checkCount: number;
}

interface RhoDetails {
	action: "enable" | "disable" | "trigger" | "interval" | "status";
	intervalMs?: number;
	enabled?: boolean;
	lastCheckAt?: number | null;
	nextCheckAt?: number | null;
	checkCount?: number;
	wasTriggered?: boolean;
}

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes minimum
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours maximum

const STATE_DIR = join(process.env.HOME || "", ".pi", "agent");
const STATE_PATH = join(STATE_DIR, "rho-state.json");

const RHO_PROMPT = `This is a rho check-in. Review the following:

1. Read RHO.md from the workspace if it exists - follow any checklists there
2. Check for any outstanding tasks, TODOs, or follow-ups from our conversation
3. Review any long-running operations or background processes
4. Surface anything urgent that needs attention

If nothing needs attention, reply with exactly: RHO_OK
If something needs attention, reply with the alert (do NOT include RHO_OK).`;

export default function (pi: ExtensionAPI) {
	// In-memory state (reconstructed from session)
	let state: RhoState = {
		enabled: true,
		intervalMs: DEFAULT_INTERVAL_MS,
		lastCheckAt: null,
		nextCheckAt: null,
		checkCount: 0,
	};

	let timer: NodeJS.Timeout | null = null;

	const normalizeInterval = (value: unknown): number => {
		if (typeof value !== "number" || Number.isNaN(value)) return DEFAULT_INTERVAL_MS;
		if (value === 0) return 0;
		if (value < MIN_INTERVAL_MS || value > MAX_INTERVAL_MS) return DEFAULT_INTERVAL_MS;
		return Math.floor(value);
	};

	const loadStateFromDisk = () => {
		try {
			const raw = readFileSync(STATE_PATH, "utf-8");
			const parsed = JSON.parse(raw) as Partial<RhoState>;
			if (typeof parsed.enabled === "boolean") state.enabled = parsed.enabled;
			if (parsed.intervalMs !== undefined) state.intervalMs = normalizeInterval(parsed.intervalMs);
			if (typeof parsed.lastCheckAt === "number") state.lastCheckAt = parsed.lastCheckAt;
			if (typeof parsed.nextCheckAt === "number") state.nextCheckAt = parsed.nextCheckAt;
			if (typeof parsed.checkCount === "number" && parsed.checkCount >= 0) state.checkCount = parsed.checkCount;
		} catch {
			// Ignore missing or invalid state
		}

		if (state.intervalMs === 0) state.enabled = false;
	};

	const saveStateToDisk = () => {
		try {
			mkdirSync(STATE_DIR, { recursive: true });
			writeFileSync(
				STATE_PATH,
				JSON.stringify(
					{
						enabled: state.enabled,
						intervalMs: state.intervalMs,
						lastCheckAt: state.lastCheckAt,
						nextCheckAt: state.nextCheckAt,
						checkCount: state.checkCount,
					},
					null,
					2
				)
			);
		} catch {
			// Ignore persistence failures
		}
	};

	/**
	 * Reconstruct state from session entries
	 */
	const reconstructState = (ctx: ExtensionContext) => {
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "rho_control") continue;

			const details = msg.details as RhoDetails | undefined;
			if (details) {
				if (details.enabled !== undefined) state.enabled = details.enabled;
				if (details.intervalMs !== undefined) state.intervalMs = details.intervalMs;
				if (details.lastCheckAt !== undefined) state.lastCheckAt = details.lastCheckAt;
				if (details.nextCheckAt !== undefined) state.nextCheckAt = details.nextCheckAt;
				if (details.checkCount !== undefined) state.checkCount = details.checkCount;
			}
		}
	};

	/**
	 * Parse interval string (e.g., "30m", "1h", "15min")
	 */
	const parseInterval = (input: string): number | null => {
		const match = input.trim().toLowerCase().match(/^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours)?$/);
		if (!match) return null;

		const value = parseInt(match[1], 10);
		const unit = match[2] || "m";

		if (unit.startsWith("h")) {
			return value * 60 * 60 * 1000;
		}
		return value * 60 * 1000;
	};

	/**
	 * Format interval for display
	 */
	const formatInterval = (ms: number): string => {
		if (ms >= 60 * 60 * 1000) {
			const hours = ms / (60 * 60 * 1000);
			return `${hours}h`;
		}
		const minutes = ms / (60 * 1000);
		return `${minutes}m`;
	};

	/**
	 * Schedule the next check-in
	 */
	const scheduleNext = (ctx: ExtensionContext) => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}

		if (!state.enabled || state.intervalMs === 0) {
			state.nextCheckAt = null;
			saveStateToDisk();
			return;
		}

		const now = Date.now();
		const base = state.lastCheckAt && state.lastCheckAt <= now ? state.lastCheckAt : now;
		let nextAt = base + state.intervalMs;
		if (nextAt <= now) {
			nextAt = now + 1000;
		}
		state.nextCheckAt = nextAt;

		const delay = Math.max(0, nextAt - now);
		timer = setTimeout(() => {
			triggerCheck(ctx);
		}, delay);

		saveStateToDisk();
	};

	/**
	 * Read RHO.md from workspace if it exists
	 */
	const readRhoMd = (ctx: ExtensionContext): string | null => {
		const paths = [
			join(ctx.cwd, "RHO.md"),
			join(ctx.cwd, ".pi", "RHO.md"),
			join(ctx.cwd, ".rho.md"),
		];

		for (const path of paths) {
			if (existsSync(path)) {
				try {
					const content = readFileSync(path, "utf-8").trim();
					// Check if effectively empty (only whitespace and headers)
					const hasContent = content
						.split("\n")
						.some((line) => {
							const trimmed = line.trim();
							return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("-");
						});
					return hasContent ? content : null;
				} catch {
					continue;
				}
			}
		}
		return null;
	};

	/**
	 * Trigger a check-in immediately
	 */
	const triggerCheck = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;

		state.lastCheckAt = Date.now();
		state.checkCount++;

		// Build the full prompt with RHO.md content if available
		let fullPrompt = RHO_PROMPT;
		const rhoMd = readRhoMd(ctx);
		if (rhoMd) {
			fullPrompt += `\n\n---\n\nRHO.md content:\n${rhoMd}`;
		}

		// Send as user message (appears as system event style)
		pi.sendUserMessage(fullPrompt, { deliverAs: "followUp" });

		// Schedule next
		scheduleNext(ctx);
	};

	/**
	 * Update status line
	 */
	const updateStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;

		const theme = ctx.ui.theme;
		if (!state.enabled || state.intervalMs === 0) {
			ctx.ui.setStatus("rho", theme.fg("dim", "ρ off"));
			return;
		}

		const interval = formatInterval(state.intervalMs);
		if (state.nextCheckAt) {
			const mins = Math.ceil((state.nextCheckAt - Date.now()) / (60 * 1000));
			ctx.ui.setStatus("rho", theme.fg("dim", `ρ ${interval} (${mins}m)`));
		} else {
			ctx.ui.setStatus("rho", theme.fg("dim", `ρ ${interval}`));
		}
	};

	// Reconstruct state on session events
	pi.on("session_start", async (_event, ctx) => {
		loadStateFromDisk();
		reconstructState(ctx);
		scheduleNext(ctx);
		updateStatus(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		loadStateFromDisk();
		reconstructState(ctx);
		scheduleNext(ctx);
		updateStatus(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		loadStateFromDisk();
		reconstructState(ctx);
		scheduleNext(ctx);
		updateStatus(ctx);
	});

	// Clean up on shutdown
	pi.on("session_shutdown", async () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	});

	// Listen for RHO_OK responses to suppress them
	pi.on("agent_end", async (event, ctx) => {
		const lastMessage = event.messages[event.messages.length - 1];
		if (lastMessage?.role === "assistant" && lastMessage.content) {
			const text = lastMessage.content
				.filter((c) => c.type === "text")
				.map((c) => c.text)
				.join("");

			// Check for RHO_OK at start or end
			const trimmed = text.trim();
			const isRhoOk =
				trimmed === "RHO_OK" ||
				trimmed.startsWith("RHO_OK\n") ||
				trimmed.endsWith("\nRHO_OK");

			if (isRhoOk && trimmed.length <= 300) {
				// Suppress this message
				ctx.ui.notify("ρ: OK (no alerts)", "info");
			}
		}

		// Update status after each turn
		updateStatus(ctx);
	});

	// Register rho_control tool for the LLM
	pi.registerTool({
		name: "rho_control",
		label: "Rho",
		description: "Control the rho check-in system. Actions: enable, disable, trigger (immediate), status (get info), interval (set with interval string like '30m' or '1h')",
		parameters: Type.Object({
			action: StringEnum(["enable", "disable", "trigger", "status", "interval"] as const),
			interval: Type.Optional(Type.String({ description: "Interval string for 'interval' action (e.g., '30m', '1h', '15min'). Use '0' to disable." })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.action) {
				case "enable":
					state.enabled = true;
					scheduleNext(ctx);
					updateStatus(ctx);
					return {
						content: [{ type: "text", text: "Rho enabled" }],
						details: { action: "enable", enabled: state.enabled } as RhoDetails,
					};

				case "disable":
					state.enabled = false;
					scheduleNext(ctx);
					updateStatus(ctx);
					return {
						content: [{ type: "text", text: "Rho disabled" }],
						details: { action: "disable", enabled: state.enabled } as RhoDetails,
					};

				case "trigger":
					if (!ctx.hasUI) {
						return {
							content: [{ type: "text", text: "Error: Cannot trigger rho in non-interactive mode" }],
							details: { action: "trigger", wasTriggered: false } as RhoDetails,
						};
					}
					triggerCheck(ctx);
					return {
						content: [{ type: "text", text: "Rho check-in triggered" }],
						details: {
							action: "trigger",
							wasTriggered: true,
							lastCheckAt: state.lastCheckAt,
							checkCount: state.checkCount,
						} as RhoDetails,
					};

				case "interval": {
					if (!params.interval) {
						return {
							content: [{ type: "text", text: `Current interval: ${formatInterval(state.intervalMs)}` }],
							details: {
								action: "interval",
								intervalMs: state.intervalMs,
							} as RhoDetails,
						};
					}

					const intervalMs = parseInterval(params.interval);
					if (intervalMs === null) {
						return {
							content: [{ type: "text", text: `Error: Invalid interval '${params.interval}'. Use format like '30m', '1h', or '0' to disable.` }],
							details: { action: "interval", intervalMs: state.intervalMs, error: "invalid interval" } as RhoDetails,
						};
					}

					if (intervalMs !== 0 && (intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS)) {
						return {
							content: [{ type: "text", text: `Error: Interval must be between 5m and 24h (or 0 to disable)` }],
							details: { action: "interval", intervalMs: state.intervalMs, error: "out of range" } as RhoDetails,
						};
					}

					state.intervalMs = intervalMs;
					if (intervalMs === 0) {
						state.enabled = false;
					}
					scheduleNext(ctx);
					updateStatus(ctx);

					const status = intervalMs === 0 ? "disabled" : `set to ${formatInterval(intervalMs)}`;
					return {
						content: [{ type: "text", text: `Rho interval ${status}` }],
						details: {
							action: "interval",
							intervalMs: state.intervalMs,
							enabled: state.enabled,
						} as RhoDetails,
					};
				}

				case "status": {
					const rhoMd = readRhoMd(ctx);
					let text = `Rho status:\n`;
					text += `- Enabled: ${state.enabled}\n`;
					text += `- Interval: ${formatInterval(state.intervalMs)}\n`;
					text += `- Total check-ins this session: ${state.checkCount}\n`;
					if (state.lastCheckAt) {
						const ago = Math.floor((Date.now() - state.lastCheckAt) / (60 * 1000));
						text += `- Last check-in: ${ago}m ago\n`;
					} else {
						text += `- Last check-in: never\n`;
					}
					if (state.nextCheckAt && state.enabled && state.intervalMs > 0) {
						const inMins = Math.ceil((state.nextCheckAt - Date.now()) / (60 * 1000));
						text += `- Next check-in: in ${inMins}m\n`;
					}
					text += `- RHO.md: ${rhoMd ? "found" : "not found"}`;

					return {
						content: [{ type: "text", text }],
						details: {
							action: "status",
							enabled: state.enabled,
							intervalMs: state.intervalMs,
							lastCheckAt: state.lastCheckAt,
							nextCheckAt: state.nextCheckAt,
							checkCount: state.checkCount,
						} as RhoDetails,
					};
				}
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("rho ")) + theme.fg("muted", args.action);
			if (args.interval) {
				text += ` ${theme.fg("accent", args.interval)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as RhoDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.action === "status") {
				return new Text(theme.fg("dim", `ρ ${formatInterval(details.intervalMs || DEFAULT_INTERVAL_MS)}`), 0, 0);
			}

			if (details.action === "trigger") {
				return new Text(theme.fg("success", "✓ Triggered"), 0, 0);
			}

			const status = details.enabled ? theme.fg("success", "on") : theme.fg("dim", "off");
			return new Text(theme.fg("success", "✓ ") + theme.fg("muted", `${details.action} `) + status, 0, 0);
		},
	});

	// Register /rho command
	pi.registerCommand("rho", {
		description: "Control rho check-in system: status, enable, disable, now, interval <time>",
		handler: async (args, ctx) => {
			const [subcmd, ...rest] = args.trim().split(/\s+/);
			const arg = rest.join(" ");

			switch (subcmd) {
				case "status":
				case "":
					ctx.ui.notify(
						`Rho: ${state.enabled ? "enabled" : "disabled"}, ` +
						`interval: ${formatInterval(state.intervalMs)}, ` +
						`count: ${state.checkCount}`,
						"info"
					);
					break;

				case "enable":
					state.enabled = true;
					scheduleNext(ctx);
					updateStatus(ctx);
					ctx.ui.notify("Rho enabled", "success");
					break;

				case "disable":
					state.enabled = false;
					scheduleNext(ctx);
					updateStatus(ctx);
					ctx.ui.notify("Rho disabled", "info");
					break;

				case "now":
					if (!ctx.hasUI) {
						ctx.ui.notify("Rho requires interactive mode", "error");
						return;
					}
					triggerCheck(ctx);
					ctx.ui.notify("Rho check-in triggered", "success");
					break;

				case "interval": {
					if (!arg) {
						ctx.ui.notify(`Current interval: ${formatInterval(state.intervalMs)}`, "info");
						return;
					}
					const intervalMs = parseInterval(arg);
					if (intervalMs === null) {
						ctx.ui.notify("Invalid interval. Use format: 30m, 1h, or 0 to disable", "error");
						return;
					}
					if (intervalMs !== 0 && (intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS)) {
						ctx.ui.notify("Interval must be between 5m and 24h", "error");
						return;
					}
					state.intervalMs = intervalMs;
					if (intervalMs === 0) state.enabled = false;
					scheduleNext(ctx);
					updateStatus(ctx);
					ctx.ui.notify(
						intervalMs === 0
							? "Rho disabled (interval = 0)"
							: `Rho interval set to ${formatInterval(intervalMs)}`,
						"success"
					);
					break;
				}

				default:
					ctx.ui.notify("Usage: /rho [status|enable|disable|now|interval <time>]", "warning");
					ctx.ui.notify("Examples: /rho now, /rho interval 30m, /rho interval 1h", "info");
			}
		},
	});
}
