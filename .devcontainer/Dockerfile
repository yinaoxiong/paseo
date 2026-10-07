FROM mcr.microsoft.com/devcontainers/javascript-node:24-trixie

COPY --from=ghcr.io/astral-sh/uv:0.12.23 /uv /usr/local/bin/uv
COPY ensure-deps.py /usr/local/lib/paseo-devcontainer/ensure-deps.py

# Use local mirrors for additional packages; Git is already in the base image.
RUN sed -i 's|http://deb.debian.org/debian|https://mirrors.tencent.com/debian|g; s|https://deb.debian.org/debian|https://mirrors.tencent.com/debian|g' /etc/apt/sources.list.d/debian.sources
