// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { VaultBase } from "./VaultBase.t.sol";

/// @dev Typical keeper and depositor transactions, measured with `--isolate`.
contract VaultGasTest is VaultBase {
    uint256[] internal live;

    function setUp() public override {
        super.setUp();
        // A four-order ladder already rests (two YES bids, two YES asks).
        DeltaVaultBase.Placement[] memory p = ladder(0);
        vm.prank(keeper);
        uint256[] memory keys = ops.update(market, new uint256[](0), p);
        for (uint256 i; i < keys.length; ++i) {
            live.push(keys[i]);
        }
        give(alice, 1_000_000e6, 10_000e18);
    }

    function ladder(uint64 shift) internal view returns (DeltaVaultBase.Placement[] memory p) {
        p = new DeltaVaultBase.Placement[](4);
        p[0] = vo(0, false, false, SPOT_TICKS - 20 - shift, 10 * NVDA);
        p[1] = vo(0, false, false, SPOT_TICKS - 40 - shift, 10 * NVDA);
        p[2] = vo(0, true, false, SPOT_TICKS + 20 + shift, 10 * NVDA);
        p[3] = vo(0, true, false, SPOT_TICKS + 40 + shift, 10 * NVDA);
    }

    function testGasVaultQuoteFour() public {
        DeltaVaultBase.Placement[] memory p = ladder(5);
        vm.prank(keeper);
        ops.update(market, new uint256[](0), p);
    }

    function testGasVaultRequoteFour() public {
        DeltaVaultBase.Placement[] memory p = ladder(5);
        vm.prank(keeper);
        ops.update(market, live, p);
    }

    function testGasVaultDeposit() public {
        vm.prank(alice);
        vault.deposit(10_000e6, 100e18, 0, alice);
    }

    function testGasVaultWithdraw() public {
        uint256 shares = supply() / 100;
        vm.prank(vaultAdmin);
        vault.withdraw(shares, 0, 0, vaultAdmin, vaultAdmin);
    }

    function testGasVaultWithdrawLocked() public {
        // Nearly all free quote is withdrawn first, so the next withdrawal needs escrow.
        uint256 shares = supply() / 2;
        vm.prank(vaultAdmin);
        vault.withdraw(shares, 0, 0, vaultAdmin, vaultAdmin);
        shares = supply() / 2;
        vm.prank(vaultAdmin);
        vault.withdraw(shares, 0, 0, vaultAdmin, vaultAdmin);
    }
}
