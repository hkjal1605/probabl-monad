// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet stand-in for USDG, the quote token of Robinhood Chain deployments: the testnet
///         has no USDG with usable liquidity. A plain 6-decimal ERC-20 that anyone can mint; it
///         has no value. Deployed by scripts/evm/deploy-mock-usdg.ts, never on a mainnet.
contract MockUSDG is ERC20 {
    constructor() ERC20("Global Dollar (testnet mock)", "USDG") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
