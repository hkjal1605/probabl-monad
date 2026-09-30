// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocks } from "../../src/ConditionalStocks.sol";
import { ConditionalStocksAdmin } from "../../src/ConditionalStocksAdmin.sol";
import { DeltaVault } from "../../src/vault/DeltaVault.sol";
import { DeltaVaultAdmin } from "../../src/vault/DeltaVaultAdmin.sol";
import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { IConditionalStocks } from "../../src/vault/interfaces/IConditionalStocks.sol";
import { MockToken, Vm } from "../Base.t.sol";
import { VaultAuditBase } from "./VaultAuditBase.t.sol";
import { MockFeed } from "./VaultBase.t.sol";

/// @dev Random activity over three registered markets: LP flows, keeper quotes of every order
///      type, taker fills, merges, claim donations, third-party releases, pause/unpause,
///      cancelAll, oracle moves, time, and one market resolving (YES, NO or INVALID) and being
///      settled. Flow checks use joint worlds (one outcome per registered market).
contract MultiHandler {
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
    uint32[3] internal ids;
    address internal keeper;
    address internal sentinel;
    address internal admin;
    address internal marketAdmin;
    address internal guardian;
    address internal resolver;
    address[] internal lps;
    address[] internal takers;

    uint256 public violations;
    uint256 public withdrawFailures;
    uint256 public flows;
    uint256 public placed;
    uint256 public fills;
    uint256 public settled;
    bytes32 public lastFailure;

    constructor(
        ConditionalStocks cs_,
        DeltaVault vault_,
        MockFeed feed_,
        MockToken usdc_,
        MockToken stock_,
        uint32[3] memory ids_,
        address[6] memory roles, // keeper, sentinel, vaultAdmin, marketAdmin, guardian, resolver
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
        ids = ids_;
        keeper = roles[0];
        sentinel = roles[1];
        admin = roles[2];
        marketAdmin = roles[3];
        guardian = roles[4];
        resolver = roles[5];
        lps = lps_;
        takers = takers_;
    }

    // ------------------------------------------------------------ joint-world accounting

    /// @dev For each joint outcome (bit i = market i resolves NO) the vault's quote and base.
    function _vaultWorlds() internal view returns (uint256[16] memory w, uint256 n) {
        DeltaVaultBase.Holdings memory h = ops.holdings();
        n = h.markets.length;
        for (uint256 omega; omega < 2 ** n; ++omega) {
            uint256 q = h.quote;
            uint256 b = h.base;
            for (uint256 i; i < n; ++i) {
                bool no = (omega >> i) & 1 == 1;
                q += no ? h.claims[i].noQuote : h.claims[i].yesQuote;
                b += no ? h.claims[i].noBase : h.claims[i].yesBase;
            }
            w[2 * omega] = q;
            w[2 * omega + 1] = b;
        }
    }

    function _userWorlds(address user) internal view returns (uint256[16] memory w) {
        uint32[] memory ms = ops.markets();
        uint256 q0 = usdc.balanceOf(user) + view_.credit(user, address(usdc));
        uint256 b0 = stock.balanceOf(user) + view_.credit(user, address(stock));
        for (uint256 omega; omega < 2 ** ms.length; ++omega) {
            uint256 q = q0;
            uint256 b = b0;
            for (uint256 i; i < ms.length; ++i) {
                uint8 branch = uint8((omega >> i) & 1);
                IConditionalStocks.Account memory a =
                    IConditionalStocks(address(cs)).account(ms[i], branch, user);
                q += a.quote;
                b += a.base;
            }
            w[2 * omega] = q;
            w[2 * omega + 1] = b;
        }
    }

    function _check(
        uint256[16] memory v0,
        uint256[16] memory u0,
        uint256 s0,
        uint256 n0,
        address user,
        bytes32 tag
    ) internal {
        (uint256[16] memory v1, uint256 n1) = _vaultWorlds();
        if (n1 != n0) return; // a market set change is not a flow
        uint256[16] memory u1 = _userWorlds(user);
        uint256 s1 = vault.totalSupply();
        for (uint256 k; k < 2 * 2 ** n0; ++k) {
            if (v0[k] + u0[k] != v1[k] + u1[k]) {
                violations++;
                lastFailure = bytes32(uint256(tag) | 1);
            }
            // A re-seed (supply at the dead shares) deliberately dilutes the dead shares.
            if (s0 > 1000 && v1[k] * s0 < v0[k] * s1) {
                violations++;
                lastFailure = bytes32(uint256(tag) | 2);
            }
        }
    }

    // ------------------------------------------------------------ LP flows

    function deposit(uint256 seed, uint256 quoteBudget, uint256 baseBudget) external {
        address lp = lps[seed % lps.length];
        quoteBudget = 1 + quoteBudget % 200_000e6;
        baseBudget = 1 + baseBudget % 2000e18;
        usdc.mint(lp, quoteBudget);
        stock.mint(lp, baseBudget);
        vm.startPrank(lp);
        usdc.approve(address(vault), quoteBudget);
        stock.approve(address(vault), baseBudget);
        vm.stopPrank();
        (uint256[16] memory v0, uint256 n0) = _vaultWorlds();
        uint256[16] memory u0 = _userWorlds(lp);
        uint256 s0 = vault.totalSupply();
        vm.prank(lp);
        try vault.deposit(quoteBudget, baseBudget, 1, lp) {
            flows++;
            _check(v0, u0, s0, n0, lp, "deposit");
        } catch { }
    }

    function withdraw(uint256 seed, uint256 fraction, uint256 receiverSeed) external {
        address lp = lps[seed % lps.length];
        uint256 balance = vault.balanceOf(lp);
        if (balance == 0) return;
        uint256 shares = 1 + fraction % balance;
        (uint256[16] memory v0, uint256 n0) = _vaultWorlds();
        uint256[16] memory u0 = _userWorlds(lp);
        uint256 s0 = vault.totalSupply();
        receiverSeed; // the receiver is the owner so the user-side check sees the payout
        vm.prank(lp);
        try vault.withdraw(shares, 0, 0, lp, lp) {
            flows++;
            _check(v0, u0, s0, n0, lp, "withdraw");
        } catch (bytes memory reason) {
            withdrawFailures++;
            lastFailure = bytes32(bytes4(reason));
        }
    }

    // ------------------------------------------------------------ keeper

    function quote(uint256 seed, uint256 edgeBps, uint256 qty, bool claim) external {
        uint32[] memory ms = ops.markets();
        if (ms.length == 0) return;
        uint32 id = ms[seed % ms.length];
        uint8 branch = uint8((seed >> 8) % 2);
        bool sell = (seed >> 9) % 2 == 1;
        uint256 spot = uint256(feed.answer()) / 100;
        edgeBps = 10 + edgeBps % 890;
        uint256 price =
            sell ? spot * (10_000 + edgeBps) / 10_000 : spot * (10_000 - edgeBps) / 10_000;
        uint64 ticks = uint64(sell ? (price + TICK - 1) / TICK : price / TICK);
        qty = STEP * (10 + qty % 20_000);
        if (claim) {
            IConditionalStocks.Account memory a =
                IConditionalStocks(address(cs)).account(id, branch, address(vault));
            uint256 reserve = sell ? qty : (qty * ticks * TICK + 1e18 - 1) / 1e18;
            if ((sell ? a.base : a.quote) < reserve) claim = false;
        }
        uint256 now_ = vm.getBlockTimestamp();
        uint256 flags = uint256(branch) | (sell ? 2 : 0) | (claim ? 4 : 0);
        uint256 o = uint256(id) | flags << 32 | uint256(50) << 40 | (now_ + 5 minutes) << 56
            | uint256(ticks) << 96 | qty << 160;
        IConditionalStocks.Book memory b = IConditionalStocks(address(cs)).book(id);
        uint256 p = (branch == 0 ? b.seqYes : b.seqNo) | (now_ + 60) << 32;

        uint256[] memory tracked = ops.orders(id);
        uint256 dead;
        for (uint256 i; i < tracked.length; ++i) {
            (IConditionalStocks.Order memory r,) = IConditionalStocks(address(cs)).order(tracked[i]);
            if (r.remaining != 0 && (r.expiry <= now_ || (seed >> 12) % 4 == 0)) {
                tracked[dead++] = tracked[i];
            }
        }
        uint256[] memory cancels = new uint256[](dead);
        for (uint256 i; i < dead; ++i) {
            cancels[i] = tracked[i];
        }
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](1);
        places[0] = DeltaVaultBase.Placement(o, p);
        vm.prank(keeper);
        try ops.update(id, cancels, places) {
            placed++;
        } catch {
            vm.prank(keeper);
            try ops.update(id, cancels, new DeltaVaultBase.Placement[](0)) { } catch { }
        }
    }

    function take(uint256 seed, uint256 index, uint256 qty) external {
        uint32[] memory ms = ops.markets();
        if (ms.length == 0) return;
        uint32 id = ms[seed % ms.length];
        uint256[] memory tracked = ops.orders(id);
        if (tracked.length == 0) return;
        uint256 k = tracked[index % tracked.length];
        (IConditionalStocks.Order memory r,) = IConditionalStocks(address(cs)).order(k);
        uint256 now_ = vm.getBlockTimestamp();
        if (r.remaining < STEP || r.expiry <= now_) return;
        uint256 steps = r.remaining / STEP;
        uint256 q = 20 + qty % steps;
        qty = STEP * (q > steps ? steps : q);
        uint8 branch = uint8((k >> 32) & 1);
        bool sell = r.flags & 2 == 0;
        uint256 flags = uint256(branch) | (sell ? 2 : 0) | 8;
        uint256 o = uint256(id) | flags << 32 | uint256(1000) << 40 | (now_ + 1 days) << 56
            | uint256(r.ticks) << 96 | qty << 160;
        IConditionalStocks.Book memory b = IConditionalStocks(address(cs)).book(id);
        uint256 p = (branch == 0 ? b.seqYes : b.seqNo) | (now_ + 60) << 32;
        vm.prank(takers[seed % takers.length]);
        try cs.place(o, p, (k & 0xffffffff) + 1) {
            fills++;
        } catch { }
    }

    function merge(uint256 seed) external {
        uint32[] memory ms = ops.markets();
        if (ms.length == 0) return;
        vm.prank(keeper);
        ops.merge(ms[seed % ms.length]);
    }

    function cancelAll() external {
        vm.prank(sentinel);
        ops.cancelAll();
    }

    function pauseToggle(uint256 seed) external {
        bool on = seed % 4 == 0;
        if (on) {
            if (vault.paused()) return;
            vm.prank(sentinel);
            ops.pause();
        } else {
            if (!vault.paused()) return;
            vm.prank(admin);
            ops.unpause();
        }
    }

    /// @dev A third party releases any vault order the exchange lets it release.
    function release(uint256 seed, uint256 index) external {
        uint32[] memory ms = ops.markets();
        if (ms.length == 0) return;
        uint256[] memory tracked = ops.orders(ms[seed % ms.length]);
        if (tracked.length == 0) return;
        vm.prank(takers[seed % takers.length]);
        try cs.cancel(tracked[index % tracked.length]) { } catch { }
    }

    function donate(uint256 seed, uint256 amount, bool base) external {
        uint32[] memory ms = ops.markets();
        if (ms.length == 0) return;
        uint32 id = ms[seed % ms.length];
        address from = takers[seed % takers.length];
        amount = 1 + amount % 1e9;
        vm.startPrank(from);
        try cs.split(id, base ? 1 : 0, amount) {
            view_.transferClaim(id, uint8((seed >> 4) % 2), base ? 1 : 0, address(vault), amount);
        } catch { }
        vm.stopPrank();
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
        uint256 now_ = vm.getBlockTimestamp() + 1 + secondsAhead % 20 minutes;
        vm.warp(now_);
        feed.set(feed.answer(), now_, now_);
    }

    /// @dev Resolves the third market (once) with a random outcome and settles it.
    function resolveAndSettle(uint256 outcome) external {
        if (settled != 0) return;
        uint32 id = ids[2];
        outcome %= 3;
        (uint8 yes, uint8 no) = outcome == 0 ? (1, 0) : outcome == 1 ? (0, 1) : (1, 1);
        vm.prank(guardian);
        view_.lifecycle(id, 1, keccak256("ended"));
        bytes32 c = view_.resolutionHash(id, yes, no, keccak256("e"), "u");
        vm.prank(marketAdmin);
        view_.lifecycle(id, 3, c);
        vm.prank(resolver);
        view_.resolve(id, yes, no, keccak256("e"), "u");
        ops.settle(id);
        settled = 1 + outcome;
    }
}

contract MultiMarketInvariantTest is VaultAuditBase {
    MultiHandler internal handler;
    uint32[3] internal ids;

    function setUp() public override {
        super.setUp();
        ids[0] = market;
        ids[1] = _newMarket(uint40(T0 + 30 days));
        ids[2] = _newMarket(uint40(T0 + 30 days));
        address[] memory lps = new address[](3);
        lps[0] = vaultAdmin;
        lps[1] = address(0x1A);
        lps[2] = address(0x1B);
        address[] memory takers = new address[](3);
        takers[0] = alice;
        takers[1] = bob;
        takers[2] = carol;
        handler = new MultiHandler(
            cs,
            vault,
            feed,
            usdc,
            stock,
            ids,
            [keeper, sentinel, vaultAdmin, marketAdmin, guardian, resolver],
            lps,
            takers
        );
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 80
    function invariant_multiFlowsConserveAndNeverDilute() public view {
        if (handler.violations() != 0) {
            revert(string(abi.encodePacked("violation ", handler.lastFailure())));
        }
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 80
    function invariant_withdrawalsNeverFail() public view {
        if (handler.withdrawFailures() != 0) {
            revert(string(abi.encodePacked("withdraw failed ", handler.lastFailure())));
        }
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 80
    function invariant_everyRestingOrderTrackedInEveryMarket() public view {
        uint32[] memory ms = ops.markets();
        for (uint256 m; m < ms.length; ++m) {
            uint256[] memory keys = ops.orders(ms[m]);
            uint256 notional;
            for (uint256 i; i < keys.length; ++i) {
                (IConditionalStocks.Order memory o,) =
                    IConditionalStocks(address(cs)).order(keys[i]);
                notional += (uint256(o.remaining) * o.ticks * TICK + WAD - 1) / WAD;
            }
            eq(
                notional,
                uint256(_acct(ms[m], YES, address(vault)).notional)
                    + _acct(ms[m], NO, address(vault)).notional,
                "untracked resting notional"
            );
        }
        // Nothing rests in the settled market.
        if (handler.settled() != 0) {
            eq(
                uint256(_acct(ids[2], YES, address(vault)).notional)
                    + _acct(ids[2], NO, address(vault)).notional,
                0,
                "orders left in a settled market"
            );
        }
    }

    function invariant_noIdleTokens() public view {
        eq(usdc.balanceOf(address(vault)) + stock.balanceOf(address(vault)), 0, "idle tokens");
    }
}

contract MultiHandlerWalkTest is MultiMarketInvariantTest {
    event Counters(
        uint256 flows, uint256 placed, uint256 fills, uint256 settled, uint256 violations
    );

    /// @dev 1,500 pseudo-random handler actions per seed; asserts no violation and real activity.
    function testFuzzRandomWalk(uint256 seed) public {
        for (uint256 i; i < 1500; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 a = r % 13;
            uint256 x = r >> 8;
            uint256 y = uint256(keccak256(abi.encode(r)));
            if (a == 0) handler.deposit(x, y, y >> 128);
            else if (a == 1) handler.withdraw(x, y, 0);
            else if (a == 2 || a == 3) handler.quote(x, y, y >> 64, (y >> 200) % 2 == 0);
            else if (a == 4 || a == 5) handler.take(x, y, y >> 64);
            else if (a == 6) handler.merge(x);
            else if (a == 7) handler.donate(x, y, (y >> 200) % 2 == 0);
            else if (a == 8) handler.release(x, y);
            else if (a == 9) handler.pauseToggle(x);
            else if (a == 10) handler.move(int256(y % 601) - 300);
            else if (a == 11) handler.wait(y);
            else if (i > 400 && (x % 3) == 0) handler.resolveAndSettle(y);
            else handler.cancelAll();
        }
        emit Counters(
            handler.flows(),
            handler.placed(),
            handler.fills(),
            handler.settled(),
            handler.violations()
        );
        eq(handler.violations(), 0, "violations");
        eq(handler.withdrawFailures(), 0, "withdraw failures");
        ok(handler.flows() > 50 && handler.placed() > 50 && handler.fills() > 20, "activity");
    }
}
