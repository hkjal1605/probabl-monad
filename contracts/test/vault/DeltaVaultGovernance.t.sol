// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksBase } from "../../src/ConditionalStocksBase.sol";
import { DeltaVault } from "../../src/vault/DeltaVault.sol";
import { DeltaVaultAdmin } from "../../src/vault/DeltaVaultAdmin.sol";
import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { IAggregatorV3 } from "../../src/vault/interfaces/IAggregatorV3.sol";
import { IConditionalStocks } from "../../src/vault/interfaces/IConditionalStocks.sol";
import { MockToken } from "../Base.t.sol";
import { MockFeed, VaultBase } from "./VaultBase.t.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import {
    IAccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/IAccessControlDefaultAdminRules.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Deployment checks, roles, curation, limits, settlement and module isolation.
contract DeltaVaultGovernanceTest is VaultBase {
    bytes32 internal constant EVIDENCE = keccak256("evidence");
    string internal constant URI = "https://evidence.example/packet";

    function _resolve(uint8 yes, uint8 no) internal {
        vm.prank(guardian);
        view_.lifecycle(market, 1, keccak256("event ended"));
        bytes32 commitment = view_.resolutionHash(market, yes, no, EVIDENCE, URI);
        vm.prank(marketAdmin);
        view_.lifecycle(market, 3, commitment);
        vm.prank(resolver);
        view_.resolve(market, yes, no, EVIDENCE, URI);
    }

    function _unauthorized(address who, bytes32 role) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, who, role
            )
        );
    }

    /// @dev The vault holds 1,515 USDC-if-YES, 297 USDC-if-NO, 3 NVDA-if-YES and 15 NVDA-if-NO,
    ///      plus a resting YES ask.
    function _position() internal returns (uint256 ask) {
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](4);
        places[0] = vo(YES, true, false, 10_300, 10 * NVDA);
        places[1] = vo(NO, false, false, 9700, 5 * NVDA);
        places[2] = vo(YES, false, false, 9900, 3 * NVDA);
        places[3] = vo(YES, true, false, 10_400, 7 * NVDA);
        uint256[] memory keys = quote(places);
        fill(alice, keys[0], 10 * NVDA);
        fill(bob, keys[1], 5 * NVDA);
        fill(bob, keys[2], 3 * NVDA);
        return keys[3];
    }

    // ------------------------------------------------------------ deployment

    function testConstructorValidatesConfiguration() public {
        DeltaVaultBase.Config memory c = config(address(0));
        c.base = IERC20(address(usdc));
        vm.expectRevert(DeltaVaultBase.InvalidConfig.selector);
        new DeltaVault(c);

        c = config(address(0));
        c.base = IERC20(address(new MockToken("TSLA", 18)));
        vm.expectRevert(DeltaVaultBase.InvalidConfig.selector);
        new DeltaVault(c);

        c = config(address(0));
        c.priceFeed = IAggregatorV3(address(0x1234));
        vm.expectRevert(DeltaVaultBase.InvalidConfig.selector);
        new DeltaVault(c);

        c = config(address(0x1234));
        vm.expectRevert(DeltaVaultBase.InvalidConfig.selector);
        new DeltaVault(c);

        c = config(address(0));
        c.priceFeed = IAggregatorV3(address(new MockFeed(19)));
        vm.expectRevert(DeltaVaultBase.InvalidConfig.selector);
        new DeltaVault(c);

        MockToken wide = new MockToken("WIDE", 24);
        vm.prank(marketAdmin);
        view_.listPool(address(wide), bytes32("US:WIDE"));
        c = config(address(0));
        c.base = IERC20(address(wide));
        vm.expectRevert(DeltaVaultBase.InvalidConfig.selector);
        new DeltaVault(c);

        c = config(address(0));
        c.admin = address(0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControlDefaultAdminRules.AccessControlInvalidDefaultAdmin.selector,
                address(0)
            )
        );
        new DeltaVault(c);
    }

    function testEightDecimalStockAndFeedScaling() public {
        // A B20-style 8-decimal stock token priced by an 8-decimal feed at $250.
        MockToken b20 = new MockToken("NVDAc", 8);
        vm.prank(marketAdmin);
        view_.listPool(address(b20), bytes32("US:NVDA"));
        MockFeed price = new MockFeed(8);
        price.set(250e8, now_(), now_());
        DeltaVaultBase.Config memory c = config(address(0));
        c.base = IERC20(address(b20));
        c.priceFeed = IAggregatorV3(address(price));
        DeltaVault v = new DeltaVault(c);
        vm.startPrank(vaultAdmin);
        v.grantRole(v.CURATOR_ROLE(), curator);
        vm.stopPrank();
        vm.prank(curator);
        DeltaVaultAdmin(address(v)).setLimits(DeltaVaultBase.Limits(60, 60, 0));
        // $250 per 1e8 raw units: 250e6 raw USDC x 1e18 / 1e8 raw = 2.5e18.
        eq(DeltaVaultAdmin(address(v)).oraclePrice(), 25e17, "exchange units");
    }

    // ------------------------------------------------------------ roles

    function testRolesAndDelayedAdminTransfer() public {
        ok(vault.hasRole(vault.KEEPER_ROLE(), keeper), "keeper");
        ok(vault.hasRole(vault.CURATOR_ROLE(), curator), "curator");
        ok(vault.hasRole(vault.GUARDIAN_ROLE(), sentinel), "guardian");
        eq(uint160(vault.owner()), uint160(vaultAdmin), "admin");

        bytes32 keeperRole = vault.KEEPER_ROLE();
        _unauthorized(alice, bytes32(0));
        vm.prank(alice);
        vault.grantRole(keeperRole, alice);

        vm.prank(vaultAdmin);
        vault.beginDefaultAdminTransfer(alice);
        vm.warp(now_() + 2 days - 1);
        vm.expectRevert();
        vm.prank(alice);
        vault.acceptDefaultAdminTransfer();
        vm.warp(now_() + 2);
        vm.prank(alice);
        vault.acceptDefaultAdminTransfer();
        eq(uint160(vault.owner()), uint160(alice), "transferred after the delay");
    }

    function testGovernanceSettersCheckRolesAndBounds() public {
        _unauthorized(alice, vault.CURATOR_ROLE());
        vm.prank(alice);
        ops.setLimits(DeltaVaultBase.Limits(60, 60, 0));
        DeltaVaultBase.Limits[] memory bad = new DeltaVaultBase.Limits[](5);
        bad[0] = DeltaVaultBase.Limits(0, 60, 0);
        bad[1] = DeltaVaultBase.Limits(1 days + 1, 60, 0);
        bad[2] = DeltaVaultBase.Limits(60, 0, 0);
        bad[3] = DeltaVaultBase.Limits(60, 3 days + 1, 0);
        bad[4] = DeltaVaultBase.Limits(60, 60, 1001);
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(DeltaVaultBase.InvalidConfig.selector);
            vm.prank(curator);
            ops.setLimits(bad[i]);
        }
        vm.prank(curator);
        ops.setLimits(DeltaVaultBase.Limits(1 days, 3 days, 1000));
        eq(ops.limits().maxOracleAge, 3 days, "limits");

        _unauthorized(curator, bytes32(0));
        vm.prank(curator);
        ops.setCaps(1, 1);
        vm.prank(vaultAdmin);
        ops.setCaps(5e12, 7e22);
        (uint128 quoteCap, uint128 baseCap) = ops.caps();
        eq(quoteCap, 5e12, "quote cap");
        eq(baseCap, 7e22, "base cap");

        eq(ops.withdrawLimitBps(), 10_000, "unlimited by default");
        vm.startPrank(vaultAdmin);
        vm.expectRevert(DeltaVaultBase.InvalidConfig.selector);
        ops.setWithdrawLimit(999);
        vm.expectRevert(DeltaVaultBase.InvalidConfig.selector);
        ops.setWithdrawLimit(10_001);
        ops.setWithdrawLimit(1000);
        vm.stopPrank();
        eq(ops.withdrawLimitBps(), 1000, "withdraw limit");

        _unauthorized(alice, vault.GUARDIAN_ROLE());
        vm.prank(alice);
        ops.pause();
    }

    // ------------------------------------------------------------ curation

    function testAddMarketValidation() public {
        DeltaVaultBase.Risk memory r = risk();
        _unauthorized(alice, vault.CURATOR_ROLE());
        vm.prank(alice);
        ops.addMarket(market, r);
        vm.expectRevert(DeltaVaultBase.InvalidConfig.selector);
        vm.prank(curator);
        ops.addMarket(market, r);

        // Another stock's market.
        MockToken tsla = new MockToken("TSLA", 18);
        vm.prank(marketAdmin);
        view_.listPool(address(tsla), bytes32("US:TSLA"));
        ConditionalStocksBase.MarketParams memory p = params(uint40(T0 - 1), uint40(T0 + 30 days));
        p.base = address(tsla);
        vm.prank(marketAdmin);
        uint32 other = view_.createMarket(p, "ipfs://metadata");
        vm.expectRevert(DeltaVaultBase.UnknownMarket.selector);
        vm.prank(curator);
        ops.addMarket(other, r);

        // A frozen market, and one past its cutoff.
        uint32 frozen = createMarket(uint40(T0 - 1), uint40(T0 + 2 days));
        vm.prank(guardian);
        view_.lifecycle(frozen, 1, keccak256("halt"));
        vm.expectRevert(DeltaVaultBase.UnknownMarket.selector);
        vm.prank(curator);
        ops.addMarket(frozen, r);
        uint32 soon = createMarket(uint40(T0 - 1), uint40(T0 + 1 hours));
        vm.warp(T0 + 1 hours);
        vm.expectRevert(DeltaVaultBase.UnknownMarket.selector);
        vm.prank(curator);
        ops.addMarket(soon, r);

        uint32 next = createMarket(uint40(T0 - 1), uint40(T0 + 20 days));
        DeltaVaultBase.Risk[] memory bad = new DeltaVaultBase.Risk[](4);
        for (uint256 i; i < bad.length; ++i) {
            bad[i] = risk();
        }
        bad[0].bandBps = 0;
        bad[1].bandBps = 5001;
        bad[2].maxOrder = bad[2].maxResting + 1;
        bad[3].cutoffBuffer = 7 days + 1;
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(DeltaVaultBase.InvalidConfig.selector);
            vm.prank(curator);
            ops.addMarket(next, bad[i]);
        }
        vm.prank(curator);
        ops.addMarket(next, r);
        DeltaVaultBase.Market memory m = ops.market(next);
        ok(m.listed && m.tick == TICK && m.cutoff == T0 + 20 days, "cached terms");

        // At most eight markets.
        for (uint256 i; i < 6; ++i) {
            uint32 id = createMarket(uint40(T0 - 1), uint40(T0 + 20 days));
            vm.prank(curator);
            ops.addMarket(id, r);
        }
        eq(ops.markets().length, 8, "full");
        uint32 ninth = createMarket(uint40(T0 - 1), uint40(T0 + 20 days));
        vm.expectRevert(DeltaVaultBase.MarketLimit.selector);
        vm.prank(curator);
        ops.addMarket(ninth, r);
    }

    function testRemoveMarketRequiresAFlatPosition() public {
        uint256 ask = _position();
        vm.expectRevert(DeltaVaultBase.OpenPosition.selector);
        vm.prank(curator);
        ops.removeMarket(market);
        (IConditionalStocks.Order memory live,) = IConditionalStocks(address(cs)).order(ask);
        eq(live.remaining, 7 * NVDA, "the revert keeps the ask");

        // A market with only resting quotes is dropped and its quotes cancelled.
        uint32 fresh = createMarket(uint40(T0 - 1), uint40(T0 + 20 days));
        vm.prank(marketAdmin);
        view_.lifecycle(fresh, 0, bytes32(0));
        vm.prank(curator);
        ops.addMarket(fresh, risk());
        O memory o = O(fresh, YES, true, false, false, 50, uint40(now_() + 5 minutes), 10_100, NVDA);
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](1);
        places[0] = DeltaVaultBase.Placement(pack(o), plan(seqOf(fresh, YES), now_() + 60, 0));
        vm.prank(keeper);
        uint256 k = ops.update(fresh, new uint256[](0), places)[0];
        vm.prank(curator);
        ops.removeMarket(fresh);
        eq(ops.markets().length, 1, "removed");
        ok(!ops.market(fresh).listed, "forgotten");
        (IConditionalStocks.Order memory resting,) = IConditionalStocks(address(cs)).order(k);
        eq(resting.remaining, 0, "quote cancelled");
    }

    // ------------------------------------------------------------ settlement

    function testSettleRedeemsResolvedClaimsForAnyone() public {
        uint256 ask = _position();
        vm.expectRevert(DeltaVaultBase.NotResolved.selector);
        ops.settle(market);

        uint256 quoteBefore = credit(address(vault), address(usdc));
        uint256 baseBefore = credit(address(vault), address(stock));
        _resolve(1, 0);
        vm.prank(carol);
        ops.settle(market);
        // YES wins: quote-if-YES and stock-if-YES redeem; the ask's 7 NVDA escrow returns.
        eq(credit(address(vault), address(usdc)), quoteBefore + 1515e6, "quote redeemed");
        eq(credit(address(vault), address(stock)), baseBefore + 7 * NVDA + 3 * NVDA, "base");
        eq(acct(address(vault), YES).quote + acct(address(vault), NO).quote, 0, "quote claims");
        eq(acct(address(vault), YES).base + acct(address(vault), NO).base, 0, "base claims");
        eq(ops.markets().length, 0, "dropped");
        eq(ops.orders(market).length, 0, "orders released");
        (IConditionalStocks.Order memory o,) = IConditionalStocks(address(cs)).order(ask);
        eq(o.remaining, 0, "ask cancelled");

        // Shares now represent plain tokens only.
        uint256 shares = vault.balanceOf(vaultAdmin) / 2;
        vm.prank(vaultAdmin);
        vault.withdraw(shares, 0, 0, vaultAdmin, vaultAdmin);
        vm.expectRevert(DeltaVaultBase.UnknownMarket.selector);
        ops.settle(market);
    }

    function testSettleInvalidRedeemsHalvesAndLeavesAnOddUnit() public {
        _position();
        // A one-unit claim donation makes the stock claims odd: 3 NVDA + 1 raw if YES, 15 if NO.
        vm.startPrank(alice);
        cs.split(market, 1, 1);
        view_.transferClaim(market, YES, 1, address(vault), 1);
        vm.stopPrank();
        uint256 quoteBefore = credit(address(vault), address(usdc));
        uint256 baseBefore = credit(address(vault), address(stock));
        _resolve(1, 1);
        ops.settle(market);
        eq(credit(address(vault), address(usdc)), quoteBefore + (1515e6 + 297e6) / 2, "half");
        eq(credit(address(vault), address(stock)), baseBefore + 7 * NVDA + 9 * NVDA, "half");
        eq(acct(address(vault), NO).base, 1, "the odd unit stays behind");
        eq(ops.markets().length, 0, "dropped");
    }

    // ------------------------------------------------------------ module isolation

    function testModuleCalledDirectlyOnlyTouchesItsOwnStorage() public {
        DeltaVaultAdmin module = DeltaVaultAdmin(vault.module());
        eq(module.markets().length, 0, "empty module storage");
        (uint128 quoteCap,) = module.caps();
        eq(quoteCap, 0, "no caps");
        // Its own admin can write its own storage, never the vault's.
        vm.prank(vaultAdmin);
        module.setCaps(1, 1);
        (quoteCap,) = ops.caps();
        eq(quoteCap, 10_000_000e6, "vault caps untouched");
        _unauthorized(sentinel, vault.GUARDIAN_ROLE());
        vm.prank(sentinel);
        module.pause();
    }

    function testUnknownMarketViews() public {
        vm.expectRevert(DeltaVaultBase.UnknownMarket.selector);
        ops.exposure(99);
        eq(ops.oraclePrice(), SPOT, "oracle price in exchange units");
    }
}
