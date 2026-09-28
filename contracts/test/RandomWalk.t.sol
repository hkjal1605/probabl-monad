// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { InvariantTest } from "./Invariant.t.sol";

/// @dev A long deterministic random walk: proves the invariant handler reaches fills.
contract RandomWalkTest is InvariantTest {
    function testRandomWalkFillsAndConserves() public {
        uint256 r = 42;
        for (uint256 i; i < 400; ++i) {
            r = uint256(keccak256(abi.encode(r, i)));
            uint256 action = r % 10;
            if (action < 6) {
                handler.place(r >> 8, uint8(r >> 16), uint64(r >> 32), r >> 96, r >> 128);
            } else if (action == 6) {
                handler.cancel(0, r >> 8);
            } else if (action == 7) {
                handler.split(r >> 8, r & 256 == 0, r >> 64);
            } else if (action == 8) {
                handler.merge(r >> 8, r & 256 == 0, r >> 64);
            } else {
                handler.withdraw(r >> 8, r & 256 == 0, r >> 64);
            }
            if (i % 50 == 49) {
                invariant_tokensAreFullyBacked();
                invariant_claimsEqualBackingOnBothBranches();
                invariant_openNotionalMatchesRestingOrders();
            }
        }
        ok(handler.fills() >= 20, string.concat("fills ", vm.toString(handler.fills())));
    }
}
