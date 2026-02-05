Feature: iPhone/Termius SSH support
  Rho should be usable from an iPhone via SSH (Termius or any SSH client)
  connecting to a server running Rho in tmux.

  Background:
    Given Rho is installed on a Linux or macOS server
    And the server is accessible via SSH

  Scenario: SSH-friendly tmux config ships with Rho
    Given the rho repo contains configs/tmux-rho.conf
    Then the config enables mouse support
    And the config sets escape-time to 10ms for low-latency SSH
    And the config sets a large scroll buffer (10000 lines)
    And the config sets a clean mobile-friendly status bar
    And the config binds sensible pane/window keys

  Scenario: install.sh installs tmux config on linux/macos
    Given the platform is linux or macos
    And no ~/.tmux.conf exists
    When I run install.sh
    Then configs/tmux-rho.conf is copied to ~/.tmux.conf
    And the installer prints a message about the tmux config

  Scenario: install.sh does not overwrite existing tmux config
    Given the platform is linux or macos
    And ~/.tmux.conf already exists
    When I run install.sh
    Then ~/.tmux.conf is not modified
    And the installer prints a skip message

  Scenario: rho command auto-reattaches to existing session
    Given a rho tmux session is running
    When I run "rho"
    Then it attaches to the existing session without creating a new one
    # This already works -- verify no regression

  Scenario: Termius setup guide exists
    Given the rho repo
    Then docs/iphone-setup.md exists
    And it covers: installing Rho on a server
    And it covers: installing Termius on iPhone
    And it covers: adding the server as a host
    And it covers: connecting and running rho
    And it covers: reconnection after disconnect
    And it covers: Tailscale for home servers
    And it covers: Termius keyboard toolbar tips

  Scenario: VPS setup guide exists
    Given the rho repo
    Then docs/vps-setup.md exists
    And it covers: Oracle Cloud free tier (always-free ARM instance)
    And it covers: Hetzner/DigitalOcean budget options
    And it covers: installing Rho on a fresh VPS
    And it covers: SSH key setup
    And it covers: firewall basics

  Scenario: README mentions iPhone/SSH path
    Given the rho repo README.md
    Then there is an "iPhone / iPad" section in Quick Start
    And it references docs/iphone-setup.md
    And it shows the basic SSH workflow
