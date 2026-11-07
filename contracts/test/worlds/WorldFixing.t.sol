// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { WorldBooksBase } from "../../src/worlds/WorldBooksBase.sol";
import { BookDef } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { MockPriceFeed } from "../mocks/MockPriceFeed.sol";
import { WorldsBase } from "./WorldsBase.t.sol";

/// @dev Fixing, the two-key fallback, decisions and redemption.
contract WorldFixingTest is WorldsBase {
    uint16 internal constant ABOVE_240 = 0x70;
    uint16 internal constant BELOW_240 = 0x0E;
    uint256 internal constant FIXING = T0 + 28 days;
    uint64 internal id;

    function setUp() public override {
        super.setUp();
        id = create(pricedDef());
        // Maya's world bet, Ben's opposite bet and Carol's conditional payout.
        fill(makerKey, quote(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        fill(makerKey, quote(id, bob, BELOW_240, 3000e6, 0, false, 60e6));
        fill(makerKey, quote(id, carol, ABOVE_240, 250e6, 100e6, false, 100e6));
    }

    /// Posts a feed round at `at` (at most now).
    function _round(uint80 roundId, int256 price, uint256 at) internal {
        feed.update(roundId, price, at);
    }

    function _toFixing() internal {
        passAll();
        vm.warp(FIXING - 10 minutes);
        _round(2, 245e8, FIXING - 10 minutes);
        vm.warp(FIXING + 1);
    }

    // ------------------------------------------------------------ proposals

    function testFixingNeedsEveryLegAndTheTime() public {
        vm.warp(FIXING);
        vm.expectRevert(WorldBooksBase.InvalidState.selector);
        wb.proposeFix(id, 1);
        resolve(A, YES);
        resolve(B, YES);
        vm.expectRevert(WorldBooksBase.InvalidState.selector);
        wb.proposeFix(id, 1);
        resolve(C, YES);
        vm.warp(FIXING - 1);
        vm.expectRevert(WorldBooksBase.InvalidState.selector);
        wb.proposeFix(id, 1);
    }

    function testRoundMustBeAtOrBeforeTheFixingAndFresh() public {
        passAll();
        vm.warp(FIXING - 2 hours);
        _round(2, 245e8, FIXING - 2 hours); // too old: more than 1 h before the fixing
        vm.warp(FIXING - 1 hours);
        _round(3, 246e8, FIXING - 1 hours); // exactly 1 h old: fresh enough
        vm.warp(FIXING + 5);
        _round(4, 247e8, FIXING + 5); // after the fixing
        vm.expectRevert(WorldBooksBase.InvalidFix.selector);
        wb.proposeFix(id, 2);
        vm.expectRevert(WorldBooksBase.InvalidFix.selector);
        wb.proposeFix(id, 4);
        // A missing round reverts in the feed.
        vm.expectRevert(MockPriceFeed.NoDataPresent.selector);
        wb.proposeFix(id, 77);
        // Round 3 is the last at or before the fixing: its successor is later.
        wb.proposeFix(id, 3);
        eq(wb.fix(id).price, 246e8, "proposed");
        eq(wb.fix(id).roundId, 3, "round");
    }

    /// The audit's attack: with two rounds in the window, the earlier one can't be proposed, so
    /// nobody can pick the price that suits them and wait out the window.
    function testOnlyTheLastRoundCanBeProposed() public {
        passAll();
        vm.warp(FIXING - 30 minutes);
        _round(2, 235e8, FIXING - 30 minutes);
        vm.warp(FIXING - 1);
        _round(3, 245e8, FIXING - 1);
        vm.warp(FIXING + 10 minutes);
        vm.expectRevert(WorldBooksBase.InvalidFix.selector);
        wb.proposeFix(id, 2);
        wb.proposeFix(id, 3); // the latest round
        // One proposal per book.
        vm.expectRevert(WorldBooksBase.StaleFix.selector);
        wb.proposeFix(id, 3);
        vm.warp(FIXING + 10 minutes + 1 hours - 1);
        vm.expectRevert(WorldBooksBase.FixWindow.selector);
        wb.finalizeFix(id);
        vm.warp(FIXING + 10 minutes + 1 hours);
        eq(wb.finalizeFix(id), 4, "245 is in [240, 250)");
    }

    function testASuccessorPastTheFixingProvesTheLastRound() public {
        passAll();
        vm.warp(FIXING - 5 minutes);
        _round(2, 235e8, FIXING - 5 minutes);
        vm.warp(FIXING + 1 minutes);
        _round(3, 262e8, FIXING + 1 minutes);
        vm.warp(FIXING + 2 minutes);
        wb.proposeFix(id, 2);
        vm.warp(FIXING + 2 minutes + 1 hours);
        eq(wb.finalizeFix(id), 3, "235 is in [230, 240)");
    }

    function testRoundIdGapsFallBackToTheTwoKeyPath() public {
        passAll();
        vm.warp(FIXING - 5 minutes);
        _round(2, 235e8, FIXING - 5 minutes);
        vm.warp(FIXING + 1 minutes);
        _round(5, 262e8, FIXING + 1 minutes); // rounds 3 and 4 never posted
        vm.expectRevert(WorldBooksBase.InvalidFix.selector);
        wb.proposeFix(id, 2);
        vm.expectRevert(WorldBooksBase.InvalidFix.selector);
        wb.proposeFix(id, 5);
        vm.warp(FIXING + 1 days);
        bytes32 h = wb.fixHash(id, 235e8, "evidence", "ipfs://fix");
        vm.prank(bookAdmin);
        wb.commitFix(id, h);
        vm.prank(resolver);
        eq(wb.resolveFix(id, 235e8, "evidence", "ipfs://fix"), 3, "fallback");
    }

    function testRoundsWithEqualTimestampsResolveToTheLaterId() public {
        passAll();
        vm.warp(FIXING - 1);
        _round(2, 235e8, FIXING - 1);
        _round(3, 245e8, FIXING - 1);
        vm.warp(FIXING);
        vm.expectRevert(WorldBooksBase.InvalidFix.selector);
        wb.proposeFix(id, 2);
        wb.proposeFix(id, 3);
    }

    function testNonPositiveAnswersAreRefused() public {
        passAll();
        vm.warp(FIXING - 1);
        _round(2, 0, FIXING - 1);
        vm.warp(FIXING);
        vm.expectRevert(WorldBooksBase.InvalidFix.selector);
        wb.proposeFix(id, 2);
        _round(3, -5, FIXING);
        vm.expectRevert(WorldBooksBase.InvalidFix.selector);
        wb.proposeFix(id, 3);
    }

    function testBucketBoundaries() public {
        int256[7] memory prices =
            [int256(1), 219.99999999e8, 220e8, 239.99999999e8, 240e8, 259.99999999e8, 260e8];
        uint8[7] memory expected = [1, 1, 2, 3, 4, 5, 6];
        for (uint256 i; i < prices.length; ++i) {
            uint256 snap = _snapshotState();
            passAllOnce();
            vm.warp(FIXING);
            _round(uint80(10 + i), prices[i], FIXING);
            wb.proposeFix(id, uint80(10 + i));
            vm.warp(FIXING + 1 hours);
            eq(wb.finalizeFix(id), expected[i], "bucket");
            _restore(snap);
        }
    }

    function testMaxPriceFixesTheTopBucket() public {
        _toFixing();
        _round(3, int256(uint256(type(uint128).max)), FIXING);
        wb.proposeFix(id, 3); // the latest round, at the fixing
        vm.warp(FIXING + 2 hours);
        eq(wb.finalizeFix(id), 6, "top");
    }

    function testAnswerAbove128BitsIsRefused() public {
        passAll();
        vm.warp(FIXING);
        _round(2, int256(uint256(type(uint128).max) + 1), FIXING);
        vm.expectRevert(WorldBooksBase.InvalidFix.selector);
        wb.proposeFix(id, 2);
    }

    // ------------------------------------------------------------ hold and fallback

    function testGuardianHoldForcesTheFallback() public {
        _toFixing();
        wb.proposeFix(id, 2);
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.Unauthorized.selector);
        wb.holdFix(id);
        vm.prank(guardian);
        wb.holdFix(id);
        vm.warp(FIXING + 2 hours);
        vm.expectRevert(WorldBooksBase.FixHeld.selector);
        wb.finalizeFix(id);
        vm.expectRevert(WorldBooksBase.FixHeld.selector);
        wb.proposeFix(id, 2);
        // The fallback is open at once while held.
        bytes32 h = wb.fixHash(id, 238e8, "evidence", "ipfs://fix");
        vm.prank(bookAdmin);
        wb.commitFix(id, h);
        vm.prank(resolver);
        eq(wb.resolveFix(id, 238e8, "evidence", "ipfs://fix"), 3, "fallback bucket");
        eq(wb.state(id), 7, "fixed");
        vm.prank(guardian);
        vm.expectRevert(WorldBooksBase.InvalidState.selector);
        wb.holdFix(id);
    }

    function testFallbackOpensAfterTheDeadlineWithoutAProposal() public {
        passAll();
        vm.warp(FIXING + 1 days - 1);
        bytes32 h = wb.fixHash(id, 250e8, "evidence", "ipfs://fix");
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.FixWindow.selector);
        wb.commitFix(id, h);
        vm.warp(FIXING + 1 days);
        vm.prank(bookAdmin);
        wb.commitFix(id, h);
        // A commitment blocks the feed path.
        vm.warp(FIXING + 1 days + 1);
        _round(2, 245e8, FIXING);
        vm.expectRevert(WorldBooksBase.FixHeld.selector);
        wb.proposeFix(id, 2);
        vm.prank(resolver);
        eq(wb.resolveFix(id, 250e8, "evidence", "ipfs://fix"), 5, "250 is in [250, 260)");
    }

    function testFallbackClosedWhileAProposalStands() public {
        _toFixing();
        wb.proposeFix(id, 2);
        vm.warp(FIXING + 2 days);
        bytes32 h = wb.fixHash(id, 250e8, "evidence", "ipfs://fix");
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.FixWindow.selector);
        wb.commitFix(id, h);
    }

    function testDeadlineCountsFromALateLegResolution() public {
        resolve(A, YES);
        resolve(B, YES);
        vm.warp(FIXING + 3 days);
        resolve(C, YES);
        bytes32 h = wb.fixHash(id, 250e8, "evidence", "ipfs://fix");
        vm.warp(FIXING + 3 days + 1 days - 1);
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.FixWindow.selector);
        wb.commitFix(id, h);
        vm.warp(FIXING + 4 days);
        vm.prank(bookAdmin);
        wb.commitFix(id, h);
    }

    function testFallbackChecks() public {
        passAll();
        vm.prank(guardian);
        wb.holdFix(id);
        vm.warp(FIXING);
        bytes32 h = wb.fixHash(id, 250e8, "evidence", "ipfs://fix");
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.Unauthorized.selector);
        wb.commitFix(id, h);
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        wb.commitFix(id, bytes32(0));
        vm.prank(resolver);
        vm.expectRevert(WorldBooksBase.Commitment.selector);
        wb.resolveFix(id, 250e8, "evidence", "ipfs://fix");
        vm.prank(bookAdmin);
        wb.commitFix(id, h);
        vm.startPrank(resolver);
        vm.expectRevert(WorldBooksBase.Commitment.selector);
        wb.resolveFix(id, 251e8, "evidence", "ipfs://fix");
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        wb.resolveFix(id, 0, "evidence", "ipfs://fix");
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        wb.resolveFix(id, 250e8, bytes32(0), "ipfs://fix");
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        wb.resolveFix(id, uint256(type(uint128).max) + 1, "evidence", "ipfs://fix");
        vm.stopPrank();
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.Unauthorized.selector);
        wb.resolveFix(id, 250e8, "evidence", "ipfs://fix");
        vm.prank(resolver);
        wb.resolveFix(id, 250e8, "evidence", "ipfs://fix");
        // Decided: nothing else applies.
        vm.prank(resolver);
        vm.expectRevert(WorldBooksBase.Commitment.selector);
        wb.resolveFix(id, 250e8, "evidence", "ipfs://fix");
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.InvalidState.selector);
        wb.commitFix(id, h);
        vm.expectRevert(WorldBooksBase.InvalidState.selector);
        wb.proposeFix(id, 1);
    }

    function testEventOnlyBooksHaveNoFixing() public {
        uint64 events = create(eventDef());
        passAll();
        vm.expectRevert(WorldBooksBase.InvalidState.selector);
        wb.proposeFix(events, 1);
        vm.prank(guardian);
        vm.expectRevert(WorldBooksBase.InvalidState.selector);
        wb.holdFix(events);
    }

    function testDecidedFailureHasNoFixing() public {
        resolve(A, NO);
        vm.warp(FIXING);
        vm.expectRevert(WorldBooksBase.InvalidState.selector);
        wb.proposeFix(id, 1);
    }

    // ------------------------------------------------------------ redemption

    function testWinnersRedeemAfterTheFixing() public {
        _toFixing();
        wb.proposeFix(id, 2); // 245
        vm.warp(FIXING + 2 hours);
        wb.finalizeFix(id);
        uint256 before = credit(alice);
        vm.prank(alice);
        eq(books.redeem(id), 1538e6, "maya wins 1,538");
        eq(credit(alice) - before, 1538e6, "credited");
        vm.prank(bob);
        eq(books.redeem(id), 0, "ben's atoms lose");
        eq(atoms(id, bob)[1], 0, "cleared");
        vm.prank(carol);
        eq(books.redeem(id), 250e6, "carol's payout units");
        vm.prank(maker);
        books.redeem(id);
        eq(wb.backing(id), 0, "every winning unit paid");
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.NothingToRedeem.selector);
        books.redeem(id);
        eq(wb.liability(), usdg.balanceOf(address(books)), "custody");
    }

    function testAWorldThatFailsRefundsAtomZero() public {
        resolve(B, NO);
        vm.prank(carol);
        eq(books.redeem(id), 100e6, "carol's refund");
        vm.prank(alice);
        eq(books.redeem(id), 0, "world bet lost");
        vm.prank(maker);
        eq(books.redeem(id), 3000e6 - 100e6, "maker's atom 0");
        eq(wb.backing(id), 0, "all paid");
    }

    function testRedeemBeforeTheDecisionReverts() public {
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.NotDecided.selector);
        books.redeem(id);
        _toFixing();
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.NotDecided.selector);
        books.redeem(id);
    }

    function testRedeemMany() public {
        uint64 events = create(eventDef());
        fill(makerKey, quote(events, alice, 0x02, 500, 0, false, 100));
        resolve(A, NO);
        uint64[] memory list = new uint64[](2);
        list[0] = id;
        list[1] = events;
        vm.prank(alice);
        eq(books.redeemMany(list), 0, "both lost");
        vm.prank(carol);
        vm.expectRevert(WorldBooksBase.NothingToRedeem.selector);
        books.redeemMany(list);
    }

    function testMergeAfterTheDecisionStaysConsistent() public {
        vm.prank(alice);
        books.split(id, 10);
        resolve(B, NO);
        // Split is closed once decided; a full set still merges for one unit.
        vm.prank(alice);
        books.merge(id, 4);
        vm.prank(maker);
        books.redeem(id);
        vm.prank(carol);
        books.redeem(id);
        eq(wb.backing(id), atoms(id, alice)[0], "backing = atom 0 left unredeemed");
        vm.prank(alice);
        eq(books.redeem(id), 6, "alice's atom 0");
        eq(wb.backing(id), 0, "all paid");
        eq(wb.liability(), usdg.balanceOf(address(books)), "custody");
    }

    // ------------------------------------------------------------ snapshots

    function passAllOnce() internal {
        (uint8 s,) = oracle.outcome(A);
        if (s == 0) passAll();
    }

    function _snapshotState() internal returns (uint256) {
        return SnapshotVm(address(vm)).snapshotState();
    }

    function _restore(uint256 snap) internal {
        SnapshotVm(address(vm)).revertToState(snap);
    }
}

interface SnapshotVm {
    function snapshotState() external returns (uint256);
    function revertToState(uint256) external returns (bool);
}
