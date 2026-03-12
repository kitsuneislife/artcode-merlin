FROM oven/bun:1.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl build-essential openssh-client \
  && rm -rf /var/lib/apt/lists/*

# SSH config: usar chave dedicada para github.com, aceitar fingerprint
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh \
  && ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null \
  && printf 'Host github.com\n  IdentityFile /root/.ssh/merlin_deploy_key\n  StrictHostKeyChecking yes\n' > /root/.ssh/config

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
