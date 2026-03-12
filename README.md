# Merlin for Artcode

Bootstrap inicial do sistema Merlin com estrutura canonica, infraestrutura Docker e nucleo TypeScript do agente.

## Estado Atual

- Estrutura de pastas completa
- `docker-compose.yml` funcional com `ollama` e `merlin-agent`
- Scripts operacionais `scripts/up.sh` e `scripts/down.sh`
- Configuracao canonica em `config/merlin.toml`
- Contrato inicial em `contracts/invariants.toml`
- Core com ciclo executavel: Observer -> Planner -> Builder -> Validator
- Builder com branch de stage, commit de marker, gates e descarte em falha
- Validator com artifacts em `stages/validated/<stage-id>/`
- Planner com tentativa de plano via Ollama e fallback validado
- Gate de invariantes ativo no Validator (parse de TOML + checker command)
- Gate de regressao de benchmark ativo com baseline persistido em `baselines/original-benchmark-baseline.json`
- Validator com auditoria de diff fork->original e `CHANGELOG.md` gerado automaticamente por stage

## Subir Stack

```bash
chmod +x scripts/up.sh scripts/down.sh
./scripts/up.sh
```

## Desligar Stack

```bash
./scripts/down.sh
```

## Observacoes

- O Observer gera snapshot em `baselines/` e registra execucao no SQLite.
- A verificacao de invariantes hoje cobre consistencia estrutural e comando configuravel em `contracts.checker_command`.
- O gate de benchmark usa threshold de `max_bench_regression_pct` contra baseline canonica persistida.

