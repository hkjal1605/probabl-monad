// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { EventOracle } from "../../src/worlds/EventOracle.sol";
import { WorldBooks } from "../../src/worlds/WorldBooks.sol";
import { WorldBooksAdmin } from "../../src/worlds/WorldBooksAdmin.sol";
import { WorldBooksBase } from "../../src/worlds/WorldBooksBase.sol";
import { BookDef, BookView, Leg } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { MockToken } from "../Base.t.sol";
import { MockPriceFeed } from "../mocks/MockPriceFeed.sol";
import { TestnetPermitToken } from "../mocks/TestnetToken.sol";
import { WorldsBase } from "./WorldsBase.t.sol";

/// @dev Custody, book creation, positions and book states.
contract WorldBooksTest is WorldsBase {
    // ------------------------------------------------------------ custody

    function testDepositAndWithdraw() public {
        eq(credit(alice), 1_000_000e6, "credit");
        eq(wb.liability(), 6_000_000e6, "liability");
        eq(usdg.balanceOf(address(books)), 6_000_000e6, "custody");
        vm.prank(alice);
        books.withdraw(400e6, carol);
        eq(credit(alice), 999_600e6, "after");
        eq(usdg.balanceOf(carol), 400e6, "received");
        eq(wb.liability(), 5_999_600e6, "liability after");
    }

    function testWithdrawRejectsBadInputsAndOverdraft() public {
        vm.startPrank(alice);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        books.withdraw(0, alice);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        books.withdraw(1, address(0));
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        books.withdraw(1, address(books));
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        books.withdraw(1_000_000e6 + 1, alice);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        books.deposit(0);
        vm.stopPrank();
    }

    function testWithdrawWorksWhilePaused() public {
        vm.prank(guardian);
        wb.pause(true, "incident");
        vm.prank(alice);
        books.withdraw(1e6, alice);
        eq(usdg.balanceOf(alice), 1e6, "withdrew");
    }

    function testFeeOnTransferDepositCreditsTheNet() public {
        MockToken taxed = new MockToken("TAX", 6);
        WorldBooks other =
            new WorldBooks(address(taxed), address(oracle), admin, bookAdmin, guardian, resolver);
        taxed.setFee(100); // 1%
        taxed.mint(alice, 100e6);
        vm.startPrank(alice);
        taxed.approve(address(other), type(uint256).max);
        other.deposit(100e6);
        vm.stopPrank();
        eq(WorldBooksAdmin(address(other)).credit(alice), 99e6, "net");
        eq(WorldBooksAdmin(address(other)).liability(), 99e6, "liability");
        eq(taxed.balanceOf(address(other)), 99e6, "custody");
    }

    function testNoReturnTokenWorks() public {
        MockToken quiet = new MockToken("QUIET", 6);
        quiet.setNoReturn(true);
        WorldBooks other =
            new WorldBooks(address(quiet), address(oracle), admin, bookAdmin, guardian, resolver);
        quiet.mint(alice, 5e6);
        vm.startPrank(alice);
        quiet.approve(address(other), type(uint256).max);
        other.deposit(5e6);
        other.withdraw(2e6, bob);
        vm.stopPrank();
        eq(quiet.balanceOf(bob), 2e6, "withdrawn");
    }

    function testDepositWithPermit() public {
        TestnetPermitToken token = new TestnetPermitToken("Global Dollar", "USDG", 6);
        WorldBooks other =
            new WorldBooks(address(token), address(oracle), admin, bookAdmin, guardian, resolver);
        uint256 key = 0xA1A1;
        address owner = vm.addr(key);
        token.mint(owner, 10e6);
        bytes32 digest = _permitDigest(token, owner, address(other), 10e6, 0, now_() + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        vm.prank(owner);
        other.depositWithPermit(10e6, now_() + 1 hours, v, r, s);
        eq(WorldBooksAdmin(address(other)).credit(owner), 10e6, "credited");
        // A front-run permit (already used) is ignored once its allowance is in place.
        token.mint(owner, 5e6);
        digest = _permitDigest(token, owner, address(other), 5e6, 1, now_() + 1 hours);
        (v, r, s) = vm.sign(key, digest);
        token.permit(owner, address(other), 5e6, now_() + 1 hours, v, r, s);
        vm.prank(owner);
        other.depositWithPermit(5e6, now_() + 1 hours, v, r, s);
        eq(WorldBooksAdmin(address(other)).credit(owner), 15e6, "credited after front-run");
    }

    function _permitDigest(
        TestnetPermitToken token,
        address owner,
        address spender,
        uint256 value,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                owner,
                spender,
                value,
                nonce,
                deadline
            )
        );
        return keccak256(abi.encodePacked(hex"1901", token.DOMAIN_SEPARATOR(), structHash));
    }

    function testConstructorChecks() public {
        vm.expectRevert(WorldBooksBase.InvalidAddress.selector);
        new WorldBooks(address(0x1234), address(oracle), admin, bookAdmin, guardian, resolver);
        vm.expectRevert(WorldBooksBase.InvalidAddress.selector);
        new WorldBooks(address(usdg), address(0x1234), admin, bookAdmin, guardian, resolver);
        vm.expectRevert(WorldBooksBase.InvalidAddress.selector);
        new WorldBooks(address(usdg), address(oracle), address(0), bookAdmin, guardian, resolver);
        vm.expectRevert(WorldBooksBase.InvalidAddress.selector);
        new WorldBooks(address(usdg), address(oracle), admin, bookAdmin, address(0), resolver);
    }

    function testModuleCalledDirectlyHasNoPower() public {
        WorldBooksAdmin m = WorldBooksAdmin(wb.module());
        BookDef memory d = pricedDef();
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.Unauthorized.selector);
        m.createBook(d, URI);
        eq(m.bookCount(), 0, "empty");
    }

    // ------------------------------------------------------------ books

    function testCreatesPricedAndEventOnlyBooks() public {
        uint64 priced = create(pricedDef());
        uint64 events = create(eventDef());
        eq(priced, 1, "first id");
        eq(events, 2, "second id");
        BookView memory v = wb.book(priced);
        eq(uint160(v.feed), uint160(address(feed)), "feed");
        eq(uint256(v.underlying), uint256(NVDA), "underlying");
        eq(v.atomCount, 7, "atoms");
        eq(v.legCount, 3, "legs");
        eq(v.strikeCount, 5, "strikes");
        eq(v.status, 1, "undecided");
        eq(v.feeBps, 100, "fee");
        eq(wb.book(events).atomCount, 2, "event atoms");
        (bytes32[] memory keys, bool[] memory want) = wb.legs(priced);
        eq(uint256(keys[1]), uint256(B), "leg key");
        ok(want[0] && want[1] && want[2], "wants");
        eq(wb.strikes(priced)[4], 260e8, "strike");
        eq(wb.state(priced), 1, "trading");
        eq(wb.state(99), 0, "unknown");
        eq(wb.bookOf(keccak256(abi.encode(pricedDef()))), priced, "bookOf");
    }

    function testCreateIsIdempotent() public {
        uint64 first = create(pricedDef());
        uint64 again = create(pricedDef());
        eq(again, first, "same id");
        eq(wb.bookCount(), 1, "one book");
    }

    function testOnlyTheBookAdminCreates() public {
        BookDef memory d = pricedDef();
        vm.prank(guardian);
        vm.expectRevert(WorldBooksBase.Unauthorized.selector);
        wb.createBook(d, URI);
    }

    function testNoLegsOrTooMany() public {
        BookDef memory d = pricedDef();
        d.legs = new Leg[](0);
        _rejected(d);
        d.legs = new Leg[](7);
        for (uint256 i; i < 7; ++i) {
            d.legs[i] = Leg(keccak256(abi.encode(i)), true);
        }
        _rejected(d);
    }

    function testSixLegsAndMixedWants() public {
        BookDef memory d = pricedDef();
        d.legs = new Leg[](6);
        for (uint256 i; i < 6; ++i) {
            d.legs[i] = Leg(keccak256(abi.encode(i)), i % 2 == 0);
        }
        uint64 id = create(d);
        (, bool[] memory want) = wb.legs(id);
        ok(want[0] && !want[1] && want[4] && !want[5], "wants");
    }

    function testZeroOrDuplicateLegKeys() public {
        BookDef memory d = pricedDef();
        d.legs[1].eventKey = bytes32(0);
        _rejected(d);
        d = pricedDef();
        d.legs[2].eventKey = A;
        _rejected(d);
    }

    function testLegsMustBeUnknown() public {
        vm.prank(guardian);
        oracle.freeze(B, "known");
        _rejected(pricedDef());
        vm.prank(bookAdmin);
        oracle.reopen(B, "no");
        resolve(C, YES);
        _rejected(pricedDef());
    }

    function testFeedChecks() public {
        BookDef memory d = pricedDef();
        d.feed = address(0xFEED);
        _rejected(d);
        MockPriceFeed wide = new MockPriceFeed(19, "x", 1, 1, T0);
        d.feed = address(wide);
        _rejected(d);
        MockPriceFeed exact = new MockPriceFeed(18, "x", 1, 1, T0);
        d.feed = address(exact);
        create(d);
    }

    function testStrikeRules() public {
        BookDef memory d = pricedDef();
        d.strikes = new uint128[](0);
        _rejected(d);
        d.strikes = new uint128[](9);
        for (uint256 i; i < 9; ++i) {
            d.strikes[i] = uint128(i + 1);
        }
        _rejected(d);
        d = pricedDef();
        d.strikes[2] = d.strikes[1];
        _rejected(d);
        d = pricedDef();
        d.strikes[3] = d.strikes[2] - 1;
        _rejected(d);
        d = pricedDef();
        d.strikes[0] = 0;
        _rejected(d);
        d = pricedDef();
        d.strikes = new uint128[](8);
        for (uint256 i; i < 8; ++i) {
            d.strikes[i] = uint128(1 + i);
        }
        uint64 id = create(d);
        eq(wb.book(id).atomCount, 10, "ten atoms");
        d = pricedDef();
        d.strikes = new uint128[](1);
        d.strikes[0] = type(uint128).max;
        create(d);
    }

    function testFixingRules() public {
        BookDef memory d = pricedDef();
        d.underlying = bytes32(0);
        _rejected(d);
        d = pricedDef();
        d.maxStaleness = 0;
        _rejected(d);
        d = pricedDef();
        d.maxStaleness = 1 days + 1;
        _rejected(d);
        d = pricedDef();
        d.fixingTime = d.cutoff - 1;
        _rejected(d);
        d = pricedDef();
        d.fixingTime = d.cutoff;
        create(d);
    }

    function testCutoffFeeAndMetadata() public {
        BookDef memory d = pricedDef();
        d.cutoff = uint40(T0);
        _rejected(d);
        d = pricedDef();
        d.feeBps = 1001;
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.FeeCap.selector);
        wb.createBook(d, URI);
        d = pricedDef();
        d.metadataHash = keccak256("other");
        _rejected(d);
        d = pricedDef();
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.InvalidBook.selector);
        wb.createBook(d, "");
        d.metadataHash = keccak256(new bytes(513));
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.InvalidBook.selector);
        wb.createBook(d, string(new bytes(513)));
    }

    function testEventOnlyBooksCarryNoFixing() public {
        BookDef memory d = eventDef();
        d.strikes = strikes5();
        _rejected(d);
        d = eventDef();
        d.fixingTime = uint40(T0 + 30 days);
        _rejected(d);
        d = eventDef();
        d.maxStaleness = 1;
        _rejected(d);
        d = eventDef();
        d.underlying = NVDA;
        _rejected(d);
    }

    function _rejected(BookDef memory d) internal {
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.InvalidBook.selector);
        wb.createBook(d, URI);
    }

    // ------------------------------------------------------------ positions

    function testSplitAndMerge() public {
        uint64 id = create(pricedDef());
        vm.prank(alice);
        books.split(id, 100e6);
        uint256[] memory a = atoms(id, alice);
        eq(a.length, 7, "atoms");
        for (uint256 i; i < 7; ++i) {
            eq(a[i], 100e6, "split");
        }
        eq(wb.backing(id), 100e6, "backing");
        eq(credit(alice), 999_900e6, "credit");
        vm.prank(alice);
        books.merge(id, 40e6);
        eq(atoms(id, alice)[6], 60e6, "merged");
        eq(wb.backing(id), 60e6, "backing after");
        eq(credit(alice), 999_940e6, "credit after");
        eq(wb.liability(), 6_000_000e6, "liability unchanged");
    }

    function testPositionInputChecks() public {
        uint64 id = create(pricedDef());
        vm.startPrank(alice);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        books.split(id, 0);
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        books.split(id, 1_000_000e6 + 1);
        vm.expectRevert(WorldBooksBase.UnknownBook.selector);
        books.split(99, 1);
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        books.merge(id, 1);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        books.merge(id, 0);
        books.split(id, 10);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        books.transferAtoms(id, 7, bob, 1);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        books.transferAtoms(id, 1, alice, 1);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        books.transferAtoms(id, 1, address(0), 1);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        books.transferAtoms(id, 1, bob, 0);
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        books.transferAtoms(id, 1, bob, 11);
        books.transferAtoms(id, 1, bob, 4);
        vm.stopPrank();
        eq(atoms(id, alice)[1], 6, "sent");
        eq(atoms(id, bob)[1], 4, "received");
        // Merging needs a full set: alice is short of atom 1.
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        books.merge(id, 7);
        vm.prank(alice);
        books.merge(id, 6);
    }

    function testSplitOverflowsAt128Bits() public {
        uint64 id = create(eventDef());
        uint256 huge = uint256(type(uint128).max) + 1;
        fund(carol, huge);
        vm.prank(carol);
        vm.expectRevert(WorldBooksBase.Overflow.selector);
        books.split(id, huge);
        vm.prank(carol);
        books.split(id, type(uint128).max);
        vm.prank(carol);
        vm.expectRevert(WorldBooksBase.Overflow.selector);
        books.split(id, 1);
        // Moving atoms into a full balance overflows too.
        vm.prank(alice);
        books.split(id, 1);
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.Overflow.selector);
        books.transferAtoms(id, 0, carol, 1);
    }

    function testOddAtomCountPacking() public {
        // Seven atoms: the last word holds one balance; the high half must stay clear.
        uint64 id = create(pricedDef());
        vm.prank(alice);
        books.split(id, 5);
        vm.prank(alice);
        books.transferAtoms(id, 6, bob, 5);
        uint256[] memory b = atoms(id, bob);
        eq(b[6], 5, "atom 6");
        for (uint256 i; i < 6; ++i) {
            eq(b[i], 0, "others");
        }
    }

    function testSplitStopsOnceDecidedButMergeContinues() public {
        uint64 id = create(eventDef());
        vm.prank(alice);
        books.split(id, 10);
        resolve(B, NO);
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.InvalidState.selector);
        books.split(id, 1);
        // The reverted split latched nothing; the view still reports the failure.
        eq(wb.book(id).status, 1, "not latched");
        eq(wb.state(id), 5, "failed");
        vm.prank(alice);
        books.merge(id, 4);
        eq(credit(alice), 1_000_000e6 - 6, "merged after decision");
    }

    // ------------------------------------------------------------ states

    function testStateTransitionsOfAPricedBook() public {
        uint64 id = create(pricedDef());
        eq(wb.state(id), 1, "trading");
        vm.prank(guardian);
        oracle.freeze(A, "news");
        eq(wb.state(id), 2, "halted by leg");
        resolve(A, YES);
        eq(wb.state(id), 1, "trading with A passed");
        vm.prank(guardian);
        wb.setFrozen(id, true, "book");
        eq(wb.state(id), 2, "halted by book");
        vm.prank(bookAdmin);
        wb.setFrozen(id, false, "ok");
        resolve(B, YES);
        vm.warp(T0 + 27 days);
        eq(wb.state(id), 3, "closed after cutoff");
        resolve(C, YES);
        eq(wb.state(id), 3, "closed until the fixing");
        vm.warp(T0 + 28 days);
        eq(wb.state(id), 4, "awaiting fix");
    }

    function testAWantNoLegFailsOnYes() public {
        BookDef memory d = pricedDef();
        d.legs[0].wantYes = false;
        uint64 id = create(d);
        resolve(A, NO);
        eq(wb.state(id), 1, "A NO passes");
        resolve(B, YES);
        resolve(C, INVALID);
        eq(wb.state(id), 5, "INVALID fails");
        (uint8 status, uint8 winner) = books.settle(id);
        eq(status, 2, "failed");
        eq(winner, 0, "atom 0");

        d = pricedDef();
        d.legs = new Leg[](1);
        d.legs[0] = Leg(keccak256("D"), false);
        id = create(d);
        resolve(keccak256("D"), YES);
        eq(wb.state(id), 5, "want NO, got YES");
    }

    function testEventOnlyBookPasses() public {
        uint64 id = create(eventDef());
        passAll();
        eq(wb.state(id), 6, "passed");
        (uint8 status, uint8 winner) = books.settle(id);
        eq(status, 3, "passed status");
        eq(winner, 1, "atom 1");
        // Settling again is a no-op.
        (status, winner) = books.settle(id);
        eq(status, 3, "still passed");
    }

    function testFreezeRoles() public {
        uint64 id = create(eventDef());
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.Unauthorized.selector);
        wb.setFrozen(id, true, "x");
        vm.prank(guardian);
        wb.setFrozen(id, true, "x");
        vm.prank(guardian);
        vm.expectRevert(WorldBooksBase.Unauthorized.selector);
        wb.setFrozen(id, false, "x");
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        wb.setFrozen(id, true, "x");
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        wb.setFrozen(id, false, bytes32(0));
        vm.prank(bookAdmin);
        vm.expectRevert(WorldBooksBase.UnknownBook.selector);
        wb.setFrozen(42, true, "x");
    }

    // ------------------------------------------------------------ governance

    function testPauseAndAdmin() public {
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.Unauthorized.selector);
        wb.pause(true, "x");
        vm.prank(guardian);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        wb.pause(false, "x");
        vm.prank(guardian);
        wb.pause(true, "x");
        ok(wb.paused(), "paused");
        vm.prank(guardian);
        wb.pause(false, "y");
        vm.prank(admin);
        wb.proposeAdmin(bob);
        vm.prank(bob);
        vm.expectRevert(WorldBooksBase.AdminDelay.selector);
        wb.acceptAdmin();
        vm.warp(T0 + 2 days);
        vm.prank(bob);
        wb.acceptAdmin();
        eq(uint160(wb.admin()), uint160(bob), "admin");
        vm.prank(bob);
        wb.configure(carol, carol, carol);
        (address b_, address g, address r) = wb.roles();
        ok(b_ == carol && g == carol && r == carol, "roles");
        vm.prank(bob);
        vm.expectRevert(WorldBooksBase.InvalidAddress.selector);
        wb.configure(carol, address(0), carol);
    }

    function testClaimFees() public {
        uint64 id = create(pricedDef());
        // A 1% fee on a 20 USDG fill.
        fill(makerKey, quote(id, alice, 0x70, 1538e6, 0, false, 20e6));
        eq(wb.fees(), 0.2e6, "fees");
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.Unauthorized.selector);
        wb.claimFees(alice, 1);
        vm.startPrank(admin);
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        wb.claimFees(admin, 0.2e6 + 1);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        wb.claimFees(address(0), 1);
        wb.claimFees(admin, 0.2e6);
        vm.stopPrank();
        eq(credit(admin), 0.2e6, "claimed");
        eq(wb.fees(), 0, "none left");
        eq(wb.liability(), usdg.balanceOf(address(books)), "liability");
    }
}
