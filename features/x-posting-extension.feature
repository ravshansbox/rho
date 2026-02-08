Feature: X posting extension (native Pi tooling)
  As a rho user
  I want X posting to be available as a Pi extension
  So that I can draft, queue, and post with a safe confirmation flow

  Background:
    Given the X extension is enabled
    And the X data directory exists at ~/.config/xpost

  # ---------------------------------------------------------------------------
  # Store formats
  # ---------------------------------------------------------------------------

  Scenario: Corrections are append-only JSONL
    When the LLM calls x(action="correct", bad="foo", good="bar", rule="No emojis")
    Then a line should be appended to ~/.config/xpost/corrections.jsonl
    And the line should be valid JSON

  Scenario: Queue entries are append-only JSONL
    When the LLM calls x(action="queue_add", profile="tau", text="hello")
    Then a line should be appended to ~/.config/xpost/queue.jsonl
    And the queue entry should include fields id, created, profile, kind, text, status

  # ---------------------------------------------------------------------------
  # Tool surface
  # ---------------------------------------------------------------------------

  Scenario: Listing the queue returns queued items
    Given 2 queued items exist
    When the LLM calls x(action="queue_list")
    Then the tool result should list 2 items

  Scenario: Posting requires confirmation in interactive sessions
    Given the session is running with UI enabled
    When the LLM calls x(action="post", profile="tau", text="hello")
    Then the user should be prompted to confirm the post
    And the post should only be sent after confirmation

  Scenario: Headless posting is blocked by default
    Given the session is running without UI
    When the LLM calls x(action="post", profile="tau", text="hello")
    Then the tool should return an error mentioning "confirm" or "interactive"

  # ---------------------------------------------------------------------------
  # Slash command UX
  # ---------------------------------------------------------------------------

  Scenario: /x opens the queue overlay
    Given the session is running with UI enabled
    When the user types "/x"
    Then a queue overlay should open
    And it should list queued drafts

  Scenario: Approving a queued post sends it
    Given the queue overlay is open
    And a queued item is selected
    When the user approves posting
    Then the post should be sent
    And the queue item should be marked sent or removed
