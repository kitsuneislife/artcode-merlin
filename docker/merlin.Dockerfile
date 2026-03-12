FROM oven/bun:1.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/core

COPY core/package.json ./
COPY core/tsconfig.json ./
RUN bun install

COPY core/ ./

CMD ["bun", "run", "start"]
