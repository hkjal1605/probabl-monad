// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { WorldBooksBase } from "../../src/worlds/WorldBooksBase.sol";
import { BookDef, WorldQuote } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { WorldsBase } from "./WorldsBase.t.sol";

/// @dev Probes from the security review that hold (malformed calldata, precompiles as makers,
///      conservation, a fuzzed ten-atom walk), plus regressions of what it found.
contract WorldBooksProbesTest is WorldsBase {
    uint256 internal constant FIX_AT = T0 + 28 days;

    /// Neither atoms nor fees can be sent to WorldBooks itself, where nothing could move them.
    function testNothingStrandsAtTheBooksAddress() public {
        uint64 id = create(pricedDef());
        vm.prank(alice);
        books.split(id, 100e6);
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        books.transferAtoms(id, 1, address(books), 100e6);
        fill(makerKey, quote(id, alice, 0x70, 1538e6, 0, false, 20e6));
        vm.prank(admin);
        vm.expectRevert(WorldBooksBase.InvalidTerms.selector);
        wb.claimFees(address(books), 1);
    }

    /// Dirty high bits in a calldata field (mask) are rejected by the ABI decoder, so the
    /// digest and the settlement can never disagree.
    function test_OK_dirtyCalldataIsRejected() public {
        uint64 id = create(eventDef());
        WorldQuote memory q = quote(id, alice, 2, 1000e6, 0, false, 30e6);
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        bytes memory data = abi.encodeCall(books.fillQuote, (q, r, vs));
        assembly ("memory-safe") {
            let p := add(add(data, 32), 68) // selector + taker + book -> mask word
            mstore(p, or(mload(p), shl(16, 1)))
        }
        vm.prank(alice);
        (bool success,) = address(books).call(data);
        ok(!success, "dirty mask accepted");
    }

    /// A taker can name any address as a "contract maker"; a precompile that echoes its input
    /// (identity, 0x04) or hashes it (sha256, 0x02) never yields the exact 32-byte selector.
    function test_OK_precompilesCannotActAsMakers() public {
        uint64 id = create(eventDef());
        for (uint256 i = 1; i <= 10; ++i) {
            address pc = address(uint160(i));
            // the "maker" holds the atoms it would deliver, so the fill reaches the hook
            vm.startPrank(alice);
            books.split(id, 1000e6);
            books.transferAtoms(id, 1, pc, 1000e6);
            vm.stopPrank();
            WorldQuote memory q = quote(id, bob, 2, 1000e6, 0, false, 30e6);
            q.nonce = (uint256(uint160(pc)) << 96) | i;
            vm.prank(bob);
            (bool success, bytes memory ret) =
                address(books).call(abi.encodeCall(books.fillQuote, (q, bytes32(0), bytes32(0))));
            ok(!success, "a precompile accepted a fill");
            ok(bytes4(ret) == bytes4(keccak256("MakerRejected()")), "reverted before the hook");
        }
    }

    /// Credit, backing and fees always sum to the liability and the token balance across a
    /// buy with a split shortfall, a sell with auto-merge, a decision and redemptions.
    function test_OK_conservationAcrossBuySellAndRedeem() public {
        uint64 id = create(pricedDef());
        // maker sells 400 units of atoms 4..6 plus 100 refund units (shortfall split)
        WorldQuote memory q = quote(id, alice, uint16(0x70), 400e6, 100e6, false, 150e6);
        fill(makerKey, q);
        // alice sells half back; maker auto-merges what completes sets
        q = quote(id, alice, uint16(0x70), 200e6, 50e6, true, 70e6);
        fill(makerKey, q);
        _conserve(id);
        vm.warp(FIX_AT - 5 minutes);
        feed.update(2, 255e8, FIX_AT - 5 minutes); // atom 5 wins
        passAll();
        vm.warp(FIX_AT + 1);
        wb.proposeFix(id, 2);
        vm.warp(FIX_AT + 1 + 1 hours);
        eq(wb.finalizeFix(id), 5, "winner");
        vm.prank(alice);
        eq(books.redeem(id), 200e6, "alice winner payout");
        vm.prank(maker);
        books.redeem(id);
        eq(wb.backing(id), 0, "backing left after every holder redeemed");
        _conserve(id);
    }

    /// Random splits, merges, transfers and buy/sell fills between two wallet makers and three
    /// takers on a ten-atom book: every atom's supply stays equal to the backing and the books
    /// conserve value.
    function testFuzz_OK_fillsBackEveryAtomAndConserve(uint256 seed) public {
        _walk(create(tenAtomDef()), seed);
    }

    /// The random walk really fills (both sides), so the fuzz above is not vacuous.
    function test_OK_walkFills() public {
        uint64 id = create(tenAtomDef());
        uint256 filled;
        for (uint256 i; i < 6; ++i) {
            filled += _walk(id, i);
        }
        ok(filled >= 20, string.concat("too few fills: ", _str(filled)));
    }

    function _walk(uint64 id, uint256 seed) internal returns (uint256 filled) {
        address[5] memory who = [alice, bob, carol, maker, maker2];
        uint256[2] memory keys = [makerKey, maker2Key];
        for (uint256 step; step < 24; ++step) {
            seed = uint256(keccak256(abi.encode(seed, step)));
            uint256 op = seed % 5;
            address a = who[(seed >> 8) % 3];
            if (op == 0) {
                vm.prank(who[(seed >> 8) % 5]);
                books.split(id, 1 + (seed >> 16) % 5000e6);
            } else if (op == 1) {
                address m = who[(seed >> 8) % 5];
                uint256[] memory b = atoms(id, m);
                uint256 low = type(uint256).max;
                for (uint256 i; i < b.length; ++i) {
                    if (b[i] < low) low = b[i];
                }
                if (low != 0) {
                    vm.prank(m);
                    books.merge(id, 1 + (seed >> 16) % low);
                }
            } else if (op == 2) {
                uint8 atom = uint8((seed >> 16) % 10);
                uint256 bal = atoms(id, a)[atom];
                address to = who[(seed >> 24) % 5];
                if (bal != 0 && to != a) {
                    vm.prank(a);
                    books.transferAtoms(id, atom, to, 1 + (seed >> 32) % bal);
                }
            } else {
                bool sell = op == 4;
                uint16 mask = uint16(((seed >> 16) % 1023) << 1) & 0x3FE;
                uint128 units = mask == 0 ? 0 : uint128(1 + (seed >> 40) % 3000e6);
                uint128 refund = uint128((seed >> 80) % 3000e6);
                if (mask == 0 && refund == 0) refund = 1;
                uint256 hi = units > refund ? units : refund;
                uint256 lo = refund;
                for (uint256 i = 1; i < 10; ++i) {
                    uint256 pay = (mask >> i) & 1 == 1 ? units : 0;
                    if (pay < lo) lo = pay;
                }
                uint128 price = uint128(lo + (seed >> 120) % (hi - lo + 1));
                if (price == 0) price = 1;
                if (price > hi) continue;
                WorldQuote memory q = quote(id, a, mask, units, refund, sell, price);
                (bytes32 r, bytes32 vs) = sign(keys[(seed >> 200) % 2], q);
                vm.prank(a);
                try books.fillQuote(q, r, vs) {
                    ++filled;
                } catch { }
            }
            for (uint256 atom; atom < 10; ++atom) {
                uint256 supply;
                for (uint256 i; i < 5; ++i) {
                    supply += atoms(id, who[i])[atom];
                }
                eq(supply, wb.backing(id), "atom supply == backing");
            }
            _conserve(id);
        }
    }

    function tenAtomDef() internal view returns (BookDef memory d) {
        d = pricedDef();
        uint128[] memory s = new uint128[](8);
        for (uint256 i; i < 8; ++i) {
            s[i] = uint128(200e8 + i * 10e8);
        }
        d.strikes = s;
    }

    function _conserve(uint64 id) internal view {
        address[6] memory users = [alice, bob, carol, maker, maker2, delegate];
        uint256 total = wb.backing(id) + wb.fees();
        for (uint256 i; i < users.length; ++i) {
            total += wb.credit(users[i]);
        }
        eq(total, wb.liability(), "credit + backing + fees == liability");
        eq(usdg.balanceOf(address(books)), wb.liability(), "token balance == liability");
    }
}
