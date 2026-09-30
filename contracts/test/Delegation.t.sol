// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";
import { Base } from "./Base.t.sol";

contract DelegationTest is Base {
    uint256 internal constant NVDA = 1e18;

    function _approve(address owner, uint8 permissions) internal {
        vm.prank(owner);
        view_.approveDelegate(
            bot, 0, uint40(T0 + 7 days), 1_000e6, 2_000e6, 5e18, 10e18, 100, permissions
        );
    }

    function _delegated(
        address owner,
        uint8 branch,
        bool sell,
        uint64 ticks,
        uint256 qty,
        uint256 m
    ) internal returns (uint256) {
        O memory o = O(market, branch, sell, false, m != 0, 100, uint40(T0 + 1 days), ticks, qty);
        uint256 p = plan(seqOf(market, branch), now_() + 60, 0);
        vm.prank(bot);
        return cs.placeFor(owner, pack(o), p, m);
    }

    function testDelegatedPlacementChargesBudgetAndKeepsProceedsWithOwner() public {
        _approve(alice, 1);
        uint256 k = _delegated(alice, YES, false, 20_000, 2 * NVDA, 0);
        ConditionalStocksBase.Grant memory g = view_.grant(alice, bot);
        eq(g.remainingQuote, 1_600e6, "charged full notional");
        (ConditionalStocksBase.Order memory o, address d) = view_.order(k);
        ok(o.owner == alice && d == bot, "owner and delegate recorded");
        eq(credit(alice, address(usdc)), 1_000_000e6 - 400e6, "owner funds");

        vm.prank(bob);
        cs.split(market, 1, NVDA);
        uint256 ask = rest(bob, YES, true, true, 19_000, NVDA);
        _delegated(alice, YES, false, 19_000, NVDA, one(uint32(ask)));
        eq(acct(alice, YES).base, NVDA, "stock to owner");
        eq(acct(bot, YES).base, 0, "nothing to delegate");
    }

    function testDelegateLimits() public {
        _approve(alice, 1);
        O memory o = O(market, YES, false, false, false, 100, uint40(T0 + 1 days), 20_000, 6 * NVDA);
        uint256 p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.expectRevert(ConditionalStocksBase.DelegateBudget.selector);
        vm.prank(bot);
        cs.placeFor(alice, pack(o), p, 0); // $1200 > $1000 per order.
        o.quantity = 5 * NVDA;
        o.maxFee = 101;
        vm.expectRevert(ConditionalStocksBase.InvalidDelegation.selector);
        vm.prank(bot);
        cs.placeFor(alice, pack(o), p, 0);
        o.maxFee = 100;
        o.expiry = uint40(T0 + 8 days);
        vm.expectRevert(ConditionalStocksBase.InvalidDelegation.selector);
        vm.prank(bot);
        cs.placeFor(alice, pack(o), p, 0);
        o.expiry = uint40(T0 + 1 days);
        vm.prank(bot);
        cs.placeFor(alice, pack(o), p, 0);
        p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.prank(bot);
        cs.placeFor(alice, pack(o), p, 0);
        p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.expectRevert(ConditionalStocksBase.DelegateBudget.selector);
        vm.prank(bot);
        cs.placeFor(alice, pack(o), p, 0);
    }

    function testRevocationStopsFillsAndMakesOrdersReleasable() public {
        _approve(alice, 1 | 2);
        uint256 k = _delegated(alice, YES, false, 20_000, NVDA, 0);
        vm.prank(alice);
        view_.revokeDelegate(bot);
        // Carol sells into the revoked bid: skipped.
        take(carol, YES, true, false, 20_000, NVDA, one(uint32(k)));
        eq(acct(carol, YES).quote, 0, "not filled");
        vm.prank(carol);
        cs.cancel(k); // Publicly releasable.
        eq(credit(alice, address(usdc)), 1_000_000e6, "refund to owner");
    }

    function testDelegateCancelNeedsPermission() public {
        _approve(alice, 1);
        uint256 k = _delegated(alice, YES, false, 20_000, NVDA, 0);
        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        vm.prank(bot);
        cs.cancel(k);
        _approve(alice, 1 | 2); // Re-approval replaces the grant: the old order is dead.
        vm.prank(bob);
        cs.cancel(k);
        uint256 k2 = _delegated(alice, YES, false, 20_000, NVDA, 0);
        vm.prank(bot);
        cs.cancel(k2);
    }

    function testRevokeAllAndExpiry() public {
        _approve(alice, 1);
        vm.prank(alice);
        view_.revokeAllDelegates();
        O memory o = O(market, YES, false, false, false, 100, uint40(T0 + 1 days), 20_000, NVDA);
        uint256 p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.expectRevert(ConditionalStocksBase.DelegationInactive.selector);
        vm.prank(bot);
        cs.placeFor(alice, pack(o), p, 0);
        _approve(alice, 1); // New grant under the new epoch.
        vm.warp(T0 + 7 days);
        o.expiry = uint40(T0 + 7 days + 1 hours);
        p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.expectRevert(ConditionalStocksBase.DelegationInactive.selector);
        vm.prank(bot);
        cs.placeFor(alice, pack(o), p, 0);
    }

    function testApprovalValidation() public {
        vm.startPrank(alice);
        vm.expectRevert(ConditionalStocksBase.InvalidDelegation.selector);
        view_.approveDelegate(alice, 0, uint40(T0 + 1 days), 1, 1, 0, 0, 0, 1);
        vm.expectRevert(ConditionalStocksBase.InvalidDelegation.selector);
        view_.approveDelegate(bot, 0, uint40(T0 + 91 days), 1, 1, 0, 0, 0, 1);
        vm.expectRevert(ConditionalStocksBase.InvalidDelegation.selector);
        view_.approveDelegate(bot, 0, uint40(T0 + 1 days), 2, 1, 0, 0, 0, 1);
        vm.expectRevert(ConditionalStocksBase.InvalidDelegation.selector);
        view_.approveDelegate(bot, 0, uint40(T0 + 1 days), 1, 1, 0, 0, 0, 2);
        vm.expectRevert(ConditionalStocksBase.InvalidDelegation.selector);
        view_.approveDelegate(bot, 99, uint40(T0 + 1 days), 1, 1, 0, 0, 0, 1);
        // Both sides disabled, or a base per-order limit above its total.
        vm.expectRevert(ConditionalStocksBase.InvalidDelegation.selector);
        view_.approveDelegate(bot, 0, uint40(T0 + 1 days), 0, 0, 0, 0, 0, 1);
        vm.expectRevert(ConditionalStocksBase.InvalidDelegation.selector);
        view_.approveDelegate(bot, 0, uint40(T0 + 1 days), 0, 0, 2, 1, 0, 1);
        // A sell-only grant is valid.
        view_.approveDelegate(bot, 0, uint40(T0 + 1 days), 0, 0, 1, 1, 0, 1);
        vm.stopPrank();
        vm.expectRevert(ConditionalStocksBase.InvalidDelegation.selector);
        vm.prank(bot);
        cs.placeFor(bot, 0, 0, 0);
    }
}
