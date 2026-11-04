// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IWorldBooks, WorldQuote } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { WorldVault } from "../../src/worlds/vault/WorldVault.sol";
import { WorldVaultAdmin } from "../../src/worlds/vault/WorldVaultAdmin.sol";
import { WorldVaultBase } from "../../src/worlds/vault/WorldVaultBase.sol";
import { VaultWorldsBase } from "./VaultWorldsBase.t.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

interface PausableErrors {
    error EnforcedPause();
}

/// @dev Seed, requests, batches, marks, processing and claims.
contract WorldVaultBatchesTest is VaultWorldsBase {
    uint256 internal constant SUPPLY = SEED * 1e12; // 18-decimal shares, $1 each at the seed

    function _close() internal returns (uint64 batchId) {
        vm.warp(now_() + 1 days);
        batchId = vault.closeBatch();
    }

    function _mark(uint64 batchId, uint256 nav) internal {
        vm.prank(marker);
        vault.mark(batchId, nav);
    }

    // ------------------------------------------------------------ seed

    function testSeed() public view {
        eq(vault.totalSupply(), SUPPLY, "supply");
        eq(vault.balanceOf(address(0xdEaD)), 1000, "dead shares");
        eq(vault.balanceOf(vaultAdmin), SUPPLY - 1000, "admin shares");
        eq(vaultCredit(), SEED, "seed in books");
        eq(ops.refNav(), SEED, "ref nav");
        eq(ops.lastNavPerShare(), 1e24, "1 raw unit per 1e12 shares, x 1e36");
        (uint64 open, uint64 closed) = ops.batches();
        eq(open, 1, "batch 1 open");
        eq(closed, 0, "none closed");
    }

    function testSeedOnceByTheAdminAtAMinimum() public {
        vm.prank(vaultAdmin);
        vm.expectRevert(WorldVaultBase.AlreadySeeded.selector);
        vault.seed(1e6);
        WorldVault fresh = new WorldVault(IWorldBooks(address(books)), vaultAdmin, 1 days, "W", "W");
        vm.prank(alice);
        vm.expectRevert();
        fresh.seed(1e6);
        vm.startPrank(vaultAdmin);
        usdg.mint(vaultAdmin, 1e6);
        usdg.approve(address(fresh), type(uint256).max);
        vm.expectRevert(WorldVaultBase.InvalidAmount.selector);
        fresh.seed(1e6 - 1);
        fresh.seed(1e6);
        vm.stopPrank();
        eq(fresh.totalSupply(), 1e18, "one share");
        WorldVault unseeded =
            new WorldVault(IWorldBooks(address(books)), vaultAdmin, 1 days, "W", "W");
        vm.prank(alice);
        vm.expectRevert(WorldVaultBase.SeedRequired.selector);
        unseeded.requestDeposit(1);
        vm.prank(alice);
        vm.expectRevert(WorldVaultBase.SeedRequired.selector);
        unseeded.requestRedeem(1);
    }

    // ------------------------------------------------------------ requests

    function testDepositNeedsRoleCapAndNoPause() public {
        vm.prank(carol);
        vm.expectRevert(WorldVaultBase.NotDepositor.selector);
        vault.requestDeposit(1e6);
        vm.prank(vaultAdmin);
        ops.setOpenDeposits(true);
        vm.prank(carol);
        vault.requestDeposit(1e6);
        vm.prank(vaultAdmin);
        ops.setDepositCap(SEED + 100e6);
        vm.prank(alice);
        vm.expectRevert(WorldVaultBase.CapExceeded.selector);
        vault.requestDeposit(100e6);
        vm.prank(alice);
        vault.requestDeposit(99e6);
        vm.prank(alice);
        vm.expectRevert(WorldVaultBase.InvalidAmount.selector);
        vault.requestDeposit(0);
        vm.prank(sentinel);
        ops.pause();
        vm.prank(vaultAdmin);
        ops.setDepositCap(type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(PausableErrors.EnforcedPause.selector);
        vault.requestDeposit(1e6);
        // Redemptions are never paused.
        vm.prank(vaultAdmin);
        vault.requestRedeem(1e18);
    }

    function testCancelRequestsInTheOpenBatch() public {
        vm.prank(alice);
        vault.requestDeposit(100e6);
        uint256 before = usdg.balanceOf(alice);
        vm.prank(alice);
        vault.cancelDeposit(40e6);
        eq(usdg.balanceOf(alice) - before, 40e6, "refunded");
        (uint256 assets,) = ops.requests(1, alice);
        eq(assets, 60e6, "left");
        vm.prank(alice);
        vm.expectRevert(WorldVaultBase.InvalidAmount.selector);
        vault.cancelDeposit(61e6);
        vm.prank(vaultAdmin);
        vault.requestRedeem(5e18);
        vm.prank(vaultAdmin);
        vault.cancelRedeem(2e18);
        (, uint256 shares) = ops.requests(1, vaultAdmin);
        eq(shares, 3e18, "shares left");
        // Once closed, the requests are fixed: cancels apply to the new open batch only.
        _close();
        vm.prank(alice);
        vm.expectRevert(WorldVaultBase.InvalidAmount.selector);
        vault.cancelDeposit(1);
        vm.prank(vaultAdmin);
        vm.expectRevert(WorldVaultBase.InvalidAmount.selector);
        vault.cancelRedeem(1);
    }

    // ------------------------------------------------------------ batches

    function testDepositBatchMintsAtTheMark() public {
        vm.prank(alice);
        vault.requestDeposit(100_000e6);
        vm.expectRevert(WorldVaultBase.BatchState.selector);
        vault.closeBatch();
        uint64 b = _close();
        eq(b, 1, "batch 1");
        WorldVaultBase.Batch memory bt = ops.batch(1);
        eq(bt.guaranteed, SEED, "guaranteed");
        eq(bt.best, SEED, "best");
        eq(bt.supply, SUPPLY, "supply");
        (uint64 open, uint64 closed) = ops.batches();
        eq(open, 2, "next open");
        eq(closed, 1, "awaiting mark");
        // Requests now join batch 2, which cannot close before batch 1 is marked.
        vm.prank(bob);
        vault.requestDeposit(1e6);
        vm.warp(now_() + 1 days);
        vm.expectRevert(WorldVaultBase.BatchState.selector);
        vault.closeBatch();
        _mark(1, SEED);
        bt = ops.batch(1);
        eq(bt.minted, 100_000e6 * SUPPLY / SEED, "minted at $1");
        vault.claim(1, alice);
        eq(vault.balanceOf(alice), 1e23, "alice's shares");
        eq(vaultCredit(), SEED + 100_000e6, "deposit moved into books");
        eq(ops.refNav(), SEED + 100_000e6, "ref nav");
        vm.expectRevert(WorldVaultBase.NothingToClaim.selector);
        vault.claim(1, alice);
        vm.expectRevert(WorldVaultBase.BatchState.selector);
        vault.claim(2, bob);
    }

    function testEmptyBatchDoesNotClose() public {
        vm.warp(now_() + 2 days);
        vm.expectRevert(WorldVaultBase.BatchState.selector);
        vault.closeBatch();
    }

    function testRedemptionPaysAtTheMark() public {
        vm.prank(vaultAdmin);
        vault.requestRedeem(1e23);
        uint64 b = _close();
        _mark(b, SEED);
        uint256 before = usdg.balanceOf(vaultAdmin);
        vault.claim(b, vaultAdmin);
        eq(usdg.balanceOf(vaultAdmin) - before, 100_000e6, "paid $1 a share");
        eq(vault.totalSupply(), SUPPLY - 1e23, "burned");
        eq(ops.refNav(), SEED - 100_000e6, "ref nav");
    }

    function testWithdrawLimitFillsPartlyAndHandsTheRestBack() public {
        vm.prank(vaultAdmin);
        ops.setWithdrawLimit(1000); // 10% of supply per batch
        vm.prank(vaultAdmin);
        vault.requestRedeem(SUPPLY / 2);
        uint64 b = _close();
        _mark(b, SEED);
        WorldVaultBase.Batch memory bt = ops.batch(b);
        eq(bt.filled, SUPPLY / 10, "10% filled");
        eq(bt.paid, SEED / 10, "paid");
        uint256 sharesBefore = vault.balanceOf(vaultAdmin);
        vault.claim(b, vaultAdmin);
        eq(vault.balanceOf(vaultAdmin) - sharesBefore, SUPPLY / 2 - SUPPLY / 10, "unfilled back");
    }

    function testRedemptionIsLimitedByFreeCredit() public {
        _bigRisk();
        // Most of the vault's credit goes into a book.
        for (uint256 i; i < 9; ++i) {
            vfill(keeperKey, vq(id, alice, ABOVE_240, 100_000e6, 0, false, 1_000e6));
        }
        uint256 free = vaultCredit();
        ok(free < 200_000e6, "little free credit");
        vm.prank(vaultAdmin);
        vault.requestRedeem(SUPPLY / 2);
        uint64 b = _close();
        WorldVaultBase.Batch memory bt = ops.batch(b);
        vm.prank(vaultAdmin);
        ops.setMaxMarkMove(10_000);
        // Marked at its best value, half the shares are worth more than the free credit.
        _mark(b, bt.best);
        bt = ops.batch(b);
        ok(bt.paid <= free, "paid within free credit");
        ok(bt.filled < SUPPLY / 2, "partly filled");
        eq(vaultCredit(), free - bt.paid, "credit paid out");
    }

    function testMarkBoundsAndMoveLimit() public {
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        vm.prank(alice);
        vault.requestDeposit(10e6);
        uint64 b = _close();
        WorldVaultBase.Batch memory bt = ops.batch(b);
        eq(bt.guaranteed, SEED - 1518e6, "guaranteed");
        eq(bt.best, SEED + 20e6, "best");
        vm.startPrank(marker);
        vm.expectRevert(WorldVaultBase.MarkBounds.selector);
        vault.mark(b, bt.guaranteed - 1);
        vm.expectRevert(WorldVaultBase.MarkBounds.selector);
        vault.mark(b, bt.best + 1);
        vm.stopPrank();
        vm.prank(vaultAdmin);
        ops.setMaxMarkMove(10); // 0.1% per share
        vm.prank(marker);
        vm.expectRevert(WorldVaultBase.MarkMove.selector);
        vault.mark(b, bt.guaranteed);
        vm.prank(alice);
        vm.expectRevert();
        vault.mark(b, SEED);
        vm.prank(alice);
        vm.expectRevert();
        ops.approveMark(b, bt.guaranteed);
        vm.prank(sentinel);
        ops.approveMark(b, bt.guaranteed);
        (bool approved, uint256 nav) = ops.approvedMark(b);
        ok(approved && nav == bt.guaranteed, "approved");
        // Only that exact value is approved.
        vm.prank(marker);
        vm.expectRevert(WorldVaultBase.MarkMove.selector);
        vault.mark(b, bt.guaranteed + 1);
        _mark(b, bt.guaranteed);
        eq(ops.lastNavPerShare(), bt.guaranteed * 1e36 / SUPPLY, "nav per share");
    }

    function testFloorProcessingAfterTheTimeout() public {
        vm.prank(alice);
        vault.requestDeposit(10e6);
        uint64 b = _close();
        vm.warp(now_() + 3 days - 1);
        vm.expectRevert(WorldVaultBase.BatchState.selector);
        vault.processAtFloor(b);
        vm.warp(now_() + 1);
        vault.processAtFloor(b);
        WorldVaultBase.Batch memory bt = ops.batch(b);
        eq(bt.nav, SEED, "at guaranteed");
        eq(bt.status, 3, "processed");
        ok(bt.refunded, "deposits refunded at the floor");
        eq(bt.minted, 0, "nothing minted");
        uint256 before = usdg.balanceOf(alice);
        vault.claim(b, alice);
        eq(usdg.balanceOf(alice) - before, 10e6, "deposit back");
        vm.expectRevert(WorldVaultBase.BatchState.selector);
        vault.processAtFloor(b);
        vm.prank(marker);
        vm.expectRevert(WorldVaultBase.BatchState.selector);
        vault.mark(b, SEED);
    }

    function testNothingGuaranteedRefundsDepositsAndReturnsShares() public {
        // A small vault that put all of its credit at risk.
        WorldVault small = new WorldVault(IWorldBooks(address(books)), vaultAdmin, 1 days, "S", "S");
        WorldVaultAdmin sops = WorldVaultAdmin(address(small));
        vm.startPrank(vaultAdmin);
        sops.grantRole(small.KEEPER_ROLE(), keeper);
        sops.grantRole(small.CURATOR_ROLE(), curator);
        sops.setDepositCap(type(uint256).max);
        sops.setOpenDeposits(true);
        usdg.mint(vaultAdmin, 1e6);
        usdg.approve(address(small), type(uint256).max);
        small.seed(1e6);
        vm.stopPrank();
        vm.startPrank(curator);
        sops.setLimits(limits());
        WorldVaultBase.Risk memory k = risk();
        k.maxLossBps = 10_000;
        k.maxDailyExposureBps = 10_000;
        sops.setRisk(k);
        sops.setFeed(address(feed), true);
        vm.stopPrank();
        WorldQuote memory q = quote(id, alice, ABOVE_240, 1.01e6, 0, false, 0.01e6);
        q.nonce = uint256(uint160(address(small))) << 96 | 1;
        q.makerData = makerData(0, now_());
        vfill(keeperKey, q);
        eq(wb.credit(address(small)), 0, "all at risk");
        vm.prank(alice);
        usdg.approve(address(small), type(uint256).max);
        vm.prank(alice);
        small.requestDeposit(5e6);
        vm.prank(vaultAdmin);
        small.requestRedeem(1e17);
        vm.warp(now_() + 1 days);
        uint64 b = small.closeBatch();
        vm.warp(now_() + 3 days);
        small.processAtFloor(b);
        WorldVaultBase.Batch memory bt = sops.batch(b);
        ok(bt.refunded, "refunded");
        eq(bt.paid, 0, "nothing paid");
        uint256 before = usdg.balanceOf(alice);
        small.claim(b, alice);
        eq(usdg.balanceOf(alice) - before, 5e6, "deposit back");
        uint256 shares = small.balanceOf(vaultAdmin);
        small.claim(b, vaultAdmin);
        eq(small.balanceOf(vaultAdmin) - shares, 1e17, "shares back");
    }

    function testDepositsAndRedemptionsNetInOneBatch() public {
        vm.prank(alice);
        vault.requestDeposit(50_000e6);
        vm.prank(vaultAdmin);
        vault.requestRedeem(5e22);
        uint64 b = _close();
        _mark(b, SEED);
        vault.claim(b, alice);
        vault.claim(b, vaultAdmin);
        eq(vault.balanceOf(alice), 5e22, "minted");
        eq(vaultCredit(), SEED, "net zero flow");
        eq(ops.refNav(), SEED, "ref nav");
    }

    function testRoundTripNeverProfits() public {
        vfill(keeperKey, vq(id, carol, ABOVE_240, 1538e6, 0, false, 20e6));
        vm.prank(alice);
        vault.requestDeposit(333_333_333);
        uint64 b = _close();
        _mark(b, SEED - 7); // an odd value: shares round down
        vault.claim(b, alice);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.requestRedeem(shares);
        b = _close();
        // The same value per share as the deposit was priced at.
        _mark(b, SEED - 7 + 333_333_333);
        uint256 before = usdg.balanceOf(alice);
        vault.claim(b, alice);
        ok(usdg.balanceOf(alice) - before <= 333_333_333, "no profit from rounding");
    }

    function testManyClaimantsShareExactly() public {
        address[3] memory who = [alice, bob, carol];
        vfill(keeperKey, vq(id, carol, ABOVE_240, 1538e6, 0, false, 20e6));
        vm.prank(vaultAdmin);
        ops.setOpenDeposits(true);
        for (uint256 i; i < 3; ++i) {
            vm.prank(who[i]);
            vault.requestDeposit(1_000_001 + i);
        }
        uint64 b = _close();
        _mark(b, SEED - 3);
        WorldVaultBase.Batch memory bt = ops.batch(b);
        uint256 sum;
        for (uint256 i; i < 3; ++i) {
            vault.claim(b, who[i]);
            sum += vault.balanceOf(who[i]);
        }
        ok(sum <= bt.minted, "never more than minted");
        (,, uint256 escrow) = ops.held();
        eq(vault.balanceOf(address(vault)), escrow, "escrow is the dust");
    }

    function testHeldAccounting() public {
        vm.prank(alice);
        vault.requestDeposit(70e6);
        vm.prank(vaultAdmin);
        vault.requestRedeem(4e18);
        (uint256 pending, uint256 owed, uint256 escrow) = ops.held();
        eq(pending, 70e6, "pending");
        eq(owed, 0, "owed");
        eq(escrow, 4e18, "escrow");
        uint64 b = _close();
        _mark(b, SEED);
        (pending, owed, escrow) = ops.held();
        eq(pending, 0, "pending after");
        eq(owed, 4e6, "owed after");
        eq(escrow, 70e6 * 1e12, "minted escrow");
        eq(usdg.balanceOf(address(vault)), owed, "vault holds what it owes");
    }

    /// The audit's M-1: at the floor, deposits are refunded rather than bought at the price most
    /// favourable to them; redemptions pay the guaranteed value; the last mark stays the
    /// reference.
    function testFloorRefundsDepositsAndKeepsTheLastMark() public {
        _bigRisk();
        vfill(keeperKey, vq(id, carol, ABOVE_240, 100_000e6, 0, false, 1_000e6));
        uint256 lastBefore = ops.lastNavPerShare();
        uint256 refBefore = ops.refNav();
        vm.prank(alice);
        vault.requestDeposit(500_000e6);
        vm.prank(vaultAdmin);
        vault.requestRedeem(1e23);
        uint64 b = _close();
        WorldVaultBase.Batch memory bt = ops.batch(b);
        vm.warp(now_() + 3 days);
        vault.processAtFloor(b);
        bt = ops.batch(b);
        ok(bt.refunded, "refunded");
        eq(bt.paid, Math.mulDiv(1e23, bt.guaranteed, SUPPLY), "redemptions at guaranteed");
        eq(ops.lastNavPerShare(), lastBefore, "last mark kept");
        eq(ops.refNav(), refBefore - bt.paid, "reference less the redemptions");
        uint256 before = usdg.balanceOf(alice);
        vault.claim(b, alice);
        eq(usdg.balanceOf(alice) - before, 500_000e6, "alice whole");
        eq(vault.balanceOf(alice), 0, "no shares at the floor");
    }

    function _bigRisk() internal {
        WorldVaultBase.Risk memory k = risk();
        k.maxBookRisk = type(uint128).max;
        k.maxLegRisk = type(uint128).max;
        k.maxLossBps = 10_000;
        k.maxDailyExposureBps = 10_000;
        vm.prank(curator);
        ops.setRisk(k);
    }
}
