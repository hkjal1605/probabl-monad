// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Testnet stand-in for a token with no usable testnet copy (cbBTC, SOL, …), carrying the
///         name, symbol and decimals of the token it mirrors. A plain ERC-20 that anyone can mint;
///         it has no value. Deployed by scripts/evm/deploy-testnet-tokens.ts, never on a mainnet.
contract TestnetToken is ERC20 {
    uint8 private immutable DECIMALS;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        DECIMALS = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice A `TestnetToken` with EIP-2612 permits under the domain (name, "1"), for mirrored
///         tokens that have them on mainnet (WETH, Robinhood Stock Tokens).
contract TestnetPermitToken is TestnetToken, ERC20Permit {
    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        TestnetToken(name_, symbol_, decimals_)
        ERC20Permit(name_)
    { }

    function decimals() public view override(ERC20, TestnetToken) returns (uint8) {
        return TestnetToken.decimals();
    }
}
