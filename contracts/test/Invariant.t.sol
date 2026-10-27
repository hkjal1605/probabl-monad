// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocks } from "../src/ConditionalStocks.sol";
import { ConditionalStocksAdmin } from "../src/ConditionalStocksAdmin.sol";
import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";
import { Base, MockToken, Vm } from "./Base.t.sol";

/// @dev Random protocol activity by four actors in one market.
contract Handler {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    ConditionalStocks internal cs;
    ConditionalStocksAdmin internal view_;
    uint32 internal market;
    address[] public actors;
    uint256[] public keys;
    uint256 public fills;

    constructor(ConditionalStocks cs_, uint32 market_, address[] memory actors_) {
        cs = cs_;
        view_ = ConditionalStocksAdmin(address(cs_));
        market = market_;
        actors = actors_;
    }

    function keyCount() external view returns (uint256) {
        return keys.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function split(uint256 seed, bool base, uint256 amount) external {
        address a = _actor(seed);
        amount = base ? 1e15 * (1 + amount % 5_000) : 1e6 * (1 + amount % 50_000);
        vm.prank(a);
        try ConditionalStocksAdmin(address(cs)).split(market, base ? 1 : 0, amount) { } catch { }
    }

    function merge(uint256 seed, bool base, uint256 amount) external {
        address a = _actor(seed);
        amount = base ? 1e15 * (1 + amount % 5_000) : 1e6 * (1 + amount % 50_000);
        vm.prank(a);
        try ConditionalStocksAdmin(address(cs)).merge(market, base ? 1 : 0, amount) { } catch { }
    }

    function place(uint256 seed, uint8 flags, uint64 ticks, uint256 qty, uint256 makerSeed)
        external
    {
        address a = _actor(seed);
        uint8 branch = flags & 1;
        ticks = 18_000 + ticks % 4_000;
        qty = 1e15 * (1 + qty % 3_000);
        uint256 o = uint256(market) | uint256(flags & 15) << 32 | uint256(1_000) << 40
            | uint256(vm.getBlockTimestamp() + 1 days) << 56 | uint256(ticks) << 96 | qty << 160;
        ConditionalStocksBase.Book memory b = view_.book(market);
        uint256 seq = branch == 0 ? b.seqYes : b.seqNo;
        uint256 m;
        uint256 count;
        bool sell = flags & 2 != 0;
        for (uint256 i; i < keys.length && count < 8; ++i) {
            uint256 k = keys[(makerSeed + i) % keys.length];
            (ConditionalStocksBase.Order memory maker,) = view_.order(k);
            if (
                (k >> 32 & 1) == branch && maker.remaining != 0 && (maker.flags & 2 != 0) != sell
                    && (sell ? maker.ticks >= ticks : maker.ticks <= ticks)
            ) m |= ((k & 0xffffffff) + 1) << (32 * count++);
        }
        vm.prank(a);
        try cs.place(o, seq | (vm.getBlockTimestamp() + 60) << 32, m) returns (uint256 k) {
            (ConditionalStocksBase.Order memory placed,) = view_.order(k);
            if (placed.remaining != 0) keys.push(k);
            if (placed.remaining != _quantity(o)) fills++;
        } catch { }
    }

    function _quantity(uint256 o) internal pure returns (uint256) {
        return o >> 160;
    }

    function cancel(uint256 seed, uint256 index) external {
        if (keys.length == 0 || seed % 4 != 0) return;
        uint256 i = index % keys.length;
        uint256 k = keys[i];
        (ConditionalStocksBase.Order memory o,) = view_.order(k);
        if (o.remaining != 0) {
            vm.prank(seed % 2 == 0 ? o.owner : _actor(seed));
            try cs.cancel(k) { } catch { }
        }
        (o,) = view_.order(k);
        if (o.remaining == 0) {
            keys[i] = keys[keys.length - 1];
            keys.pop();
        }
    }

    function invalidate(uint256 seed) external {
        if (seed % 16 != 0) return;
        vm.prank(_actor(seed));
        view_.invalidateOrders();
    }

    function withdraw(uint256 seed, bool base, uint256 amount) external {
        address a = _actor(seed);
        address token = base ? view_.terms(market).base : view_.quote();
        uint256 available = view_.credit(a, token);
        if (available == 0) return;
        vm.prank(a);
        cs.withdraw(token, 1 + amount % available, a);
    }
}

contract InvariantTest is Base {
    Handler internal handler;
    address[] internal actors;

    function setUp() public override {
        super.setUp();
        useFees(7, 13);
        useRebate(4_000);
        actors.push(alice);
        actors.push(bob);
        actors.push(carol);
        actors.push(bot);
        for (uint256 i; i < actors.length; ++i) {
            vm.startPrank(actors[i]);
            ConditionalStocksAdmin(address(cs)).split(market, 0, 400_000e6);
            ConditionalStocksAdmin(address(cs)).split(market, 1, 4_000e18);
            vm.stopPrank();
        }
        handler = new Handler(cs, market, actors);
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    /// @dev Walks every live order the handler knows of: reservations and notional by owner.
    function _orders()
        internal
        view
        returns (
            uint256 quoteEscrow,
            uint256 baseEscrow,
            uint256[2][2] memory claimEscrow,
            uint256 notional,
            uint256 bidNotional
        )
    {
        for (uint256 i; i < handler.keyCount(); ++i) {
            uint256 k = handler.keys(i);
            (ConditionalStocksBase.Order memory o,) = view_.order(k);
            if (o.remaining == 0) continue;
            uint256 n = (uint256(o.remaining) * o.ticks * TICK + WAD - 1) / WAD;
            notional += n;
            bool sell = o.flags & 2 != 0;
            if (!sell) bidNotional += n;
            uint256 branch = k >> 32 & 1;
            if (o.flags & 4 == 0) {
                if (sell) baseEscrow += o.remaining;
                else quoteEscrow += n;
            } else {
                claimEscrow[branch][sell ? 1 : 0] += sell ? o.remaining : n;
            }
        }
    }

    function invariant_tokensAreFullyBacked() public view {
        (uint256 quoteEscrow, uint256 baseEscrow,,,) = _orders();
        uint256 quoteCredit;
        uint256 baseCredit;
        for (uint256 i; i < actors.length; ++i) {
            quoteCredit += credit(actors[i], address(usdc));
            baseCredit += credit(actors[i], address(stock));
        }
        ConditionalStocksBase.Backing memory bk = view_.backing(market);
        eq(
            quoteCredit + quoteEscrow + bk.quote,
            view_.pool(address(usdc)).liability,
            "quote liability"
        );
        eq(
            baseCredit + baseEscrow + bk.base,
            view_.pool(address(stock)).liability,
            "base liability"
        );
        eq(usdc.balanceOf(address(cs)), view_.pool(address(usdc)).liability, "quote custody");
        eq(stock.balanceOf(address(cs)), view_.pool(address(stock)).liability, "base custody");
    }

    function invariant_claimsEqualBackingOnBothBranches() public view {
        (,, uint256[2][2] memory claimEscrow,,) = _orders();
        ConditionalStocksBase.Backing memory bk = view_.backing(market);
        for (uint8 branch; branch < 2; ++branch) {
            uint256 quoteClaims = claimEscrow[branch][0];
            uint256 baseClaims = claimEscrow[branch][1];
            for (uint256 i; i < actors.length; ++i) {
                ConditionalStocksBase.Account memory a = view_.account(market, branch, actors[i]);
                quoteClaims += a.quote;
                baseClaims += a.base;
            }
            ConditionalStocksBase.Fees memory f = view_.fees(market, branch);
            eq(quoteClaims + f.quote, bk.quote, "quote claims");
            eq(baseClaims + f.base, bk.base, "base claims");
        }
    }

    /// @dev Wallets carry the notional of all their resting orders; the market cap counts bids.
    function invariant_openNotionalMatchesRestingOrders() public view {
        (,,, uint256 notional, uint256 bidNotional) = _orders();
        uint256 accounts;
        for (uint256 i; i < actors.length; ++i) {
            accounts += view_.account(market, 0, actors[i]).notional;
            accounts += view_.account(market, 1, actors[i]).notional;
        }
        eq(view_.book(market).openNotional, bidNotional, "market notional");
        eq(accounts, notional, "wallet notional");
    }
}
