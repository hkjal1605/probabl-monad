// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IEventOracle } from "../interfaces/IEventOracle.sol";
import { IWorldBooks, WorldQuote } from "../interfaces/IWorldBooks.sol";
import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import {
    ReentrancyGuardTransient
} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Storage layout, types, events and shared accounting of the world vault.
/// @dev `WorldVault` (seed, deposit and redemption batches, claims) and `WorldVaultAdmin` (the
///      maker hook, risk tracking, curation, governance and views, executed by delegatecall from
///      the former) inherit this single layout, which includes the OpenZeppelin share token,
///      roles, pause flag and reentrancy lock. Neither may declare state variables of its own.
abstract contract WorldVaultBase is
    ERC20,
    AccessControlDefaultAdminRules,
    Pausable,
    ReentrancyGuardTransient
{
    // ---------------------------------------------------------------- roles and bounds

    /// @notice Sets eligibility and risk limits.
    bytes32 public constant CURATOR_ROLE = keccak256("CURATOR_ROLE");
    /// @notice Signs the vault's quotes and merges, within the curator's limits.
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    /// @notice Posts each batch's net asset value within its on-chain bounds.
    bytes32 public constant MARKER_ROLE = keccak256("MARKER_ROLE");
    /// @notice Pauses deposits and quoting; approves a mark beyond the move limit.
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    /// @notice May request deposits while deposits are not open to everyone.
    bytes32 public constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");

    /// @notice A batch closes at the earliest this long after it opened.
    uint256 public constant BATCH_PERIOD = 1 days;
    /// @notice A closed batch with no mark this long after closing processes at its guaranteed
    ///         value, so exits never depend on the marker.
    uint256 public constant MARK_TIMEOUT = 3 days;
    uint256 public constant MAX_TTL = 1 days;
    uint256 public constant MAX_CUTOFF_BUFFER = 7 days;
    uint256 public constant MAX_FEE_BPS = 1000;
    uint256 public constant MAX_LEGS = 6;
    uint256 public constant MIN_WITHDRAW_LIMIT_BPS = 1000;
    /// @notice Shares the seed locks forever, as Uniswap V2's minimum liquidity.
    uint256 public constant DEAD_SHARES = 1000;
    uint256 public constant MIN_SEED_SHARES = 1e18;
    address internal constant DEAD = address(0xdEaD);
    uint256 internal constant BPS = 10_000;
    /// @dev Scale of `lastNavPerShare`: raw quote units per share unit x 1e36, so even a tiny value
    ///      per share keeps its precision.
    uint256 internal constant NAV_SCALE = 1e36;

    // WorldBooks `state` values of a decided book.
    uint8 internal constant S_FAILED = 5;
    uint8 internal constant S_FIXED = 7;

    // Batch status.
    uint8 internal constant OPEN = 1;
    uint8 internal constant CLOSED = 2;
    uint8 internal constant PROCESSED = 3;

    // ---------------------------------------------------------------- types

    /// @notice Which quotes the vault signs. `marginBps` keeps every price at least that share of
    ///         the bundle's payout range inside it, so no quote gives a bundle away. A quote lives
    ///         at most `maxTtl` from when the keeper signed it.
    struct Limits {
        uint32 maxTtl;
        uint32 cutoffBuffer;
        /// Furthest decision time (the fixing, or an event-only book's cutoff) from now.
        uint32 maxTenor;
        uint8 maxLegs;
        uint16 maxFeeBps;
        uint16 marginBps;
        /// Whether books without a feed (pure event worlds) are eligible.
        bool eventOnly;
    }

    /// @notice Size and risk caps, in raw quote units.
    ///         - A book's risk is the most the vault can lose in it: the credit it has put into
    ///           the book (`cost`) minus the least the book is sure to return (`lo`).
    ///         - A leg's risk sums the risk of every book that uses it.
    ///         - `maxLossBps` bounds how far the vault's guaranteed value may fall below its
    ///           reference value.
    ///         - `maxDailyExposureBps` bounds, per calendar day, the sum over fills of the most
    ///           value each can move away from the vault whatever the true odds: the payout given
    ///           minus the price on a sale, the price minus the bundle's sure payout on a
    ///           buy-back. That is the most a stolen or broken keeper key can extract in a day,
    ///           so it applies to every fill.
    struct Risk {
        uint128 maxQuoteSize;
        uint128 maxQuotePrice;
        uint128 maxBookRisk;
        uint128 maxLegRisk;
        uint16 maxLossBps;
        uint16 maxDailyExposureBps;
    }

    /// @notice The vault's lowest and highest atom balance in a book as last synced, and the net
    ///         credit it has put into the book (negative once it has taken out more).
    struct Position {
        uint128 lo;
        uint128 hi;
        int256 cost;
    }

    /// @notice A batch of deposit and redemption requests, priced together at one mark.
    struct Batch {
        uint256 depositAssets;
        uint256 redeemShares;
        uint256 guaranteed;
        uint256 best;
        uint256 supply;
        uint256 nav;
        uint256 minted;
        uint256 filled;
        uint256 paid;
        uint40 openedAt;
        uint40 closedAt;
        uint8 status;
        bool refunded;
    }

    /// @notice The exposure the day's fills have used.
    struct Day {
        uint64 day;
        uint192 used;
    }

    // ---------------------------------------------------------------- storage

    IWorldBooks public immutable BOOKS;
    IEventOracle public immutable ORACLE;
    IERC20 public immutable QUOTE;
    /// @notice Shares per raw quote unit at the seed: shares have 18 decimals.
    uint256 internal immutable SHARE_SCALE;

    Limits internal _limits;
    Risk internal _risk;
    mapping(address feed => bool) internal _feeds;
    mapping(uint64 book => Position) internal _positions;
    mapping(bytes32 eventKey => uint256) internal _legRisk;
    uint256 internal _sumLo;
    uint256 internal _sumHi;
    uint64 internal _quoteEpoch;
    Day internal _day;
    /// @notice The value deposit and loss caps are measured against: the last mark, plus the
    ///         deposits and minus the redemptions it processed.
    uint256 internal _refNav;
    uint256 internal _lastNavPerShare;
    uint256 internal _depositCap;
    uint16 internal _withdrawLimitBps;
    uint16 internal _maxMarkMoveBps;
    bool internal _openDeposits;
    /// @dev The batch taking requests, and the closed batch awaiting its mark (zero: none).
    uint64 internal _batchId;
    uint64 internal _closedBatch;
    mapping(uint64 batch => Batch) internal _batches;
    mapping(uint64 batch => mapping(address owner => uint256)) internal _deposits;
    mapping(uint64 batch => mapping(address owner => uint256)) internal _redeems;
    /// @dev A guardian-approved mark plus one (zero: none).
    mapping(uint64 batch => uint256) internal _approvedMarks;
    /// @dev Requested deposits not yet processed, held by the vault.
    uint256 internal _pendingAssets;
    /// @dev Processed redemptions and refunded deposits not yet claimed, held by the vault.
    uint256 internal _owedAssets;
    /// @dev Shares the vault holds for owners: pending redemptions and unclaimed results.
    uint256 internal _escrowShares;

    // ---------------------------------------------------------------- events and errors

    event Seeded(address indexed admin, uint256 assets, uint256 shares);
    event DepositRequested(uint64 indexed batch, address indexed owner, uint256 assets);
    event DepositCancelled(uint64 indexed batch, address indexed owner, uint256 assets);
    event RedeemRequested(uint64 indexed batch, address indexed owner, uint256 shares);
    event RedeemCancelled(uint64 indexed batch, address indexed owner, uint256 shares);
    event BatchClosed(uint64 indexed batch, uint256 guaranteed, uint256 best, uint256 supply);
    event MarkApproved(uint64 indexed batch, uint256 nav);
    event BatchProcessed(
        uint64 indexed batch,
        uint256 nav,
        uint256 minted,
        uint256 filled,
        uint256 paid,
        bool refunded,
        bool floor
    );
    event Claimed(uint64 indexed batch, address indexed owner, uint256 shares, uint256 assets);
    event PositionSynced(uint64 indexed book, uint256 lo, uint256 hi, int256 cost);
    event QuoteEpochAdvanced(uint64 epoch);
    event LimitsSet(Limits limits);
    event RiskSet(Risk risk);
    event FeedSet(address indexed feed, bool allowed);
    event DepositCapSet(uint256 cap);
    event OpenDepositsSet(bool open);
    event WithdrawLimitSet(uint16 bps);
    event MaxMarkMoveSet(uint16 bps);

    error InvalidConfig();
    error InvalidAmount();
    error InvalidLimits();
    error RoleConflict();
    error Unauthorized();
    error SeedRequired();
    error AlreadySeeded();
    error NotDepositor();
    error CapExceeded();
    error BatchState();
    error NothingToClaim();
    error MarkBounds();
    error MarkMove();
    error QuoteSigner();
    error QuoteEpoch();
    error IneligibleBook();
    error QuoteExpiry();
    error LegJustResolved();
    error QuoteSize();
    error QuotePrice();
    error BookRisk();
    error LegRisk();
    error LossCap();
    error DailyExposure();
    error UnknownBook();

    constructor(
        IWorldBooks books,
        address admin,
        uint48 adminDelay,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) AccessControlDefaultAdminRules(adminDelay, admin) {
        if (address(books).code.length == 0) revert InvalidConfig();
        address quote = books.quote();
        uint256 decimals = IERC20Metadata(quote).decimals();
        if (decimals > 18) revert InvalidConfig();
        BOOKS = books;
        ORACLE = IEventOracle(books.oracle());
        QUOTE = IERC20(quote);
        SHARE_SCALE = 10 ** (18 - decimals);
    }

    // ---------------------------------------------------------------- roles

    /// @dev The quoting key never also marks, curates or administers, and the marking key never
    ///      quotes: a stolen key then reaches only its own bounds.
    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        if (
            (role == KEEPER_ROLE
                    && (hasRole(MARKER_ROLE, account)
                        || hasRole(CURATOR_ROLE, account)
                        || hasRole(DEFAULT_ADMIN_ROLE, account)))
                || (role == MARKER_ROLE && hasRole(KEEPER_ROLE, account))
                || ((role == CURATOR_ROLE || role == DEFAULT_ADMIN_ROLE)
                    && hasRole(KEEPER_ROLE, account))
        ) revert RoleConflict();
        return super._grantRole(role, account);
    }

    // ---------------------------------------------------------------- shared accounting

    /// @dev Re-reads the vault's atoms of `book`, adds `spent` (the credit the vault just put into
    ///      the book; negative when it took credit out) to its cost, and updates its position,
    ///      the running sums and the risk of every leg of the book. Returns the book's risk before
    ///      and after. Atoms reaching the vault any other way (a transfer to it) only raise `lo`,
    ///      so they can only lower the risk.
    function _sync(uint64 book, bytes32[] memory keys, int256 spent)
        internal
        returns (uint256 oldRisk, uint256 newRisk)
    {
        uint256[] memory balances = BOOKS.atoms(book, address(this));
        if (balances.length == 0) revert UnknownBook();
        uint256 lo = type(uint256).max;
        uint256 hi;
        for (uint256 i; i < balances.length; ++i) {
            uint256 v = balances[i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        Position memory p = _positions[book];
        int256 cost = p.cost + spent;
        _sumLo = _sumLo - p.lo + lo;
        _sumHi = _sumHi - p.hi + hi;
        oldRisk = _riskOf(p.cost, p.lo);
        newRisk = _riskOf(cost, lo);
        _moveLegRisk(keys, oldRisk, newRisk);
        _positions[book] = Position(uint128(lo), uint128(hi), cost);
        emit PositionSynced(book, lo, hi, cost);
    }

    /// @dev Drops a decided book the vault has redeemed: nothing in it is at risk any more.
    function _clear(uint64 book, bytes32[] memory keys) internal {
        Position memory p = _positions[book];
        _sumLo -= p.lo;
        _sumHi -= p.hi;
        _moveLegRisk(keys, _riskOf(p.cost, p.lo), 0);
        delete _positions[book];
        emit PositionSynced(book, 0, 0, 0);
    }

    function _moveLegRisk(bytes32[] memory keys, uint256 oldRisk, uint256 newRisk) private {
        if (newRisk == oldRisk) return;
        for (uint256 i; i < keys.length; ++i) {
            _legRisk[keys[i]] = _legRisk[keys[i]] - oldRisk + newRisk;
        }
    }

    function _riskOf(int256 cost, uint256 lo) internal pure returns (uint256) {
        int256 l = SafeCast.toInt256(lo);
        return cost > l ? uint256(cost - l) : 0;
    }

    function _legsOf(uint64 book) internal view returns (bytes32[] memory keys) {
        (keys,) = BOOKS.legs(book);
    }

    /// @dev What a quote's bundle pays at worst and at best, over the book's `count` atoms.
    function _payRange(WorldQuote calldata q, uint256 count)
        internal
        pure
        returns (uint256 minPay, uint256 maxPay)
    {
        minPay = type(uint256).max;
        for (uint256 i; i < count; ++i) {
            uint256 pay = i == 0 ? q.refund : ((uint256(q.mask) >> i) & 1 == 1 ? q.units : 0);
            if (pay < minPay) minPay = pay;
            if (pay > maxPay) maxPay = pay;
        }
    }
}
