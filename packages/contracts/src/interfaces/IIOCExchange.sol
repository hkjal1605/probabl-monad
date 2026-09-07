// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Order } from "../types/ProtocolTypes.sol";
import { IProtocolAuthority } from "./IProtocolAuthority.sol";

interface IIOCExchange {
    function authority() external view returns (IProtocolAuthority);
    function openIOCOrder(
        Order calldata order,
        bytes calldata signature
    ) external returns (bytes32 orderHash);
    function matchIOCOrders(
        Order calldata takerOrder,
        Order calldata makerOrder,
        uint128 fillQuantity
    ) external;
    function cancelIOCRemainder(
        bytes32 orderHash
    ) external;
}
