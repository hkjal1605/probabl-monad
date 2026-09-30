// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocks } from "../../src/ConditionalStocks.sol";
import { ConditionalStocksAdmin } from "../../src/ConditionalStocksAdmin.sol";
import { DeltaVault } from "../../src/vault/DeltaVault.sol";
import { DeltaVaultAdmin } from "../../src/vault/DeltaVaultAdmin.sol";
import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { IConditionalStocks } from "../../src/vault/interfaces/IConditionalStocks.sol";
import { MockToken, Vm } from "../Base.t.sol";
import { MockFeed, VaultBase } from "./VaultBase.t.sol";

/// @dev Random vault activity: LP flows, keeper quotes, taker fills, oracle moves, time, merges
///      and claim donations. Flow checks run inside the handler and are counted as violations.
contract VaultHandler {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant STEP = 1e15;
    uint256 internal constant TICK = 1e4;

    ConditionalStocks internal cs;
    ConditionalStocksAdmin internal view_;
    DeltaVault internal vault;
    DeltaVaultAdmin internal ops;
    MockFeed internal feed;
    MockToken internal usdc;
    MockToken internal stock;
    uint32 internal market;
    address internal keeper;
    address[] internal lps;
    address[] internal takers;

    uint256 public violations;
    uint256 public flows;
    uint256 public placed;
    uint256 public fills;

    constructor(
        ConditionalStocks cs_,
        DeltaVault vault_,
        MockFeed feed_,
        MockToken usdc_,
        MockToken stock_,
        uint32 market_,
        address keeper_,
        address[] memory lps_,
        address[] memory takers_
    ) {
        cs = cs_;
        view_ = ConditionalStocksAdmin(address(cs_));
        vault = vault_;
        ops = DeltaVaultAdmin(address(vault_));
        feed = feed_;
        usdc = usdc_;
        stock = stock_;
        market = market_;
        keeper = keeper_;
        lps = lps_;
        takers = takers_;
    }

    // ------------------------------------------------------------ accounting

    function _worlds() internal view returns (uint256[4] memory w) {
        DeltaVaultBase.Holdings memory h = ops.holdings();
        w = [h.quote, h.quote, h.base, h.base];
        for (uint256 i; i < h.claims.length; ++i) {
            w[0] += h.claims[i].yesQuote;
            w[1] += h.claims[i].noQuote;
            w[2] += h.claims[i].yesBase;
            w[3] += h.claims[i].noBase;
        }
    }

    function _wealth(address user) internal view returns (uint256[4] memory w) {
        uint256 q = usdc.balanceOf(user) + view_.credit(user, address(usdc));
        uint256 b = stock.balanceOf(user) + view_.credit(user, address(stock));
        IConditionalStocks.Account memory yes =
            IConditionalStocks(address(cs)).account(market, 0, user);
        IConditionalStocks.Account memory no =
            IConditionalStocks(address(cs)).account(market, 1, user);
        w = [q + yes.quote, q + no.quote, b + yes.base, b + no.base];
    }

    /// @dev A flow moves holdings between the vault and one user without creating any, and never
    ///      lowers the holdings behind each remaining share.
    function _check(
        uint256[4] memory vault0,
        uint256[4] memory user0,
        uint256 supply0,
        address user
    ) internal {
        uint256[4] memory vault1 = _worlds();
        uint256[4] memory user1 = _wealth(user);
        uint256 supply1 = vault.totalSupply();
        for (uint256 i; i < 4; ++i) {
            if (vault0[i] + user0[i] != vault1[i] + user1[i]) violations++;
            if (vault1[i] * supply0 < vault0[i] * supply1) violations++;
        }
    }

    // ------------------------------------------------------------ LP flows

    function deposit(uint256 seed, uint256 quoteBudget, uint256 baseBudget) external {
        address lp = lps[seed % lps.length];
        quoteBudget = 1e6 + quoteBudget % 200_000e6;
        baseBudget = STEP + baseBudget % 2000e18;
        usdc.mint(lp, quoteBudget);
        stock.mint(lp, baseBudget);
        vm.startPrank(lp);
        usdc.approve(address(vault), quoteBudget);
        stock.approve(address(vault), baseBudget);
        vm.stopPrank();
        (uint256[4] memory v0, uint256[4] memory u0, uint256 s0) =
            (_worlds(), _wealth(lp), vault.totalSupply());
        vm.prank(lp);
        try vault.deposit(quoteBudget, baseBudget, 1, lp) {
            flows++;
            _check(v0, u0, s0, lp);
        } catch { }
    }

    function withdraw(uint256 seed, uint256 fraction) external {
        address lp = lps[seed % lps.length];
        uint256 balance = vault.balanceOf(lp);
        if (balance == 0) return;
        uint256 shares = 1 + fraction % balance;
        (uint256[4] memory v0, uint256[4] memory u0, uint256 s0) =
            (_worlds(), _wealth(lp), vault.totalSupply());
        vm.prank(lp);
        try vault.withdraw(shares, 0, 0, lp, lp) {
            flows++;
            _check(v0, u0, s0, lp);
        } catch {
            violations++; // Withdrawals must never fail.
        }
    }

    // ------------------------------------------------------------ keeper and takers

    /// @dev Cancels expired vault quotes and posts one more: bids below and asks above the oracle
    ///      price, so vault quotes never cross.
    function quote(uint256 seed, uint256 edgeBps, uint256 qty, bool claim) external {
        uint8 branch = uint8(seed % 2);
        bool sell = (seed >> 1) % 2 == 1;
        uint256 spot = uint256(feed.answer()) / 100;
        edgeBps = 10 + edgeBps % 890;
        uint256 price =
            sell ? spot * (10_000 + edgeBps) / 10_000 : spot * (10_000 - edgeBps) / 10_000;
        uint64 ticks = uint64(sell ? (price + TICK - 1) / TICK : price / TICK);
        qty = STEP * (10 + qty % 20_000);
        if (claim) {
            IConditionalStocks.Account memory a =
                IConditionalStocks(address(cs)).account(market, branch, address(vault));
            uint256 reserve = sell ? qty : (qty * ticks * TICK + 1e18 - 1) / 1e18;
            if ((sell ? a.base : a.quote) < reserve) claim = false;
        }
        uint256 now_ = vm.getBlockTimestamp();
        uint256 flags = uint256(branch) | (sell ? 2 : 0) | (claim ? 4 : 0);
        uint256 o = uint256(market) | flags << 32 | uint256(50) << 40 | (now_ + 5 minutes) << 56
            | uint256(ticks) << 96 | qty << 160;
        IConditionalStocks.Book memory b = IConditionalStocks(address(cs)).book(market);
        uint256 p = (branch == 0 ? b.seqYes : b.seqNo) | (now_ + 60) << 32;

        uint256[] memory tracked = ops.orders(market);
        uint256 expired;
        for (uint256 i; i < tracked.length; ++i) {
            (IConditionalStocks.Order memory r,) = IConditionalStocks(address(cs)).order(tracked[i]);
            if (r.remaining != 0 && r.expiry <= now_) tracked[expired++] = tracked[i];
        }
        uint256[] memory cancels = new uint256[](expired);
        for (uint256 i; i < expired; ++i) {
            cancels[i] = tracked[i];
        }
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](1);
        places[0] = DeltaVaultBase.Placement(o, p);
        vm.prank(keeper);
        try ops.update(market, cancels, places) {
            placed++;
        } catch {
            vm.prank(keeper);
            ops.update(market, cancels, new DeltaVaultBase.Placement[](0));
        }
    }

    function take(uint256 seed, uint256 index, uint256 qty) external {
        uint256[] memory tracked = ops.orders(market);
        if (tracked.length == 0) return;
        uint256 k = tracked[index % tracked.length];
        (IConditionalStocks.Order memory r,) = IConditionalStocks(address(cs)).order(k);
        uint256 now_ = vm.getBlockTimestamp();
        if (r.remaining == 0 || r.expiry <= now_) return;
        qty = STEP * (1 + qty % (r.remaining / STEP));
        uint8 branch = uint8((k >> 32) & 1);
        bool sell = r.flags & 2 == 0; // The taker takes the other side.
        uint256 flags = uint256(branch) | (sell ? 2 : 0) | 8;
        uint256 o = uint256(market) | flags << 32 | uint256(1000) << 40 | (now_ + 1 days) << 56
            | uint256(r.ticks) << 96 | qty << 160;
        IConditionalStocks.Book memory b = IConditionalStocks(address(cs)).book(market);
        uint256 p = (branch == 0 ? b.seqYes : b.seqNo) | (now_ + 60) << 32;
        vm.prank(takers[seed % takers.length]);
        try cs.place(o, p, (k & 0xffffffff) + 1) {
            fills++;
        } catch { }
    }

    function merge() external {
        vm.prank(keeper);
        ops.merge(market);
    }

    // ------------------------------------------------------------ environment

    function move(int256 bps) external {
        bps = bps % 300;
        int256 answer = feed.answer() * (10_000 + bps) / 10_000;
        if (answer < 60e8 || answer > 160e8) return;
        uint256 now_ = vm.getBlockTimestamp();
        feed.set(answer, now_, now_);
    }

    function wait(uint256 secondsAhead) external {
        uint256 now_ = vm.getBlockTimestamp() + 1 + secondsAhead % 5 minutes;
        vm.warp(now_);
        feed.set(feed.answer(), now_, now_);
    }

    /// @dev Anyone may hand the vault claims; they only add to what shares represent.
    function donate(uint256 seed, uint256 amount, bool base) external {
        address from = takers[seed % takers.length];
        amount = 1 + amount % 1e9;
        vm.startPrank(from);
        try cs.split(market, base ? 1 : 0, amount) {
            view_.transferClaim(market, uint8(seed % 2), base ? 1 : 0, address(vault), amount);
        } catch { }
        vm.stopPrank();
    }
}

contract DeltaVaultInvariantTest is VaultBase {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        address[] memory lps = new address[](3);
        lps[0] = vaultAdmin;
        lps[1] = address(0x1A);
        lps[2] = address(0x1B);
        address[] memory takers = new address[](3);
        takers[0] = alice;
        takers[1] = bob;
        takers[2] = carol;
        handler = new VaultHandler(cs, vault, feed, usdc, stock, market, keeper, lps, takers);
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariant_flowsConserveAndNeverDilute() public view {
        eq(handler.violations(), 0, "a flow created value or diluted holders");
    }

    /// @dev Every resting vault order is tracked, so its escrow is part of what shares own.
    function invariant_everyRestingOrderIsTracked() public view {
        uint256[] memory keys = ops.orders(market);
        uint256 notional;
        for (uint256 i; i < keys.length; ++i) {
            (IConditionalStocks.Order memory o,) = IConditionalStocks(address(cs)).order(keys[i]);
            notional += (uint256(o.remaining) * o.ticks * TICK + WAD - 1) / WAD;
        }
        eq(
            notional,
            uint256(acct(address(vault), YES).notional) + acct(address(vault), NO).notional,
            "untracked resting notional"
        );
        eq(ops.exposure(market).resting, notional, "exposure view");
    }

    function invariant_vaultHoldsNoIdleTokensAndExchangeStaysBacked() public view {
        eq(usdc.balanceOf(address(vault)) + stock.balanceOf(address(vault)), 0, "idle tokens");
        eq(usdc.balanceOf(address(cs)), view_.pool(address(usdc)).liability, "quote custody");
        eq(stock.balanceOf(address(cs)), view_.pool(address(stock)).liability, "base custody");
    }

    function invariant_deadSharesStayLocked() public view {
        eq(vault.balanceOf(address(0xdEaD)), vault.DEAD_SHARES(), "dead shares");
        ok(vault.totalSupply() >= vault.DEAD_SHARES(), "supply");
    }

    function afterInvariant() public view {
        ok(handler.flows() + handler.placed() + handler.fills() > 0, "no activity");
    }
}
