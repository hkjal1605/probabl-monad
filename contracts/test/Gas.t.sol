// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksAdmin } from "../src/ConditionalStocksAdmin.sol";
import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";
import { Base } from "./Base.t.sol";

/// @dev Typical trading transactions. Run with `forge test --match-contract GasTest --isolate
///      --gas-report` so every call is its own cold-state transaction.
contract GasTest is Base {
    uint256 internal constant NVDA = 1e18;
    /// @dev An RFQ maker's signing key.
    uint256 internal constant QUOTER = 0xA11CE5;
    uint256[8] internal asks;

    function setUp() public override {
        super.setUp();
        useFees(5, 10);
        // A rebate prices its path in: makers get a quarter of each taker fee.
        useRebate(2_500);
        for (uint256 i; i < 4; ++i) {
            address user = [bob, carol, bot, admin][i];
            if (user == admin) fund(admin, 1_000_000e6, 10_000e18);
            vm.prank(user);
            ConditionalStocksAdmin(address(cs)).split(market, 1, 100 * NVDA);
            vm.prank(user);
            ConditionalStocksAdmin(address(cs)).split(market, 0, 100_000e6);
        }
        // Alice is an active trader: her claim accounts and the fee slots already exist.
        uint256 warm = rest(bob, YES, true, true, 19_000, NVDA);
        take(alice, YES, false, false, 19_000, NVDA / 10, one(uint32(warm)));
        uint256 warmBid = rest(carol, NO, false, false, 10_000, NVDA);
        take(alice, NO, true, false, 10_000, NVDA / 10, one(uint32(warmBid)));
        vm.prank(alice);
        ConditionalStocksAdmin(address(cs)).split(market, 0, 1_000e6);
        for (uint256 i; i < 8; ++i) {
            address maker = [bob, carol, bot, admin][i % 4];
            asks[i] = rest(maker, YES, true, true, uint64(20_000 + i), NVDA);
        }
        // An active RFQ maker: claims on the branch and its nonce word (0) already in use.
        address quoter = vm.addr(QUOTER);
        fund(quoter, 1_000_000e6, 10_000e18);
        vm.prank(quoter);
        ConditionalStocksAdmin(address(cs)).split(market, 1, 100 * NVDA);
        takeQuotes(alice, YES, false, false, 20_000, NVDA / 10, _quote(0, NVDA / 10), 0);
    }

    function _quote(uint256 nonce, uint256 fill)
        internal
        view
        returns (ConditionalStocksBase.Quote[] memory list)
    {
        list = new ConditionalStocksBase.Quote[](1);
        list[0] = signedQuote(QUOTER, alice, YES, true, true, 20_000, 10 * NVDA, nonce, fill);
    }

    /// @dev A market buy filled by one RFQ quote (the maker's nonce word already in use).
    function testGasMarketBuyOneQuote() public {
        takeQuotes(alice, YES, false, false, 21_000, NVDA, _quote(1, NVDA), 0);
    }

    /// @dev The same with the first nonce of a new word (one fill in 256 with sequential nonces).
    function testGasMarketBuyOneQuoteNewNonceWord() public {
        takeQuotes(alice, YES, false, false, 21_000, NVDA, _quote(256, NVDA), 0);
    }

    /// @dev One quote and one resting maker in the same market buy.
    function testGasMarketBuyQuoteAndMaker() public {
        takeQuotes(
            alice, YES, false, false, 21_000, 2 * NVDA, _quote(1, NVDA), one(uint32(asks[0]))
        );
    }

    /// @dev A 1-click market buy filled by one quote, as the server submits it.
    function testGasDelegatedMarketBuyOneQuote() public {
        vm.prank(alice);
        view_.approveDelegate(
            bot, 0, uint40(T0 + 7 days), 1_000_000e6, 10_000_000e6, 1_000e18, 10_000e18, 100, 1
        );
        O memory o = O(market, YES, false, false, true, 100, uint40(T0 + 1 days), 21_000, NVDA);
        uint256 p = plan(seqOf(market, YES), now_() + 60, 0);
        ConditionalStocksBase.Quote[] memory list = _quote(1, NVDA);
        vm.prank(bot);
        cs.placeWithQuotes(alice, pack(o), p, 0, list);
    }

    function testGasRestingBidWholeFunded() public {
        rest(alice, NO, false, false, 15_000, NVDA);
    }

    function testGasRestingAskClaimFunded() public {
        rest(bob, NO, true, true, 25_000, NVDA);
    }

    function testGasMarketBuyOneMakerPartial() public {
        take(alice, YES, false, false, 21_000, NVDA / 2, one(uint32(asks[0])));
    }

    function testGasMarketBuyOneMakerFull() public {
        take(alice, YES, false, false, 21_000, NVDA, one(uint32(asks[0])));
    }

    function testGasMarketBuyFourMakers() public {
        uint256[] memory seqs = new uint256[](4);
        for (uint256 i; i < 4; ++i) {
            seqs[i] = uint32(asks[i]);
        }
        take(alice, YES, false, false, 21_000, 4 * NVDA, makers(seqs));
    }

    function testGasMarketBuyEightMakers() public {
        uint256[] memory seqs = new uint256[](8);
        for (uint256 i; i < 8; ++i) {
            seqs[i] = uint32(asks[i]);
        }
        take(alice, YES, false, false, 21_000, 8 * NVDA, makers(seqs));
    }

    function testGasClaimFundedBuyOneMaker() public {
        take(alice, YES, false, true, 21_000, NVDA, one(uint32(asks[0])));
    }

    /// @dev A trader's second resting order (the first one enrolls it).
    function testGasRestingBidReturningTrader() public {
        rest(alice, NO, false, false, 15_000, NVDA);
        rest(alice, NO, false, false, 15_001, NVDA);
    }

    /// @dev A 1-click (delegated) market buy against one maker, as the server submits it.
    function testGasDelegatedMarketBuyOneMaker() public {
        vm.prank(alice);
        view_.approveDelegate(
            bot, 0, uint40(T0 + 7 days), 1_000_000e6, 10_000_000e6, 1_000e18, 10_000e18, 100, 1
        );
        O memory o = O(market, YES, false, false, true, 100, uint40(T0 + 1 days), 21_000, NVDA);
        uint256 p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.prank(bot);
        cs.placeFor(alice, pack(o), p, one(uint32(asks[0])));
    }

    function testGasCancelBid() public {
        uint256 k = rest(carol, NO, false, false, 9_000, NVDA);
        vm.prank(carol);
        cs.cancel(k);
    }

    function testGasCancel() public {
        vm.prank(bob);
        cs.cancel(asks[0]);
    }

    function testGasCustody() public {
        usdc.mint(alice, 100e6);
        vm.startPrank(alice);
        cs.deposit(address(usdc), 100e6);
        cs.withdraw(address(usdc), 50e6, alice);
        ConditionalStocksAdmin(address(cs)).split(market, 0, 10e6);
        ConditionalStocksAdmin(address(cs)).merge(market, 0, 5e6);
        vm.stopPrank();
    }
}
