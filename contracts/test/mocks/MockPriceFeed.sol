// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Testnet stand-in for a Chainlink price feed: Chainlink publishes no stock feeds on
///         Robinhood Chain testnet. It serves `AggregatorV3Interface` with rounds only its owner
///         writes; scripts/evm/feed-mirror.ts copies each new round of the stock's mainnet feed,
///         round ids included. Deployed by scripts/evm/deploy-mock-feeds.ts, never on a mainnet.
contract MockPriceFeed is Ownable {
    struct Round {
        int192 answer;
        uint64 updatedAt;
    }

    uint256 public constant version = 1;
    uint8 public immutable decimals;
    string public description;
    uint80 public latestRound;
    mapping(uint80 roundId => Round) internal _rounds;

    /// @dev Chainlink's `AggregatorInterface` event.
    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    error StaleRound();
    error InvalidTimestamp();
    error NoDataPresent();

    constructor(
        uint8 decimals_,
        string memory description_,
        uint80 roundId,
        int256 answer,
        uint256 updatedAt
    ) Ownable(msg.sender) {
        decimals = decimals_;
        description = description_;
        _update(roundId, answer, updatedAt);
    }

    /// @notice Writes round `roundId`, which must follow the latest. `updatedAt` must not lie in
    ///         the future, as consumers reject such rounds.
    function update(uint80 roundId, int256 answer, uint256 updatedAt) external onlyOwner {
        _update(roundId, answer, updatedAt);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return getRoundData(latestRound);
    }

    function getRoundData(uint80 roundId)
        public
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        Round memory r = _rounds[roundId];
        if (r.updatedAt == 0) revert NoDataPresent();
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }

    function _update(uint80 roundId, int256 answer, uint256 updatedAt) internal {
        if (roundId <= latestRound) revert StaleRound();
        if (updatedAt == 0 || updatedAt > block.timestamp) revert InvalidTimestamp();
        latestRound = roundId;
        _rounds[roundId] = Round(SafeCast.toInt192(answer), uint64(updatedAt));
        emit AnswerUpdated(answer, roundId, updatedAt);
    }
}
