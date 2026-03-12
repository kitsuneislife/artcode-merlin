# Stage stage-20260312-1773334177295

## Resultado

- Status: VALIDATED
- Branch base: main
- Commit final: 33eb81cdb8bfb6cfe81d7889cde63fd39c3816fb
- Alvo: interpreter
- Tipo: refactor

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
- Regressao bench: -69.75% (limite 3.00%)