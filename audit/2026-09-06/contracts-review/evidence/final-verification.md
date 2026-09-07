# Final contract-audit verification

Run on 2026-09-06 from `packages/contracts` after adding `test/AuditFindings.t.sol`.

## Tool versions

- Forge: `1.7.1-Homebrew` (`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`)
- Bun: `1.3.14`
- Solidity: `0.8.30` through Foundry
- Slither: unavailable
- Aderyn: unavailable
- Semgrep: unavailable

## Commands

| Command | Exit/result |
| --- | --- |
| `FOUNDRY_PROFILE=ci forge test -vv` | 0; 63 passed, 0 failed, 0 skipped |
| `forge test --match-contract AuditFindingsTest -vv` | 0; 6 passed, 0 failed, 0 skipped |
| `forge coverage --ir-minimum --report summary` | 0; 63 passed, 0 failed, 0 skipped |
| `forge fmt --check` | 0 |
| `forge lint` | 0 |
| `bun run typecheck` | 0 |
| `forge build --sizes` | 0 |

The CI-profile arithmetic tests each ran 10,000 fuzz cases. The two integration fuzz tests each ran
256 cases under their file-specific CI settings.

## Production-source coverage

The coverage command warns that `--ir-minimum` can produce inaccurate source mappings. The reported
aggregate was:

| Metric | Coverage |
| --- | ---: |
| Lines | 92.01% (714/776) |
| Statements | 89.28% (899/1007) |
| Branches | 41.55% (59/142) |
| Functions | 96.64% (115/119) |

## Bytecode size

The largest first-party runtime was `ConditionalExchange` at 22,622 bytes, leaving 1,954 bytes below
the 24,576-byte EIP-170 limit. All first-party initcode and runtime sizes passed Foundry's size check.

## Snapshot identifiers

- Production Solidity path/hash-list SHA-256:
  `30826606edf2cbb6ea70f7a5909e2e92679b37ea02eb6d476b91b24bff344586`
- Pinned CTF runtime Keccak-256:
  `0xadf1ee4719c637975ba08765e3a1187f2fb865c9b17386005960a81ff29cfcc7`
- No Git commit was available because the workspace was not a usable Git checkout.
