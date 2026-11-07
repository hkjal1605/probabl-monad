// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Outcomes of venue events (Polymarket and Kalshi), shared by every world book.
/// @dev States: 0 unknown, 1 frozen, 2 committed, 3 YES, 4 NO, 5 INVALID. Only 3, 4 and 5 are
///      final. `resolvedAt` is zero until then.
interface IEventOracle {
    function outcome(bytes32 key) external view returns (uint8 state, uint40 resolvedAt);

    function outcomes(bytes32[] calldata keys)
        external
        view
        returns (uint8[] memory states, uint40[] memory resolvedAt);
}
