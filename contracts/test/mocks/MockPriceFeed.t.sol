// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DeltaVault } from "../../src/vault/DeltaVault.sol";
import { DeltaVaultAdmin } from "../../src/vault/DeltaVaultAdmin.sol";
import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { IAggregatorV3 } from "../../src/vault/interfaces/IAggregatorV3.sol";
import { Vm } from "../Base.t.sol";
import { VaultBase } from "../vault/VaultBase.t.sol";
import { MockPriceFeed } from "./MockPriceFeed.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev The testnet mock feed: owner-only, increasing rounds, no future timestamps, and a vault
///      prices from it as from Chainlink.
contract MockPriceFeedTest is VaultBase {
    /// A mainnet round id: phase 1, aggregator round 1406.
    uint80 internal constant ROUND = (1 << 64) + 1406;

    MockPriceFeed internal mock;

    function setUp() public override {
        super.setUp();
        mock = new MockPriceFeed(8, "RHNVDA / USD (testnet mock)", ROUND, 100e8, now_() - 60);
    }

    function testServesTheSeededRound() public view {
        (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredIn) =
            mock.latestRoundData();
        eq(id, ROUND, "round");
        ok(answer == 100e8, "answer");
        eq(startedAt, now_() - 60, "startedAt");
        eq(updatedAt, now_() - 60, "updatedAt");
        eq(answeredIn, ROUND, "answeredInRound");
        eq(mock.decimals(), 8, "decimals");
        ok(mock.owner() == address(this), "owner");
    }

    function testOwnerWritesNewerRoundsAndKeepsHistory() public {
        uint256 t = now_();
        vm.recordLogs();
        mock.update(ROUND + 2, 101e8, t);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        ok(logs.length == 1 && logs[0].topics[0] == MockPriceFeed.AnswerUpdated.selector, "event");
        (uint80 id, int256 answer,, uint256 updatedAt,) = mock.latestRoundData();
        eq(id, ROUND + 2, "latest round");
        ok(answer == 101e8, "latest answer");
        eq(updatedAt, t, "latest updatedAt");
        (, answer,,,) = mock.getRoundData(ROUND);
        ok(answer == 100e8, "earlier round");
        vm.expectRevert(MockPriceFeed.NoDataPresent.selector);
        mock.getRoundData(ROUND + 1);
    }

    function testRejectsOldRoundsFutureTimesAndStrangers() public {
        uint256 t = now_();
        vm.expectRevert(MockPriceFeed.StaleRound.selector);
        mock.update(ROUND, 101e8, t);
        vm.expectRevert(MockPriceFeed.InvalidTimestamp.selector);
        mock.update(ROUND + 1, 101e8, t + 1);
        vm.expectRevert(MockPriceFeed.InvalidTimestamp.selector);
        mock.update(ROUND + 1, 101e8, 0);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        mock.update(ROUND + 1, 101e8, t);
    }

    function testPricesAVault() public {
        DeltaVaultBase.Config memory c = config(address(0));
        c.priceFeed = IAggregatorV3(address(mock));
        DeltaVault v = new DeltaVault(c);
        bytes32 curatorRole = v.CURATOR_ROLE();
        vm.prank(vaultAdmin);
        v.grantRole(curatorRole, curator);
        vm.prank(curator);
        DeltaVaultAdmin(address(v)).setLimits(DeltaVaultBase.Limits(10 minutes, 1 days, 100));
        eq(DeltaVaultAdmin(address(v)).oraclePrice(), SPOT, "$100 in exchange units");

        vm.warp(now_() + 1 days);
        vm.expectRevert(DeltaVaultBase.StaleOracle.selector);
        DeltaVaultAdmin(address(v)).oraclePrice();
        mock.update(ROUND + 1, 150e8, now_());
        eq(DeltaVaultAdmin(address(v)).oraclePrice(), SPOT * 3 / 2, "follows the new round");
    }
}
