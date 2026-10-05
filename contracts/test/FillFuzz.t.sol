// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";
import { Base, Vm } from "./Base.t.sol";

/// @dev Exact-allocation fuzz of the matching engine in a market whose step x tick is NOT a
///      multiple of 1e18 (so every floor/ceil path in `_fill`, `_quoteUp` and `_cancel` rounds).
///      Every Trade event is checked against an independent reference model (quote at the maker
///      price floored, improvement, per-order fee carry). After a full unwind (owners cancel,
///      market resolves, fee claims go to the admin, everyone redeems) each participant's
///      underlying credit must have moved by exactly the economic trades at maker prices, fees
///      must have reached the admin, and custody must equal the remaining credit.
contract FillFuzzTest is Base {
    uint128 internal constant TICK2 = 7_777;
    uint96 internal constant STEP2 = 333_333_333_333_337;
    uint256 internal constant BPS = 10_000;
    bytes32 internal constant TRADE = keccak256("Trade(uint32,uint256,uint256,uint256)");
    bytes32 internal constant EVIDENCE = keccak256("evidence");
    string internal constant URI = "https://evidence.example/packet";

    struct Info {
        address owner;
        uint64 ticks;
        bool sell;
        uint256 remaining;
        uint256 carry;
    }

    uint32 internal m2;
    address[5] internal holders;
    mapping(uint256 => Info) internal info; // branch << 32 | seq
    mapping(address => int256) internal expQuote;
    mapping(address => int256) internal expBase;
    uint256 internal makerBps;
    uint256 internal takerBps;
    uint8 internal branch;
    uint8 internal winner;
    uint256 internal fillCount;

    function setUp() public override {
        super.setUp();
        holders = [alice, bob, carol, bot, admin];
    }

    // ------------------------------------------------------------------ tests

    /// One taker (alice) against 1-3 resting makers (possibly alice herself), every funding
    /// combination, IOC or GTC remainder, random market fee rates.
    function testFuzz_OneTakerAgainstMakers(uint256 seed) public {
        branch = uint8(seed & 1);
        winner = uint8(seed >> 1 & 1);
        bool takerSell = seed >> 2 & 1 != 0;
        bool takerClaim = seed >> 3 & 1 != 0;
        bool gtc = seed >> 4 & 1 != 0;
        _createMarket((seed >> 8) % 1_001, (seed >> 24) % 1_001);
        uint256[10] memory before = _snapshot();
        uint64 tTicks = uint64(23_000 + (seed >> 40) % 6_000);
        uint256 tQty = uint256(STEP2) * (1 + (seed >> 56) % 6_000);
        uint256 nMakers = 1 + (seed >> 72) % 3;
        uint256[] memory ks = new uint256[](nMakers + 1);
        uint256 m;
        for (uint256 i; i < nMakers; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address who = r % 6 == 0 ? alice : [bob, carol, bot][r % 3];
            bool claim = r >> 8 & 1 != 0;
            uint64 off = uint64((r >> 16) % 400);
            uint64 mTicks = takerSell ? tTicks + off : tTicks - off;
            uint256 mQty = uint256(STEP2) * (1 + (r >> 32) % 3_000);
            if (claim) _fundClaims(who, !takerSell, mTicks, mQty);
            ks[i] = _placeAs(who, !takerSell, claim, false, mTicks, mQty, 0);
            m |= (uint256(uint32(ks[i])) + 1) << (32 * i);
        }
        if (takerClaim) _fundClaims(alice, takerSell, tTicks, tQty);
        vm.recordLogs();
        ks[nMakers] = _placeAs(alice, takerSell, takerClaim, !gtc, tTicks, tQty, m);
        _process(vm.getRecordedLogs());
        ok(fillCount != 0, "no fill");
        _unwind(ks);
        _compare(before);
    }

    /// One resting maker (bob) filled by 1-4 sequential IOC takers (possibly bob himself) at
    /// random market fee rates: exercises the maker's carry chain, notional telescoping over
    /// partial fills and the escrow refund on the final cancel.
    function testFuzz_OneMakerAgainstTakers(uint256 seed) public {
        branch = uint8(seed & 1);
        winner = uint8(seed >> 1 & 1);
        bool makerSell = seed >> 2 & 1 != 0;
        bool makerClaim = seed >> 3 & 1 != 0;
        _createMarket((seed >> 8) % 1_001, (seed >> 24) % 1_001);
        uint256[10] memory before = _snapshot();
        uint64 mTicks = uint64(23_000 + (seed >> 40) % 6_000);
        uint256 mQty = uint256(STEP2) * (1 + (seed >> 56) % 6_000);
        if (makerClaim) _fundClaims(bob, makerSell, mTicks, mQty);
        uint256 nTakers = 1 + (seed >> 72) % 4;
        uint256[] memory ks = new uint256[](nTakers + 1);
        ks[0] = _placeAs(bob, makerSell, makerClaim, false, mTicks, mQty, 0);
        for (uint256 i; i < nTakers; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address t = [alice, carol, bot, bob][r % 4];
            bool claim = r >> 8 & 1 != 0;
            uint64 off = uint64((r >> 16) % 400);
            uint64 tTicks = makerSell ? mTicks + off : mTicks - off;
            uint256 tQty = uint256(STEP2) * (1 + (r >> 32) % 2_000);
            if (claim) _fundClaims(t, !makerSell, tTicks, tQty);
            vm.recordLogs();
            ks[i + 1] = _placeAs(t, !makerSell, claim, true, tTicks, tQty, uint32(ks[0]) + 1);
            _process(vm.getRecordedLogs());
        }
        ok(fillCount != 0, "no fill");
        _unwind(ks);
        _compare(before);
    }

    // ------------------------------------------------------------------ helpers

    /// @dev Opens `m2`: a market whose step x tick rounds, at these fee rates.
    function _createMarket(uint256 mb, uint256 tb) internal {
        makerBps = mb;
        takerBps = tb;
        ConditionalStocksBase.MarketParams memory p = params(uint40(T0 - 1), uint40(T0 + 30 days));
        p.tick = TICK2;
        p.step = STEP2;
        p.maxSteps = 3_000_000;
        p.minNotional = 1e4;
        p.metadataHash = keccak256(bytes("ipfs://m2"));
        p.makerBps = uint16(mb);
        p.takerBps = uint16(tb);
        vm.prank(marketAdmin);
        m2 = view_.createMarket(p, "ipfs://m2");
        vm.prank(marketAdmin);
        view_.lifecycle(m2, 0, bytes32(0));
    }

    function _price(uint64 ticks) internal pure returns (uint256) {
        return uint256(ticks) * TICK2;
    }

    function _up(uint256 q, uint256 price) internal pure returns (uint256) {
        return (q * price + WAD - 1) / WAD;
    }

    /// Gives a claim-funded side exactly the most it can need (payments at maker prices plus the
    /// remainder's escrow never exceed ceil(qty x limit price)).
    function _fundClaims(address who, bool sell, uint64 ticks, uint256 qty) internal {
        vm.prank(who);
        cs.split(m2, sell ? 1 : 0, sell ? qty : _up(qty, _price(ticks)));
    }

    function _placeAs(
        address who,
        bool sell,
        bool claim,
        bool ioc,
        uint64 ticks,
        uint256 qty,
        uint256 m
    ) internal returns (uint256 k) {
        uint256 seq = seqOf(m2, branch);
        info[uint256(branch) << 32 | seq] = Info(who, ticks, sell, qty, 0);
        uint256 o = pack(O(m2, branch, sell, claim, ioc, 1_000, uint40(T0 + 10 days), ticks, qty));
        uint256 p = plan(seq, now_() + 60, 0);
        vm.prank(who);
        k = cs.place(o, p, m);
    }

    function _process(Vm.Log[] memory logs) internal {
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter != address(cs) || logs[i].topics.length == 0
                    || logs[i].topics[0] != TRADE
            ) continue;
            (uint256 fill, uint256 amounts, uint256 fees) =
                abi.decode(logs[i].data, (uint256, uint256, uint256));
            _check(fill, amounts, fees);
        }
    }

    function _check(uint256 fill, uint256 amounts, uint256 fees) internal {
        uint256 q = uint96(fill);
        uint256 br = uint8(fill >> 160);
        Info storage mk = info[br << 32 | uint32(fill >> 96)];
        Info storage tk = info[br << 32 | uint32(fill >> 128)];
        uint256 quoteAmount = _checkAmounts(mk, tk, q, amounts);
        (uint256 buyerFee, uint256 sellerFee) = _checkFees(mk, tk, q, quoteAmount, fees);
        mk.remaining -= q;
        tk.remaining -= q;
        fillCount++;
        if (br == winner) {
            address buyer = tk.sell ? mk.owner : tk.owner;
            address seller = tk.sell ? tk.owner : mk.owner;
            expQuote[buyer] -= int256(quoteAmount);
            expBase[buyer] += int256(q - buyerFee);
            expQuote[seller] += int256(quoteAmount - sellerFee);
            expBase[seller] -= int256(q);
            expQuote[admin] += int256(sellerFee);
            expBase[admin] += int256(buyerFee);
        }
    }

    function _checkAmounts(Info storage mk, Info storage tk, uint256 q, uint256 amounts)
        internal
        view
        returns (uint256 quoteAmount)
    {
        uint256 mp = _price(mk.ticks);
        quoteAmount = uint128(amounts);
        eq(q, mk.remaining < tk.remaining ? mk.remaining : tk.remaining, "fill quantity");
        eq(quoteAmount, q * mp / WAD, "quote at maker price, floored");
        ok(q * mp - quoteAmount * WAD < WAD, "rounding loss >= 1 raw unit");
        uint256 improvement;
        if (tk.sell) {
            improvement = _up(mk.remaining, mp) - _up(mk.remaining - q, mp) - quoteAmount;
        } else {
            uint256 tp = _price(tk.ticks);
            improvement = _up(tk.remaining, tp) - _up(tk.remaining - q, tp) - quoteAmount;
        }
        eq(amounts >> 128, improvement, "improvement");
    }

    function _checkFees(
        Info storage mk,
        Info storage tk,
        uint256 q,
        uint256 quoteAmount,
        uint256 fees
    ) internal returns (uint256 buyerFee, uint256 sellerFee) {
        Info storage buyer = tk.sell ? mk : tk;
        Info storage seller = tk.sell ? tk : mk;
        uint256 n = q * (tk.sell ? makerBps : takerBps) + buyer.carry;
        buyerFee = n / BPS;
        buyer.carry = n % BPS;
        n = quoteAmount * (tk.sell ? takerBps : makerBps) + seller.carry;
        sellerFee = n / BPS;
        seller.carry = n % BPS;
        eq(uint128(fees), buyerFee, "buyer fee");
        eq(fees >> 128, sellerFee, "seller fee");
    }

    function _snapshot() internal view returns (uint256[10] memory s) {
        for (uint256 i; i < 5; ++i) {
            s[i] = credit(holders[i], address(usdc));
            s[5 + i] = credit(holders[i], address(stock));
        }
    }

    function _unwind(uint256[] memory ks) internal {
        for (uint256 i; i < ks.length; ++i) {
            (ConditionalStocksBase.Order memory o,) = view_.order(ks[i]);
            if (o.remaining != 0) {
                vm.prank(o.owner);
                cs.cancel(ks[i]);
            }
        }
        eq(view_.book(m2).openNotional, 0, "market notional released");
        vm.prank(guardian);
        view_.lifecycle(m2, 1, keccak256("event ended"));
        uint8 yes = winner == 0 ? 1 : 0;
        bytes32 commitment = view_.resolutionHash(m2, yes, 1 - yes, EVIDENCE, URI);
        vm.prank(marketAdmin);
        view_.lifecycle(m2, 3, commitment);
        vm.prank(resolver);
        view_.resolve(m2, yes, 1 - yes, EVIDENCE, URI);
        for (uint8 br; br < 2; ++br) {
            ConditionalStocksBase.Fees memory f = view_.fees(m2, br);
            if (f.quote != 0) {
                vm.prank(admin);
                view_.claimFees(m2, br, 0, admin, f.quote);
            }
            if (f.base != 0) {
                vm.prank(admin);
                view_.claimFees(m2, br, 1, admin, f.base);
            }
        }
        for (uint256 i; i < 5; ++i) {
            address h = holders[i];
            ConditionalStocksBase.Account memory y = view_.account(m2, 0, h);
            ConditionalStocksBase.Account memory n = view_.account(m2, 1, h);
            eq(uint256(y.notional) + n.notional, 0, "wallet notional released");
            if (y.quote != 0 || n.quote != 0) {
                vm.prank(h);
                cs.redeem(m2, 0, y.quote, n.quote);
            }
            if (y.base != 0 || n.base != 0) {
                vm.prank(h);
                cs.redeem(m2, 1, y.base, n.base);
            }
        }
        ConditionalStocksBase.Backing memory bk = view_.backing(m2);
        eq(bk.quote, 0, "quote backing drained");
        eq(bk.base, 0, "base backing drained");
    }

    function _compare(uint256[10] memory before) internal view {
        uint256 totalQ;
        uint256 totalB;
        for (uint256 i; i < 5; ++i) {
            address h = holders[i];
            uint256 q = credit(h, address(usdc));
            uint256 b = credit(h, address(stock));
            eq(
                q,
                uint256(int256(before[i]) + expQuote[h]),
                string.concat("quote of #", vm.toString(i))
            );
            eq(
                b,
                uint256(int256(before[5 + i]) + expBase[h]),
                string.concat("base of #", vm.toString(i))
            );
            totalQ += q;
            totalB += b;
        }
        eq(totalQ, view_.pool(address(usdc)).liability, "quote liability");
        eq(totalB, view_.pool(address(stock)).liability, "base liability");
        eq(usdc.balanceOf(address(cs)), totalQ, "quote custody");
        eq(stock.balanceOf(address(cs)), totalB, "base custody");
    }
}
