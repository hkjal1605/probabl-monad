// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { VaultAuditBase } from "./VaultAuditBase.t.sol";

/// @dev Verification (expected to pass): with the supply squeezed to a few wei above the dead
///      shares and inflated by claim donations, a victim's deposit and exit lose only rounding,
///      and the attacker who set it up never ends ahead in any world.
contract TinySupplyInflationTest is VaultAuditBase {
    function testFuzzTinySupplyDonationNeverExtracts(
        uint256 keep,
        uint256 donateQuote,
        uint256 donateBase,
        uint256 qBudget,
        uint256 bBudget,
        bool attackerLeavesFirst
    ) public {
        // The attacker ends up the only holder besides the dead shares, with 1..1e6 wei shares.
        uint256 all = vault.balanceOf(vaultAdmin);
        vm.prank(vaultAdmin);
        ok(vault.transfer(attacker, all), "share transfer");
        keep = 1 + keep % 1e6;
        vm.prank(attacker);
        vault.withdraw(all - keep, 0, 0, attacker, attacker);
        eq(supply(), 1000 + keep, "tiny supply");

        fund(attacker, 10_000_000e6, 100_000e18);
        uint256[4] memory a0 = wealth(attacker);
        // Credit the attacker's `keep` shares at their pro-rata value (rounded up) before the
        // setup: anything above that at the end would be extracted from the victim.
        {
            uint256[4] memory w = worlds(ops.holdings());
            for (uint256 i; i < 4; ++i) {
                a0[i] += (w[i] * keep + supply() - 1) / supply();
            }
        }
        // Donations of unpaired claims inflate every share (the dead ones included).
        donateQuote = 1 + donateQuote % 1_000_000e6;
        donateBase = 1 + donateBase % 10_000e18;
        _donate(attacker, market, YES, 0, donateQuote);
        _donate(attacker, market, NO, 1, donateBase);

        qBudget = 1 + qBudget % 5_000_000e6;
        bBudget = 1 + bBudget % 50_000e18;
        give(carol, qBudget, bBudget);
        uint256[4] memory c0 = wealth(carol);
        vm.prank(carol);
        try vault.deposit(qBudget, bBudget, 1, carol) returns (uint256 shares, uint256, uint256) {
            if (attackerLeavesFirst) {
                vm.prank(attacker);
                vault.withdraw(keep, 0, 0, attacker, attacker);
            }
            vm.prank(carol);
            vault.withdraw(shares, 0, 0, carol, carol);
            if (!attackerLeavesFirst) {
                vm.prank(attacker);
                vault.withdraw(keep, 0, 0, attacker, attacker);
            }
        } catch (bytes memory reason) {
            ok(
                bytes4(reason) == DeltaVaultBase.Slippage.selector
                    || bytes4(reason) == DeltaVaultBase.CapExceeded.selector,
                "unexpected deposit failure"
            );
            vm.prank(attacker);
            vault.withdraw(keep, 0, 0, attacker, attacker);
        }
        uint256[4] memory c1 = wealth(carol);
        uint256[4] memory a1 = wealth(attacker);
        for (uint256 i; i < 4; ++i) {
            ok(c1[i] <= c0[i], "victim profited");
            ok(c0[i] - c1[i] <= 4, "victim lost more than rounding");
            ok(a1[i] <= a0[i], "attacker ended ahead");
        }
    }
}
