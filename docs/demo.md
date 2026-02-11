# Demo

A quick, repeatable demo you can run in a live pi session. It shows the check-in loop and brain stats.

## Prereqs

- Full install of rho (extensions + skills + brain)
- `tmux` installed (`pkg install tmux`)
- Optional: Tasker + AutoInput for the `/tasker` step

## 1. Add a reminder and task

```bash
# Add a daily reminder (goes into brain.jsonl)
pi -p --no-session "Use the brain tool to add a reminder: 'Check for urgent messages' with daily cadence at 9am"

# Add a checklist task
pi -p --no-session "Use the brain tool to add a task: 'Review any failed commands from recent sessions' with high priority"
```

## 2. Run the demo (inside a pi session)

```text
What is rho? One sentence.
Always use ripgrep over grep when searching.
# start a new pi session
pi --no-session --thinking minimal
When you search code here, which tool should you use for me?
/rho now
```

Optional Tasker UI read (if configured):

```text
/tasker read_screen
```

## Expected behavior

- The assistant answers the one-sentence question.
- The brain tool stores the preference and confirms it.
- In the new session, the assistant recalls the preference and mentions ripgrep organically.
- `/rho now` triggers a check-in (inline or in a tmux heartbeat window).
- The check-in reads reminders and tasks from the brain, ends with `RHO_OK` if everything is fine.
- `/tasker read_screen` returns visible UI text and element coordinates.
