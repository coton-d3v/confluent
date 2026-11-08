#!/bin/sh
# Secrets are runtime configuration (ROADMAP E02.09): with DOPPLER_TOKEN set, Doppler injects them;
# without it, the process reads the environment provided by the orchestrator (compose, etc.).
set -e
if [ -n "${DOPPLER_TOKEN:-}" ]; then
  exec doppler run -- "$@"
fi
exec "$@"
