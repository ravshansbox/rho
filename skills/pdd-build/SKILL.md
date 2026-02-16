---
name: pdd-build
description: Execute a completed PDD implementation plan step-by-step with validation gates.
kind: sop
---

# PDD Build

## Overview

This SOP takes a completed PDD project (design doc + implementation plan) and executes the implementation plan step-by-step using subagents. Each step is built by a subagent, then verified against user-defined "done" criteria before advancing. The user defines how completion is validated — automated tests, manual testing via tmux, browser validation via Playwriter, visual inspection, or any combination.

## Parameters

- **project_dir** (required): Path to the PDD project directory (e.g., `.agents/planning/2026-02-10-review-extension`)
- **validation_strategy** (required): How the agent should verify each step is done. The user must explain this in detail.
- **start_step** (optional, default: 1): Step number to start from (for resuming interrupted builds)

**Constraints for parameter acquisition:**
- You MUST ask for all required parameters upfront in a single prompt
- You MUST verify the project_dir contains the expected PDD artifacts before proceeding:
  - `design/detailed-design.md` must exist
  - `implementation/plan.md` must exist and contain a checklist
- You MUST ask the user to describe their validation strategy in detail — this is the critical input
- The user MUST explain how the agent should know a step is done. Examples:
  - "Run `npm test` and all tests must pass"
  - "Open a tmux session and test the CLI command as a user"
  - "Use the playwriter skill to open the browser and verify the UI renders correctly"
  - "Run the extension with `pi -e ./index.ts` in a tmux window and execute `/review test.md`"
  - A combination: "Run unit tests, then use playwriter to check the browser UI"
- You MUST confirm you understand the validation strategy by summarizing it back
- You MUST NOT proceed without explicit user confirmation of the validation strategy
- You MUST check the implementation plan checklist for already-completed steps and offer to resume from the next incomplete step

## Steps

### 1. Load and Parse the Implementation Plan

Read the PDD artifacts and prepare for execution.

**Constraints:**
- You MUST read the following files:
  - `{project_dir}/design/detailed-design.md`
  - `{project_dir}/implementation/plan.md`
  - Any research files in `{project_dir}/research/`
- You MUST parse the checklist from `plan.md` to determine which steps are complete and which remain
- You MUST parse each step's details: objective, guidance, tests, integration notes, demo description
- You MUST present a summary to the user:
  - Total steps, completed steps, remaining steps
  - The validation strategy as understood
  - Estimated scope of work
- You MUST ask for confirmation before starting execution
- You MUST NOT begin execution without explicit user go-ahead

### 2. Prepare the Build Context

Assemble the context documents that each subagent will need.

**Constraints:**
- You MUST create a build context file at `{project_dir}/implementation/build-context.md` containing:
  - The full detailed design (or a focused summary if the design is very large)
  - The validation strategy
  - The current state of the implementation (which steps are done)
  - Any relevant research findings
- You MUST identify file paths and directories the subagents will need to create or modify
- You MUST verify that prerequisites exist (e.g., `package.json`, directory structure, dependencies)
- You SHOULD create any prerequisite files or directories that don't exist yet
- You MUST load any skills referenced in the validation strategy (e.g., playwriter, clipboard, notification)

### 3. Execute Steps

Execute each implementation step using a subagent, then validate.

**Constraints:**
- You MUST execute steps sequentially unless the user explicitly approved parallel execution
- For each step, you MUST follow this exact process:

#### 3a. Brief the Subagent

- You MUST construct a clear, self-contained prompt for the subagent that includes:
  - The step objective and guidance from the implementation plan
  - Relevant sections of the design doc (not the entire doc — only what's needed for this step)
  - The current file state (what exists, what was built in previous steps)
  - Explicit instructions on what files to create or modify
  - The test/verification criteria for this step
- You MUST NOT include the entire design doc in every subagent prompt — extract only relevant sections
- You MUST include the project's file structure context so the subagent knows where things are

#### 3b. Launch the Subagent

- You MUST use the `subagent` tool to execute the step
- You SHOULD use async mode for steps that are expected to take a long time
- You MUST monitor the subagent's progress if running async (check status periodically)
- You MUST capture the subagent's output for review

#### 3c. Verify the Step

- You MUST verify the step is complete using the user-defined validation strategy
- You MUST NOT skip validation — this is the critical gate
- Validation methods (use whichever the user specified):

  **Automated tests:**
  - Run the test command (e.g., `npm test`, `pytest`, etc.)
  - All tests must pass
  - Check test output for failures

  **Tmux manual testing:**
  - Use `rho_subagent` to open a tmux window with the test scenario
  - Or use `bash` to run commands in a tmux session
  - Verify expected output or behavior

  **Playwriter browser validation:**
  - Load the playwriter skill
  - Navigate to the relevant URL
  - Verify UI elements render correctly
  - Check for visual regressions or interaction issues

  **File verification:**
  - Read created/modified files to verify they match expectations
  - Check that code compiles/parses correctly
  - Verify file structure matches the design

  **Combination:**
  - Execute each validation method in sequence
  - All must pass for the step to be considered done

#### 3d. Handle Failures

- If validation fails, you MUST:
  1. Analyze the failure — what went wrong?
  2. Determine if it's a subagent error (bad code) or a design issue (spec is wrong)
  3. For subagent errors: retry the step with additional context about the failure (max 2 retries)
  4. For design issues: STOP and notify the user — do not attempt to fix design problems autonomously
  5. Include the failure details and any error output in the retry prompt
- You MUST NOT retry more than 2 times per step without user intervention
- You MUST NOT silently skip failed validation
- After 2 failed retries, you MUST stop and present the situation to the user with:
  - What was attempted
  - What failed and why
  - The subagent's output
  - Your recommendation for how to proceed

#### 3e. Update the Checklist

- On successful validation, you MUST update the checklist in `plan.md` to mark the step as complete (`[x]`)
- You MUST write a brief status note to `{project_dir}/implementation/build-log.md` with:
  - Step number and name
  - Timestamp
  - Validation result
  - Any notable decisions or deviations
- You MUST notify the user of progress (e.g., "Step 3/12 complete: Web UI shell")

### 4. Integration Validation

After all steps are complete, validate the full system.

**Constraints:**
- You MUST run the complete validation strategy against the finished implementation
- You MUST verify that all checklist items are marked complete
- You MUST test the end-to-end flow described in the design doc
- You SHOULD run any additional integration tests that span multiple steps
- If integration issues are found, you MUST:
  1. Identify which step(s) are affected
  2. Determine the fix
  3. Either fix directly or launch a targeted subagent
  4. Re-validate after fixing

### 5. Report Results

Present a final summary to the user.

**Constraints:**
- You MUST create a build report at `{project_dir}/implementation/build-report.md` containing:
  - Total steps executed
  - Steps that passed on first attempt vs. required retries
  - Any deviations from the original design
  - Known issues or limitations discovered during build
  - Validation results summary
- You MUST present the report to the user in conversation
- You MUST highlight any areas that need manual attention
- You MUST suggest next steps (e.g., "TUI mode follow-up", "deploy to global extensions", etc.)

## Examples

### Example 1: CLI Extension with Tests
```
Project dir: .agents/planning/2026-02-10-review-extension
Validation strategy: Run `npm test` in the extension directory after each step.
For steps that add UI, also run `pi -e ./index.ts` in a tmux window and
execute the /review command to verify it works interactively.
```

### Example 2: Browser UI with Playwriter
```
Project dir: .agents/planning/2026-02-10-review-extension
Validation strategy: After each step that changes the UI, use the playwriter
skill to open http://localhost:<port> and verify:
- The page loads without console errors
- Key elements are visible (sidebar, code viewer, buttons)
- Interactions work (click file, click line number, type comment)
For non-UI steps, verify files exist and code parses without errors.
```

### Example 3: Full Manual Testing
```
Project dir: .agents/planning/2026-02-10-review-extension
Validation strategy: After each step, open a tmux split and run the
extension. Test it as a user would — try the happy path, try edge cases,
try to break it. Report what works and what doesn't. Use the notification
skill to alert me if a step fails after retries.
```

### Example 4: Hybrid
```
Project dir: .agents/planning/2026-02-10-review-extension
Validation strategy:
- Steps 1-2: verify files exist and `npm install` succeeds
- Steps 3-6: use playwriter to check the browser UI renders
- Steps 7-8: use playwriter to test submit/cancel WebSocket flow
- Steps 9-10: run `pi -e ./index.ts` in tmux and test /review command
- Steps 11-12: full playwriter mobile viewport test + manual tmux test
```

## Troubleshooting

### Subagent Produces Wrong Code
- Include more design context in the retry prompt
- Reference specific sections of the design doc
- Include the error output verbatim
- If the subagent consistently misunderstands, break the step into smaller sub-steps

### Validation Is Flaky
- Add retries with delays for timing-sensitive checks (e.g., server startup)
- For browser validation, add explicit waits for elements
- For tmux testing, allow time for commands to complete

### Step Dependencies Are Wrong
- If a step fails because a previous step's output is wrong, fix the earlier step first
- Update the build log to note the dependency issue
- Re-run both steps in order

### Design Doc Has Gaps
- STOP — do not guess at missing requirements
- Note the gap in the build log
- Ask the user for clarification
- Resume after the gap is resolved
