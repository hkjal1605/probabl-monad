// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocks } from "../src/ConditionalStocks.sol";
import { ConditionalStocksAdmin } from "../src/ConditionalStocksAdmin.sol";
import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";
import { Base, MockToken, Vm } from "./Base.t.sol";

/// @dev Random activity over two markets that share both token pools: one with the default terms
///      (exact quote amounts) and one whose step x tick is not a multiple of 1e18 (every quote
///      amount and reservation rounds). Beyond test/Invariant.t.sol it drives: stale plans,
///      duplicate and dead makers in plans, self-matches, delegated placement (placeFor), grant
///      revocation and regeneration, replace, cancelMany, third-party release, fee changes
///      (0..1000 bps), fee claims, claim transfers, time (order and grant expiry), pauses and
///      token donations.
contract EngineHandler {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    ConditionalStocks internal immutable cs;
    ConditionalStocksAdmin internal immutable view_;
    MockToken internal immutable usdc;
    MockToken internal immutable stock;
    address internal immutable admin;
    address internal immutable guardian;
    address internal immutable marketAdmin;
    address internal immutable resolver;
    uint256 internal immutable lastTime;

    uint32[] internal markets;
    address[] internal actors;
    address[] internal delegates;
    uint256[] internal keys;
    mapping(uint256 => uint256) public placedQty;

    uint256 public donatedQuote;
    uint256 public donatedBase;
    uint256 public placed;
    uint256 public filledPlacements;
    uint256 public rested;
    uint256 public delegatedPlaced;
    uint256 public cancelled;
    uint256 public replaced;

    constructor(
        ConditionalStocks cs_,
        MockToken usdc_,
        MockToken stock_,
        uint32[] memory markets_,
        address[] memory actors_,
        address[] memory delegates_,
        address[4] memory roles,
        uint256 lastTime_
    ) {
        cs = cs_;
        view_ = ConditionalStocksAdmin(address(cs_));
        usdc = usdc_;
        stock = stock_;
        markets = markets_;
        actors = actors_;
        delegates = delegates_;
        admin = roles[0];
        guardian = roles[1];
        marketAdmin = roles[2];
        resolver = roles[3];
        lastTime = lastTime_;
    }

    function keyCount() external view returns (uint256) {
        return keys.length;
    }

    function keyAt(uint256 i) external view returns (uint256) {
        return keys[i];
    }

    // ------------------------------------------------------------------ placement

    function place(
        uint256 seed,
        uint256 priceSeed,
        uint256 qtySeed,
        uint256 makerSeed,
        uint256 planSeed
    ) public {
        uint32 id = markets[seed % markets.length];
        address owner = actors[(seed >> 8) % actors.length];
        uint256 flags = (seed >> 16) & 15;
        uint256 o = _order(id, flags, priceSeed, qtySeed, planSeed);
        (uint256 p, uint256 m) = _plan(id, flags, o, makerSeed, planSeed);
        address d = (seed >> 24) % 4 == 0 ? delegates[(seed >> 32) % delegates.length] : address(0);
        uint256 k;
        bool success;
        if (d == address(0)) {
            vm.prank(owner);
            try cs.place(o, p, m) returns (uint256 key_) {
                (k, success) = (key_, true);
            } catch { }
        } else {
            vm.prank(d);
            try cs.placeFor(owner, o, p, m) returns (uint256 key_) {
                (k, success) = (key_, true);
                delegatedPlaced++;
            } catch { }
        }
        if (success) _track(k, o);
    }

    /// Extra entry points so the fuzzer spends most calls placing.
    function placeB(uint256 a, uint256 b, uint256 c, uint256 d, uint256 e) external {
        place(a, b, c, d, e);
    }

    function placeC(uint256 a, uint256 b, uint256 c, uint256 d, uint256 e) external {
        place(a, b, c, d, e);
    }

    function _track(uint256 k, uint256 o) internal {
        placed++;
        (ConditionalStocksBase.Order memory placedOrder,) = view_.order(k);
        if (placedOrder.remaining != 0) {
            keys.push(k);
            placedQty[k] = o >> 160;
            rested++;
        }
        if (placedOrder.remaining != o >> 160) filledPlacements++;
    }

    function _order(uint32 id, uint256 flags, uint256 priceSeed, uint256 qtySeed, uint256 planSeed)
        internal
        view
        returns (uint256)
    {
        ConditionalStocksBase.Terms memory tm = view_.terms(id);
        uint256 mid = 2e8 / tm.tick; // $200 per whole token
        uint256 ticks = mid - mid / 10 + priceSeed % (mid / 5 + 1);
        uint256 qty = uint256(tm.step) * (1 + qtySeed % 3_000);
        uint256 expiry = vm.getBlockTimestamp() + 1 + (planSeed >> 8) % 2 days;
        if (expiry > tm.cutoff) expiry = tm.cutoff;
        uint256 maxFee = (planSeed >> 40) % 8 == 0 ? (planSeed >> 48) % 1_001 : 1_000;
        return uint256(id) | flags << 32 | maxFee << 40 | expiry << 56 | ticks << 96 | qty << 160;
    }

    /// Lists live crossing makers older than nextSeq (dead ones included: they are skipped on
    /// chain), sometimes the same maker twice, sometimes a plan that is several placements old.
    function _plan(uint32 id, uint256 flags, uint256 o, uint256 makerSeed, uint256 planSeed)
        internal
        view
        returns (uint256 p, uint256 m)
    {
        uint256 branch = flags & 1;
        bool sell = flags & 2 != 0;
        uint64 ticks = uint64(o >> 96);
        ConditionalStocksBase.Book memory b = view_.book(id);
        uint256 nextSeq = branch == 0 ? b.seqYes : b.seqNo;
        if ((planSeed >> 60) % 4 == 0) {
            uint256 lag = (planSeed >> 64) % 20;
            nextSeq = lag > nextSeq ? 0 : nextSeq - lag;
        }
        uint256 count;
        uint256 n = keys.length;
        for (uint256 i; i < n && count < 8; ++i) {
            uint256 k = keys[(makerSeed % n + i) % n];
            if (uint32(k >> 40) != id || (k >> 32 & 1) != branch || uint32(k) >= nextSeq) continue;
            (ConditionalStocksBase.Order memory mo,) = view_.order(k);
            if (mo.remaining == 0 || (mo.flags & 2 != 0) == sell) continue;
            if (sell ? mo.ticks < ticks : mo.ticks > ticks) continue;
            m |= (uint256(uint32(k)) + 1) << (32 * count++);
            if (count < 8 && (makerSeed >> (i % 200)) & 7 == 0) {
                m |= (uint256(uint32(k)) + 1) << (32 * count++);
            }
        }
        uint256 expiry = uint40(o >> 56);
        uint256 deadline = vm.getBlockTimestamp() + 60;
        if (deadline > expiry) deadline = expiry;
        uint256 minFill = (planSeed >> 72) % 16 == 0 ? (planSeed >> 80) % (o >> 160) : 0;
        p = nextSeq | deadline << 32 | minFill << 72;
    }

    // ------------------------------------------------------------------ cancellation

    function cancel(uint256 seed, uint256 index) external {
        if (keys.length == 0) return;
        uint256 k = keys[index % keys.length];
        (ConditionalStocksBase.Order memory o, address d) = view_.order(k);
        address caller = o.owner;
        if (seed % 4 == 0 || caller == address(0)) caller = actors[(seed >> 8) % actors.length];
        else if (seed % 4 == 1 && d != address(0)) caller = d;
        vm.prank(caller);
        try cs.cancel(k) {
            cancelled++;
        } catch { }
    }

    function cancelMany(uint256 seed, uint256 index) external {
        if (keys.length == 0) return;
        uint256 n = 1 + seed % 4;
        uint256[] memory ks = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            ks[i] =
                keys[(index % keys.length + i * (((seed >> 8) | 1) % keys.length)) % keys.length];
        }
        (ConditionalStocksBase.Order memory o,) = view_.order(ks[0]);
        address caller = o.owner == address(0) ? actors[seed % actors.length] : o.owner;
        vm.prank(caller);
        try cs.cancelMany(ks) { } catch { }
    }

    function replace(
        uint256 seed,
        uint256 index,
        uint256 priceSeed,
        uint256 qtySeed,
        uint256 planSeed
    ) external {
        if (keys.length == 0) return;
        uint256 old = keys[index % keys.length];
        (ConditionalStocksBase.Order memory mo,) = view_.order(old);
        if (mo.remaining == 0) return;
        uint32 id = uint32(old >> 40);
        uint256 flags = (seed >> 16) & 15;
        uint256 o = _order(id, flags, priceSeed, qtySeed, planSeed);
        (uint256 p, uint256 m) = _plan(id, flags, o, seed, planSeed);
        vm.prank(mo.owner);
        try cs.replace(old, o, p, m) returns (uint256 k) {
            replaced++;
            _track(k, o);
        } catch { }
    }

    // ------------------------------------------------------------------ positions and custody

    function split(uint256 seed, uint256 amount) external {
        uint32 id = markets[seed % markets.length];
        address a = actors[(seed >> 8) % actors.length];
        uint8 collateral = uint8(seed >> 16 & 1);
        uint256 available = view_.credit(a, collateral == 0 ? address(usdc) : address(stock));
        if (available == 0) return;
        vm.prank(a);
        cs.split(id, collateral, 1 + amount % (available / 8 + 1));
    }

    function merge(uint256 seed, uint256 amount) external {
        uint32 id = markets[seed % markets.length];
        address a = actors[(seed >> 8) % actors.length];
        uint8 collateral = uint8(seed >> 16 & 1);
        ConditionalStocksBase.Account memory y = view_.account(id, 0, a);
        ConditionalStocksBase.Account memory n = view_.account(id, 1, a);
        uint256 yes = collateral == 0 ? y.quote : y.base;
        uint256 no = collateral == 0 ? n.quote : n.base;
        uint256 max = yes < no ? yes : no;
        if (max == 0) return;
        vm.prank(a);
        cs.merge(id, collateral, 1 + amount % max);
    }

    function transferClaim(uint256 seed, uint256 amount) external {
        uint32 id = markets[seed % markets.length];
        address from = actors[(seed >> 8) % actors.length];
        address to = actors[(seed >> 24) % actors.length];
        if (from == to) return;
        uint8 branch = uint8(seed >> 16 & 1);
        uint8 collateral = uint8(seed >> 17 & 1);
        ConditionalStocksBase.Account memory a = view_.account(id, branch, from);
        uint256 balance = collateral == 0 ? a.quote : a.base;
        if (balance == 0) return;
        vm.prank(from);
        view_.transferClaim(id, branch, collateral, to, 1 + amount % balance);
    }

    function deposit(uint256 seed, uint256 amount) external {
        address a = actors[seed % actors.length];
        MockToken token = (seed >> 8) & 1 == 0 ? usdc : stock;
        amount = token == usdc ? 1 + amount % 100_000e6 : 1 + amount % 100e18;
        token.mint(a, amount);
        vm.prank(a);
        cs.deposit(address(token), amount);
    }

    function withdraw(uint256 seed, uint256 amount) external {
        address a = actors[seed % actors.length];
        address token = (seed >> 8) & 1 == 0 ? address(usdc) : address(stock);
        uint256 available = view_.credit(a, token);
        if (available == 0) return;
        vm.prank(a);
        cs.withdraw(token, 1 + amount % available, a);
    }

    function donate(uint256 seed, uint256 amount) external {
        amount = 1 + amount % 1e18;
        if (seed & 1 == 0) {
            usdc.mint(address(cs), amount);
            donatedQuote += amount;
        } else {
            stock.mint(address(cs), amount);
            donatedBase += amount;
        }
    }

    // ------------------------------------------------------------------ owner / governance moves

    function invalidate(uint256 seed) external {
        if (seed % 8 != 0) return;
        vm.prank(actors[(seed >> 8) % actors.length]);
        view_.invalidateOrders();
    }

    function delegate(uint256 seed) external {
        address owner = actors[seed % actors.length];
        address d = delegates[(seed >> 8) % delegates.length];
        uint256 action = (seed >> 16) % 8;
        vm.prank(owner);
        if (action < 5) {
            uint32 mkt = (seed >> 24) % 3 == 0 ? markets[(seed >> 32) % markets.length] : 0;
            uint40 exp = uint40(vm.getBlockTimestamp() + 1 hours + (seed >> 40) % 5 days);
            uint16 maxFee = uint16((seed >> 80) % 4 == 0 ? (seed >> 88) % 1_001 : 1_000);
            uint8 perms = (seed >> 100) & 1 == 0 ? 1 : 3;
            view_.approveDelegate(d, mkt, exp, 1e12, 1e15, 1e22, 1e24, maxFee, perms);
        } else if (action < 7) {
            try view_.revokeDelegate(d) { } catch { }
        } else {
            view_.revokeAllDelegates();
        }
    }

    function warp(uint256 secs) external {
        uint256 to = vm.getBlockTimestamp() + 1 + secs % 6 hours;
        if (to < lastTime) vm.warp(to);
    }

    function setFees(uint256 seed) external {
        uint16 makerBps = uint16(seed % 4 == 0 ? (seed >> 8) % 1_001 : (seed >> 8) % 50);
        uint16 takerBps = uint16((seed >> 24) % 4 == 0 ? (seed >> 32) % 1_001 : (seed >> 32) % 50);
        vm.prank(admin);
        view_.configure(marketAdmin, guardian, resolver, makerBps, takerBps);
    }

    function claimFees(uint256 seed, uint256 amount) external {
        uint32 id = markets[seed % markets.length];
        uint8 branch = uint8(seed >> 8 & 1);
        uint8 collateral = uint8(seed >> 9 & 1);
        ConditionalStocksBase.Fees memory f = view_.fees(id, branch);
        uint256 have = collateral == 0 ? f.quote : f.base;
        if (have == 0) return;
        address to = (seed >> 16) % 2 == 0 ? admin : actors[(seed >> 24) % actors.length];
        vm.prank(admin);
        view_.claimFees(id, branch, collateral, to, 1 + amount % have);
    }

    function pause(uint256 seed) external {
        bool paused = view_.control().paused;
        if (!paused && seed % 8 != 0) return;
        vm.prank(guardian);
        view_.pause(!paused, keccak256("audit"));
    }
}

contract EngineInvariantTest is Base {
    uint128 internal constant TICK2 = 7_777;
    uint96 internal constant STEP2 = 333_333_333_333_337;
    bytes32 internal constant EVIDENCE = keccak256("evidence");
    string internal constant URI = "https://evidence.example/packet";

    EngineHandler internal handler;
    uint32[] internal markets;
    address[] internal actors;
    address[] internal delegates;
    address[] internal holders;

    function setUp() public virtual override {
        super.setUp();
        ConditionalStocksBase.MarketParams memory p = params(uint40(T0 - 1), uint40(T0 + 30 days));
        p.tick = TICK2;
        p.step = STEP2;
        p.maxSteps = 3_000_000;
        p.minNotional = 1e4;
        p.metadataHash = keccak256(bytes("ipfs://m2"));
        vm.prank(marketAdmin);
        uint32 m2 = view_.createMarket(p, "ipfs://m2");
        vm.prank(marketAdmin);
        view_.lifecycle(m2, 0, bytes32(0));
        markets.push(market);
        markets.push(m2);
        vm.prank(admin);
        view_.configure(marketAdmin, guardian, resolver, 7, 13);

        actors.push(alice);
        actors.push(bob);
        actors.push(carol);
        actors.push(bot);
        delegates.push(address(0xD1));
        delegates.push(address(0xD2));
        for (uint256 i; i < actors.length; ++i) {
            vm.startPrank(actors[i]);
            for (uint256 j; j < markets.length; ++j) {
                cs.split(markets[j], 0, 200_000e6);
                cs.split(markets[j], 1, 2_000e18);
            }
            vm.stopPrank();
            holders.push(actors[i]);
        }
        holders.push(admin);
        holders.push(delegates[0]);
        holders.push(delegates[1]);
        handler = new EngineHandler(
            cs,
            usdc,
            stock,
            markets,
            actors,
            delegates,
            [admin, guardian, marketAdmin, resolver],
            T0 + 29 days
        );
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    // ------------------------------------------------------------------ invariants

    /// Per market and branch: claims held + fee pool + claim-funded escrow == backing.
    function invariant_claimsEqualBacking() public view {
        for (uint256 j; j < markets.length; ++j) {
            uint32 id = markets[j];
            (uint256[2] memory quoteEscrow, uint256[2] memory baseEscrow) = _claimEscrow(id);
            ConditionalStocksBase.Backing memory bk = view_.backing(id);
            for (uint8 br; br < 2; ++br) {
                uint256 quoteClaims = quoteEscrow[br];
                uint256 baseClaims = baseEscrow[br];
                for (uint256 i; i < holders.length; ++i) {
                    ConditionalStocksBase.Account memory a = view_.account(id, br, holders[i]);
                    quoteClaims += a.quote;
                    baseClaims += a.base;
                }
                ConditionalStocksBase.Fees memory f = view_.fees(id, br);
                eq(quoteClaims + f.quote, bk.quote, "quote claims != quote backing");
                eq(baseClaims + f.base, bk.base, "base claims != base backing");
            }
        }
    }

    /// Per token: credit + backing (every market) + underlying-funded escrow == liability, and
    /// custody == liability + donations.
    function invariant_poolsAreExactlyBacked() public view {
        (uint256 quoteEscrow, uint256 baseEscrow) = _wholeEscrow();
        uint256 quoteTotal = quoteEscrow;
        uint256 baseTotal = baseEscrow;
        for (uint256 i; i < holders.length; ++i) {
            quoteTotal += credit(holders[i], address(usdc));
            baseTotal += credit(holders[i], address(stock));
        }
        for (uint256 j; j < markets.length; ++j) {
            ConditionalStocksBase.Backing memory bk = view_.backing(markets[j]);
            quoteTotal += bk.quote;
            baseTotal += bk.base;
        }
        uint256 quoteLiability = view_.pool(address(usdc)).liability;
        uint256 baseLiability = view_.pool(address(stock)).liability;
        eq(quoteTotal, quoteLiability, "quote liability");
        eq(baseTotal, baseLiability, "base liability");
        eq(usdc.balanceOf(address(cs)), quoteLiability + handler.donatedQuote(), "quote custody");
        eq(stock.balanceOf(address(cs)), baseLiability + handler.donatedBase(), "base custody");
    }

    /// Book.openNotional == sum over the market's live bids (asks escrow base, which the quote
    /// cap does not measure); Account.notional == sum over the owner's live orders on that
    /// market branch.
    function invariant_notionalMatchesLiveOrders() public view {
        uint256[16] memory owned; // actor * 4 + market * 2 + branch
        uint256[2] memory perMarket;
        for (uint256 i; i < handler.keyCount(); ++i) {
            uint256 k = handler.keyAt(i);
            (ConditionalStocksBase.Order memory o,) = view_.order(k);
            if (o.remaining == 0) continue;
            uint256 j = _marketIndex(uint32(k >> 40));
            uint256 n = _notional(o, uint32(k >> 40));
            if (o.flags & 2 == 0) perMarket[j] += n;
            owned[_actorIndex(o.owner) * 4 + j * 2 + (k >> 32 & 1)] += n;
        }
        for (uint256 j; j < markets.length; ++j) {
            eq(view_.book(markets[j]).openNotional, perMarket[j], "market notional");
            for (uint256 a; a < actors.length; ++a) {
                for (uint8 br; br < 2; ++br) {
                    eq(
                        view_.account(markets[j], br, actors[a]).notional,
                        owned[a * 4 + j * 2 + br],
                        "wallet notional"
                    );
                }
            }
        }
        for (uint256 h = actors.length; h < holders.length; ++h) {
            for (uint256 j; j < markets.length; ++j) {
                eq(view_.account(markets[j], 0, holders[h]).notional, 0, "non-trader notional");
                eq(view_.account(markets[j], 1, holders[h]).notional, 0, "non-trader notional");
            }
        }
    }

    /// Orders only shrink, stay step-aligned and keep their owner.
    function invariant_ordersWellFormed() public view {
        for (uint256 i; i < handler.keyCount(); ++i) {
            uint256 k = handler.keyAt(i);
            (ConditionalStocksBase.Order memory o,) = view_.order(k);
            if (o.remaining == 0) continue;
            ok(o.remaining <= handler.placedQty(k), "order grew");
            ok(o.remaining % view_.terms(uint32(k >> 40)).step == 0, "unaligned remainder");
            _actorIndex(o.owner);
        }
    }

    /// After every run: owners cancel everything, each market resolves, fees are claimed, every
    /// holder redeems and withdraws. Custody must end at exactly the donations.
    function afterInvariant() public {
        _unwind(handler.placed());
    }

    // ------------------------------------------------------------------ deterministic walks

    function testWalkThenUnwind() public {
        _walk(7, 1_500);
        _checkAll();
        _unwind(7);
        ok(
            handler.filledPlacements() >= 100,
            string.concat("fills ", vm.toString(handler.filledPlacements()))
        );
        ok(handler.delegatedPlaced() >= 20, "delegated placements");
        ok(handler.replaced() >= 10, "replaces");
    }

    /// forge-config: default.fuzz.runs = 96
    function testFuzz_WalkThenUnwind(uint256 seed) public {
        _walk(seed, 150);
        _checkAll();
        _unwind(seed >> 128);
    }

    function _walk(uint256 r, uint256 steps) internal {
        for (uint256 i; i < steps; ++i) {
            r = uint256(keccak256(abi.encode(r, i)));
            uint256 a = r % 100;
            if (a < 45) handler.place(r >> 8, r >> 40, r >> 72, r >> 104, r >> 136);
            else if (a < 53) handler.cancel(r >> 8, r >> 40);
            else if (a < 56) handler.cancelMany(r >> 8, r >> 40);
            else if (a < 62) handler.replace(r >> 8, r >> 40, r >> 72, r >> 104, r >> 136);
            else if (a < 66) handler.split(r >> 8, r >> 40);
            else if (a < 70) handler.merge(r >> 8, r >> 40);
            else if (a < 73) handler.transferClaim(r >> 8, r >> 40);
            else if (a < 76) handler.deposit(r >> 8, r >> 40);
            else if (a < 79) handler.withdraw(r >> 8, r >> 40);
            else if (a < 84) handler.delegate(r >> 8);
            else if (a < 88) handler.warp(r >> 8);
            else if (a < 91) handler.setFees(r >> 8);
            else if (a < 94) handler.claimFees(r >> 8, r >> 40);
            else if (a < 96) handler.invalidate(r >> 8 << 3);
            else if (a < 98) handler.pause(r >> 8);
            else handler.donate(r >> 8, r >> 40);
            if (i % 50 == 49) _checkAll();
        }
    }

    function _checkAll() internal view {
        invariant_claimsEqualBacking();
        invariant_poolsAreExactlyBacked();
        invariant_notionalMatchesLiveOrders();
        invariant_ordersWellFormed();
    }

    // ------------------------------------------------------------------ unwind

    function _unwind(uint256 seed) internal {
        if (view_.control().paused) {
            vm.prank(guardian);
            view_.pause(false, keccak256("resume"));
        }
        for (uint256 i; i < handler.keyCount(); ++i) {
            uint256 k = handler.keyAt(i);
            (ConditionalStocksBase.Order memory o,) = view_.order(k);
            if (o.remaining == 0) continue;
            vm.prank(o.owner);
            cs.cancel(k);
        }
        for (uint256 j; j < markets.length; ++j) {
            uint32 id = markets[j];
            eq(view_.book(id).openNotional, 0, "market notional after cancel-all");
            uint8 yes = uint8((seed >> j) & 1);
            vm.prank(guardian);
            view_.lifecycle(id, 1, keccak256("event ended"));
            bytes32 commitment = view_.resolutionHash(id, yes, 1 - yes, EVIDENCE, URI);
            vm.prank(marketAdmin);
            view_.lifecycle(id, 3, commitment);
            vm.prank(resolver);
            view_.resolve(id, yes, 1 - yes, EVIDENCE, URI);
            _claimAllFees(id);
            for (uint256 h; h < holders.length; ++h) {
                _redeemAll(id, holders[h]);
            }
            ConditionalStocksBase.Backing memory bk = view_.backing(id);
            eq(bk.quote, 0, "quote backing left after full redemption");
            eq(bk.base, 0, "base backing left after full redemption");
        }
        for (uint256 h; h < holders.length; ++h) {
            _withdrawAll(holders[h], address(usdc));
            _withdrawAll(holders[h], address(stock));
        }
        eq(view_.pool(address(usdc)).liability, 0, "quote liability after unwind");
        eq(view_.pool(address(stock)).liability, 0, "base liability after unwind");
        eq(usdc.balanceOf(address(cs)), handler.donatedQuote(), "quote custody after unwind");
        eq(stock.balanceOf(address(cs)), handler.donatedBase(), "base custody after unwind");
    }

    function _claimAllFees(uint32 id) internal {
        for (uint8 br; br < 2; ++br) {
            ConditionalStocksBase.Fees memory f = view_.fees(id, br);
            if (f.quote != 0) {
                vm.prank(admin);
                view_.claimFees(id, br, 0, admin, f.quote);
            }
            if (f.base != 0) {
                vm.prank(admin);
                view_.claimFees(id, br, 1, admin, f.base);
            }
        }
    }

    function _redeemAll(uint32 id, address h) internal {
        ConditionalStocksBase.Account memory y = view_.account(id, 0, h);
        ConditionalStocksBase.Account memory n = view_.account(id, 1, h);
        eq(uint256(y.notional) + n.notional, 0, "wallet notional after cancel-all");
        if (y.quote != 0 || n.quote != 0) {
            vm.prank(h);
            cs.redeem(id, 0, y.quote, n.quote);
        }
        if (y.base != 0 || n.base != 0) {
            vm.prank(h);
            cs.redeem(id, 1, y.base, n.base);
        }
    }

    function _withdrawAll(address h, address token) internal {
        uint256 c = credit(h, token);
        if (c == 0) return;
        vm.prank(h);
        cs.withdraw(token, c, h);
    }

    // ------------------------------------------------------------------ helpers

    function _notional(ConditionalStocksBase.Order memory o, uint32 id)
        internal
        view
        returns (uint256)
    {
        return (uint256(o.remaining) * o.ticks * view_.terms(id).tick + WAD - 1) / WAD;
    }

    function _claimEscrow(uint32 id)
        internal
        view
        returns (uint256[2] memory quoteEscrow, uint256[2] memory baseEscrow)
    {
        for (uint256 i; i < handler.keyCount(); ++i) {
            uint256 k = handler.keyAt(i);
            if (uint32(k >> 40) != id) continue;
            (ConditionalStocksBase.Order memory o,) = view_.order(k);
            if (o.remaining == 0 || o.flags & 4 == 0) continue;
            uint256 br = k >> 32 & 1;
            if (o.flags & 2 != 0) baseEscrow[br] += o.remaining;
            else quoteEscrow[br] += _notional(o, id);
        }
    }

    function _wholeEscrow() internal view returns (uint256 quoteEscrow, uint256 baseEscrow) {
        for (uint256 i; i < handler.keyCount(); ++i) {
            uint256 k = handler.keyAt(i);
            (ConditionalStocksBase.Order memory o,) = view_.order(k);
            if (o.remaining == 0 || o.flags & 4 != 0) continue;
            if (o.flags & 2 != 0) baseEscrow += o.remaining;
            else quoteEscrow += _notional(o, uint32(k >> 40));
        }
    }

    function _marketIndex(uint32 id) internal view returns (uint256) {
        for (uint256 j; j < markets.length; ++j) {
            if (markets[j] == id) return j;
        }
        revert("unknown market");
    }

    function _actorIndex(address owner) internal view returns (uint256) {
        for (uint256 a; a < actors.length; ++a) {
            if (actors[a] == owner) return a;
        }
        revert("order owned by a non-actor");
    }
}
