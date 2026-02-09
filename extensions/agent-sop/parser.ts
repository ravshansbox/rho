/**
 * SOP Parser — Parses .sop.md files into structured SOP definitions.
 *
 * Handles the Strands Agent SOP format:
 * - # Title
 * - ## Overview
 * - ## Parameters (with types, defaults, constraints)
 * - ## Steps (nested ### sub-steps with **Constraints:** blocks)
 */

export interface SOPParameter {
	name: string;
	required: boolean;
	defaultValue?: string;
	description: string;
}

export interface SOPConstraint {
	level: "MUST" | "SHOULD" | "MAY" | "MUST NOT";
	text: string;
}

export interface SOPStep {
	number: string; // "1", "2.1", etc.
	title: string;
	content: string;
	constraints: SOPConstraint[];
	substeps: SOPStep[];
}

export interface SOP {
	name: string; // filename without .sop.md
	title: string;
	overview: string;
	parameters: SOPParameter[];
	steps: SOPStep[];
	rawContent: string;
	filePath: string;
}

/**
 * Parse a parameter line like:
 * - **task_description** (required): Description of the task
 * - **mode** (optional, default: "interactive"): The interaction mode
 */
function parseParameterLine(line: string): SOPParameter | null {
	const match = line.match(
		/^-\s+\*\*(\w+)\*\*\s*\(([^)]+)\)\s*:\s*(.+)$/,
	);
	if (!match) return null;

	const [, name, modifiers, description] = match;
	const modLower = modifiers.toLowerCase();
	const required = modLower.includes("required");

	let defaultValue: string | undefined;
	const defaultMatch = modLower.match(/default:\s*"?([^"]*)"?/);
	if (defaultMatch) {
		defaultValue = defaultMatch[1].replace(/^"|"$/g, "");
	}

	return { name, required, defaultValue, description: description.trim() };
}

/**
 * Extract constraints from a text block.
 * Looks for lines starting with "- You MUST", "- You SHOULD", "- You MAY", "- You MUST NOT"
 */
function parseConstraints(text: string): SOPConstraint[] {
	const constraints: SOPConstraint[] = [];
	const lines = text.split("\n");

	for (const line of lines) {
		const trimmed = line.trim();
		const match = trimmed.match(
			/^-\s+(?:You\s+)?(MUST NOT|MUST|SHOULD|MAY)\s+(.+)$/,
		);
		if (match) {
			constraints.push({
				level: match[1] as SOPConstraint["level"],
				text: match[2].trim(),
			});
		}
	}

	return constraints;
}

/**
 * Parse step number from a heading like "### 2.1 Analyze Requirements"
 */
function parseStepHeading(
	heading: string,
	level: number,
): { number: string; title: string } | null {
	// Match "### 1. Title" or "### 2.1 Title" or "#### 2.1.1 Title"
	const prefix = "#".repeat(level);
	const regex = new RegExp(`^${prefix}\\s+(\\d+(?:\\.\\d+)*)(?:\\.?\\s+)(.+)$`);
	const match = heading.match(regex);
	if (match) {
		return { number: match[1], title: match[2].trim() };
	}
	return null;
}

/**
 * Parse a .sop.md file into a structured SOP object.
 */
export function parseSOP(content: string, filePath: string): SOP {
	const name = filePath
		.split("/")
		.pop()!
		.replace(/\.sop\.md$/, "");

	const lines = content.split("\n");
	let title = name;
	let overview = "";
	const parameters: SOPParameter[] = [];
	const steps: SOPStep[] = [];

	// State machine
	type Section =
		| "none"
		| "overview"
		| "parameters"
		| "steps"
		| "other";
	let currentSection: Section = "none";
	let currentStep: SOPStep | null = null;
	let currentSubstep: SOPStep | null = null;
	let stepContentLines: string[] = [];

	function flushStepContent() {
		const text = stepContentLines.join("\n").trim();
		if (currentSubstep) {
			currentSubstep.content = text;
			currentSubstep.constraints = parseConstraints(text);
		} else if (currentStep) {
			currentStep.content = text;
			currentStep.constraints = parseConstraints(text);
		}
		stepContentLines = [];
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// # Title (h1)
		if (line.startsWith("# ") && !line.startsWith("## ")) {
			title = line.slice(2).trim();
			continue;
		}

		// ## Section headers
		if (line.startsWith("## ")) {
			const sectionTitle = line.slice(3).trim().toLowerCase();
			flushStepContent();

			if (sectionTitle === "overview") {
				currentSection = "overview";
			} else if (sectionTitle === "parameters") {
				currentSection = "parameters";
			} else if (sectionTitle === "steps") {
				currentSection = "steps";
			} else if (
				sectionTitle.startsWith("mode") ||
				sectionTitle.startsWith("important") ||
				sectionTitle.startsWith("directory")
			) {
				// These are informational sections, treat as part of "other"
				currentSection = "other";
			} else {
				currentSection = "other";
			}
			continue;
		}

		// ### Step headers (within steps section)
		if (currentSection === "steps" && line.startsWith("### ")) {
			flushStepContent();
			if (currentSubstep && currentStep) {
				currentStep.substeps.push(currentSubstep);
				currentSubstep = null;
			}
			if (currentStep) {
				steps.push(currentStep);
			}

			const parsed = parseStepHeading(line, 3);
			if (parsed) {
				currentStep = {
					number: parsed.number,
					title: parsed.title,
					content: "",
					constraints: [],
					substeps: [],
				};
			}
			continue;
		}

		// #### Sub-step headers
		if (currentSection === "steps" && line.startsWith("#### ")) {
			flushStepContent();
			if (currentSubstep && currentStep) {
				currentStep.substeps.push(currentSubstep);
			}

			const parsed = parseStepHeading(line, 4);
			if (parsed) {
				currentSubstep = {
					number: parsed.number,
					title: parsed.title,
					content: "",
					constraints: [],
					substeps: [],
				};
			}
			continue;
		}

		// Content accumulation
		switch (currentSection) {
			case "overview":
				if (line.trim()) overview += (overview ? "\n" : "") + line.trim();
				break;
			case "parameters": {
				const param = parseParameterLine(line.trim());
				if (param) parameters.push(param);
				break;
			}
			case "steps":
				stepContentLines.push(line);
				break;
		}
	}

	// Flush remaining
	flushStepContent();
	if (currentSubstep && currentStep) {
		currentStep.substeps.push(currentSubstep);
	}
	if (currentStep) {
		steps.push(currentStep);
	}

	return {
		name,
		title,
		overview,
		parameters,
		steps,
		rawContent: content,
		filePath,
	};
}

/**
 * Generate a parameter summary for display.
 */
export function formatParameterSummary(params: SOPParameter[]): string {
	if (params.length === 0) return "No parameters";

	return params
		.map((p) => {
			const req = p.required ? "required" : "optional";
			const def = p.defaultValue ? ` [default: "${p.defaultValue}"]` : "";
			return `  ${p.name} (${req}${def}): ${p.description}`;
		})
		.join("\n");
}

/**
 * Generate a step outline for display.
 */
export function formatStepOutline(steps: SOPStep[]): string {
	const lines: string[] = [];
	for (const step of steps) {
		lines.push(`${step.number}. ${step.title}`);
		for (const sub of step.substeps) {
			lines.push(`   ${sub.number}. ${sub.title}`);
		}
	}
	return lines.join("\n");
}

/**
 * Count total steps (including substeps) for progress tracking.
 */
export function countSteps(steps: SOPStep[]): number {
	let count = 0;
	for (const step of steps) {
		if (step.substeps.length > 0) {
			count += step.substeps.length;
		} else {
			count += 1;
		}
	}
	return count;
}

/**
 * Get a flat list of all step IDs (e.g., ["1", "2.1", "2.2", "3"]).
 */
export function flatStepIds(steps: SOPStep[]): string[] {
	const ids: string[] = [];
	for (const step of steps) {
		if (step.substeps.length > 0) {
			for (const sub of step.substeps) {
				ids.push(sub.number);
			}
		} else {
			ids.push(step.number);
		}
	}
	return ids;
}
