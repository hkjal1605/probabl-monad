// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DeltaVault } from "../../src/vault/DeltaVault.sol";
import { DeltaVaultAdmin } from "../../src/vault/DeltaVaultAdmin.sol";
import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { IAggregatorV3 } from "../../src/vault/interfaces/IAggregatorV3.sol";
import { IConditionalStocks } from "../../src/vault/interfaces/IConditionalStocks.sol";
import { Base } from "../Base.t.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev A Chainlink-style feed whose round is set by the test.
contract MockFeed {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function set(int256 answer_, uint256 startedAt_, uint256 updatedAt_) external {
        answer = answer_;
        startedAt = startedAt_;
        updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, updatedAt, 1);
    }
}

/// @dev The exchange of `Base` plus a seeded NVDA vault quoting its market: 100,000 USDC and
///      1,000 NVDA at a $100 oracle price, a 10% band and a 200 NVDA imbalance cap.
abstract contract VaultBase is Base {
    uint256 internal constant NVDA = 1e18;
    /// $100 in exchange price units (raw USDC per raw NVDA x 1e18) and in ticks.
    uint256 internal constant SPOT = 100e6;
    uint64 internal constant SPOT_TICKS = 10_000;
    uint256 internal constant SEED_QUOTE = 100_000e6;
    uint256 internal constant SEED_BASE = 1000e18;

    address internal vaultAdmin = address(0xDA);
    address internal curator = address(0xC5);
    address internal keeper = address(0xEE);
    address internal sentinel = address(0x6B);

    DeltaVault internal vault;
    /// The module ABI at the vault address.
    DeltaVaultAdmin internal ops;
    MockFeed internal feed;

    function setUp() public virtual override {
        super.setUp();
        feed = new MockFeed(8);
        feed.set(100e8, now_(), now_());
        vault = new DeltaVault(config(address(0)));
        ops = DeltaVaultAdmin(address(vault));
        vm.startPrank(vaultAdmin);
        vault.grantRole(vault.CURATOR_ROLE(), curator);
        vault.grantRole(vault.KEEPER_ROLE(), keeper);
        vault.grantRole(vault.GUARDIAN_ROLE(), sentinel);
        ops.setCaps(10_000_000e6, 100_000e18);
        vm.stopPrank();
        vm.startPrank(curator);
        ops.setLimits(DeltaVaultBase.Limits(10 minutes, 1 days + 1 hours, 100));
        ops.addMarket(market, risk());
        vm.stopPrank();
        give(vaultAdmin, SEED_QUOTE, SEED_BASE);
        vm.prank(vaultAdmin);
        vault.deposit(SEED_QUOTE, SEED_BASE, 0, vaultAdmin);
    }

    function config(address sequencer) internal view returns (DeltaVaultBase.Config memory) {
        return DeltaVaultBase.Config({
            exchange: IConditionalStocks(address(cs)),
            base: IERC20(address(stock)),
            priceFeed: IAggregatorV3(address(feed)),
            sequencerFeed: IAggregatorV3(sequencer),
            admin: vaultAdmin,
            adminDelay: 2 days,
            name: "Probabl Delta Vault NVDA",
            symbol: "dvNVDA"
        });
    }

    function risk() internal pure returns (DeltaVaultBase.Risk memory) {
        return DeltaVaultBase.Risk({
            bandBps: 1000,
            cutoffBuffer: 1 hours,
            maxOrder: 50_000e6,
            maxResting: 200_000e6,
            maxImbalance: uint96(200 * NVDA)
        });
    }

    /// @dev Wallet tokens approved for the vault.
    function give(address user, uint256 quoteAmount, uint256 baseAmount) internal {
        usdc.mint(user, quoteAmount);
        stock.mint(user, baseAmount);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        stock.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ quoting

    /// @dev A resting vault order in the default market, valid for five minutes.
    function vo(uint8 branch, bool sell, bool claim, uint64 ticks, uint256 qty)
        internal
        view
        returns (DeltaVaultBase.Placement memory)
    {
        O memory o =
            O(market, branch, sell, claim, false, 50, uint40(now_() + 5 minutes), ticks, qty);
        return DeltaVaultBase.Placement(pack(o), plan(seqOf(market, branch), now_() + 60, 0));
    }

    function quote(DeltaVaultBase.Placement[] memory places)
        internal
        returns (uint256[] memory keys)
    {
        vm.prank(keeper);
        keys = ops.update(market, new uint256[](0), places);
    }

    function quote1(DeltaVaultBase.Placement memory p) internal returns (uint256) {
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](1);
        places[0] = p;
        return quote(places)[0];
    }

    function cancel1(uint256 key) internal {
        uint256[] memory keys = new uint256[](1);
        keys[0] = key;
        vm.prank(keeper);
        ops.update(market, keys, new DeltaVaultBase.Placement[](0));
    }

    /// @dev `taker` fills `qty` of the vault's resting order `key` from exchange credit.
    function fill(address taker, uint256 key, uint256 qty) internal {
        (IConditionalStocks.Order memory o,) = IConditionalStocks(address(cs)).order(key);
        bool sell = o.flags & 2 != 0;
        take(taker, uint8((key >> 32) & 1), !sell, false, o.ticks, qty, one(uint32(key)));
    }

    // ------------------------------------------------------------ accounting helpers

    /// @dev Per-world holdings: [quote if YES, quote if NO, base if YES, base if NO].
    function worlds(DeltaVaultBase.Holdings memory h) internal pure returns (uint256[4] memory w) {
        w = [h.quote, h.quote, h.base, h.base];
        for (uint256 i; i < h.claims.length; ++i) {
            w[0] += h.claims[i].yesQuote;
            w[1] += h.claims[i].noQuote;
            w[2] += h.claims[i].yesBase;
            w[3] += h.claims[i].noBase;
        }
    }

    /// @dev What `user` owns of the default market's world holdings outside the vault: wallet
    ///      tokens, exchange credit and exchange claims.
    function wealth(address user) internal view returns (uint256[4] memory w) {
        uint256 q = usdc.balanceOf(user) + credit(user, address(usdc));
        uint256 b = stock.balanceOf(user) + credit(user, address(stock));
        IConditionalStocks.Account memory yes =
            IConditionalStocks(address(cs)).account(market, 0, user);
        IConditionalStocks.Account memory no =
            IConditionalStocks(address(cs)).account(market, 1, user);
        w = [q + yes.quote, q + no.quote, b + yes.base, b + no.base];
    }

    function supply() internal view returns (uint256) {
        return vault.totalSupply();
    }
}
