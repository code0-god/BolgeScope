# Revisit fixture

`revisit.mb` is a newly synthesized raw Malbolge program from a bounded offline search (seed `20260927`, attempt 3). It was independently run through the instrumented public-domain Olmstead C interpreter. The original verification trace and memory images are preserved read-only under `evidence/supervisor/extended/revisit-search-003/`.

Provenance/license: generated inside this project for this implementation, with no copied third-party program; distribution follows the project's license when one is chosen.

- SHA-256: `c7be2fb97a66b0d3f5b13ba4c2ec51c21e2ecf59af384e3464aecd428ecdbfa4`
- Input: `41 42 43 0A`
- Output: `D2 41 41 42 7C`
- Halt: step 27, A/C/D = 29550/62/86
- Generated address 99: decoded `o` then `C`; 100: `*` then `x`; 101: `<` then `n`.

This fixture tests actual revisits with changed runtime decoding. The 87-cell four-update regression remains a separate program.
