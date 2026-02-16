---
name: create-sop
description: "Create a new SOP-style skill as skills/<name>/SKILL.md with kind: sop frontmatter and structured Parameters/Steps sections."
kind: sop
---

# Create SOP Skill

## Overview

Create a new workflow skill where **SOPs are implemented as skills**.

Canonical artifact:
- `skills/<skill-name>/SKILL.md`

A valid SOP skill must include:
- YAML frontmatter with `name`, `description`, and `kind: sop`
- `## Parameters`
- `## Steps`

## Parameters

- **sop_topic** (required): What the SOP skill should do
- **skill_name** (optional): Kebab-case skill name. If omitted, generate from topic.
- **output_dir** (optional, default: `skills`): Parent directory for the skill
- **include_examples** (optional, default: `true`): Include `## Examples`
- **include_troubleshooting** (optional, default: `true`): Include `## Troubleshooting`

## Steps

### 1. Gather requirements

**Constraints:**
- You MUST ask for all required inputs up front.
- You MUST clarify intended outcomes, required tools, and failure boundaries.
- You MUST identify what must be interactive vs autonomous.

### 2. Define the skill contract

**Constraints:**
- You MUST create/confirm a kebab-case `skill_name`.
- You MUST define parameters in a machine-readable bullet format.
- You MUST separate required vs optional params and defaults.

### 3. Draft SOP skill content

**Constraints:**
- You MUST generate frontmatter:

```yaml
---
name: <skill_name>
description: <one-line purpose>
kind: sop
---
```

- You MUST include these sections in order:
  1. `# <Title>`
  2. `## Overview`
  3. `## Parameters`
  4. `## Steps`
- You MUST use RFC-2119 constraints (`MUST`, `SHOULD`, `MAY`).
- You MUST include explicit negative constraints with reasons when relevant.

### 4. Write the artifact

**Constraints:**
- You MUST write to: `{output_dir}/{skill_name}/SKILL.md`
- You MUST create parent directories when missing.
- You MUST use the skill artifact convention only: `skills/<skill_name>/SKILL.md`.

### 5. Validate

**Constraints:**
- You MUST verify frontmatter includes `kind: sop`.
- You MUST verify `## Parameters` and `## Steps` are present.
- You SHOULD suggest running via: `/skill run {skill_name}`.

## Output

When done, report:
- Created path
- Parameter list
- Short execution example

## Example

Input:
- `sop_topic`: "Automated code review with lint/test gates"
- `skill_name`: `code-review`

Output path:
- `skills/code-review/SKILL.md`

Run with:
- `/skill run code-review`
