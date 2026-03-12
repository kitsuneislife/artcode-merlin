# artcode-merlin

> Sistema de auto-evolução controlada para projetos de linguagem e compiladores.

Merlin não é um bot que escreve código aleatoriamente. É um **engenheiro autônomo** que observa o estado de um projeto, raciocina sobre o que evoluir, experimenta com segurança e valida cada mudança — em ciclo contínuo, com total rastreabilidade.

O humano mantém controle absoluto: Merlin propõe via Pull Request, humano decide o merge.

---

## Como funciona

```
┌─────────────────────────────────────────────────────────────┐
│                     ciclo contínuo                          │
│                                                             │
│   Observer  →  Planner  →  Builder  →  Validator  →  PR    │
│      ↑                                     │               │
│      └─────────────── loop ────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### Observer
Mede o estado atual do fork: testes, benchmarks, clippy, cobertura, distância de commits em relação ao original. Nunca interpreta — só emite um snapshot JSON.

### Planner
Recebe o snapshot + histórico de experimentos do SQLite + roadmap do projeto original e chama o **Qwen2.5-Coder 7B** (via Ollama local) para raciocinar sobre o que evoluir. Sempre produz um plano válido — se o LLM falhar, o fallback é determinístico.

### Builder
Cria uma branch `stage-{id}` no fork, aplica as mudanças do plano e roda os gates de qualidade:
- `cargo test --all` — zero tolerância a falhas
- `cargo clippy` — zero warnings novos
- `cargo bench` — regressão > 3% = descarte

Se todos passam: merge no fork. Se qualquer um falha: rollback completo, fork volta ao estado anterior. Nenhum experimento quebrado fica no histórico.

### Validator
Avalia o **estado acumulado** do fork. Gera REPORT.md, CHANGELOG.md e, quando o checklist de 8 gates está 100% verde, abre o PR automaticamente.

---

## Dois repositórios, papéis diferentes

```
artcode/           ← original (você controla)
artcode-merlin/
  └── fork/artcode/ ← fork vivo (Merlin controla)
```

- **Original**: Merlin nunca commita aqui. Montado como `read-only` no container — restrição física.
- **Fork**: Merlin commita livremente. Git log completo e auditável. Nunca é resetado.

O PR `fork → original` é a proposta formal. Você revisa, você decide.

---

## Features

- **LLM local** — Qwen2.5-Coder 7B via Ollama. Sem dados saindo da sua máquina.
- **Memória de longo prazo** — SQLite persiste histórico de experimentos e feedback de PRs rejeitados. O Planner aprende com ciclos anteriores.
- **3 camadas de proteção contra regressão**: invariantes de contrato, baseline de benchmarks, clippy limpo.
- **Contratos de linguagem** — `contracts/invariants.toml` define programas que *sempre* devem compilar e produzir o mesmo output. Violação = descarte imediato.
- **Auditoria de diff** — o Validator avalia coerência do escopo antes de propor o PR.
- **Changelog automático** — gerado a partir dos commits do fork para cada stage.
- **Shutdown gracioso** — `SIGINT`/`SIGTERM` espera o ciclo atual terminar antes de parar.
- **Zero dependências no host** — tudo roda em Docker. Só Docker é necessário.

---

## Stack

| Componente | Tecnologia |
|---|---|
| Agente | Bun + TypeScript strict |
| LLM | Ollama + Qwen2.5-Coder 7B |
| Banco de dados | SQLite (bun:sqlite) |
| Config | TOML (@iarna/toml) |
| Orquestração | Docker Compose |
| Testes | bun:test — 89 testes, 14 arquivos |

---

## Estrutura

```
artcode-merlin/
├── core/                  # Agente Merlin (TypeScript)
│   └── src/
│       ├── observer/      # Coleta métricas do fork
│       ├── planner/       # Raciocina via Ollama + SQLite
│       ├── builder/       # Branch → gates → commit/rollback
│       ├── validator/     # 8 gates + REPORT + CHANGELOG
│       ├── contracts/     # Verificação de invariantes
│       ├── baselines/     # Gestão de baseline de benchmarks
│       ├── stages/        # Estabilidade + integração
│       ├── fork/          # Init do clone
│       ├── pr/            # Automação de PR (GitHub API)
│       ├── db/            # Schema SQLite
│       └── lib/           # Config, Logger, Types
├── config/
│   └── merlin.toml        # Configuração canônica
├── contracts/
│   ├── invariants.toml    # O que NUNCA pode regredir
│   └── programs/          # Programas de teste dos invariantes
├── docker/
│   ├── merlin.Dockerfile
│   └── ollama.Dockerfile
├── stages/                # Metadados de stages (validated, integrated)
├── baselines/             # Snapshots de métricas
├── db/                    # SQLite (volume persistido)
├── logs/                  # Logs JSON por ciclo
└── scripts/
    ├── up.sh              # Sobe tudo
    └── down.sh            # Derruba tudo (dados preservados)
```

---

## Pré-requisitos

- Docker + Docker Compose
- O repositório `artcode` clonado no diretório pai (ou configurado via `.env`)

---

## Como rodar

### 1. Configurar

```bash
cp docker/.env.example .env
# Edite .env:
# GITHUB_TOKEN=ghp_...          (para PRs automáticos)
# ARTCODE_REPO_PATH=../artcode  (path do artcode original)
# OLLAMA_MODEL=qwen2.5-coder:7b
```

### 2. Subir a stack

```bash
chmod +x scripts/up.sh scripts/down.sh
./scripts/up.sh
```

Na primeira execução, o Ollama baixa o modelo (~4.7 GB). Depois disso, fica em cache no volume.

### 3. Acompanhar

```bash
# Logs do agente em tempo real
docker compose logs -f merlin-agent

# Logs do LLM
docker compose logs -f ollama

# Status dos serviços
docker compose ps
```

### 4. Parar

```bash
./scripts/down.sh          # Para tudo, preserva dados
docker compose down -v     # Para tudo e remove volumes (use com cuidado)
```

---

## Comandos úteis

```bash
# Rodar um único ciclo para testar
docker compose run --rm -e MERLIN_MAX_ITERATIONS=1 merlin-agent bun run src/index.ts

# Rodar os testes
docker compose run --rm --no-deps merlin-agent bun run verify

# Pausar o agente sem derrubar o Ollama
docker compose stop merlin-agent
docker compose start merlin-agent
```

---

## Configuração (`config/merlin.toml`)

```toml
[target]
original = "/workspace/original"  # artcode original (read-only)
fork = "/workspace/fork"          # fork vivo (read-write)
branch_prefix = "stage"

[llm]
provider = "ollama"
model = "qwen2.5-coder:7b"
base_url = "http://ollama:11434"

[thresholds]
max_bench_regression_pct = 3.0
max_coverage_drop_pct = 1.0
clipy_zero_warnings = true

[cycle]
auto_plan = true
auto_build = true
auto_pr = true
require_human_merge = true  # imutável
interval_seconds = 300
max_iterations = 0          # 0 = infinito

[stages]
stability_min_commits = 3
```

---

## O que o Merlin nunca faz

- Commitar diretamente no `artcode` original
- Fazer merge de PRs (sempre requer aprovação humana)
- Ignorar uma falha de teste
- Sobrescrever um baseline sem registro
- Rodar dois stages em paralelo
- Alterar `contracts/invariants.toml` autonomamente
- Remover histórico do SQLite
- Expor o Ollama fora da rede Docker interna
- Resetar ou reescrever o histórico do fork

---

## Reusabilidade

Merlin é agnóstico ao projeto-alvo. Para usar em outro projeto:

1. Crie um novo repositório `{projeto}-merlin`
2. Copie este repositório como template
3. Edite `.env` com o path do novo repo
4. Edite `merlin.toml` — só `[target]` e `[thresholds]` mudam
5. Defina `contracts/invariants.toml` para o novo projeto
6. `./scripts/up.sh`

O core (Observer, Planner, Builder, Validator) não muda. Dockerfiles não mudam.

