FROM node:24-bookworm-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:${PATH}

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    git \
    python3 \
    make \
    g++ \
    && corepack enable \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /open-mission

RUN mkdir -p /pnpm && chown -R node:node /pnpm /open-mission

USER node