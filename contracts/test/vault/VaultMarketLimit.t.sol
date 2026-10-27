// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { VaultBase } from "./VaultBase.t.sol";

/// @dev Deposits and withdrawals are in kind across every registered market, so `MAX_MARKETS`
///      bounds their gas. With the vault full and holding unpaired claims in every market (the
///      worst case), both stay far below a block's gas, so LPs can always exit.
contract VaultMarketLimitTest is VaultBase {
    /// A quarter of a 32M-gas block.
    uint256 internal constant EXIT_GAS_CEILING = 8_000_000;
    address internal taker = address(0xB0B);

    function setUp() public override {
        super.setUp();
        fund(taker, 10_000_000e6, 100_000e18);
        give(alice, 10_000_000e6, 100_000e18);
    }

    /// @dev The vault sells 1 NVDA in YES and buys 1 NVDA in NO in the current market, both
    ///      filled: unpaired YES quote and NO stock claims.
    function trade() internal {
        DeltaVaultBase.Placement[] memory p = new DeltaVaultBase.Placement[](2);
        p[0] = vo(0, true, false, SPOT_TICKS + 20, NVDA);
        p[1] = vo(1, false, false, SPOT_TICKS - 20, NVDA);
        uint256[] memory keys = quote(p);
        fill(taker, keys[0], NVDA);
        fill(taker, keys[1], NVDA);
    }

    function testExitsStayCheapWithEveryMarketHeld() public {
        trade();
        while (ops.markets().length < vault.MAX_MARKETS()) {
            market = createMarket(uint40(now_() - 1), uint40(T0 + 30 days));
            vm.prank(marketAdmin);
            view_.lifecycle(market, 0, bytes32(0));
            vm.prank(curator);
            ops.addMarket(market, risk());
            trade();
        }
        uint256 shares = supply() / 100;
        uint256 before = gasleft();
        vm.prank(vaultAdmin);
        vault.withdraw(shares, 0, 0, vaultAdmin, vaultAdmin);
        uint256 withdrawGas = before - gasleft();
        before = gasleft();
        vm.prank(alice);
        vault.deposit(10_000e6, 100e18, 0, alice);
        uint256 depositGas = before - gasleft();
        ok(withdrawGas < EXIT_GAS_CEILING, "withdrawal gas");
        ok(depositGas < EXIT_GAS_CEILING, "deposit gas");
    }
}
