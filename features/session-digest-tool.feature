Feature: session_digest tool (optional)
  As a rho user
  I want session logs to be digestible via a tool
  So that the LLM can inspect and summarize prior work reliably

  Background:
    Given the session_digest extension is enabled

  Scenario: Digest current session with defaults
    When the LLM calls session_digest()
    Then the tool should return a summary of the current session
    And the output should be bounded by maxChars

  Scenario: Digest supports limiting turns
    When the LLM calls session_digest(maxTurns=5)
    Then the tool should only include the last 5 turns

  Scenario: Digest errors clearly when logs are missing
    Given no session logs are available
    When the LLM calls session_digest()
    Then the tool should return an error mentioning "logs" or "session"