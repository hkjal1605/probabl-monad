// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";
import { Base } from "./Base.t.sol";

contract LifecycleTest is Base {
    uint256 internal constant NVDA = 1e18;
    bytes32 internal constant EVIDENCE = keccak256("evidence");
    string internal constant URI = "https://evidence.example/packet";

    function _resolve(uint8 yes, uint8 no) internal {
        vm.prank(guardian);
        view_.lifecycle(market, 1, keccak256("event ended"));
        bytes32 commitment = view_.resolutionHash(market, yes, no, EVIDENCE, URI);
        vm.prank(marketAdmin);
        view_.lifecycle(market, 3, commitment);
        vm.prank(resolver);
        view_.resolve(market, yes, no, EVIDENCE, URI);
    }

    function testCreateMarketValidation() public {
        ConditionalStocksBase.MarketParams memory p = params(uint40(T0), uint40(T0 + 1 days));
        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        view_.createMarket(p, "ipfs://metadata");
        p.metadataHash = keccak256("other");
        vm.expectRevert(ConditionalStocksBase.InvalidTerms.selector);
        vm.prank(marketAdmin);
        view_.createMarket(p, "ipfs://metadata");
        p = params(uint40(T0), uint40(T0 + 1 days));
        p.yesIndex = 1;
        p.noIndex = 1;
        vm.expectRevert(ConditionalStocksBase.InvalidTerms.selector);
        vm.prank(marketAdmin);
        view_.createMarket(p, "ipfs://metadata");
        p = params(uint40(T0), uint40(T0 + 1 days));
        p.maxOrder = 1e6 - 1;
        vm.expectRevert(ConditionalStocksBase.InvalidTerms.selector);
        vm.prank(marketAdmin);
        view_.createMarket(p, "ipfs://metadata");
        p = params(uint40(T0), uint40(T0 + 1 days));
        p.base = address(usdc);
        vm.expectRevert(ConditionalStocksBase.InvalidAddress.selector);
        vm.prank(marketAdmin);
        view_.createMarket(p, "ipfs://metadata");
    }

    function testOpenRequiresScheduledWindow() public {
        uint32 later = createMarket(uint40(T0 + 1 hours), uint40(T0 + 2 days));
        vm.expectRevert(ConditionalStocksBase.InvalidState.selector);
        vm.prank(marketAdmin);
        view_.lifecycle(later, 0, bytes32(0));
        vm.warp(T0 + 1 hours);
        vm.prank(marketAdmin);
        view_.lifecycle(later, 0, bytes32(0));
        eq(view_.terms(later).state, 2, "open");
    }

    function testAnyoneFreezesAtCutoff() public {
        vm.expectRevert(ConditionalStocksBase.InvalidState.selector);
        view_.lifecycle(market, 2, bytes32(0));
        vm.warp(T0 + 30 days);
        view_.lifecycle(market, 2, bytes32(0));
        eq(view_.terms(market).state, 3, "frozen");
    }

    function testResolutionRequiresMatchingCommitment() public {
        vm.prank(guardian);
        view_.lifecycle(market, 1, keccak256("event ended"));
        bytes32 commitment = view_.resolutionHash(market, 1, 0, EVIDENCE, URI);
        vm.prank(marketAdmin);
        view_.lifecycle(market, 3, commitment);
        vm.expectRevert(ConditionalStocksBase.Commitment.selector);
        vm.prank(resolver);
        view_.resolve(market, 0, 1, EVIDENCE, URI);
        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        vm.prank(marketAdmin);
        view_.resolve(market, 1, 0, EVIDENCE, URI);
        vm.prank(resolver);
        view_.resolve(market, 1, 0, EVIDENCE, URI);
        ConditionalStocksBase.Book memory b = view_.book(market);
        eq(b.payoutYes, 1, "yes payout");
        eq(b.payoutNo, 0, "no payout");
        eq(view_.terms(market).state, 6, "redeemable");
        ok(view_.evidence(market) == EVIDENCE, "evidence");
        ok(view_.commitment(market) == bytes32(0), "commitment cleared");
    }

    function _tradeYes() internal {
        vm.prank(bob);
        cs.split(market, 1, 10 * NVDA);
        uint256 ask = rest(bob, YES, true, true, 20_000, 4 * NVDA);
        take(alice, YES, false, false, 20_000, 4 * NVDA, one(uint32(ask)));
    }

    function testYesResolutionPaysYesClaims() public {
        _tradeYes();
        _resolve(1, 0);
        vm.prank(alice);
        cs.redeem(market, 1, 4 * NVDA, 0);
        eq(credit(alice, address(stock)), 10_000e18 + 4 * NVDA, "alice owns the stock");
        vm.prank(alice);
        cs.redeem(market, 0, 0, 800e6); // Quote-if-NO pays nothing.
        eq(credit(alice, address(usdc)), 1_000_000e6 - 800e6, "paid the trade");
        vm.prank(bob);
        cs.redeem(market, 0, 800e6, 0);
        eq(credit(bob, address(usdc)), 1_000_000e6 + 800e6, "bob was paid");
        vm.prank(bob);
        cs.redeem(market, 1, 6 * NVDA, 10 * NVDA);
        eq(credit(bob, address(stock)), 10_000e18 - 4 * NVDA, "bob keeps his unsold stock");
        eq(view_.backing(market).base, 0, "base backing drained");
        eq(view_.backing(market).quote, 0, "quote backing drained");
    }

    function testNoResolutionRestoresEveryone() public {
        _tradeYes();
        _resolve(0, 1);
        vm.prank(alice);
        cs.redeem(market, 0, 0, 800e6);
        vm.prank(alice);
        cs.redeem(market, 1, 4 * NVDA, 0);
        vm.prank(bob);
        cs.redeem(market, 1, 6 * NVDA, 10 * NVDA);
        vm.prank(bob);
        cs.redeem(market, 0, 800e6, 0);
        eq(credit(alice, address(usdc)), 1_000_000e6, "alice refunded");
        eq(credit(bob, address(stock)), 10_000e18, "bob keeps all stock");
    }

    function testInvalidResolutionPaysHalfAndRejectsFractions() public {
        _tradeYes();
        _resolve(1, 1);
        vm.expectRevert(ConditionalStocksBase.FractionalRedemption.selector);
        vm.prank(alice);
        cs.redeem(market, 0, 0, 800e6 + 1);
        vm.prank(alice);
        cs.redeem(market, 1, 4 * NVDA, 0);
        eq(credit(alice, address(stock)), 10_000e18 + 2 * NVDA, "half of the stock claims");
        vm.prank(alice);
        cs.redeem(market, 0, 0, 800e6);
        eq(credit(alice, address(usdc)), 1_000_000e6 - 400e6, "half of the quote claims");
    }

    function testRedeemBeforeResolutionFailsAndMergeAlwaysWorks() public {
        _tradeYes();
        vm.expectRevert(ConditionalStocksBase.InvalidState.selector);
        vm.prank(bob);
        cs.redeem(market, 1, NVDA, 0);
        vm.prank(guardian);
        view_.lifecycle(market, 1, keccak256("halt"));
        vm.prank(bob);
        cs.merge(market, 1, 6 * NVDA);
        eq(credit(bob, address(stock)), 10_000e18 - 4 * NVDA, "merged");
    }

    function testArchiveAfterRedeemable() public {
        _resolve(1, 0);
        vm.expectRevert(ConditionalStocksBase.InvalidState.selector);
        vm.prank(marketAdmin);
        view_.lifecycle(market, 4, bytes32(0));
        vm.prank(marketAdmin);
        view_.lifecycle(market, 4, keccak256("archived"));
        eq(view_.terms(market).state, 7, "archived");
    }

    function testClaimTransferAndFeeClaim() public {
        vm.prank(admin);
        view_.configure(marketAdmin, guardian, resolver, 0, 100);
        _tradeYes();
        ConditionalStocksBase.Fees memory f = view_.fees(market, YES);
        eq(f.base, 4 * NVDA / 100, "taker fee in stock-if-YES");
        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        view_.claimFees(market, YES, 1, carol, f.base);
        vm.prank(admin);
        view_.claimFees(market, YES, 1, carol, f.base);
        eq(acct(carol, YES).base, 4 * NVDA / 100, "fees delivered as claims");
        vm.prank(alice);
        view_.transferClaim(market, YES, 1, carol, NVDA);
        eq(acct(carol, YES).base, NVDA + 4 * NVDA / 100, "transferred");
        eq(acct(alice, YES).base, 4 * NVDA - 4 * NVDA / 100 - NVDA, "debited");
    }

    function testAdminTransferIsDelayed() public {
        vm.prank(admin);
        view_.proposeAdmin(carol);
        vm.expectRevert(ConditionalStocksBase.AdminDelay.selector);
        vm.prank(carol);
        view_.acceptAdmin();
        vm.warp(now_() + 2 days);
        vm.prank(carol);
        view_.acceptAdmin();
        ok(view_.admin() == carol, "new admin");
    }

    function testRolesAndFeeBounds() public {
        vm.expectRevert(ConditionalStocksBase.FeeCap.selector);
        vm.prank(admin);
        view_.configure(marketAdmin, guardian, resolver, 1_001, 0);
        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        vm.prank(marketAdmin);
        view_.pause(true, keccak256("x"));
        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        vm.prank(guardian);
        view_.listPool(address(0x1234));
    }
}
