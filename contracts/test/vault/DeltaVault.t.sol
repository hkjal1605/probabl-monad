// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DeltaVault } from "../../src/vault/DeltaVault.sol";
import { DeltaVaultAdmin } from "../../src/vault/DeltaVaultAdmin.sol";
import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { IConditionalStocks } from "../../src/vault/interfaces/IConditionalStocks.sol";
import { VaultBase } from "./VaultBase.t.sol";
import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

/// @dev Share accounting: seeding, in-kind deposits and withdrawals, caps and rate limits.
contract DeltaVaultTest is VaultBase {
    function _holdings() internal view returns (DeltaVaultBase.Holdings memory) {
        return ops.holdings();
    }

    /// @dev Three fills leave the vault unpaired claims on both branches of both collaterals:
    ///      it sells 10 NVDA-if-YES at $103 (alice), buys 5 NVDA-if-NO at $97 (bob) and buys
    ///      3 NVDA-if-YES at $99 (bob). A whole-funded order keeps the inactive branch of what it
    ///      paid: claims end at 1,515 USDC-if-YES, 297 USDC-if-NO, 3 NVDA-if-YES, 15 NVDA-if-NO.
    function _trade() internal {
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](3);
        places[0] = vo(YES, true, false, 10_300, 10 * NVDA);
        places[1] = vo(NO, false, false, 9700, 5 * NVDA);
        places[2] = vo(YES, false, false, 9900, 3 * NVDA);
        uint256[] memory keys = quote(places);
        fill(alice, keys[0], 10 * NVDA);
        fill(bob, keys[1], 5 * NVDA);
        fill(bob, keys[2], 3 * NVDA);
    }

    /// @dev Per-world holdings per share must not fall: after * supplyBefore >= before * after.
    function _noDilution(uint256[4] memory before, uint256 s0, uint256[4] memory next, uint256 s1)
        internal
        pure
    {
        for (uint256 i; i < 4; ++i) {
            ok(next[i] * s0 >= before[i] * s1, "per-share holdings fell");
        }
    }

    // ------------------------------------------------------------ seeding

    function testSeedMintsSqrtSharesAndLocksDeadShares() public view {
        eq(supply(), 1e22, "sqrt(100,000 x 1,000) in 18-decimal units");
        eq(vault.balanceOf(address(0xdEaD)), 1000, "dead shares");
        eq(vault.balanceOf(vaultAdmin), 1e22 - 1000, "seeder");
        eq(credit(address(vault), address(usdc)), SEED_QUOTE, "quote credit");
        eq(credit(address(vault), address(stock)), SEED_BASE, "base credit");
        eq(usdc.balanceOf(address(vault)) + stock.balanceOf(address(vault)), 0, "no idle tokens");
    }

    function testOnlyTheAdminSeeds() public {
        DeltaVault fresh = new DeltaVault(config(address(0)));
        vm.prank(vaultAdmin);
        DeltaVaultAdmin(address(fresh)).setCaps(type(uint128).max, type(uint128).max);
        give(alice, 1000e6, 10 * NVDA);
        vm.startPrank(alice);
        usdc.approve(address(fresh), type(uint256).max);
        stock.approve(address(fresh), type(uint256).max);
        vm.expectRevert(DeltaVaultBase.SeedRequired.selector);
        fresh.deposit(1000e6, 10 * NVDA, 0, alice);
        vm.stopPrank();
    }

    function testSeedNeedsBothAssetsAndMinimumSize() public {
        DeltaVault fresh = new DeltaVault(config(address(0)));
        vm.prank(vaultAdmin);
        DeltaVaultAdmin(address(fresh)).setCaps(type(uint128).max, type(uint128).max);
        give(vaultAdmin, 1000e6, 10 * NVDA);
        vm.startPrank(vaultAdmin);
        usdc.approve(address(fresh), type(uint256).max);
        stock.approve(address(fresh), type(uint256).max);
        vm.expectRevert(DeltaVaultBase.InvalidAmount.selector);
        fresh.deposit(1000e6, 0, 0, vaultAdmin);
        // sqrt(1e12 x 1e5) in 18-decimal units is below the 1e9 minimum.
        vm.expectRevert(DeltaVaultBase.InvalidAmount.selector);
        fresh.deposit(1, 1e5, 0, vaultAdmin);
        vm.stopPrank();
    }

    function testReseedAfterEveryHolderLeft() public {
        uint256 all = vault.balanceOf(vaultAdmin);
        vm.prank(vaultAdmin);
        vault.withdraw(all, 0, 0, vaultAdmin, vaultAdmin);
        eq(supply(), 1000, "only dead shares");
        give(alice, 1000e6, 10 * NVDA);
        vm.expectRevert(DeltaVaultBase.SeedRequired.selector);
        vm.prank(alice);
        vault.deposit(1000e6, 10 * NVDA, 0, alice);
        // The admin re-seeds at a new ratio; the dead shares keep a negligible fraction.
        give(vaultAdmin, 50_000e6, 100 * NVDA);
        vm.prank(vaultAdmin);
        (uint256 shares,,) = vault.deposit(50_000e6, 100 * NVDA, 0, vaultAdmin);
        eq(shares, 2_236_067_977_499_789_696_409, "sqrt(50,000 x 100)");
    }

    // ------------------------------------------------------------ deposits

    function testDepositTakesTheSameFractionOfEveryHolding() public {
        give(alice, 10_000e6, 500 * NVDA);
        uint256 s0 = supply();
        uint256[4] memory before = worlds(_holdings());
        vm.prank(alice);
        (uint256 shares, uint256 quoteIn, uint256 baseIn) =
            vault.deposit(10_000e6, 500 * NVDA, 0, alice);
        // The quote budget binds: one raw unit is reserved for rounding.
        eq(shares, (10_000e6 - 1) * s0 / SEED_QUOTE, "shares");
        eq(quoteIn, (SEED_QUOTE * shares + s0 - 1) / s0, "quote rounded up");
        eq(baseIn, (SEED_BASE * shares + s0 - 1) / s0, "base rounded up");
        eq(usdc.balanceOf(alice), 10_000e6 - quoteIn, "unused quote stays");
        eq(stock.balanceOf(alice), 500 * NVDA - baseIn, "unused base stays");
        eq(vault.balanceOf(alice), shares, "minted");
        _noDilution(before, s0, worlds(_holdings()), supply());
    }

    function testDepositHandsBackTheComplementOfUnpairedClaims() public {
        _trade();
        DeltaVaultBase.Holdings memory h = _holdings();
        eq(h.quote, SEED_QUOTE - 485e6 - 297e6, "plain quote");
        eq(h.base, SEED_BASE - 10 * NVDA, "plain base");
        eq(h.claims[0].yesQuote, 1515e6, "quote if YES");
        eq(h.claims[0].noQuote, 297e6, "quote if NO");
        eq(h.claims[0].yesBase, 3 * NVDA, "stock if YES");
        eq(h.claims[0].noBase, 15 * NVDA, "stock if NO");

        give(carol, 100_000e6, 1000 * NVDA);
        uint256 s0 = supply();
        uint256[4] memory before = worlds(h);
        (uint256 previewShares, uint256 previewQuote, uint256 previewBase,) =
            vault.previewDeposit(20_000e6, 1000 * NVDA);
        vm.prank(carol);
        (uint256 shares, uint256 quoteIn, uint256 baseIn) =
            vault.deposit(20_000e6, 1000 * NVDA, 0, carol);
        eq(shares, previewShares, "preview shares");
        eq(quoteIn, previewQuote, "preview quote");
        eq(baseIn, previewBase, "preview base");

        // Carol paid the richer branch of each collateral and received the other side back.
        uint256 yesQuote = (1515e6 * shares + s0 - 1) / s0;
        uint256 noQuote = (297e6 * shares + s0 - 1) / s0;
        uint256 yesBase = (3 * NVDA * shares + s0 - 1) / s0;
        uint256 noBase = (15 * NVDA * shares + s0 - 1) / s0;
        eq(quoteIn, (h.quote * shares + s0 - 1) / s0 + yesQuote, "quote paid");
        eq(baseIn, (h.base * shares + s0 - 1) / s0 + noBase, "base paid");
        eq(acct(carol, NO).quote, yesQuote - noQuote, "quote-if-NO complement");
        eq(acct(carol, YES).base, noBase - yesBase, "stock-if-YES complement");
        eq(acct(carol, YES).quote + acct(carol, NO).base, 0, "nothing else");
        _noDilution(before, s0, worlds(_holdings()), supply());
    }

    function testDepositSlippageAndCaps() public {
        give(alice, 1_000_000e6, 10_000 * NVDA);
        vm.startPrank(alice);
        (uint256 expected,,,) = vault.previewDeposit(10_000e6, 500 * NVDA);
        vm.expectRevert(DeltaVaultBase.Slippage.selector);
        vault.deposit(10_000e6, 500 * NVDA, expected + 1, alice);
        vm.expectRevert(DeltaVaultBase.Slippage.selector);
        vault.deposit(0, 500 * NVDA, 0, alice);
        vm.stopPrank();

        vm.prank(vaultAdmin);
        ops.setCaps(150_000e6, 100_000e18);
        vm.expectRevert(DeltaVaultBase.CapExceeded.selector);
        vm.prank(alice);
        vault.deposit(60_000e6, 10_000 * NVDA, 0, alice);
        vm.prank(alice);
        vault.deposit(40_000e6, 10_000 * NVDA, 0, alice);
    }

    function testDepositRejectsTransferFeesAndBadReceivers() public {
        give(alice, 10_000e6, 100 * NVDA);
        stock.setFee(10);
        vm.expectRevert(DeltaVaultBase.UnsupportedToken.selector);
        vm.prank(alice);
        vault.deposit(10_000e6, 100 * NVDA, 0, alice);
        stock.setFee(0);
        address[3] memory bad = [address(0), address(vault), address(cs)];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(DeltaVaultBase.InvalidReceiver.selector);
            vm.prank(alice);
            vault.deposit(10_000e6, 100 * NVDA, 0, bad[i]);
        }
    }

    // ------------------------------------------------------------ withdrawals

    function testWithdrawPaysTheSameFractionOfEveryHolding() public {
        uint256 shares = vault.balanceOf(vaultAdmin) / 10;
        uint256 s0 = supply();
        uint256[4] memory before = worlds(_holdings());
        vm.prank(vaultAdmin);
        (uint256 quoteOut, uint256 baseOut) = vault.withdraw(shares, 0, 0, carol, vaultAdmin);
        eq(quoteOut, SEED_QUOTE * shares / s0, "quote rounded down");
        eq(baseOut, SEED_BASE * shares / s0, "base rounded down");
        eq(usdc.balanceOf(carol), quoteOut, "quote tokens to the receiver");
        eq(stock.balanceOf(carol), baseOut, "base tokens to the receiver");
        _noDilution(before, s0, worlds(_holdings()), supply());
    }

    function testWithdrawMergesPairedClaimsAndTransfersTheRest() public {
        _trade();
        DeltaVaultBase.Holdings memory h = _holdings();
        uint256 shares = vault.balanceOf(vaultAdmin) / 4;
        uint256 s0 = supply();
        (uint256 previewQuote, uint256 previewBase, DeltaVaultBase.Claims[] memory claims) =
            vault.previewWithdraw(shares);
        vm.prank(vaultAdmin);
        (uint256 quoteOut, uint256 baseOut) = vault.withdraw(shares, 0, 0, carol, vaultAdmin);
        eq(quoteOut, previewQuote, "preview quote");
        eq(baseOut, previewBase, "preview base");

        uint256 yesQuote = 1515e6 * shares / s0;
        uint256 noQuote = 297e6 * shares / s0;
        uint256 yesBase = 3 * NVDA * shares / s0;
        uint256 noBase = 15 * NVDA * shares / s0;
        eq(quoteOut, h.quote * shares / s0 + noQuote, "plain quote plus merged pairs");
        eq(baseOut, h.base * shares / s0 + yesBase, "plain base plus merged pairs");
        eq(usdc.balanceOf(carol), quoteOut, "quote tokens");
        eq(stock.balanceOf(carol), baseOut, "base tokens");
        eq(acct(carol, YES).quote, yesQuote - noQuote, "unpaired quote-if-YES");
        eq(acct(carol, NO).base, noBase - yesBase, "unpaired stock-if-NO");
        eq(acct(carol, NO).quote + acct(carol, YES).base, 0, "paired sides merged");
        eq(claims[0].yesQuote, yesQuote - noQuote, "preview quote claims");
        eq(claims[0].noBase, noBase - yesBase, "preview stock claims");
    }

    function testWithdrawCancelsOrdersOnlyWhenTheirEscrowIsNeeded() public {
        // Bids reserve 39,400 of the 100,000 USDC.
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](2);
        places[0] = vo(YES, false, false, 9900, 200 * NVDA);
        places[1] = vo(NO, false, false, 9800, 200 * NVDA);
        uint256[] memory keys = quote(places);
        eq(credit(address(vault), address(usdc)), SEED_QUOTE - 19_800e6 - 19_600e6, "free");

        uint256 small = vault.balanceOf(vaultAdmin) / 10;
        vm.prank(vaultAdmin);
        vault.withdraw(small, 0, 0, carol, vaultAdmin);
        (IConditionalStocks.Order memory o,) = IConditionalStocks(address(cs)).order(keys[0]);
        ok(o.remaining != 0, "small withdrawal keeps quotes");
        eq(ops.orders(market).length, 2, "still tracked");

        uint256 large = vault.balanceOf(vaultAdmin) * 8 / 10;
        (uint256 expected,,) = vault.previewWithdraw(large);
        ok(expected > credit(address(vault), address(usdc)), "needs escrow");
        uint256 before = usdc.balanceOf(carol);
        vm.prank(vaultAdmin);
        (uint256 quoteOut,) = vault.withdraw(large, 0, 0, carol, vaultAdmin);
        eq(quoteOut, expected, "paid in full");
        eq(usdc.balanceOf(carol) - before, expected, "received");
        (o,) = IConditionalStocks(address(cs)).order(keys[0]);
        eq(o.remaining, 0, "escrow released");
        eq(ops.orders(market).length, 0, "untracked");
    }

    function testWithdrawNeverPausedAndUsesAllowance() public {
        vm.prank(sentinel);
        ops.pause();
        vm.prank(guardian);
        view_.pause(true, bytes32("incident"));
        uint256 shares = vault.balanceOf(vaultAdmin) / 10;

        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, bob, 0, shares)
        );
        vm.prank(bob);
        vault.withdraw(shares, 0, 0, bob, vaultAdmin);

        vm.prank(vaultAdmin);
        vault.approve(bob, shares);
        vm.prank(bob);
        (uint256 quoteOut,) = vault.withdraw(shares, 0, 0, bob, vaultAdmin);
        ok(quoteOut > 0 && usdc.balanceOf(bob) == quoteOut, "paid while both are paused");
        eq(vault.allowance(vaultAdmin, bob), 0, "allowance spent");
    }

    function testWithdrawSlippageAndReceivers() public {
        uint256 shares = vault.balanceOf(vaultAdmin) / 10;
        (uint256 quoteOut, uint256 baseOut,) = vault.previewWithdraw(shares);
        vm.startPrank(vaultAdmin);
        vm.expectRevert(DeltaVaultBase.Slippage.selector);
        vault.withdraw(shares, quoteOut + 1, 0, vaultAdmin, vaultAdmin);
        vm.expectRevert(DeltaVaultBase.Slippage.selector);
        vault.withdraw(shares, 0, baseOut + 1, vaultAdmin, vaultAdmin);
        vm.expectRevert(DeltaVaultBase.InvalidAmount.selector);
        vault.withdraw(0, 0, 0, vaultAdmin, vaultAdmin);
        vm.expectRevert(DeltaVaultBase.InvalidReceiver.selector);
        vault.withdraw(shares, 0, 0, address(cs), vaultAdmin);
        vault.withdraw(shares, quoteOut, baseOut, vaultAdmin, vaultAdmin);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ withdrawal window

    function testWithdrawLimitCountsNetOutflowPerWindow() public {
        vm.prank(vaultAdmin);
        ops.setWithdrawLimit(1000);
        // The seed deposit's inflow offsets outflow in its own window; start a fresh one.
        vm.warp(now_() + 1 days);
        uint256 s0 = supply();
        uint256 tenth = s0 / 10;
        vm.startPrank(vaultAdmin);
        vault.withdraw(tenth, 0, 0, vaultAdmin, vaultAdmin);
        vm.expectRevert(DeltaVaultBase.WithdrawLimit.selector);
        vault.withdraw(1, 0, 0, vaultAdmin, vaultAdmin);
        vm.stopPrank();
        eq(ops.withdrawable(), 0, "window used");

        // A deposit and withdrawal of the same shares never consumes the window.
        give(alice, 50_000e6, 500 * NVDA);
        vm.startPrank(alice);
        (uint256 shares,,) = vault.deposit(50_000e6, 500 * NVDA, 0, alice);
        vault.withdraw(shares, 0, 0, alice, alice);
        vm.stopPrank();

        vm.warp(now_() + 1 days);
        uint256 allowed = supply() / 10;
        eq(ops.withdrawable(), allowed, "a new window");
        vm.prank(vaultAdmin);
        vault.withdraw(allowed, 0, 0, vaultAdmin, vaultAdmin);
    }

    // ------------------------------------------------------------ round trips (fuzz)

    function testFuzzRoundTripNeverProfits(uint96 quoteBudget, uint96 baseBudget, bool trade)
        public
    {
        if (trade) _trade();
        uint256 q = 1e6 + uint256(quoteBudget) % 5_000_000e6;
        uint256 b = 1e15 + uint256(baseBudget) % (50_000 * NVDA);
        give(carol, q, b);
        uint256[4] memory start = wealth(carol);
        uint256 s0 = supply();
        uint256[4] memory h0 = worlds(_holdings());

        vm.startPrank(carol);
        try vault.deposit(q, b, 1, carol) returns (uint256 shares, uint256, uint256) {
            _noDilution(h0, s0, worlds(_holdings()), supply());
            uint256 s1 = supply();
            uint256[4] memory h1 = worlds(_holdings());
            vault.withdraw(shares, 0, 0, carol, carol);
            _noDilution(h1, s1, worlds(_holdings()), supply());
        } catch (bytes memory reason) {
            // Budgets too small for one share (or past the cap) must fail cleanly.
            ok(
                bytes4(reason) == DeltaVaultBase.Slippage.selector
                    || bytes4(reason) == DeltaVaultBase.CapExceeded.selector,
                "unexpected deposit failure"
            );
        }
        vm.stopPrank();

        uint256[4] memory end = wealth(carol);
        for (uint256 i; i < 4; ++i) {
            ok(end[i] <= start[i], "round trip profited in some world");
            // Rounding costs at most a few raw units per term.
            ok(start[i] - end[i] <= 4, "round trip lost more than rounding");
        }
    }

    function testFuzzWithdrawalNeverDilutes(uint256 fraction, bool trade) public {
        if (trade) _trade();
        uint256 shares = 1 + fraction % vault.balanceOf(vaultAdmin);
        uint256 s0 = supply();
        uint256[4] memory before = worlds(_holdings());
        vm.prank(vaultAdmin);
        try vault.withdraw(shares, 0, 0, carol, vaultAdmin) {
            _noDilution(before, s0, worlds(_holdings()), supply());
        } catch (bytes memory reason) {
            ok(bytes4(reason) == DeltaVaultBase.WithdrawLimit.selector, "unexpected failure");
        }
    }
}
