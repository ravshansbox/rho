# Rho E2E Test — full install + CLI lifecycle in a clean container.
# No LLM keys needed. Tests install, config, CLI, doctor, and tmux session.
#
# Build & run:
#   docker build -t rho-e2e -f tests/e2e/Dockerfile .
#   docker run --rm rho-e2e
#
# Or use the wrapper:
#   ./tests/e2e/run.sh

FROM docker.io/library/node:22-bookworm

# System deps (tmux + git are required by rho)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux \
    git \
    procps \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Install pi globally (rho depends on it)
RUN npm install -g @mariozechner/pi-coding-agent

# Create a non-root user (rho expects a real HOME)
RUN useradd -m -s /bin/bash tester
USER tester
WORKDIR /home/tester

# Set npm global prefix to user-writable dir (for any npm install -g in install.sh)
RUN mkdir -p /home/tester/.npm-global \
    && npm config set prefix /home/tester/.npm-global

# Ensure ~/.local/bin and npm-global/bin are on PATH
ENV PATH="/home/tester/.local/bin:/home/tester/.npm-global/bin:${PATH}"
ENV HOME="/home/tester"
# Suppress Node experimental warnings in test output
ENV NODE_NO_WARNINGS=1

# Copy the repo (simulates a developer checkout; path is arbitrary)
USER root
COPY --chown=tester:tester . /home/tester/rho
USER tester

# Run the e2e test script
CMD ["bash", "/home/tester/rho/tests/e2e/test-e2e.sh"]
