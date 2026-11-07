// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { WorldBooksBase } from "../../src/worlds/WorldBooksBase.sol";
import { BookDef, IWorldBooks, Leg, WorldQuote } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { WorldVault } from "../../src/worlds/vault/WorldVault.sol";
import { WorldVaultAdmin } from "../../src/worlds/vault/WorldVaultAdmin.sol";
import { WorldVaultBase } from "../../src/worlds/vault/WorldVaultBase.sol";
import { MockPriceFeed } from "../mocks/MockPriceFeed.sol";
import { VaultWorldsBase } from "./VaultWorldsBase.t.sol";

/// @dev The maker hook: signer, epoch, eligibility, lifetime, size, margin and risk caps.
contract WorldVaultTest is VaultWorldsBase {
    bytes4 internal immutable REJECTED = WorldBooksBase.MakerRejected.selector;

    // ------------------------------------------------------------ quoting and tracking

    function testVaultSellsAWorldBetAndTracksItsRisk() public {
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        eq(vaultCredit(), SEED + 20e6 - 1538e6, "split 1,538, paid 20");
        WorldVaultBase.Position memory p = ops.position(id);
        eq(p.lo, 0, "lo");
        eq(p.hi, 1538e6, "hi");
        eq(uint256(p.cost), 1518e6, "cost: split 1,538, took 20");
        // The book's risk is the most the vault can lose there: cost minus what it's sure of.
        eq(ops.legRisk(A), 1518e6, "leg A risk");
        eq(ops.legRisk(C), 1518e6, "leg C risk");
        (uint256 c, uint256 lo, uint256 hi, uint256 guaranteed, uint256 best) = ops.totals();
        eq(c, vaultCredit(), "credit");
        eq(lo, 0, "sum lo");
        eq(hi, 1538e6, "sum hi");
        eq(guaranteed, SEED - 1518e6, "guaranteed");
        eq(best, SEED + 20e6, "best");
        eq(atoms(id, alice)[5], 1538e6, "maya holds atom 5");
    }

    function testNettingAcrossTakers() public {
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        vfill(keeperKey, vq(id, bob, BELOW_240, 3000e6, 0, false, 60e6));
        eq(SEED - vaultCredit(), 2920e6, "netted 2,920");
        WorldVaultBase.Position memory p = ops.position(id);
        eq(p.lo, 0, "lo");
        eq(p.hi, 3000e6, "hi: atom 0");
        eq(ops.legRisk(B), 2920e6, "leg risk: the netted cost");
    }

    function testCashOutUnwindsTheVault() public {
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, true, 15e6));
        eq(vaultCredit(), SEED + 5e6, "kept the spread");
        WorldVaultBase.Position memory p = ops.position(id);
        eq(p.hi, 0, "flat");
        eq(ops.legRisk(A), 0, "no leg risk");
    }

    // ------------------------------------------------------------ the hook's own checks

    function testHookOnlyForBooks() public {
        WorldQuote memory q = vq(id, alice, ABOVE_240, 10, 0, false, 5);
        (bytes32 r, bytes32 vs) = sign(keeperKey, q);
        vm.prank(alice);
        vm.expectRevert(WorldVaultBase.Unauthorized.selector);
        ops.onWorldFill(digestOf(q), q, r, vs, 0);
    }

    function testSignerAndEpoch() public {
        hookRejects(
            vq(id, alice, ABOVE_240, 10, 0, false, 5),
            makerKey,
            0,
            WorldVaultBase.QuoteSigner.selector
        );
        WorldQuote memory q = vq(id, alice, ABOVE_240, 10, 0, false, 5);
        q.makerData = 7;
        hookRejects(q, keeperKey, 0, WorldVaultBase.QuoteEpoch.selector);
        vrejects(makerKey, vq(id, alice, ABOVE_240, 10, 0, false, 5), REJECTED);
    }

    function testPauseVoidsOutstandingQuotes() public {
        WorldQuote memory old = vq(id, alice, ABOVE_240, 10, 0, false, 5);
        vm.prank(sentinel);
        ops.pause();
        vrejects(keeperKey, vq(id, alice, ABOVE_240, 10, 0, false, 5), REJECTED);
        vm.prank(vaultAdmin);
        ops.unpause();
        vrejects(keeperKey, old, REJECTED);
        vfill(keeperKey, vq(id, alice, ABOVE_240, 10, 0, false, 5));
        WorldQuote memory again = vq(id, alice, ABOVE_240, 10, 0, false, 5);
        vm.prank(keeper);
        ops.advanceQuoteEpoch();
        vrejects(keeperKey, again, REJECTED);
        vm.prank(alice);
        vm.expectRevert(WorldVaultBase.Unauthorized.selector);
        ops.advanceQuoteEpoch();
    }

    /// Eligibility applies to fills that add risk (an unwind is always allowed).
    function testEligibility() public {
        // A feed the curator did not allow.
        MockPriceFeed other = new MockPriceFeed(8, "AAPL / USD", 1, 200e8, T0);
        BookDef memory d = pricedDef();
        d.feed = address(other);
        uint64 otherFeed = create(d);
        vrejects(keeperKey, vq(otherFeed, alice, ABOVE_240, 10, 0, false, 5), REJECTED);
        vm.prank(curator);
        ops.setFeed(address(other), true);
        vfill(keeperKey, vq(otherFeed, alice, ABOVE_240, 10, 0, false, 5));
        // Too many legs.
        d = pricedDef();
        d.legs = new Leg[](5);
        for (uint256 i; i < 5; ++i) {
            d.legs[i] = Leg(keccak256(abi.encode("leg", i)), true);
        }
        uint64 wide = create(d);
        vrejects(keeperKey, vq(wide, alice, ABOVE_240, 10, 0, false, 5), REJECTED);
        // Decided too far out.
        d = pricedDef();
        d.legs[0].eventKey = keccak256("far");
        d.fixingTime = uint40(T0 + 61 days);
        d.cutoff = uint40(T0 + 60 days);
        uint64 far = create(d);
        vrejects(keeperKey, vq(far, alice, ABOVE_240, 10, 0, false, 5), REJECTED);
        // A fee above the vault's cap.
        d = pricedDef();
        d.feeBps = 300;
        uint64 dear = create(d);
        vrejects(keeperKey, vq(dear, alice, ABOVE_240, 10, 0, false, 5), REJECTED);
        // Event-only books need the curator's opt-in.
        uint64 events = create(eventDef());
        vfill(keeperKey, vq(events, alice, 0x02, 100, 0, false, 5));
        WorldVaultBase.Limits memory l = limits();
        l.eventOnly = false;
        vm.prank(curator);
        ops.setLimits(l);
        vrejects(keeperKey, vq(events, bob, 0x02, 100, 0, false, 5), REJECTED);
    }

    function testLifetimeAndCutoffBuffer() public {
        WorldQuote memory q = vq(id, alice, ABOVE_240, 10, 0, false, 5);
        q.expiry = uint40(now_() + 301);
        hookRejects(q, keeperKey, 0, WorldVaultBase.QuoteExpiry.selector);
        vm.warp(T0 + 27 days - 1 hours - 30);
        q = vq(id, alice, ABOVE_240, 10, 0, false, 5);
        q.expiry = uint40(now_() + 31);
        hookRejects(q, keeperKey, 0, WorldVaultBase.QuoteExpiry.selector);
        q.expiry = uint40(now_() + 30);
        vfill(keeperKey, q);
    }

    function testSizeCaps() public {
        hookRejects(
            vq(id, alice, ABOVE_240, 100_000e6 + 1, 0, false, 50e6),
            keeperKey,
            0,
            WorldVaultBase.QuoteSize.selector
        );
        WorldVaultBase.Risk memory k = risk();
        k.maxQuotePrice = 10e6;
        vm.prank(curator);
        ops.setRisk(k);
        hookRejects(
            vq(id, alice, ABOVE_240, 1000e6, 0, false, 10e6 + 1),
            keeperKey,
            0,
            WorldVaultBase.QuoteSize.selector
        );
    }

    function testPriceMargins() public {
        // A sale must keep 0.1% of the payout range: 1.538 USDG on 1,538 units.
        hookRejects(
            vq(id, alice, ABOVE_240, 1538e6, 0, false, 1.538e6 - 1),
            keeperKey,
            0,
            WorldVaultBase.QuotePrice.selector
        );
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 1.538e6));
        // A buy-back must stay that far below the payout.
        hookRejects(
            vq(id, alice, ABOVE_240, 1538e6, 0, true, 1538e6 - 1.538e6 + 1),
            keeperKey,
            0,
            WorldVaultBase.QuotePrice.selector
        );
        // A refund bundle's range starts at its worst payout.
        hookRejects(
            vq(id, alice, 0x7E, 1000e6, 400e6, false, 400e6 + 0.6e6 - 1),
            keeperKey,
            0,
            WorldVaultBase.QuotePrice.selector
        );
    }

    function testQuotesSignedBeforeALegResolvedDoNotFill() public {
        WorldQuote memory stale = vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6);
        vm.warp(now_() + 10);
        resolve(A, YES); // the world just became likelier
        vrejects(keeperKey, stale, REJECTED);
        hookRejects(stale, keeperKey, 0, WorldVaultBase.LegJustResolved.selector);
        // Signed in the same second as the resolution: still stale.
        hookRejects(
            vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6),
            keeperKey,
            0,
            WorldVaultBase.LegJustResolved.selector
        );
        // Shrinking maxTtl changes nothing for a quote signed before the resolution.
        WorldVaultBase.Limits memory l = limits();
        l.maxTtl = 60;
        vm.prank(curator);
        ops.setLimits(l);
        vrejects(keeperKey, stale, REJECTED);
        // A quote signed after it fills at once.
        vm.warp(now_() + 1);
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 40e6));
    }

    // ------------------------------------------------------------ risk caps

    function _setRisk(uint128 bookRisk, uint128 legRisk_, uint16 lossBps, uint16 dailyBps)
        internal
    {
        WorldVaultBase.Risk memory k = risk();
        k.maxBookRisk = bookRisk;
        k.maxLegRisk = legRisk_;
        k.maxLossBps = lossBps;
        k.maxDailyExposureBps = dailyBps;
        vm.prank(curator);
        ops.setRisk(k);
    }

    function testBookRiskCap() public {
        _setRisk(1000e6, 300_000e6, 3000, 2000);
        vrejects(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6), REJECTED);
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1000e6, 0, false, 13e6));
        eq(ops.legRisk(A), 987e6, "risk 987");
        // Adding 19 USDG of cost takes the book past 1,000.
        vrejects(keeperKey, vq(id, alice, ABOVE_240, 20e6, 0, false, 1e6), REJECTED);
        vfill(keeperKey, vq(id, alice, ABOVE_240, 14e6, 0, false, 1e6));
    }

    function testLegRiskCapAcrossBooks() public {
        BookDef memory d = pricedDef();
        d.legs[1].eventKey = keccak256("other B");
        d.legs[2].eventKey = keccak256("other C");
        uint64 sibling = create(d);
        _setRisk(200_000e6, 2000e6, 3000, 2000);
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        // The sibling shares leg A: 1,538 + 1,538 > 2,000.
        vrejects(keeperKey, vq(sibling, alice, ABOVE_240, 1538e6, 0, false, 20e6), REJECTED);
        vfill(keeperKey, vq(sibling, alice, ABOVE_240, 400e6, 0, false, 6e6));
        eq(ops.legRisk(A), 1518e6 + 394e6, "A sums both books");
        eq(ops.legRisk(B), 1518e6, "B only in the first");
    }

    function testRiskShrinkingFillsPassAboveTheCaps() public {
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        _setRisk(100e6, 100e6, 1, 10_000);
        // Growing the position is refused...
        vrejects(keeperKey, vq(id, bob, ABOVE_240, 10e6, 0, false, 1e6), REJECTED);
        // ...but buying it back always passes.
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1000e6, 0, true, 9e6));
        vfill(keeperKey, vq(id, alice, ABOVE_240, 538e6, 0, true, 5e6));
        eq(ops.position(id).hi, 0, "unwound");
    }

    function testLossCap() public {
        // 0.1% of 1,000,000 = 1,000 USDG of guaranteed value at risk.
        _setRisk(200_000e6, 300_000e6, 10, 2000);
        vrejects(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6), REJECTED);
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1000e6, 0, false, 13e6));
        eq(SEED - ops.position(id).lo - vaultCredit(), 987e6, "987 at risk");
    }

    function testDailyExposureBudgetResetsTheNextDay() public {
        // 0.2% a day = 2,000 USDG of worst-case value moved.
        _setRisk(200_000e6, 300_000e6, 3000, 20);
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        eq(ops.day().used, 1518e6, "payout given minus price");
        vrejects(keeperKey, vq(id, bob, ABOVE_240, 1538e6, 0, false, 20e6), REJECTED);
        vm.warp(T0 + 1 days);
        vfill(keeperKey, vq(id, bob, ABOVE_240, 1538e6, 0, false, 20e6));
        eq(ops.day().day, (T0 + 1 days) / 1 days, "new day");
        eq(ops.day().used, 1518e6, "fresh budget");
    }

    /// The audit's H-1: a stolen keeper selling the vault's held atoms for almost nothing lowers
    /// neither the guaranteed value nor the risk, but every fill spends the daily budget.
    function testAStolenKeeperCannotDumpInventoryPastTheBudget() public {
        _setRisk(200_000e6, 300_000e6, 3000, 2000);
        vfill(keeperKey, vq(id, bob, ABOVE_240, 100_000e6, 0, false, 1_000e6));
        _setRisk(200_000e6, 300_000e6, 3000, 1000); // 100,000 USDG a day
        // The vault holds 100,000 of atoms 0-3; selling them all for 100 moves 99,900.
        vrejects(keeperKey, vq(id, carol, 0x0E, 100_000e6, 100_000e6, false, 100e6), REJECTED);
        hookRejects(
            vq(id, carol, 0x0E, 100_000e6, 100_000e6, false, 100e6),
            keeperKey,
            vaultCredit(),
            WorldVaultBase.DailyExposure.selector
        );
    }

    function testAStolenKeeperCannotOverpayABuyBackPastTheBudget() public {
        _setRisk(200_000e6, 300_000e6, 3000, 2000);
        vfill(keeperKey, vq(id, bob, ABOVE_240, 100_000e6, 0, false, 1_000e6));
        vm.warp(T0 + 1 days);
        _setRisk(200_000e6, 300_000e6, 3000, 500); // 50,000 USDG a day
        // Buying back at 99.9% of face moves 99,900 the vault's way only if the world happens.
        vrejects(keeperKey, vq(id, bob, ABOVE_240, 100_000e6, 0, true, 99_900e6), REJECTED);
        // A fair cash-out uses only its price.
        vfill(keeperKey, vq(id, bob, ABOVE_240, 100_000e6, 0, true, 900e6));
        eq(ops.day().used, 900e6, "price paid");
    }

    /// The audit's M-2: atoms given to the vault can only lower its risk, so they can't freeze
    /// quoting on shared legs.
    function testDonatedAtomsCannotFreezeQuoting() public {
        MockPriceFeed other = new MockPriceFeed(8, "AAPL / USD", 1, 200e8, T0);
        BookDef memory d = pricedDef();
        d.feed = address(other);
        uint64 ineligible = create(d);
        _setRisk(200_000e6, 2000e6, 3000, 2000);
        vm.startPrank(alice);
        books.split(ineligible, 300_000e6);
        books.transferAtoms(ineligible, 5, address(vault), 300_000e6);
        vm.stopPrank();
        ops.sync(ineligible);
        eq(ops.legRisk(A), 0, "a gift adds no risk");
        vfill(keeperKey, vq(id, bob, ABOVE_240, 1538e6, 0, false, 20e6));
        eq(ops.legRisk(A), 1518e6, "honest quoting continues");
    }

    /// The audit's L-2: de-listing a book stops new risk there but never traps a position.
    function testDelistedBooksStillUnwind() public {
        vfill(keeperKey, vq(id, bob, ABOVE_240, 1538e6, 0, false, 20e6));
        vm.prank(curator);
        ops.setFeed(address(feed), false);
        vrejects(keeperKey, vq(id, alice, ABOVE_240, 100e6, 0, false, 5e6), REJECTED);
        vfill(keeperKey, vq(id, bob, ABOVE_240, 1538e6, 0, true, 15e6));
        eq(ops.position(id).hi, 0, "unwound");
    }

    function testSigningTimeBoundsTheQuote() public {
        WorldQuote memory q = vq(id, alice, ABOVE_240, 10, 0, false, 5);
        q.makerData = makerData(0, now_() + 1); // signed in the future
        hookRejects(q, keeperKey, 0, WorldVaultBase.QuoteExpiry.selector);
        // Signed 200 s ago with a 200 s life is fine; with 101 s more it is not (300 s TTL).
        vm.warp(now_() + 200);
        q = vq(id, alice, ABOVE_240, 10, 0, false, 5);
        q.makerData = makerData(0, now_() - 200);
        q.expiry = uint40(now_() + 100);
        vfill(keeperKey, q);
        q = vq(id, alice, ABOVE_240, 10, 0, false, 5);
        q.makerData = makerData(0, now_() - 200);
        q.expiry = uint40(now_() + 101);
        hookRejects(q, keeperKey, 0, WorldVaultBase.QuoteExpiry.selector);
    }

    // ------------------------------------------------------------ positions

    function testSettleRedeemsDecidedBooks() public {
        vfill(keeperKey, vq(id, alice, ABOVE_240, 1538e6, 0, false, 20e6));
        uint64[] memory list = new uint64[](2);
        list[0] = id;
        list[1] = 999;
        ops.settle(list); // undecided and unknown books are skipped
        eq(ops.position(id).hi, 1538e6, "still open");
        resolve(B, NO);
        ops.settle(list);
        eq(vaultCredit(), SEED + 20e6, "atom 0 paid back the split");
        eq(ops.position(id).hi, 0, "cleared");
        eq(ops.legRisk(A), 0, "leg risk released");
        (,, uint256 hi,,) = ops.totals();
        eq(hi, 0, "sum hi");
    }

    function testSyncAndMergeAfterADonation() public {
        vm.startPrank(alice);
        books.split(id, 100e6);
        for (uint8 i; i < 7; ++i) {
            books.transferAtoms(id, i, address(vault), 100e6);
        }
        vm.stopPrank();
        eq(ops.position(id).hi, 0, "not yet seen");
        ops.sync(id);
        eq(ops.position(id).lo, 100e6, "lo after sync");
        vm.prank(alice);
        vm.expectRevert();
        ops.merge(id, 100e6);
        vm.prank(keeper);
        ops.merge(id, 100e6);
        eq(vaultCredit(), SEED + 100e6, "merged donation");
        eq(ops.position(id).lo, 0, "flat");
        vm.expectRevert(WorldVaultBase.UnknownBook.selector);
        ops.sync(999);
    }

    // ------------------------------------------------------------ roles and settings

    function testRoleConflicts() public {
        bytes32 keeperRole = vault.KEEPER_ROLE();
        bytes32 markerRole = vault.MARKER_ROLE();
        bytes32 curatorRole = vault.CURATOR_ROLE();
        vm.startPrank(vaultAdmin);
        vm.expectRevert(WorldVaultBase.RoleConflict.selector);
        ops.grantRole(keeperRole, marker);
        vm.expectRevert(WorldVaultBase.RoleConflict.selector);
        ops.grantRole(keeperRole, curator);
        vm.expectRevert(WorldVaultBase.RoleConflict.selector);
        ops.grantRole(keeperRole, vaultAdmin);
        vm.expectRevert(WorldVaultBase.RoleConflict.selector);
        ops.grantRole(markerRole, keeper);
        vm.expectRevert(WorldVaultBase.RoleConflict.selector);
        ops.grantRole(curatorRole, keeper);
        ops.beginDefaultAdminTransfer(keeper);
        vm.stopPrank();
        vm.warp(T0 + 2 days);
        vm.prank(keeper);
        vm.expectRevert(WorldVaultBase.RoleConflict.selector);
        ops.acceptDefaultAdminTransfer();
    }

    function testSettingBounds() public {
        WorldVaultBase.Limits memory l = limits();
        l.maxTtl = 1 days + 1;
        vm.startPrank(curator);
        vm.expectRevert(WorldVaultBase.InvalidLimits.selector);
        ops.setLimits(l);
        l = limits();
        l.maxLegs = 7;
        vm.expectRevert(WorldVaultBase.InvalidLimits.selector);
        ops.setLimits(l);
        l = limits();
        l.maxFeeBps = 1001;
        vm.expectRevert(WorldVaultBase.InvalidLimits.selector);
        ops.setLimits(l);
        l = limits();
        l.cutoffBuffer = 7 days + 1;
        vm.expectRevert(WorldVaultBase.InvalidLimits.selector);
        ops.setLimits(l);
        WorldVaultBase.Risk memory k = risk();
        k.maxLossBps = 10_001;
        vm.expectRevert(WorldVaultBase.InvalidLimits.selector);
        ops.setRisk(k);
        vm.expectRevert(WorldVaultBase.InvalidLimits.selector);
        ops.setFeed(address(0), true);
        vm.stopPrank();
        vm.startPrank(vaultAdmin);
        vm.expectRevert(WorldVaultBase.InvalidLimits.selector);
        ops.setWithdrawLimit(999);
        vm.expectRevert(WorldVaultBase.InvalidLimits.selector);
        ops.setMaxMarkMove(10_001);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert();
        ops.setLimits(limits());
        vm.prank(curator);
        vm.expectRevert();
        ops.setDepositCap(1);
    }

    function testModuleCalledDirectlyHasNoPower() public {
        WorldVaultAdmin m = WorldVaultAdmin(ops.module());
        WorldQuote memory q = vq(id, alice, ABOVE_240, 10, 0, false, 5);
        vm.prank(address(books));
        vm.expectRevert();
        m.onWorldFill(digestOf(q), q, bytes32(0), bytes32(0), 0);
        eq(m.quoteEpoch(), 0, "own empty storage");
    }

    function testConstructorChecks() public {
        vm.expectRevert(WorldVaultBase.InvalidConfig.selector);
        new WorldVault(IWorldBooks(address(0x1234)), vaultAdmin, 1 days, "x", "x");
    }
}
