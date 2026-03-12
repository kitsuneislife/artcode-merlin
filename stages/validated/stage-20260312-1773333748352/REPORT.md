# Stage stage-20260312-1773333748352

## Resultado

- Status: VALIDATED
- Branch base: main
- Commit final: 598d2cd6af29fe31e9b1e3f6a00a54e2e1adf68f
- Alvo: interpreter
- Tipo: fix

## Gates

- cargo test --all: exit 0
- cargo clippy: exit 101
- cargo bench: exit 0
- benchmark gate: pass
- invariants: pass
- diff scope coherent: pass
- stability met: pass (3/3 commits limpos)
- changelog generated: yes

## Notas

- Invariantes verificados: 1
- Baseline bench source: existing
- Regressao bench: -69.68% (limite 3.00%)