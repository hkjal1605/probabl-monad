// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BookDef, Leg, WorldQuote } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { WorldVaultBase } from "../../src/worlds/vault/WorldVaultBase.sol";
import { VaultWorldsBase } from "./VaultWorldsBase.t.sol";

/// @dev Gas of fills, and the vault hook's own cost in its costliest case: a six-leg,
///      eight-strike book whose position and leg risks are all written from zero. WorldBooks
///      gives the hook 1M; this keeps it well below that on Ethereum's schedule.
contract WorldGasTest is VaultWorldsBase {
    event log_named_uint(string key, uint256 val);

    function _sixLegBook(string memory tag) internal returns (uint64) {
        BookDef memory d = pricedDef();
        d.legs = new Leg[](6);
        for (uint256 i; i < 6; ++i) {
            d.legs[i] = Leg(keccak256(abi.encode(tag, i)), true);
        }
        d.strikes = new uint128[](8);
        for (uint256 i; i < 8; ++i) {
            d.strikes[i] = uint128(200e8 + i * 10e8);
        }
        return create(d);
    }

    function _wideLimits() internal {
        WorldVaultBase.Limits memory l = limits();
        l.maxLegs = 6;
        vm.prank(curator);
        ops.setLimits(l);
    }

    function testHookHeadroomInTheCostliestCase() public {
        _wideLimits();
        uint64 c = _sixLegBook("cold");
        // Give the vault an uneven, never-synced position in a fresh six-leg book.
        vm.startPrank(alice);
        books.split(c, 1000e6);
        for (uint8 i; i < 5; ++i) {
            books.transferAtoms(c, i, address(vault), 1000e6);
        }
        vm.stopPrank();
        WorldQuote memory q = vq(c, alice, 0x3F0, 1000e6, 0, false, 10e6);
        (bytes32 r, bytes32 vs) = sign(keeperKey, q);
        bytes32 digest = digestOf(q);
        // As if the fill had cost the vault 990 USDG: the book's risk grows, so the hook writes
        // its position and all six legs' risk from zero, checks eligibility and every cap.
        uint256 creditBefore = vaultCredit() + 990e6;
        vm.prank(address(books));
        uint256 start = gasleft();
        ops.onWorldFill(digest, q, r, vs, creditBefore);
        uint256 used = start - gasleft();
        emit log_named_uint("vault hook, six legs", used);
        ok(used < 400_000, string.concat("hook gas ", vm.toString(used)));
    }

    function testVaultFillInASixLegBook() public {
        _wideLimits();
        uint64 c = _sixLegBook("fill");
        WorldQuote memory q = vq(c, alice, 0x3F0, 1000e6, 0, false, 10e6);
        (bytes32 r, bytes32 vs) = sign(keeperKey, q);
        vm.prank(alice);
        uint256 start = gasleft();
        books.fillQuote(q, r, vs);
        uint256 used = start - gasleft();
        emit log_named_uint("vault fill, six legs, ten atoms", used);
        ok(used < 600_000, string.concat("vault fill gas ", vm.toString(used)));
    }

    function testWalletMakerFillGas() public {
        WorldQuote memory q = quote(id, alice, ABOVE_240, 1538e6, 0, false, 20e6);
        (bytes32 r, bytes32 vs) = sign(makerKey, q);
        vm.prank(alice);
        uint256 start = gasleft();
        books.fillQuote(q, r, vs);
        uint256 used = start - gasleft();
        emit log_named_uint("wallet-maker fill, seven atoms", used);
        ok(used < 250_000, string.concat("wallet fill gas ", vm.toString(used)));
    }
}
