// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { EventOracle } from "../../src/worlds/EventOracle.sol";
import { WorldBooks } from "../../src/worlds/WorldBooks.sol";
import { WorldBooksAdmin } from "../../src/worlds/WorldBooksAdmin.sol";
import { BookDef, BookView, WorldQuote } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { WorldVault } from "../../src/worlds/vault/WorldVault.sol";
import { WorldVaultAdmin } from "../../src/worlds/vault/WorldVaultAdmin.sol";
import { WorldVaultBase } from "../../src/worlds/vault/WorldVaultBase.sol";
import { MockToken } from "../Base.t.sol";
import { MockPriceFeed } from "../mocks/MockPriceFeed.sol";
import { VaultWorldsBase } from "./VaultWorldsBase.t.sol";
import { WVm } from "./WorldsBase.t.sol";

struct Env {
    WorldBooks books;
    EventOracle oracle;
    MockPriceFeed feed;
    MockToken usdg;
    WorldVault vault;
    address bookAdmin;
    address resolver;
    address marker;
    address sentinel;
    address keeper;
    uint256 keeperKey;
}

/// @dev Random vault quotes, cash-outs, donations, resolutions, fixings, settlements and
///      deposit/redemption batches.
contract VaultHandler {
    WVm internal constant vm = WVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    Env internal e;
    WorldBooksAdmin internal wb;
    WorldVaultAdmin internal ops;
    address[] public takers;
    uint64[] public ids;
    bytes32[3] internal legs;
    uint256 internal nonce;
    uint80 internal round = 1;
    uint256 public fills;
    uint256 public processed;

    constructor(
        Env memory e_,
        address[] memory takers_,
        uint64[] memory ids_,
        bytes32[3] memory legs_
    ) {
        e = e_;
        wb = WorldBooksAdmin(address(e_.books));
        ops = WorldVaultAdmin(address(e_.vault));
        takers = takers_;
        ids = ids_;
        legs = legs_;
    }

    function _taker(uint256 seed) internal view returns (address) {
        return takers[seed % takers.length];
    }

    function _id(uint256 seed) internal view returns (uint64) {
        return ids[seed % ids.length];
    }

    function _sign(WorldQuote memory q) internal view returns (bytes32 r, bytes32 vs) {
        (uint8 v, bytes32 r_, bytes32 s) = vm.sign(e.keeperKey, wb.quoteDigest(q));
        r = r_;
        vs = bytes32(uint256(s) | (v == 28 ? uint256(1) << 255 : 0));
    }

    function _quote(
        address taker,
        uint64 id,
        uint16 mask,
        uint256 units,
        uint256 refund,
        bool sell,
        uint256 price
    ) internal returns (WorldQuote memory q) {
        q = WorldQuote({
            taker: taker,
            book: id,
            mask: mask,
            units: uint128(units),
            refund: uint128(refund),
            sell: sell,
            price: uint128(price),
            expiry: uint40(vm.getBlockTimestamp() + 60),
            makerData: uint64(uint24(ops.quoteEpoch())) | uint64(vm.getBlockTimestamp()) << 24,
            nonce: uint256(uint160(address(e.vault))) << 96 | ++nonce
        });
    }

    /// The vault sells a random bundle at a price inside its margin.
    function vaultSells(
        uint256 takerSeed,
        uint256 book,
        uint16 mask,
        uint256 units,
        uint256 refund,
        uint256 priceSeed
    ) external {
        uint64 id = _id(book);
        BookView memory v = wb.book(id);
        mask = uint16(mask & ((uint256(1) << v.atomCount) - 2));
        units = mask == 0 ? 0 : 1e6 + units % 20_000e6;
        refund = refund % 3 == 0 ? 0 : 1e6 + refund % 5_000e6;
        if (mask == 0 && refund == 0) return;
        (uint256 minPay, uint256 maxPay) = _range(mask, units, refund, v.atomCount);
        uint256 margin = (maxPay - minPay) * 10 / 10_000;
        uint256 price = minPay + margin + priceSeed % (maxPay - minPay - margin + 1);
        if (price == 0) return;
        WorldQuote memory q = _quote(_taker(takerSeed), id, mask, units, refund, false, price);
        (bytes32 r, bytes32 vs) = _sign(q);
        vm.prank(q.taker);
        try e.books.fillQuote(q, r, vs) {
            ++fills;
        } catch { }
    }

    /// A taker sells part of one of its atoms back to the vault.
    function vaultBuys(
        uint256 takerSeed,
        uint256 book,
        uint256 atom,
        uint256 amount,
        uint256 priceSeed
    ) external {
        address taker = _taker(takerSeed);
        uint64 id = _id(book);
        uint256[] memory held = wb.atoms(id, taker);
        if (held.length == 0) return;
        atom = 1 + atom % (held.length - 1);
        if (held[atom] == 0) return;
        uint256 units = 1 + amount % held[atom];
        uint256 margin = units * 10 / 10_000;
        uint256 price = priceSeed % (units - margin + 1);
        if (price == 0) price = 1;
        if (price > units - margin) return;
        // forge-lint: disable-next-line(incorrect-shift)
        WorldQuote memory q = _quote(taker, id, uint16(1 << atom), units, 0, true, price);
        (bytes32 r, bytes32 vs) = _sign(q);
        vm.prank(taker);
        try e.books.fillQuote(q, r, vs) {
            ++fills;
        } catch { }
    }

    function donate(uint256 takerSeed, uint256 book, uint256 atom, uint256 amount) external {
        address taker = _taker(takerSeed);
        uint64 id = _id(book);
        uint256[] memory held = wb.atoms(id, taker);
        if (held.length == 0) return;
        atom = atom % held.length;
        if (held[atom] == 0) return;
        vm.prank(taker);
        e.books.transferAtoms(id, uint8(atom), address(e.vault), 1 + amount % held[atom]);
        ops.sync(id);
    }

    function merge(uint256 book) external {
        uint64 id = _id(book);
        uint256[] memory held = wb.atoms(id, address(e.vault));
        uint256 low = type(uint256).max;
        for (uint256 i; i < held.length; ++i) {
            if (held[i] < low) low = held[i];
        }
        if (low == 0 || low == type(uint256).max) return;
        vm.prank(e.keeper);
        ops.merge(id, low);
    }

    function resolveLeg(uint256 legSeed, uint256 outcomeSeed) external {
        bytes32 key = legs[legSeed % 3];
        (uint8 s,) = e.oracle.outcome(key);
        if (s >= 3) return;
        uint8 outcome = outcomeSeed % 4 == 0 ? 4 : 3;
        bytes32 h = e.oracle.resolutionHash(key, outcome, "evidence", "ipfs://e");
        vm.prank(e.bookAdmin);
        e.oracle.commit(key, h);
        vm.prank(e.resolver);
        e.oracle.resolve(key, outcome, "evidence", "ipfs://e");
    }

    function fix(uint256 book, uint256 priceSeed) external {
        uint64 id = _id(book);
        BookView memory v = wb.book(id);
        if (v.feed == address(0) || v.status != 1) return;
        if (vm.getBlockTimestamp() < v.fixingTime) vm.warp(v.fixingTime);
        if (wb.state(id) != 4) return;
        e.feed.update(++round, int256(200e8 + priceSeed % 80e8), v.fixingTime);
        try wb.proposeFix(id, round) { } catch { }
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        try wb.finalizeFix(id) { } catch { }
    }

    function settle() external {
        ops.settle(ids);
    }

    function requestDeposit(uint256 seed, uint256 assets) external {
        address who = _taker(seed);
        assets = 1 + assets % 50_000e6;
        vm.prank(who);
        try e.vault.requestDeposit(assets) { } catch { }
    }

    function requestRedeem(uint256 seed, uint256 shares) external {
        address who = _taker(seed);
        uint256 balance = e.vault.balanceOf(who);
        if (balance == 0) return;
        vm.prank(who);
        e.vault.requestRedeem(1 + shares % balance);
    }

    function closeAndMark(uint256 navSeed, bool floor) external {
        vm.warp(vm.getBlockTimestamp() + 1 days);
        try e.vault.closeBatch() { } catch { }
        (, uint64 closed) = ops.batches();
        if (closed == 0) return;
        WorldVaultBase.Batch memory bt = ops.batch(closed);
        if (floor) {
            vm.warp(vm.getBlockTimestamp() + 3 days);
            e.vault.processAtFloor(closed);
        } else {
            uint256 nav = bt.guaranteed + navSeed % (bt.best - bt.guaranteed + 1);
            vm.prank(e.sentinel);
            ops.approveMark(closed, nav);
            vm.prank(e.marker);
            e.vault.mark(closed, nav);
        }
        ++processed;
        for (uint256 i; i < takers.length; ++i) {
            try e.vault.claim(closed, takers[i]) { } catch { }
        }
    }

    function warp(uint256 seconds_) external {
        vm.warp(vm.getBlockTimestamp() + seconds_ % 2 hours);
    }

    function _range(uint16 mask, uint256 units, uint256 refund, uint256 count)
        internal
        pure
        returns (uint256 minPay, uint256 maxPay)
    {
        minPay = type(uint256).max;
        for (uint256 i; i < count; ++i) {
            uint256 pay = i == 0 ? refund : ((uint256(mask) >> i) & 1 == 1 ? units : 0);
            if (pay < minPay) minPay = pay;
            if (pay > maxPay) maxPay = pay;
        }
    }
}

contract WorldVaultInvariantTest is VaultWorldsBase {
    VaultHandler internal handler;
    uint64[] internal books_;
    address[] internal takers;

    function setUp() public override {
        super.setUp();
        BookDef memory d = pricedDef();
        d.legs[2].eventKey = keccak256("sibling C");
        books_.push(id);
        books_.push(create(d));
        books_.push(create(eventDef()));
        takers.push(alice);
        takers.push(bob);
        takers.push(vaultAdmin);
        vm.prank(vaultAdmin);
        ops.setOpenDeposits(true);
        usdg.mint(vaultAdmin, 1_000_000e6);
        vm.prank(vaultAdmin);
        usdg.approve(address(books), type(uint256).max);
        vm.prank(vaultAdmin);
        books.deposit(1_000_000e6);
        WorldVaultBase.Risk memory k = risk();
        k.maxLossBps = 9000;
        k.maxDailyExposureBps = 10_000;
        k.maxBookRisk = type(uint128).max;
        k.maxLegRisk = type(uint128).max;
        vm.prank(curator);
        ops.setRisk(k);
        Env memory env = Env({
            books: books,
            oracle: oracle,
            feed: feed,
            usdg: usdg,
            vault: vault,
            bookAdmin: bookAdmin,
            resolver: resolver,
            marker: marker,
            sentinel: sentinel,
            keeper: keeper,
            keeperKey: keeperKey
        });
        handler = new VaultHandler(env, takers, books_, [A, B, keccak256("sibling C")]);
        feed.transferOwnership(address(handler));
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    /// The tracked positions, their sums and every leg's risk match the vault's actual atoms.
    function invariant_trackingMatchesBalances() public view {
        uint256 sumLo;
        uint256 sumHi;
        for (uint256 b; b < books_.length; ++b) {
            uint256[] memory held = wb.atoms(books_[b], address(vault));
            uint256 lo = type(uint256).max;
            uint256 hi;
            for (uint256 i; i < held.length; ++i) {
                if (held[i] < lo) lo = held[i];
                if (held[i] > hi) hi = held[i];
            }
            WorldVaultBase.Position memory p = ops.position(books_[b]);
            eq(p.lo, lo, "position lo");
            eq(p.hi, hi, "position hi");
            sumLo += lo;
            sumHi += hi;
        }
        (, uint256 trackedLo, uint256 trackedHi,,) = ops.totals();
        eq(trackedLo, sumLo, "sum lo");
        eq(trackedHi, sumHi, "sum hi");
        bytes32[4] memory keys = [A, B, C, keccak256("sibling C")];
        for (uint256 k; k < keys.length; ++k) {
            uint256 expected;
            for (uint256 b; b < books_.length; ++b) {
                (bytes32[] memory legKeys,) = wb.legs(books_[b]);
                bool uses;
                for (uint256 j; j < legKeys.length; ++j) {
                    if (legKeys[j] == keys[k]) uses = true;
                }
                if (uses) {
                    WorldVaultBase.Position memory p = ops.position(books_[b]);
                    if (p.cost > int256(uint256(p.lo))) {
                        expected += uint256(p.cost - int256(uint256(p.lo)));
                    }
                }
            }
            eq(ops.legRisk(keys[k]), expected, "leg risk");
        }
    }

    /// The vault holds the assets and shares it owes, and the books stay fully backed.
    function invariant_vaultHoldsWhatItOwes() public view {
        (uint256 pending, uint256 owed, uint256 escrow) = ops.held();
        ok(usdg.balanceOf(address(vault)) >= pending + owed, "assets owed");
        ok(vault.balanceOf(address(vault)) >= escrow, "shares owed");
        eq(usdg.balanceOf(address(books)), wb.liability(), "books custody");
    }

    function testRandomWalkKeepsTrackingExact() public {
        uint256 r = 11;
        for (uint256 i; i < 500; ++i) {
            r = uint256(keccak256(abi.encode(r, i)));
            uint256 action = r % 20;
            if (action < 8) {
                handler.vaultSells(r >> 8, r >> 16, uint16(r >> 24), r >> 40, r >> 72, r >> 104);
            } else if (action < 11) {
                handler.vaultBuys(r >> 8, r >> 16, r >> 24, r >> 32, r >> 64);
            } else if (action == 11) {
                handler.donate(r >> 8, r >> 16, r >> 24, r >> 32);
            } else if (action == 12) {
                handler.merge(r >> 8);
            } else if (action == 13) {
                handler.requestDeposit(r >> 8, r >> 16);
            } else if (action == 14) {
                handler.requestRedeem(r >> 8, r >> 16);
            } else if (action == 15 && i % 3 == 0) {
                handler.closeAndMark(r >> 8, r & 768 == 0);
            } else if (action == 16 && i > 250) {
                handler.resolveLeg(r >> 8, r >> 16);
            } else if (action == 17 && i > 420) {
                handler.fix(r >> 8, r >> 16);
            } else if (action == 18) {
                handler.settle();
            } else {
                handler.warp(r >> 8);
            }
            if (i % 25 == 24) {
                invariant_trackingMatchesBalances();
                invariant_vaultHoldsWhatItOwes();
            }
        }
        // Three more batches, marked and at the floor, after the books' events played out.
        for (uint256 i; i < 3; ++i) {
            handler.requestDeposit(i, 10_000e6 + i);
            handler.requestRedeem(2, 1e21 + i);
            handler.closeAndMark(i * 7919, i == 1);
            invariant_trackingMatchesBalances();
            invariant_vaultHoldsWhatItOwes();
        }
        ok(handler.fills() >= 80, string.concat("fills ", vm.toString(handler.fills())));
        ok(handler.processed() >= 4, string.concat("batches ", vm.toString(handler.processed())));
    }
}
