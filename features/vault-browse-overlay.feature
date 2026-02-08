Feature: /vault-search browse overlay
  As a rho user
  I want an interactive vault search overlay
  So that I can find and link notes quickly while chatting

  Background:
    Given the vault exists at ~/.rho/vault
    And vault-search is enabled

  # ---------------------------------------------------------------------------
  # Entry points
  # ---------------------------------------------------------------------------

  Scenario: /vault-search opens overlay in interactive mode
    Given the session is running with UI enabled
    When the user types "/vault-search"
    Then a centered overlay should open
    And it should show a query input

  Scenario: /vault-search errors clearly without UI
    Given the session is running without UI
    When the user types "/vault-search"
    Then the command should return an error mentioning "interactive"

  # ---------------------------------------------------------------------------
  # Search + preview
  # ---------------------------------------------------------------------------

  Scenario: Searching shows results
    Given the vault contains a note titled "Agentic note taking"
    And the session is running with UI enabled
    When the user types "/vault-search"
    And enters the query "agentic"
    Then the results list should include "Agentic note taking"

  Scenario: Selecting a result shows a preview
    Given the results list includes a note "Agentic note taking"
    When the user selects the result
    Then a preview pane should show the note content (or a truncated preview)

  # ---------------------------------------------------------------------------
  # Linking
  # ---------------------------------------------------------------------------

  Scenario: Enter inserts wikilink into editor
    Given a result is selected with slug "agentic-note-taking"
    When the user presses Enter
    Then the editor should receive the text "[[agentic-note-taking]]"
