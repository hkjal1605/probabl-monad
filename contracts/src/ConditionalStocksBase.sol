// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Storage layout, types, events and shared helpers of the conditional-stocks protocol.
/// @dev `ConditionalStocks` (trading and custody) and `ConditionalStocksAdmin` (governance,
///      delegation, lifecycle and views, executed by delegatecall from the former) inherit this
///      single layout. Neither contract may declare additional state variables.
abstract contract ConditionalStocksBase {
    // ---------------------------------------------------------------- constants

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint16 internal constant MAX_FEE_BPS = 1_000;
    uint256 internal constant MAX_MAKERS = 8;
    /// @dev Placements retained per branch for the crossed-book race check.
    uint256 internal constant RECENT = 16;
    uint64 internal constant ADMIN_DELAY = 2 days;
    uint64 internal constant MAX_GRANT_LIFETIME = 90 days;
    uint256 internal constant MAX_URI = 512;

    uint8 internal constant SCHEDULED = 1;
    uint8 internal constant OPEN = 2;
    uint8 internal constant FROZEN = 3;
    uint8 internal constant AWAITING = 4;
    uint8 internal constant REDEEMABLE = 6;
    uint8 internal constant ARCHIVED = 7;

    uint8 internal constant TRADE = 1;
    uint8 internal constant CANCEL = 2;

    // Stored order flags.
    uint8 internal constant S_SELL = 2;
    uint8 internal constant S_CLAIM = 4;
    uint8 internal constant S_DELEGATED = 16;

    // ---------------------------------------------------------------- errors

    error Unauthorized();
    error InvalidAddress();
    error InvalidTerms();
    error InvalidState();
    error InvalidOrder();
    error NotTrading();
    error Expired();
    error StalePlan();
    error FeeCap();
    error InsufficientFunds();
    error CapExceeded();
    error Commitment();
    error FractionalRedemption();
    error InvalidDelegation();
    error DelegationInactive();
    error DelegateBudget();
    error AdminDelay();
    error TransferFailed();
    error Reentrancy();
    error Overflow();

    // ---------------------------------------------------------------- events

    event Configured(
        address marketAdmin,
        address guardian,
        address resolutionAdmin,
        uint16 makerBps,
        uint16 takerBps
    );
    event AdminProposed(address indexed successor, uint64 acceptableAfter);
    event AdminAccepted(address indexed admin);
    event PauseSet(bool paused, bytes32 reason);
    event PoolListed(address indexed token, uint8 decimals);
    event Deposited(address indexed owner, address indexed token, uint256 amount);
    event Withdrawn(address indexed owner, address indexed token, uint256 amount, address to);
    event MarketCreated(uint32 indexed market, MarketParams params, string metadataUri);
    event MarketState(uint32 indexed market, uint8 state, address actor, bytes32 commitment);
    event MarketResolved(
        uint32 indexed market, uint8 yes, uint8 no, bytes32 evidence, string uri, address actor
    );
    /// @param kind 0 split, 1 merge, 2 redeem. `amount` is the underlying moved.
    event PositionChanged(
        uint32 indexed market,
        address indexed owner,
        uint8 kind,
        uint8 collateral,
        uint256 yes,
        uint256 no,
        uint256 amount
    );
    /// @param asset 1 quote YES, 2 quote NO, 4 base YES, 5 base NO.
    event ClaimTransferred(
        uint32 indexed market, address indexed from, address indexed to, uint8 asset, uint256 amount
    );
    event FeesClaimed(uint32 indexed market, uint8 asset, address to, uint256 amount);
    event OrdersInvalidated(address indexed owner, uint64 epoch);
    event DelegateApproved(
        address indexed owner,
        address indexed delegate,
        uint32 market,
        uint64 epoch,
        uint32 generation,
        uint40 expiresAt,
        uint128 maxOrderQuote,
        uint128 totalQuote,
        uint16 maxFeeBps,
        uint8 permissions
    );
    event DelegateRevoked(address indexed owner, address indexed delegate);
    event DelegatesRevoked(address indexed owner, uint64 epoch);
    /// @param order The packed order word as placed (see `ConditionalStocks.place`).
    /// @param seq Sequence (order id within market and branch) assigned to this placement.
    event OrderPlaced(
        uint32 indexed market, address indexed owner, uint256 order, uint256 seq, address delegate
    );
    /// @param fill quantity(96) | makerSeq(32) << 96 | takerSeq(32) << 128 | branch(8) << 160.
    /// @param amounts quote(128) | buyer price improvement(128) << 128.
    /// @param fees buyer fee in base claims(128) | seller fee in quote claims(128) << 128.
    event Trade(uint32 indexed market, uint256 fill, uint256 amounts, uint256 fees);
    event OrderCancelled(uint32 indexed market, uint256 key);

    // ---------------------------------------------------------------- types

    struct MarketParams {
        address base;
        bytes32 condition;
        uint8 yesIndex;
        uint8 noIndex;
        bytes32 rulesHash;
        bytes32 metadataHash;
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

    /// @dev Immutable terms plus lifecycle state; read by every placement (three slots).
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

    /// @dev Written by every placement (one slot).
    struct Book {
        uint64 openNotional;
        uint32 seqYes;
        uint32 seqNo;
        uint8 payoutYes;
        uint8 payoutNo;
        uint40 resolvedAt;
    }

    /// @dev Underlying locked behind the outstanding claims of one market.
    struct Backing {
        uint128 quote;
        uint128 base;
    }

    /// @dev Fees accrued in claims of one market branch.
    struct Fees {
        uint128 quote;
        uint128 base;
    }

    /// @dev Claims of one owner in one market branch plus the open notional of the owner's
    ///      resting orders on that branch.
    struct Account {
        uint96 quote;
        uint96 base;
        uint64 notional;
    }

    struct Order {
        // slot 0: mutable and hot
        uint96 remaining;
        uint64 ticks;
        uint40 expiry;
        uint16 carry;
        uint16 maxFeeBps;
        uint8 flags;
        // slot 1: immutable
        address owner;
        uint64 epoch;
        uint32 generation;
    }

    struct Trader {
        uint64 epoch;
        uint64 delegationEpoch;
    }

    struct Grant {
        uint32 market;
        uint40 expiresAt;
        uint64 epoch;
        uint32 generation;
        uint16 maxFeeBps;
        uint8 permissions;
        bool revoked;
        uint128 maxOrderQuote;
        uint128 remainingQuote;
    }

    struct Pool {
        uint128 liability;
        uint8 decimals;
        bool listed;
    }

    struct Control {
        address guardian;
        bool paused;
        uint16 makerBps;
        uint16 takerBps;
    }

    // ---------------------------------------------------------------- storage

    address internal immutable QUOTE;

    address internal _admin;
    address internal _pendingAdmin;
    uint64 internal _adminAfter;
    address internal _marketAdmin;
    address internal _resolutionAdmin;
    Control internal _control;
    uint32 internal _marketCount;
    bool transient _locked;

    mapping(address token => Pool) internal _pools;
    mapping(address owner => mapping(address token => uint256)) internal _credit;
    mapping(uint32 market => Terms) internal _terms;
    mapping(uint32 market => Book) internal _books;
    mapping(uint32 market => Backing) internal _backing;
    /// @dev Key: market << 1 | branch.
    mapping(uint256 marketBranch => Fees) internal _fees;
    /// @dev Key: market << 1 | branch.
    mapping(uint256 marketBranch => mapping(address owner => Account)) internal _accounts;
    mapping(uint32 market => bytes32) internal _commitments;
    mapping(uint32 market => bytes32) internal _evidence;
    /// @dev Key: market << 40 | branch << 32 | seq. Only resting orders are stored.
    mapping(uint256 key => Order) internal _orders;
    mapping(uint256 key => address) internal _delegates;
    mapping(address owner => Trader) internal _traders;
    mapping(address owner => mapping(address delegate => Grant)) internal _grants;
    /// @dev Key: (market << 1 | branch) << 3 | (seq % RECENT) / 2. Two 128-bit entries per slot.
    mapping(uint256 => uint256) internal _recent;

    constructor(address quote_) {
        if (quote_.code.length == 0) revert InvalidAddress();
        QUOTE = quote_;
    }

    // ---------------------------------------------------------------- shared helpers

    function _collateral(uint32 id, uint8 collateral) internal view returns (address) {
        address base = _terms[id].base;
        if (base == address(0) || collateral > 1) revert InvalidTerms();
        return collateral == 0 ? QUOTE : base;
    }

    function _claim(
        uint32 id,
        uint256 branch,
        uint256 collateral,
        address owner,
        uint256 amount,
        bool add
    ) internal {
        Account storage a = _accounts[uint256(id) << 1 | branch][owner];
        if (collateral == 0) {
            uint256 value = a.quote;
            if (!add && value < amount) revert InsufficientFunds();
            a.quote = add ? _u96(value + amount) : uint96(value - amount);
        } else {
            uint256 value = a.base;
            if (!add && value < amount) revert InsufficientFunds();
            a.base = add ? _u96(value + amount) : uint96(value - amount);
        }
    }

    function _authorized(Grant memory g, uint64 delegationEpoch, uint32 market, uint8 permission)
        internal
        view
        returns (bool)
    {
        return g.permissions & permission == permission && !g.revoked && g.epoch == delegationEpoch
            && block.timestamp < g.expiresAt && (g.market == 0 || g.market == market);
    }

    function _asset(uint256 branch, uint256 collateral) internal pure returns (uint8) {
        return uint8(3 * collateral + 1 + branch);
    }

    function _payoutDenominator(uint8 yes, uint8 no) internal pure returns (uint256) {
        if ((yes == 1 && no == 0) || (yes == 0 && no == 1)) return 1;
        if (yes == 1 && no == 1) return 2;
        revert InvalidTerms();
    }

    function _quoteUp(uint256 quantity, uint256 price) internal pure returns (uint256) {
        return (quantity * price + WAD - 1) / WAD;
    }

    function _u64(uint256 value) internal pure returns (uint64) {
        if (value > type(uint64).max) revert Overflow();
        return uint64(value);
    }

    function _u96(uint256 value) internal pure returns (uint96) {
        if (value > type(uint96).max) revert Overflow();
        return uint96(value);
    }

    function _u128(uint256 value) internal pure returns (uint128) {
        if (value > type(uint128).max) revert Overflow();
        return uint128(value);
    }
}
