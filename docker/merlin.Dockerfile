FROM oven/bun:1.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl build-essential \
  && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --no-modify-path --profile minimal \
  && rustup component add clippy

WORKDIR /workspace/core

COPY core/package.json ./
COPY core/tsconfig.json ./
RUN bun install

COPY core/ ./

CMD ["bun", "run", "start"]
