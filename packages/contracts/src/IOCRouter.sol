// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IIOCExchange } from "./interfaces/IIOCExchange.sol";
import { IProtocolAuthority } from "./interfaces/IProtocolAuthority.sol";
import { ProtocolRoles } from "./libraries/ProtocolRoles.sol";
import { Order, TimeInForce } from "./types/ProtocolTypes.sol";
import { ProtocolAccess } from "./utils/ProtocolAccess.sol";

/// @notice Executes bounded immediate-or-cancel orders atomically across open makers.
contract IOCRouter is ProtocolAccess, ReentrancyGuard {
    error InvalidAddress();
    error InvalidIOC();

    uint256 public constant MAX_IOC_MAKERS = 32;

    IIOCExchange public immutable exchange;

    constructor(
        IIOCExchange exchange_,
        IProtocolAuthority authority_
    ) ProtocolAccess(authority_) {
        if (address(exchange_) == address(0) || address(exchange_).code.length == 0) {
            revert InvalidAddress();
        }
        if (address(exchange_.authority()) != address(authority_)) revert InvalidAddress();
        exchange = exchange_;
    }

    function executeIOC(
        Order calldata takerOrder,
        bytes calldata takerSignature,
        Order[] calldata makerOrders,
        uint128[] calldata fillQuantities
    )
        external
        nonReentrant
        onlyProtocolRole(ProtocolRoles.MATCHER_ROLE)
        returns (bytes32 takerOrderHash)
    {
        uint256 makerCount = makerOrders.length;
        if (
            takerOrder.tif != TimeInForce.IOC || makerCount != fillQuantities.length
                || makerCount > MAX_IOC_MAKERS
        ) revert InvalidIOC();

        takerOrderHash = exchange.openIOCOrder(takerOrder, takerSignature);
        for (uint256 i; i < makerCount; ++i) {
            if (makerOrders[i].tif != TimeInForce.GTC) revert InvalidIOC();
            exchange.matchIOCOrders(takerOrder, makerOrders[i], fillQuantities[i]);
        }
        exchange.cancelIOCRemainder(takerOrderHash);
    }
}
