// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { TestnetPermitToken } from "./TestnetToken.sol";

/// @notice Testnet copy of an xStock (Backed's tokenized share) on Monad: the mainnet token's
///         name, symbol, 18 decimals, permit domain, `terms`, `VERSION` and multiplier (shares of
///         the underlying per share of the token, 1e18 = one), read from Monad mainnet by
///         scripts/evm/deploy-testnet-tokens.ts. The mainnet token rebases its balances by the
///         multiplier so that one token tracks one share; the copy's balances are already in
///         shares, so its multiplier is metadata only. Anyone can mint; it has no value and is
///         never deployed on a mainnet.
contract TestnetXStockToken is TestnetPermitToken {
    string public terms;
    string private _version;
    uint256 public immutable multiplier;
    uint256 public immutable newMultiplier;
    uint256 public immutable multiplierNonce;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory terms_,
        string memory version_,
        uint256 multiplier_,
        uint256 newMultiplier_,
        uint256 multiplierNonce_
    ) TestnetPermitToken(name_, symbol_, 18) {
        terms = terms_;
        _version = version_;
        multiplier = multiplier_;
        newMultiplier = newMultiplier_;
        multiplierNonce = multiplierNonce_;
    }

    /// @dev The implementation version the mainnet token reports.
    // forge-lint: disable-next-line(mixed-case-function)
    function VERSION() external view returns (string memory) {
        return _version;
    }

    /// @dev The issuer pause the indexer reads; testnet copies never pause.
    function paused() external pure returns (bool) {
        return false;
    }
}
