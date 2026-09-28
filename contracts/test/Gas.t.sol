// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Base } from "./Base.t.sol";

/// @dev Typical trading transactions. Run with `forge test --match-contract GasTest --isolate
///      --gas-report` so every call is its own cold-state transaction.
contract GasTest is Base {
    uint256 internal constant NVDA = 1e18;
    uint256[8] internal asks;

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        view_.configure(marketAdmin, guardian, resolver, 5, 10);
        for (uint256 i; i < 4; ++i) {
            address user = [bob, carol, bot, admin][i];
            if (user == admin) fund(admin, 1_000_000e6, 10_000e18);
            vm.prank(user);
            cs.split(market, 1, 100 * NVDA);
            vm.prank(user);
            cs.split(market, 0, 100_000e6);
        }
        // Alice is an active trader: her claim accounts and the fee slots already exist.
        uint256 warm = rest(bob, YES, true, true, 19_000, NVDA);
        take(alice, YES, false, false, 19_000, NVDA / 10, one(uint32(warm)));
        uint256 warmBid = rest(carol, NO, false, false, 10_000, NVDA);
        take(alice, NO, true, false, 10_000, NVDA / 10, one(uint32(warmBid)));
        vm.prank(alice);
        cs.split(market, 0, 1_000e6);
        for (uint256 i; i < 8; ++i) {
            address maker = [bob, carol, bot, admin][i % 4];
            asks[i] = rest(maker, YES, true, true, uint64(20_000 + i), NVDA);
        }
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

    function testGasCancel() public {
        vm.prank(bob);
        cs.cancel(asks[0]);
    }

    function testGasCustody() public {
        usdc.mint(alice, 100e6);
        vm.startPrank(alice);
        cs.deposit(address(usdc), 100e6);
        cs.withdraw(address(usdc), 50e6, alice);
        cs.split(market, 0, 10e6);
        cs.merge(market, 0, 5e6);
        vm.stopPrank();
    }
}
