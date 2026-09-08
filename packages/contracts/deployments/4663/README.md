# Robinhood mainnet deployment — 2026-09-08

Status: all 12 contracts deployed and wired successfully on chain **4663**.
This is the owner-authorized internal-mainnet experiment, not public-production approval.
No markets were created, no services were started, and no tester-wallet allowlist was added.

The [deployment manifest](v2-0x6bba1ddd7173d207daeb80cbc8f66eef7b2d8abb.json)
records constructor arguments, bytecode/source/lock hashes, transaction receipts and roles.
The [read-only verification evidence](verification-2026-09-08.json) records the checks
and finality observed after deployment. The transaction journal is
`deployment-0x7c2e81c16df690f0fef9d472682f88f0b4ad5f6d-nonce0.jsonl`.

## Addresses

| Contract | Address |
| --- | --- |
| ConditionalTokens | `0x509E319A1bA0C429596A05294594D884F5610D73` |
| ProtocolAuthority | `0x6Bba1dDD7173d207dAEb80cbc8F66eeF7B2d8ABb` |
| MarketRegistry | `0x1879c9161E56f274Fd107C6265bc5a80aA0B49B5` |
| ManualResolutionController | `0x3775baC90DAf126828f2eEc4d49F0EE7089C9685` |
| ConditionalExchange | `0x05ebC8a330e5dFbade8F7912286B5Ada4EcE618a` |
| OrderValidator | `0x55b76717C9cC90f5044FA422ac496049b2491cfb` |
| PayoutVault | `0x391F746653a8542003669343A918da0851DD2D51` |
| ProtocolFeeVault | `0x16cfe20B7a1a81F4210f3214144F36E0d45582F9` |
| ConditionalSettlement | `0x35d12210008358b370a8250195ADF8dF4a5D16a4` |
| AtomicOrderRouter | `0xf5187230dC7849d866e42C0011c29eF62c99238E` |
| OrderRecoveryRouter | `0xEcEf1fA3C58C0DE7Ee141f78A6db0Ad400dE4cad` |
| PositionRouter | `0x57C89817F52c33c2D3aC5f57bA7124dC48EB8F8B` |

Existing USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 decimals).
Earliest deployment block / indexer start: **57869333**.
PayoutVault was created inside the exchange constructor, not in a separate EOA transaction.

## Verification and cost

- 16 successful transactions: 11 EOA creations and 5 configuration/handover transactions.
- Deployment gas used: **22,742,009**.
- Actual deployment fees: **0.00547604087437 ETH**.
- Deployer balance afterwards: **0.00352395912563 ETH**, from the funded **0.009 ETH**.
- Maker and taker fees are both **0 bps**.
- Source/lock identity, reconstructed installed runtimes, deployment/configuration inputs
  and receipts, dependency wiring, exact role membership and delayed handover were checked.
- Contract source digest: `59cf66d386d2310dc5aae9844919017f56ee997cfd708be899bb5637227b3593`.
- At the recorded 17:33:56 UTC check, transactions had successful sequencer receipts,
  but the RPC `safe` and `finalized` tags had not yet reached the deployment.
  Receipt success is not a claim of Ethereum finality; recheck before relying on finalized state.
  A 17:38:33 UTC recheck confirmed the final configuration receipt remained canonical;
  the safe/finalized tags were still behind the deployment.

The full release verifier correctly rejects the still-pending final-admin handover.
This is an expected release gate, not a bytecode or wiring mismatch.

Explorer source verification is **not complete**. The explorer API returned an HTTP 403
browser challenge. A subsequent Forge verification attempt was stopped by permission
review because source publication makes repository Solidity source public. Obtain explicit
owner approval before publishing, then follow the
[Blockscout verification instructions](https://docs.blockscout.com/devs/verification/foundry-verification).
No source was published by this deployment task.

## Required administrator handover

Current temporary administrator/deployer: `0x7c2e81c16dF690F0fEF9d472682f88f0b4Ad5f6D`.
Pending final administrator: `0x4D00cfD3495c1E0e7280E74Ba92af3163Ad0531f`.

The final administrator must call `acceptDefaultAdminTransfer()` **after** the scheduled
timestamp **1789061446**: September 10, 2026, **17:30:46 UTC / 23:00:46 IST**.
Allow at least one second beyond that timestamp; the contract checks that the delay has passed.

Unsigned transaction details for that future action:

- Chain ID: `4663`
- From: `0x4D00cfD3495c1E0e7280E74Ba92af3163Ad0531f`
- To: `0x6Bba1dDD7173d207dAEb80cbc8F66eeF7B2d8ABb`
- Value: `0`
- Data: `0xcefc1429`

This acceptance was **not** sent. It needs authorization from the final administrator,
not the deployer, and gas if that administrator is an EOA. After acceptance, run the
unchanged `verify:v2` with this manifest. The market-creation CLI requires that gate to pass.
No delay, permission or verification check was weakened for deployment.

## Environment and operational follow-up

The untracked root `.env` now contains all 12 backend contract addresses, six existing
frontend address settings, both manifest paths and the earliest deployment block.
Other environment values were preserved; file permissions remain `0600`.
The API and indexer environment loaders accept the new configuration. The indexer's
read-only onchain preflight also passed on chain 4663 at block 57873409, checking the
configured contract code, dependency graph, execution version and manifest identity.

Manifest paths currently point to this local workspace; update paths when provisioning
the server. Never copy the deployer private key into frontend configuration or long-running
service environments. Rebuild the UI/admin UI with their public address settings when those
deployments are requested. Database provisioning, service deployment, end-to-end live trades,
source publication and the scheduled final-admin acceptance remain separate follow-up work.

Do not rerun `deploy:v2` to finish the handover: it deploys a new contract graph. Preserve this
manifest and transaction journal. The one-shot operator wrapper refuses a nonzero deployer
nonce and cannot silently repeat this deployment.
