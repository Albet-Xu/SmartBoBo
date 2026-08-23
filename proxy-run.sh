#!/usr/bin/env bash
# ============================================================
# BoBo - run a command with the local proxy (Linux / macOS)
#
# Sets HTTPS_PROXY / HTTP_PROXY / ALL_PROXY so that the
# camourfox browser kernel download (from GitHub, currently
# unreachable without a proxy) and uv/PyPI traffic can go
# through the local proxy at 127.0.0.1:7890.
#
# Usage (run from the project root):
#     ./proxy-run.sh uv sync
#     ./proxy-run.sh uv run camoufox fetch
#
# This script only affects the child process it launches;
# it does NOT change your shell or system settings.
# ============================================================
export HTTPS_PROXY="http://127.0.0.1:7890"
export HTTP_PROXY="http://127.0.0.1:7890"
export ALL_PROXY="http://127.0.0.1:7890"
export NO_PROXY="127.0.0.1,localhost,172.16.17.13"
"$@"
