// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { WorldBooks } from "../../src/worlds/WorldBooks.sol";
import { WorldBooksAdmin } from "../../src/worlds/WorldBooksAdmin.sol";
import { WorldBooksBase } from "../../src/worlds/WorldBooksBase.sol";
import { BookDef, WorldQuote } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { WorldsBase } from "./WorldsBase.t.sol";

/// @dev Quotes, bundles, netting, fees, signatures, nonces and delegation.
contract WorldFillsTest is WorldsBase {
    uint16 internal constant ABOVE_240 = 0x70; // atoms 4, 5, 6
    uint16 internal constant BELOW_240 = 0x0E; // atoms 1, 2, 3
    uint16 internal constant ALL_WORLD = 0x7E; // atoms 1..6
    uint64 internal id;

    function setUp() public override {
        super.setUp();
        id = create(pricedDef());
    }

    // ------------------------------------------------------------ the plan's examples

    /// Maya's world bet and Ben's opposite bet: the second nets against the first.
    function testWorldBetsNetAgainstEachOther() public {
        uint256 makerCredit = credit(maker);
        fill(makerKey, quote(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        eq(credit(alice), 1_000_000e6 - 20.2e6, "maya paid price + 1% fee");
        eq(makerCredit - credit(maker), 1518e6, "maker locked 1,538 - 20");
        uint256[] memory m = atoms(id, maker);
        uint256[] memory a = atoms(id, alice);
        for (uint256 i; i < 7; ++i) {
            eq(m[i], i >= 4 ? 0 : 1538e6, "maker keeps the rest");
            eq(a[i], i >= 4 ? 1538e6 : 0, "maya holds atoms 4-6");
        }
        eq(wb.backing(id), 1538e6, "backing");

        fill(makerKey, quote(id, bob, BELOW_240, 3000e6, 0, false, 60e6));
        eq(makerCredit - credit(maker), 2920e6, "netted: 2,920 not 4,458");
        m = atoms(id, maker);
        eq(m[0], 3000e6, "atom 0");
        eq(m[1], 0, "atom 1 all delivered");
        eq(m[4], 1462e6, "atom 4");
        eq(wb.backing(id), 3000e6, "backing");
        eq(wb.fees(), 0.8e6, "fees");
    }

    /// Maya's conditional payout: $100 for 250 units above $240 plus a $100 refund.
    function testConditionalPayoutIsABundle() public {
        fill(makerKey, quote(id, alice, ABOVE_240, 250e6, 100e6, false, 100e6));
        uint256[] memory a = atoms(id, alice);
        eq(a[0], 100e6, "refund units");
        eq(a[4], 250e6, "payout units");
        eq(a[1], 0, "nothing below");
        eq(credit(alice), 1_000_000e6 - 101e6, "paid stake + fee");
        uint256[] memory m = atoms(id, maker);
        eq(m[0], 150e6, "maker atom 0");
        eq(m[1], 250e6, "maker atoms below");
        eq(m[4], 0, "maker atoms above");
    }

    function testTakerSellsBackAndTheMakerMerges() public {
        fill(makerKey, quote(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        uint256 makerBefore = credit(maker);
        uint256 aliceBefore = credit(alice);
        // Cash-out at 40 USDG: the maker completes 1,538 full sets and merges them.
        fill(makerKey, quote(id, alice, ABOVE_240, 1538e6, 0, true, 40e6));
        eq(credit(alice) - aliceBefore, 40e6 - 0.4e6, "proceeds minus fee");
        eq(credit(maker), makerBefore + 1538e6 - 40e6, "merged then paid");
        uint256[] memory m = atoms(id, maker);
        for (uint256 i; i < 7; ++i) {
            eq(m[i], 0, "flat");
            eq(atoms(id, alice)[i], 0, "alice flat");
        }
        eq(wb.backing(id), 0, "no backing left");
    }

    function testFullSetBundleTradesAtExactlyItsValue() public {
        WorldQuote memory q = quote(id, alice, ALL_WORLD, 10e6, 10e6, false, 10e6 - 1);
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.InvalidBundle.selector);
        books.fillQuote(q, r, vs);
        fill(makerKey, quote(id, alice, ALL_WORLD, 10e6, 10e6, false, 10e6));
        // Alice now holds a full set and can merge it.
        vm.prank(alice);
        books.merge(id, 10e6);
    }

    function testPriceBounds() public {
        // A world bet can't cost more than it pays.
        _rejects(
            quote(id, alice, ABOVE_240, 100, 0, false, 101), WorldBooksBase.InvalidBundle.selector
        );
        // A refund bundle never sells for less than its worst payout.
        _rejects(
            quote(id, alice, ALL_WORLD, 100, 50, false, 49), WorldBooksBase.InvalidBundle.selector
        );
        fill(makerKey, quote(id, alice, ALL_WORLD, 100, 50, false, 50));
        // And a sell is bounded the same way.
        _rejects(
            quote(id, alice, ABOVE_240, 100, 0, true, 101), WorldBooksBase.InvalidBundle.selector
        );
    }

    function testBundleShapes() public {
        bytes4 bad = WorldBooksBase.InvalidBundle.selector;
        _rejects(quote(id, alice, 0x01, 1, 0, false, 1), bad); // atom 0 in the mask
        _rejects(quote(id, alice, 0x80, 1, 0, false, 1), bad); // atom 7 does not exist
        _rejects(quote(id, alice, 0x8000, 1, 0, false, 1), bad);
        _rejects(quote(id, alice, ABOVE_240, 0, 0, false, 1), bad); // mask without units
        _rejects(quote(id, alice, 0, 5, 5, false, 1), bad); // units without mask
        _rejects(quote(id, alice, 0, 0, 0, false, 1), bad); // nothing
        _rejects(quote(id, alice, ABOVE_240, 5, 0, false, 0), bad); // free
        // Refund alone is a bet against the world.
        fill(makerKey, quote(id, alice, 0, 0, 100, false, 90));
        eq(atoms(id, alice)[0], 100, "atom 0 only");
    }

    function testEventOnlyBundles() public {
        uint64 events = create(eventDef());
        _rejects(quote(events, alice, 0x04, 1, 0, false, 1), WorldBooksBase.InvalidBundle.selector);
        fill(makerKey, quote(events, alice, 0x02, 1000, 0, false, 30));
        eq(atoms(events, alice)[1], 1000, "world atom");
        eq(atoms(events, maker)[0], 1000, "maker against");
    }

    function testFeeRoundsUp() public {
        fill(makerKey, quote(id, alice, ABOVE_240, 100, 0, false, 1));
        eq(wb.fees(), 1, "1% of 1 rounds to 1");
        eq(credit(alice), 1_000_000e6 - 2, "paid 2");
        fill(makerKey, quote(id, alice, ABOVE_240, 1000, 0, false, 101));
        eq(wb.fees(), 3, "1% of 101 rounds to 2");
        // A sell's proceeds never go negative: the fee is at most 10%.
        fill(makerKey, quote(id, alice, ABOVE_240, 1, 0, true, 1));
        eq(wb.fees(), 4, "sell fee");
    }

    function testZeroFeeBook() public {
        bytes32 key = keccak256("free");
        BookDef memory d = pricedDef();
        d.feeBps = 0;
        d.legs[0].eventKey = key;
        uint64 free = create(d);
        fill(makerKey, quote(free, alice, ABOVE_240, 100, 0, false, 7));
        eq(credit(alice), 1_000_000e6 - 7, "no fee");
        eq(wb.fees(), 0, "none");
    }

    // ------------------------------------------------------------ funds

    function testTakerAndMakerFundsAreChecked() public {
        fund(address(0x1111), 5);
        _rejects(
            quote(id, address(0x1111), ABOVE_240, 1000, 0, false, 5),
            WorldBooksBase.InsufficientFunds.selector
        );
        // A maker that cannot split the shortfall.
        uint256 poorKey = 0x9999;
        address poor = vm.addr(poorKey);
        fund(poor, 10);
        WorldQuote memory q = quote(id, alice, ABOVE_240, 1000, 0, false, 5);
        (bytes32 r, bytes32 vs) = sign(poorKey, q);
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        books.fillQuote(q, r, vs);
        // Selling atoms one does not hold.
        _rejects(
            quote(id, alice, ABOVE_240, 1, 0, true, 1), WorldBooksBase.InsufficientFunds.selector
        );
        // A maker that cannot pay for what it buys.
        vm.prank(alice);
        books.split(id, 50);
        q = quote(id, alice, ABOVE_240, 50, 0, true, 40);
        (r, vs) = sign(poorKey, q);
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        books.fillQuote(q, r, vs);
    }

    // ------------------------------------------------------------ states

    function testOnlyTradingBooksFill() public {
        bytes4 notTrading = WorldBooksBase.NotTrading.selector;
        vm.prank(guardian);
        oracle.freeze(A, "news");
        _rejects(quote(id, alice, ABOVE_240, 1, 0, false, 1), notTrading);
        vm.prank(bookAdmin);
        oracle.reopen(A, "fine");
        vm.prank(guardian);
        wb.setFrozen(id, true, "x");
        _rejects(quote(id, alice, ABOVE_240, 1, 0, false, 1), notTrading);
        vm.prank(bookAdmin);
        wb.setFrozen(id, false, "x");
        vm.prank(guardian);
        wb.pause(true, "x");
        _rejects(quote(id, alice, ABOVE_240, 1, 0, false, 1), notTrading);
        vm.prank(guardian);
        wb.pause(false, "x");
        fill(makerKey, quote(id, alice, ABOVE_240, 1, 0, false, 1));
        resolve(A, NO);
        _rejects(quote(id, alice, ABOVE_240, 1, 0, false, 1), notTrading);
    }

    function testTradingStopsAtCutoffAndContinuesOnPassedLegs() public {
        resolve(A, YES);
        resolve(B, YES);
        resolve(C, YES);
        fill(makerKey, quote(id, alice, ABOVE_240, 1, 0, false, 1));
        vm.warp(T0 + 27 days);
        _rejects(quote(id, alice, ABOVE_240, 1, 0, false, 1), WorldBooksBase.NotTrading.selector);
    }

    function testExpiredAndUnknown() public {
        WorldQuote memory q = quote(id, alice, ABOVE_240, 1, 0, false, 1);
        q.expiry = uint40(now_());
        _rejects(q, WorldBooksBase.Expired.selector);
        q = quote(99, alice, ABOVE_240, 1, 0, false, 1);
        _rejects(q, WorldBooksBase.UnknownBook.selector);
    }

    // ------------------------------------------------------------ signatures and nonces

    function testDigestMatchesTheSpec() public {
        WorldQuote memory q = quote(id, alice, ABOVE_240, 7, 3, true, 5);
        q.makerData = 42;
        eq(uint256(wb.quoteDigest(q)), uint256(digestOf(q)), "EIP-712 digest");
    }

    function testOnlyTheTakerFills() public {
        WorldQuote memory q = quote(id, alice, ABOVE_240, 1, 0, false, 1);
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        vm.prank(bob);
        vm.expectRevert(WorldBooksBase.Unauthorized.selector);
        books.fillQuote(q, r, vs);
    }

    function testTamperedQuoteRecoversAnotherSigner() public {
        WorldQuote memory q = quote(id, alice, ABOVE_240, 1000e6, 0, false, 10e6);
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        uint256 before = credit(maker);
        q.price = 1e6; // tampered
        vm.prank(alice);
        // The recovered signer is some unfunded address, never the maker.
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        books.fillQuote(q, r, vs);
        eq(credit(maker), before, "maker untouched");
    }

    function testHighSAndInvalidSignatures() public {
        WorldQuote memory q = quote(id, alice, ABOVE_240, 1, 0, false, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digestOf(q));
        // Compact signatures put v in the top bit, so only s in (n/2, 2^255) is expressible
        // above the canonical half: the malleable range, refused.
        uint256 half = SECP256K1_N / 2;
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.BadSignature.selector);
        books.fillQuote(q, r, bytes32(half + 1));
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.BadSignature.selector);
        books.fillQuote(q, r, bytes32((uint256(1) << 255) - 1));
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.BadSignature.selector);
        books.fillQuote(q, bytes32(0), bytes32(0));
        // The canonical signature fills.
        bytes32 vs = bytes32(uint256(s) | (v == 28 ? uint256(1) << 255 : 0));
        vm.prank(alice);
        books.fillQuote(q, r, vs);
        eq(atoms(id, alice)[4], 1, "filled");
    }

    /// A garbage signature recovers some unknown address, never the maker: that address can only
    /// "make" from the taker's own payment, so the taker gets no more than it paid for.
    function testGarbageSignatureNeverReachesTheMaker() public {
        uint256 before = credit(maker);
        WorldQuote memory q = quote(id, alice, ABOVE_240, 1, 0, false, 1);
        (, bytes32 r,) = vm.sign(makerKey, digestOf(q));
        vm.prank(alice);
        books.fillQuote(q, r, bytes32(uint256(12345)));
        eq(credit(maker), before, "maker untouched");
        eq(atoms(id, alice)[4], 1, "bundle bought from the premium itself");
    }

    function testNonceFillsOnce() public {
        WorldQuote memory q = quote(id, alice, ABOVE_240, 10, 0, false, 1);
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        vm.prank(alice);
        books.fillQuote(q, r, vs);
        ok(wb.nonceUsed(maker, q.nonce), "used");
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.NonceUsed.selector);
        books.fillQuote(q, r, vs);
    }

    function testMakerInvalidatesNonces() public {
        WorldQuote memory q = quote(id, alice, ABOVE_240, 10, 0, false, 1);
        q.nonce = 300; // word 1, bit 44
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        vm.prank(maker);
        books.invalidateNonces(1, uint256(1) << 44);
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.NonceUsed.selector);
        books.fillQuote(q, r, vs);
    }

    function testSignaturesDoNotReplayAcrossChainsOrDeployments() public {
        WorldQuote memory q = quote(id, alice, ABOVE_240, 1000e6, 0, false, 10e6);
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        uint256 before = credit(maker);
        vm.chainId(31338);
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        books.fillQuote(q, r, vs);
        eq(credit(maker), before, "other chain");
        vm.chainId(31337);
        // A second deployment with the same book and funded maker.
        WorldBooks other =
            new WorldBooks(address(usdg), address(oracle), admin, bookAdmin, guardian, resolver);
        vm.prank(bookAdmin);
        WorldBooksAdmin(address(other)).createBook(pricedDef(), URI);
        usdg.mint(maker, 5000e6);
        usdg.mint(alice, 50e6);
        vm.prank(maker);
        usdg.approve(address(other), type(uint256).max);
        vm.prank(maker);
        other.deposit(5000e6);
        vm.prank(alice);
        usdg.approve(address(other), type(uint256).max);
        vm.prank(alice);
        other.deposit(50e6);
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        other.fillQuote(q, r, vs);
        eq(WorldBooksAdmin(address(other)).credit(maker), 5000e6, "other deployment");
    }

    function testNoSelfTrade() public {
        WorldQuote memory q = quote(id, maker, ABOVE_240, 1, 0, false, 1);
        _rejects(q, WorldBooksBase.SelfTrade.selector);
    }

    function testAnEoaNamedAsMakerContractRejects() public {
        WorldQuote memory q = quote(id, alice, ABOVE_240, 1, 0, false, 1);
        q.nonce = uint256(uint160(maker)) << 96 | 1;
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.MakerRejected.selector);
        books.fillQuote(q, bytes32(0), bytes32(0));
    }

    // ------------------------------------------------------------ delegation

    function _grant(uint8 permissions) internal {
        vm.prank(alice);
        wb.approveDelegate(
            delegate, uint40(now_() + 30 days), 100e6, 150e6, 2000e6, 3000e6, 100, permissions
        );
    }

    function _fillFor(uint256 key, WorldQuote memory q) internal {
        (bytes32 r, bytes32 vs) = sign(key, q);
        vm.prank(delegate);
        books.fillQuoteFor(q, r, vs);
    }

    function _rejectsFor(WorldQuote memory q, bytes4 selector) internal {
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        vm.prank(delegate);
        vm.expectRevert(selector);
        books.fillQuoteFor(q, r, vs);
    }

    function testDelegatedBuysSpendTheBudget() public {
        _grant(1);
        _fillFor(makerKey, quote(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        (, WorldBooksBase.Budget memory b) = wb.grant(alice, delegate);
        eq(b.remainingBuy, 150e6 - 20.2e6, "spent price + fee");
        eq(atoms(id, alice)[4], 1538e6, "proceeds to the owner");
        eq(credit(delegate), 1_000_000e6, "delegate untouched");
        // Over the per-fill limit.
        _rejectsFor(
            quote(id, alice, ABOVE_240, 1000e6, 0, false, 99.5e6),
            WorldBooksBase.DelegateBudget.selector
        );
        _fillFor(makerKey, quote(id, alice, ABOVE_240, 1000e6, 0, false, 99e6));
        // Over what remains.
        _rejectsFor(
            quote(id, alice, ABOVE_240, 1000e6, 0, false, 40e6),
            WorldBooksBase.DelegateBudget.selector
        );
    }

    function testDelegatedSellsNeedTheirOwnPermission() public {
        _grant(1);
        fill(makerKey, quote(id, alice, ABOVE_240, 1000e6, 0, false, 20e6));
        _rejectsFor(
            quote(id, alice, ABOVE_240, 1000e6, 0, true, 5e6),
            WorldBooksBase.DelegationInactive.selector
        );
        _grant(3);
        _fillFor(makerKey, quote(id, alice, ABOVE_240, 1000e6, 0, true, 5e6));
        (, WorldBooksBase.Budget memory b) = wb.grant(alice, delegate);
        eq(b.remainingSell, 2000e6, "spent the largest payout");
        _rejectsFor(
            quote(id, alice, ABOVE_240, 2001e6, 0, true, 1), WorldBooksBase.DelegateBudget.selector
        );
    }

    function testDelegationEndsAndIsBounded() public {
        _grant(3);
        WorldQuote memory q = quote(id, alice, ABOVE_240, 10, 0, false, 1);
        // The delegate can't be the maker.
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        vm.prank(maker);
        vm.expectRevert(WorldBooksBase.InvalidDelegation.selector);
        books.fillQuoteFor(quote(id, maker, ABOVE_240, 10, 0, false, 1), r, vs);
        // Revoked.
        vm.prank(alice);
        wb.revokeDelegate(delegate);
        _rejectsFor(q, WorldBooksBase.DelegationInactive.selector);
        // Re-granted, then all grants revoked.
        _grant(3);
        vm.prank(alice);
        wb.revokeAllDelegates();
        _rejectsFor(
            quote(id, alice, ABOVE_240, 10, 0, false, 1), WorldBooksBase.DelegationInactive.selector
        );
        // Re-granted, then expired.
        vm.prank(alice);
        wb.approveDelegate(delegate, uint40(now_() + 1 hours), 100e6, 150e6, 1, 1, 100, 3);
        vm.warp(now_() + 1 hours);
        _rejectsFor(
            quote(id, alice, ABOVE_240, 10, 0, false, 1), WorldBooksBase.DelegationInactive.selector
        );
    }

    function testDelegateCannotBeTheMaker() public {
        _grant(3);
        uint256 delegateKey = 0xD00D;
        address signerDelegate = vm.addr(delegateKey);
        fund(signerDelegate, 1000e6);
        vm.prank(alice);
        wb.approveDelegate(signerDelegate, uint40(now_() + 1 days), 100e6, 100e6, 0, 0, 100, 1);
        WorldQuote memory q = quote(id, alice, ABOVE_240, 1000, 0, false, 900);
        (bytes32 r, bytes32 vs) = sign(delegateKey, q);
        vm.prank(signerDelegate);
        vm.expectRevert(WorldBooksBase.SelfTrade.selector);
        books.fillQuoteFor(q, r, vs);
    }

    function testDelegationFeeCap() public {
        vm.prank(alice);
        wb.approveDelegate(delegate, uint40(now_() + 1 days), 100e6, 100e6, 0, 0, 99, 1);
        _rejectsFor(quote(id, alice, ABOVE_240, 10, 0, false, 1), WorldBooksBase.FeeCap.selector);
    }

    function testApproveDelegateValidation() public {
        vm.startPrank(alice);
        uint40 later = uint40(now_() + 1 days);
        bytes4 bad = WorldBooksBase.InvalidDelegation.selector;
        vm.expectRevert(bad);
        wb.approveDelegate(address(0), later, 1, 1, 0, 0, 0, 1);
        vm.expectRevert(bad);
        wb.approveDelegate(alice, later, 1, 1, 0, 0, 0, 1);
        vm.expectRevert(bad);
        wb.approveDelegate(delegate, uint40(now_()), 1, 1, 0, 0, 0, 1);
        vm.expectRevert(bad);
        wb.approveDelegate(delegate, uint40(now_() + 91 days), 1, 1, 0, 0, 0, 1);
        vm.expectRevert(bad);
        wb.approveDelegate(delegate, later, 1, 1, 0, 0, 0, 0);
        vm.expectRevert(bad);
        wb.approveDelegate(delegate, later, 1, 1, 1, 1, 0, 4);
        vm.expectRevert(bad);
        wb.approveDelegate(delegate, later, 0, 0, 0, 0, 0, 1);
        vm.expectRevert(bad);
        wb.approveDelegate(delegate, later, 2, 1, 0, 0, 0, 1);
        vm.expectRevert(bad);
        wb.approveDelegate(delegate, later, 0, 0, 0, 0, 0, 2);
        vm.expectRevert(bad);
        wb.approveDelegate(delegate, later, 1, 1, 0, 0, 1001, 1);
        vm.expectRevert(bad);
        wb.revokeDelegate(delegate);
        vm.stopPrank();
    }

    function testFillQuoteForRejectsSelfAndZeroOwners() public {
        WorldQuote memory q = quote(id, delegate, ABOVE_240, 1, 0, false, 1);
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        vm.prank(delegate);
        vm.expectRevert(WorldBooksBase.InvalidDelegation.selector);
        books.fillQuoteFor(q, r, vs);
        q.taker = address(0);
        vm.prank(delegate);
        vm.expectRevert(WorldBooksBase.InvalidDelegation.selector);
        books.fillQuoteFor(q, r, vs);
    }

    // ------------------------------------------------------------ helpers

    function _rejects(WorldQuote memory q, bytes4 selector) internal {
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        vm.prank(q.taker);
        vm.expectRevert(selector);
        books.fillQuote(q, r, vs);
    }
}

