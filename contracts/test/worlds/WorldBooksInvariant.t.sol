// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { EventOracle } from "../../src/worlds/EventOracle.sol";
import { WorldBooks } from "../../src/worlds/WorldBooks.sol";
import { WorldBooksAdmin } from "../../src/worlds/WorldBooksAdmin.sol";
import { BookView, WorldQuote } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { MockToken } from "../Base.t.sol";
import { MockPriceFeed } from "../mocks/MockPriceFeed.sol";
import { WVm, WorldsBase } from "./WorldsBase.t.sol";

/// @dev Random custody, positions, fills, resolutions, fixings and redemptions on two books
///      (one priced, one event-only) sharing their legs.
contract BooksHandler {
    WVm internal constant vm = WVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    WorldBooks internal books;
    WorldBooksAdmin internal wb;
    EventOracle internal oracle;
    MockPriceFeed internal feed;
    MockToken internal usdg;
    address internal bookAdmin;
    address internal resolver;
    address[] public actors;
    uint256[] internal keys;
    uint64[] public ids;
    bytes32[3] internal legs;
    uint256 internal nonce;
    uint80 internal round = 1;
    uint256 public fills;
    uint256 public redemptions;
    uint256 public decisions;

    constructor(
        WorldBooks books_,
        EventOracle oracle_,
        MockPriceFeed feed_,
        MockToken usdg_,
        address bookAdmin_,
        address resolver_,
        address[] memory actors_,
        uint256[] memory keys_,
        uint64[] memory ids_,
        bytes32[3] memory legs_
    ) {
        books = books_;
        wb = WorldBooksAdmin(address(books_));
        oracle = oracle_;
        feed = feed_;
        usdg = usdg_;
        bookAdmin = bookAdmin_;
        resolver = resolver_;
        actors = actors_;
        keys = keys_;
        ids = ids_;
        legs = legs_;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _id(uint256 seed) internal view returns (uint64) {
        return ids[seed % ids.length];
    }

    function deposit(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        amount = 1 + amount % 100_000e6;
        usdg.mint(a, amount);
        vm.prank(a);
        usdg.approve(address(books), type(uint256).max);
        vm.prank(a);
        books.deposit(amount);
    }

    function withdraw(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        uint256 c = wb.credit(a);
        if (c == 0) return;
        amount = 1 + amount % c;
        vm.prank(a);
        books.withdraw(amount, a);
    }

    function split(uint256 seed, uint256 book, uint256 amount) external {
        address a = _actor(seed);
        amount = 1 + amount % 50_000e6;
        vm.prank(a);
        try books.split(_id(book), amount) { } catch { }
    }

    function merge(uint256 seed, uint256 book, uint256 amount) external {
        address a = _actor(seed);
        uint64 id = _id(book);
        uint256[] memory b = wb.atoms(id, a);
        uint256 low = type(uint256).max;
        for (uint256 i; i < b.length; ++i) {
            if (b[i] < low) low = b[i];
        }
        if (low == 0 || low == type(uint256).max) return;
        vm.prank(a);
        books.merge(id, 1 + amount % low);
    }

    function transfer(uint256 seed, uint256 book, uint256 atom, uint256 to, uint256 amount)
        external
    {
        address a = _actor(seed);
        address b = _actor(to);
        if (a == b) return;
        uint64 id = _id(book);
        uint256[] memory bal = wb.atoms(id, a);
        atom = atom % bal.length;
        if (bal[atom] == 0) return;
        vm.prank(a);
        books.transferAtoms(id, uint8(atom), b, 1 + amount % bal[atom]);
    }

    /// A wallet maker (one of the actors with a key) quotes a random bundle to another actor.
    function fill(
        uint256 makerSeed,
        uint256 takerSeed,
        uint256 book,
        uint16 mask,
        uint256 units,
        uint256 refund,
        bool sell,
        uint256 priceSeed
    ) external {
        uint256 k = keys[makerSeed % keys.length];
        address maker = vm.addr(k);
        address taker = _actor(takerSeed);
        if (taker == maker) return;
        uint64 id = _id(book);
        BookView memory v = wb.book(id);
        mask = uint16(mask & ((uint256(1) << v.atomCount) - 2));
        units = mask == 0 ? 0 : 1 + units % 5_000e6;
        refund = refund % 3 == 0 ? 0 : 1 + refund % 3_000e6;
        if (mask == 0 && refund == 0) refund = 1 + priceSeed % 1_000e6;
        uint256 minPay = type(uint256).max;
        uint256 maxPay;
        for (uint256 i; i < v.atomCount; ++i) {
            uint256 pay = i == 0 ? refund : ((uint256(mask) >> i) & 1 == 1 ? units : 0);
            if (pay < minPay) minPay = pay;
            if (pay > maxPay) maxPay = pay;
        }
        uint256 price = minPay + priceSeed % (maxPay - minPay + 1);
        if (price == 0) price = 1;
        WorldQuote memory q = WorldQuote({
            taker: taker,
            book: id,
            mask: mask,
            units: uint128(units),
            refund: uint128(refund),
            sell: sell,
            price: uint128(price),
            expiry: uint40(vm.getBlockTimestamp() + 60),
            makerData: 0,
            nonce: ++nonce
        });
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(k, wb.quoteDigest(q));
        bytes32 vs = bytes32(uint256(s) | (sv == 28 ? uint256(1) << 255 : 0));
        vm.prank(taker);
        try books.fillQuote(q, r, vs) {
            ++fills;
        } catch { }
    }

    /// Resolves one leg, mostly in the world's favour.
    function resolveLeg(uint256 legSeed, uint256 outcomeSeed) external {
        bytes32 key = legs[legSeed % 3];
        (uint8 s,) = oracle.outcome(key);
        if (s >= 3) return;
        uint8 outcome = outcomeSeed % 5 == 0 ? 4 : (outcomeSeed % 11 == 0 ? 5 : 3);
        bytes32 h = oracle.resolutionHash(key, outcome, "evidence", "ipfs://e");
        vm.prank(bookAdmin);
        oracle.commit(key, h);
        vm.prank(resolver);
        oracle.resolve(key, outcome, "evidence", "ipfs://e");
    }

    /// Moves to the priced book's fixing and fixes it at a random price.
    function fixPriced(uint256 priceSeed) external {
        uint64 id = ids[0];
        BookView memory v = wb.book(id);
        if (v.status != 1 || wb.state(id) != 4) {
            if (vm.getBlockTimestamp() < v.fixingTime) vm.warp(v.fixingTime);
            if (wb.state(id) != 4) return;
        }
        uint256 price = 200e8 + priceSeed % 80e8;
        feed.update(++round, int256(price), v.fixingTime);
        try wb.proposeFix(id, round) { } catch { }
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        try wb.finalizeFix(id) {
            ++decisions;
        } catch { }
    }

    function settle(uint256 book) external {
        try books.settle(_id(book)) { } catch { }
    }

    function redeem(uint256 seed, uint256 book) external {
        vm.prank(_actor(seed));
        try books.redeem(_id(book)) {
            ++redemptions;
        } catch { }
    }

    function warp(uint256 seconds_) external {
        vm.warp(vm.getBlockTimestamp() + seconds_ % 3 days);
    }
}

contract WorldBooksInvariantTest is WorldsBase {
    BooksHandler internal handler;
    address[] internal actors;
    uint64[] internal ids;

    function setUp() public override {
        super.setUp();
        ids.push(create(pricedDef()));
        ids.push(create(eventDef()));
        actors.push(alice);
        actors.push(bob);
        actors.push(carol);
        actors.push(maker);
        actors.push(maker2);
        uint256[] memory keys = new uint256[](2);
        keys[0] = makerKey;
        keys[1] = maker2Key;
        handler = new BooksHandler(
            books, oracle, feed, usdg, bookAdmin, resolver, actors, keys, ids, [A, B, C]
        );
        feed.transferOwnership(address(handler));
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    /// The token balance is exactly what the books owe: credit, backing and fees.
    function invariant_custodyMatchesLiability() public view {
        uint256 owed = wb.fees();
        for (uint256 i; i < actors.length; ++i) {
            owed += credit(actors[i]);
        }
        owed += credit(delegate);
        for (uint256 i; i < ids.length; ++i) {
            owed += wb.backing(ids[i]);
        }
        eq(owed, wb.liability(), "liability");
        eq(usdg.balanceOf(address(books)), wb.liability(), "custody");
    }

    /// Before a decision every atom's supply is the backing; after it, the winning atom's is.
    function invariant_everyAtomIsBacked() public view {
        for (uint256 b; b < ids.length; ++b) {
            uint64 id = ids[b];
            BookView memory v = wb.book(id);
            uint256 backing = wb.backing(id);
            for (uint256 atom; atom < v.atomCount; ++atom) {
                uint256 supply;
                for (uint256 i; i < actors.length; ++i) {
                    supply += wb.atoms(id, actors[i])[atom];
                }
                if (v.status == 1) eq(supply, backing, "undecided supply");
                else if (atom == v.winner) eq(supply, backing, "winning supply");
            }
        }
    }

    function testRandomWalkFillsDecidesAndConserves() public {
        uint256 r = 7;
        for (uint256 i; i < 600; ++i) {
            r = uint256(keccak256(abi.encode(r, i)));
            uint256 action = r % 20;
            if (action < 9) {
                handler.fill(
                    r >> 8,
                    r >> 16,
                    r >> 24,
                    uint16(r >> 32),
                    r >> 48,
                    r >> 80,
                    r & 512 == 0,
                    r >> 112
                );
            } else if (action < 11) {
                handler.split(r >> 8, r >> 16, r >> 24);
            } else if (action < 13) {
                handler.merge(r >> 8, r >> 16, r >> 24);
            } else if (action == 13) {
                handler.transfer(r >> 8, r >> 16, r >> 24, r >> 32, r >> 40);
            } else if (action == 14) {
                handler.withdraw(r >> 8, r >> 16);
            } else if (action == 15) {
                handler.deposit(r >> 8, r >> 16);
            } else if (action == 16 && i > 300) {
                handler.resolveLeg(r >> 8, r >> 16);
            } else if (action == 17 && i > 450) {
                handler.fixPriced(r >> 8);
            } else if (action == 18 && i > 450) {
                handler.redeem(r >> 8, r >> 16);
            } else {
                handler.settle(r >> 8);
            }
            if (i % 40 == 39) {
                invariant_custodyMatchesLiability();
                invariant_everyAtomIsBacked();
            }
        }
        ok(handler.fills() >= 60, string.concat("fills ", vm.toString(handler.fills())));
        ok(
            handler.redemptions() >= 3,
            string.concat("redemptions ", vm.toString(handler.redemptions()))
        );
    }
}
