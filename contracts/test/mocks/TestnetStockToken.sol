// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { TestnetPermitToken } from "./TestnetToken.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Testnet copy of a Robinhood Stock Token on Robinhood Chain: the mainnet token's name,
///         symbol, 18 decimals, permit domain, `uid`, `terms` and UI multiplier (shares of the
///         underlying per token, 1e18 = one), read from mainnet by
///         scripts/evm/deploy-testnet-tokens.ts. Anyone can mint; only the deployer can schedule
///         a multiplier change, to follow the mainnet token's corporate actions. It has no value
///         and is never deployed on a mainnet.
contract TestnetStockToken is TestnetPermitToken {
    address private immutable OWNER;
    bytes32 public immutable uid;
    string public terms;
    /// @dev The multiplier before `effectiveAt`.
    uint256 private _multiplier;
    uint256 public newUIMultiplier;
    uint256 public effectiveAt;

    error Unauthorized();

    constructor(
        string memory name_,
        string memory symbol_,
        bytes32 uid_,
        string memory terms_,
        uint256 multiplier,
        uint256 newMultiplier,
        uint256 effectiveAt_
    ) TestnetPermitToken(name_, symbol_, 18) {
        OWNER = msg.sender;
        uid = uid_;
        terms = terms_;
        _multiplier = multiplier;
        newUIMultiplier = newMultiplier;
        effectiveAt = effectiveAt_;
    }

    function uiMultiplier() public view returns (uint256) {
        return block.timestamp >= effectiveAt ? newUIMultiplier : _multiplier;
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return Math.mulDiv(balanceOf(account), uiMultiplier(), 1e18);
    }

    function totalSupplyUI() external view returns (uint256) {
        return Math.mulDiv(totalSupply(), uiMultiplier(), 1e18);
    }

    /// @dev The issuer pause the indexer reads; testnet copies never pause.
    function paused() external pure returns (bool) {
        return false;
    }

    /// @notice Schedules `newMultiplier` from `effectiveAt_`; the current one applies until then.
    function updateMultiplier(uint256 newMultiplier, uint256 effectiveAt_) external {
        if (msg.sender != OWNER) revert Unauthorized();
        _multiplier = uiMultiplier();
        newUIMultiplier = newMultiplier;
        effectiveAt = effectiveAt_;
    }
}
