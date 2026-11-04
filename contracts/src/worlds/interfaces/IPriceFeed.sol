// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice The part of Chainlink's AggregatorV3Interface a book's fixing reads.
interface IPriceFeed {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (
            uint80 round,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    function getRoundData(uint80 roundId)
        external
        view
        returns (
            uint80 round,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
