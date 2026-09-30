// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice The subset of the `ConditionalStocks` exchange ABI (including the views its admin
///         module serves at the same address) that `DeltaVault` uses. Types mirror
///         `ConditionalStocksBase`.
interface IConditionalStocks {
    struct Terms {
        address base;
        uint8 state;
        uint40 open;
        uint40 cutoff;
        uint128 tick;
        uint96 step;
        uint32 maxSteps;
        uint64 minNotional;
        uint64 maxOrder;
        uint64 maxWallet;
        uint64 maxMarket;
    }

    struct Book {
        uint64 openNotional;
        uint32 seqYes;
        uint32 seqNo;
        uint8 payoutYes;
        uint8 payoutNo;
        uint40 resolvedAt;
        uint32 restYes;
        uint32 restNo;
    }

    struct Account {
        uint96 quote;
        uint96 base;
        uint64 notional;
    }

    struct Order {
        uint96 remaining;
        uint64 ticks;
        uint40 expiry;
        uint16 carry;
        uint16 maxFeeBps;
        uint8 flags;
        address owner;
        uint64 epoch;
        uint32 generation;
    }

    struct Resting {
        uint96 remaining;
        uint64 ticks;
        uint8 flags;
    }

    struct Pool {
        uint128 liability;
        uint8 decimals;
        bool listed;
    }

    // Custody and positions.
    function deposit(address token, uint256 amount) external;
    function withdraw(address token, uint256 amount, address to) external;
    function merge(uint32 id, uint8 collateral, uint256 amount) external;
    function split(uint32 id, uint8 collateral, uint256 amount) external;
    function redeem(uint32 id, uint8 collateral, uint256 yes, uint256 no) external;
    function transferClaim(uint32 id, uint8 branch, uint8 collateral, address to, uint256 amount)
        external;

    // Trading.
    function place(uint256 o, uint256 p, uint256 m) external returns (uint256 key);
    function cancelMany(uint256[] calldata keys) external;
    function invalidateOrders() external;

    // Views.
    function quote() external view returns (address);
    function pool(address token) external view returns (Pool memory);
    function credit(address owner, address token) external view returns (uint256);
    function terms(uint32 id) external view returns (Terms memory);
    function book(uint32 id) external view returns (Book memory);
    function account(uint32 id, uint8 branch, address owner) external view returns (Account memory);
    function order(uint256 key) external view returns (Order memory, address delegate);
    function restingOrders(uint256[] calldata keys) external view returns (Resting[] memory);
}
