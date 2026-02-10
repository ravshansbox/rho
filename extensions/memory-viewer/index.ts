/**
 * Memory Viewer Extension
 *
 * Shows all brain memories in a scrollable overlay rendered as markdown.
 *
 * Usage: /memories
 *
 * Keys:
 *   ↑/↓     - Scroll one line
 *   PgUp/Dn - Scroll one page
 *   Home/End - Jump to top/bottom
 *   Esc      - Close
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Markdown, matchesKey, Key, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { TUI } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { readBrain, foldBrain, BRAIN_PATH } from "../lib/brain-store.ts";

function buildMarkdown(): string {
	const { entries } = readBrain(BRAIN_PATH);
	const brain = foldBrain(entries);
	const sections: string[] = [];

	// Behavior section
	if (brain.behaviors.length > 0) {
		const dos = brain.behaviors.filter((b) => b.category === "do");
		const donts = brain.behaviors.filter((b) => b.category === "dont");
		const values = brain.behaviors.filter((b) => b.category === "value");

		let s = "# Behavior\n";
		if (dos.length > 0) {
			s += "\n**Do:**\n";
			for (const b of dos) s += `- ${b.text}\n`;
		}
		if (donts.length > 0) {
			s += "\n**Don't:**\n";
			for (const b of donts) s += `- ${b.text}\n`;
		}
		if (values.length > 0) {
			s += "\n**Values:**\n";
			for (const b of values) s += `- ${b.text}\n`;
		}
		sections.push(s);
	}

	// Preferences section
	if (brain.preferences.length > 0) {
		let s = "# Preferences\n";
		const byCategory = new Map<string, typeof brain.preferences>();
		for (const p of brain.preferences) {
			const cat = p.category || "General";
			if (!byCategory.has(cat)) byCategory.set(cat, []);
			byCategory.get(cat)!.push(p);
		}
		for (const [cat, entries] of byCategory) {
			s += `\n**${cat}:**\n`;
			for (const e of entries) s += `- ${e.text}\n`;
		}
		sections.push(s);
	}

	// Learnings section
	if (brain.learnings.length > 0) {
		let s = `# Learnings (${brain.learnings.length})\n\n`;
		for (const l of brain.learnings) {
			s += `- ${l.text}\n`;
		}
		sections.push(s);
	}

	// Reminders section
	if (brain.reminders.length > 0) {
		let s = `# Reminders (${brain.reminders.length})\n\n`;
		for (const r of brain.reminders) {
			const status = r.enabled ? "active" : "disabled";
			const cadence = r.cadence.kind === "interval" ? `every ${r.cadence.every}` : `daily at ${r.cadence.at}`;
			s += `- [${r.id}] ${r.text} (${cadence}, ${status})\n`;
		}
		sections.push(s);
	}

	// Tasks section
	if (brain.tasks.length > 0) {
		const pending = brain.tasks.filter((t) => t.status === "pending");
		const done = brain.tasks.filter((t) => t.status === "done");
		let s = `# Tasks (${pending.length} pending, ${done.length} done)\n\n`;
		for (const t of pending) {
			const pri = t.priority !== "normal" ? ` (${t.priority})` : "";
			const due = t.due ? ` due:${t.due}` : "";
			s += `- [ ] [${t.id}] ${t.description}${pri}${due}\n`;
		}
		for (const t of done) {
			s += `- [x] [${t.id}] ${t.description}\n`;
		}
		sections.push(s);
	}

	// Daily memory files (legacy, kept for historical view)
	const memoryDir = join(BRAIN_PATH, "..", "memory");
	if (existsSync(memoryDir)) {
		const files = readdirSync(memoryDir)
			.filter((f) => f.endsWith(".md"))
			.sort()
			.reverse();
		for (const file of files) {
			const content = readFileSync(join(memoryDir, file), "utf-8").trim();
			if (content) {
				sections.push(`# Daily: ${file.replace(".md", "")}\n\n${content}`);
			}
		}
	}

	return sections.join("\n\n---\n\n");
}

class MemoryViewerComponent {
	private scrollOffset = 0;
	private allLines: string[] = [];
	private lastWidth = 0;
	private md: Markdown;
	private disposed = false;

	constructor(
		private tui: TUI,
		private theme: Theme,
		private done: () => void,
	) {
		const content = buildMarkdown();
		this.md = new Markdown(content, 1, 0, getMarkdownTheme());
	}

	handleInput(data: string): void {
		if (this.disposed) return;

		const pageSize = Math.max(1, this.visibleLines() - 2);
		const maxScroll = Math.max(0, this.allLines.length - this.visibleLines());

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.disposed = true;
			this.done();
		} else if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.tui.requestRender();
		} else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
			this.tui.requestRender();
		} else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("u"))) {
			this.scrollOffset = Math.max(0, this.scrollOffset - pageSize);
			this.tui.requestRender();
		} else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("d"))) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + pageSize);
			this.tui.requestRender();
		} else if (matchesKey(data, Key.home) || matchesKey(data, "g")) {
			this.scrollOffset = 0;
			this.tui.requestRender();
		} else if (matchesKey(data, Key.end) || data === "G") {
			this.scrollOffset = maxScroll;
			this.tui.requestRender();
		}
	}

	private visibleLines(): number {
		// Reserve lines for: top border, header, separator, bottom border, help line
		return Math.max(1, process.stdout.rows - 8);
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerW = Math.max(1, width - 2);

		// Re-render markdown if width changed
		if (width !== this.lastWidth) {
			this.lastWidth = width;
			this.allLines = this.md.render(innerW);
		}

		const visible = this.visibleLines();
		const maxScroll = Math.max(0, this.allLines.length - visible);

		// Clamp scroll
		if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;

		const border = (c: string) => th.fg("border", c);
		const accent = (c: string) => th.fg("accent", c);
		const dim = (c: string) => th.fg("dim", c);
		const result: string[] = [];

		// Top border with title
		const title = ` Memories `;
		const titleW = visibleWidth(title);
		const leftPad = Math.floor((innerW - titleW) / 2);
		const rightPad = innerW - titleW - leftPad;
		result.push(
			border("╭") +
				border("─".repeat(leftPad)) +
				accent(title) +
				border("─".repeat(rightPad)) +
				border("╮"),
		);

		// Scroll info line
		const total = this.allLines.length;
		const pos = total > 0 ? Math.floor(((this.scrollOffset + visible / 2) / Math.max(1, total)) * 100) : 0;
		const scrollInfo = `${Math.min(pos, 100)}% (${this.scrollOffset + 1}-${Math.min(this.scrollOffset + visible, total)}/${total})`;
		result.push(
			border("│") +
				truncateToWidth(dim(` ${scrollInfo}`), innerW, "", true) +
				border("│"),
		);
		result.push(border("├") + border("─".repeat(innerW)) + border("┤"));

		// Content lines
		const visibleSlice = this.allLines.slice(this.scrollOffset, this.scrollOffset + visible);
		for (const line of visibleSlice) {
			result.push(border("│") + truncateToWidth(line, innerW, "…", true) + border("│"));
		}

		// Pad if content is shorter than visible area
		for (let i = visibleSlice.length; i < visible; i++) {
			result.push(border("│") + " ".repeat(innerW) + border("│"));
		}

		// Help line
		result.push(border("├") + border("─".repeat(innerW)) + border("┤"));
		const help = " ↑↓/jk scroll  PgUp/Dn page  Home/End jump  Esc close";
		result.push(
			border("│") +
				truncateToWidth(dim(help), innerW, "", true) +
				border("│"),
		);
		result.push(border("╰") + border("─".repeat(innerW)) + border("╯"));

		return result;
	}

	invalidate(): void {
		this.lastWidth = 0; // Force re-render of markdown
		this.md.invalidate();
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("memories", {
		description: "View all brain memories in a scrollable overlay",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("memories requires interactive mode", "error");
				return;
			}

			await ctx.ui.custom<void>(
				(tui, theme, _kb, done) => new MemoryViewerComponent(tui, theme, done),
				{
					overlay: true,
					overlayOptions: {
						anchor: "center",
						width: "90%",
						minWidth: 60,
						maxHeight: "95%",
					},
				},
			);
		},
	});
}
