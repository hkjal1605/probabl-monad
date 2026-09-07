# Settlement worker

Reliable, noncustodial submission of deterministic matcher fills. See
[`docs/architecture/order-gateway-settlement-v1.md`](../../docs/architecture/order-gateway-settlement-v1.md)
for the state model and [`docs/runbooks/settlement-worker.md`](../../docs/runbooks/settlement-worker.md)
for operations.

The service validates Ponder-confirmed proposal anchors and order quantities, simulates exact
`matchOrders`/`executeIOC` calldata, persists signed attempts before broadcast, owns explicit nonce
and replacement policy, and confirms only through indexed fills.

```bash
bun --filter @conditional-stocks/settlement-worker test
bun run dev:settlement:anvil
bun run e2e:milestone11:anvil
```
