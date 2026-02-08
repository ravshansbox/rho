Feature: /tasks overlay (interactive UI)
  As a rho user
  I want an interactive tasks overlay
  So that I can manage tasks quickly without leaving Pi

  Background:
    Given rho is installed and running
    And the tasks store at ~/.rho/tasks.jsonl exists (or will be created)

  # ---------------------------------------------------------------------------
  # Entry points
  # ---------------------------------------------------------------------------

  Scenario: /tasks opens overlay in interactive mode
    Given the session is running with UI enabled
    And 2 pending tasks exist
    When the user types "/tasks"
    Then a centered overlay should open
    And it should list the 2 pending tasks

  Scenario: /tasks remains text-only in headless mode
    Given the session is running without UI
    And 2 pending tasks exist
    When the user types "/tasks"
    Then the command should not crash
    And it should return a text list of pending tasks

  # ---------------------------------------------------------------------------
  # Basic operations
  # ---------------------------------------------------------------------------

  Scenario: Add a task from the overlay
    Given the tasks overlay is open
    When the user triggers "add" and enters "Write release notes"
    Then a new pending task "Write release notes" should be persisted
    And the overlay list should refresh

  Scenario: Mark a task done from the overlay
    Given the tasks overlay is open
    And a pending task exists with ID "abc123"
    When the user marks the task "abc123" as done
    Then the task status should be "done"
    And the overlay list should refresh

  Scenario: Remove a task from the overlay
    Given the tasks overlay is open
    And a pending task exists with ID "abc123"
    When the user removes the task "abc123"
    Then the task should no longer appear in the store

  # ---------------------------------------------------------------------------
  # Concurrency safety
  # ---------------------------------------------------------------------------

  Scenario: Overlay edits don't corrupt the JSONL store under concurrent writes
    Given the tasks overlay is open
    And the heartbeat may append or rewrite tasks concurrently
    When the user adds and completes tasks rapidly
    Then ~/.rho/tasks.jsonl should remain valid JSON on every line
