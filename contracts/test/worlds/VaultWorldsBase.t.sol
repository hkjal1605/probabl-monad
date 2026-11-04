// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IWorldBooks, WorldQuote } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { WorldVault } from "../../src/worlds/vault/WorldVault.sol";
import { WorldVaultAdmin } from "../../src/worlds/vault/WorldVaultAdmin.sol";
import { WorldVaultBase } from "../../src/worlds/vault/WorldVaultBase.sol";
import { WorldsBase } from "./WorldsBase.t.sol";

/// @dev `WorldsBase` plus a world vault seeded with 1,000,000 USDG, quoting Maya's book.
abstract contract VaultWorldsBase is WorldsBase {
    uint256 internal constant SEED = 1_000_000e6;
    uint16 internal constant ABOVE_240 = 0x70;
    uint16 internal constant BELOW_240 = 0x0E;

    uint256 internal keeperKey = 0x4EE7;
    address internal keeper;
    address internal vaultAdmin = address(0xDA);
    address internal curator = address(0xC5);
    address internal marker = address(0x3A);
    address internal sentinel = address(0x6B);

    WorldVault internal vault;
    /// The module ABI at the vault address.
    WorldVaultAdmin internal ops;
    uint64 internal id;
    uint256 internal vaultNonce;

    function setUp() public virtual override {
        super.setUp();
        keeper = vm.addr(keeperKey);
        vault =
            new WorldVault(IWorldBooks(address(books)), vaultAdmin, 1 days, "World Vault", "wUSDG");
        ops = WorldVaultAdmin(address(vault));
        vm.startPrank(vaultAdmin);
        ops.grantRole(vault.CURATOR_ROLE(), curator);
        ops.grantRole(vault.KEEPER_ROLE(), keeper);
        ops.grantRole(vault.MARKER_ROLE(), marker);
        ops.grantRole(vault.GUARDIAN_ROLE(), sentinel);
        ops.grantRole(vault.DEPOSITOR_ROLE(), alice);
        ops.grantRole(vault.DEPOSITOR_ROLE(), bob);
        ops.setDepositCap(10_000_000e6);
        usdg.mint(vaultAdmin, SEED);
        usdg.approve(address(vault), type(uint256).max);
        vault.seed(SEED);
        vm.stopPrank();
        vm.startPrank(curator);
        ops.setLimits(limits());
        ops.setRisk(risk());
        ops.setFeed(address(feed), true);
        vm.stopPrank();
        id = create(pricedDef());
        for (uint256 i; i < 3; ++i) {
            address u = [alice, bob, carol][i];
            usdg.mint(u, 1_000_000e6);
            vm.prank(u);
            usdg.approve(address(vault), type(uint256).max);
        }
    }

    function limits() internal pure returns (WorldVaultBase.Limits memory) {
        return WorldVaultBase.Limits({
            maxTtl: 300,
            cutoffBuffer: 1 hours,
            maxTenor: 60 days,
            maxLegs: 4,
            maxFeeBps: 200,
            marginBps: 10,
            eventOnly: true
        });
    }

    function risk() internal pure returns (WorldVaultBase.Risk memory) {
        return WorldVaultBase.Risk({
            maxQuoteSize: 100_000e6,
            maxQuotePrice: 100_000e6,
            maxBookRisk: 200_000e6,
            maxLegRisk: 300_000e6,
            maxLossBps: 3000,
            maxDailyExposureBps: 2000
        });
    }

    /// A vault quote: its nonce names the vault; `makerData` its current quote epoch and the
    /// signing time (now).
    function vq(
        uint64 book,
        address taker,
        uint16 mask,
        uint128 units,
        uint128 refund,
        bool sell,
        uint128 price
    ) internal returns (WorldQuote memory q) {
        q = quote(book, taker, mask, units, refund, sell, price);
        q.nonce = uint256(uint160(address(vault))) << 96 | ++vaultNonce;
        q.makerData = makerData(ops.quoteEpoch(), now_());
    }

    function makerData(uint64 epoch, uint256 signedAt) internal pure returns (uint64) {
        return uint64(uint24(epoch)) | uint64(signedAt) << 24;
    }

    /// `q.taker` fills a vault quote signed by `key`.
    function vfill(uint256 key, WorldQuote memory q) internal {
        (bytes32 r, bytes32 vs) = sign(key, q);
        vm.prank(q.taker);
        books.fillQuote(q, r, vs);
    }

    function vrejects(uint256 key, WorldQuote memory q, bytes4 selector) internal {
        (bytes32 r, bytes32 vs) = sign(key, q);
        vm.prank(q.taker);
        vm.expectRevert(selector);
        books.fillQuote(q, r, vs);
    }

    /// Calls the hook as `WorldBooks` would, to see its own error.
    function hookRejects(WorldQuote memory q, uint256 key, uint256 creditBefore, bytes4 selector)
        internal
    {
        (bytes32 r, bytes32 vs) = sign(key, q);
        bytes32 digest = digestOf(q);
        vm.prank(address(books));
        vm.expectRevert(selector);
        ops.onWorldFill(digest, q, r, vs, creditBefore);
    }

    function vaultCredit() internal view returns (uint256) {
        return wb.credit(address(vault));
    }
}
