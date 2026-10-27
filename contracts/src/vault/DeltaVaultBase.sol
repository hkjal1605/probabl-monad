// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IAggregatorV3 } from "./interfaces/IAggregatorV3.sol";
import { IConditionalStocks } from "./interfaces/IConditionalStocks.sol";
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
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Storage layout, types, events and shared accounting of the Δ-vault.
/// @dev `DeltaVault` (shares, deposits and withdrawals) and `DeltaVaultAdmin` (quoting,
///      settlement, curation, governance and views, executed by delegatecall from the former)
///      inherit this single layout, which includes the OpenZeppelin share token, roles, pause
///      flag and reentrancy lock. Neither may declare state variables of its own.
abstract contract DeltaVaultBase is
    ERC20,
    AccessControlDefaultAdminRules,
    Pausable,
    ReentrancyGuardTransient
{
    // ---------------------------------------------------------------- roles and bounds

    /// @notice Registers markets and sets quoting limits.
    bytes32 public constant CURATOR_ROLE = keccak256("CURATOR_ROLE");
    /// @notice Posts and cancels the vault's quotes within the curator's limits.
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    /// @notice Pauses deposits and quoting.
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    /// @dev Deposits and withdrawals are in kind across every registered market, so their gas
    ///      grows with this bound (about 0.1M per market with claims): 48 keeps an LP's exit far
    ///      below a block's gas (VaultMarketLimit.t.sol).
    uint256 public constant MAX_MARKETS = 48;
    uint256 public constant MAX_ORDERS = 48;
    uint256 public constant MAX_BAND_BPS = 5000;
    uint256 public constant MAX_CUTOFF_BUFFER = 7 days;
    uint256 public constant MAX_TTL = 1 days;
    uint256 public constant MAX_ORACLE_AGE = 3 days;
    uint256 public constant MAX_FEE_BPS = 1000;
    uint256 public constant MIN_WITHDRAW_LIMIT_BPS = 1000;
    uint256 public constant WITHDRAW_WINDOW = 1 days;
    uint256 public constant SEQUENCER_GRACE = 1 hours;
    /// @notice Shares the first deposit locks forever, as Uniswap V2's minimum liquidity.
    uint256 public constant DEAD_SHARES = 1000;
    uint256 public constant MIN_INITIAL_SHARES = 1e9;
    address internal constant DEAD = address(0xdEaD);
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;

    // Exchange encodings: market states, stored order flags and order-word flags.
    uint8 internal constant SCHEDULED = 1;
    uint8 internal constant OPEN = 2;
    uint8 internal constant REDEEMABLE = 6;
    uint8 internal constant ARCHIVED = 7;
    uint8 internal constant SELL = 2;
    uint8 internal constant CLAIM = 4;
    uint256 internal constant IOC = 8;

    // ---------------------------------------------------------------- types

    /// @notice Deployment parameters.
    /// @param priceFeed Chainlink feed of one whole `base` token in USD; the quote token is taken
    ///        to be worth one USD.
    /// @param sequencerFeed Chainlink L2 sequencer-uptime feed, or zero where the chain has none.
    /// @param adminDelay Delay of every admin transfer (OpenZeppelin default-admin rules).
    struct Config {
        IConditionalStocks exchange;
        IERC20 base;
        IAggregatorV3 priceFeed;
        IAggregatorV3 sequencerFeed;
        address admin;
        uint48 adminDelay;
        string name;
        string symbol;
    }

    /// @notice Quoting limits of one market. Notionals are raw quote units; the imbalance is
    ///         raw base units.
    struct Risk {
        /// Largest distance of an order price from the oracle price, in bps of the latter.
        uint16 bandBps;
        /// Quoting stops (and every order expires) this long before the market cutoff.
        uint32 cutoffBuffer;
        /// Largest notional of one order.
        uint64 maxOrder;
        /// Largest notional of all the vault's resting orders in the market.
        uint64 maxResting;
        /// Largest YES-minus-NO stock position, either sign, with every resting order filled.
        uint96 maxImbalance;
    }

    struct Market {
        Risk risk;
        uint128 tick;
        uint40 cutoff;
        bool listed;
    }

    /// @notice Limits on every order.
    struct Limits {
        uint32 maxTtl;
        uint32 maxOracleAge;
        uint16 maxFeeBps;
    }

    /// @notice Claims of one market per branch and collateral.
    struct Claims {
        uint256 yesQuote;
        uint256 noQuote;
        uint256 yesBase;
        uint256 noBase;
    }

    /// @notice Everything the vault owns on the exchange. `quote` and `base` are plain credit
    ///         plus the escrow of whole-funded orders, `claims` include the escrow of
    ///         claim-funded orders, and the `free` fields exclude all escrow.
    struct Holdings {
        uint256 quote;
        uint256 base;
        uint256 freeQuote;
        uint256 freeBase;
        uint32[] markets;
        Claims[] claims;
        Claims[] free;
    }

    /// @notice Stock exposure of one market.
    struct Exposure {
        /// YES minus NO stock held, including claim-funded escrow.
        int256 imbalance;
        /// The imbalance if every resting order that raises it (YES bids, NO asks) filled.
        int256 high;
        /// The imbalance if every resting order that lowers it (YES asks, NO bids) filled.
        int256 low;
        /// Notional of the vault's resting orders.
        uint256 resting;
        /// Whether a vault bid rests at or above a vault ask of the same branch.
        bool crossed;
    }

    /// @notice An order word and plan word as `ConditionalStocks.place` takes them.
    struct Placement {
        uint256 order;
        uint256 plan;
    }

    /// @dev Running totals of a market's exposure over its live orders.
    struct Tally {
        int256 imbalance;
        uint256 raise;
        uint256 lower;
        uint256[2] bid;
        uint256[2] ask;
    }

    /// @dev Share flows of the current withdrawal window. Full-width fields: no supply, however
    ///      large, can make recording a flow (and so a withdrawal) revert.
    struct Window {
        uint256 start;
        uint256 supply;
        uint256 outflow;
        uint256 inflow;
    }

    // ---------------------------------------------------------------- storage

    IConditionalStocks public immutable EXCHANGE;
    IERC20 public immutable QUOTE;
    IERC20 public immutable BASE;
    /// @notice Chainlink USD price of one whole base token.
    IAggregatorV3 public immutable PRICE_FEED;
    /// @notice Chainlink L2 sequencer-uptime feed; zero where the chain has none.
    IAggregatorV3 public immutable SEQUENCER_FEED;
    uint256 internal immutable PRICE_NUMERATOR;
    uint256 internal immutable PRICE_DENOMINATOR;
    uint256 internal immutable QUOTE_TO_WAD;
    uint256 internal immutable BASE_TO_WAD;

    Limits internal _limits;
    uint128 internal _quoteCap;
    uint128 internal _baseCap;
    uint16 internal _withdrawLimitBps;
    Window internal _window;
    uint32[] internal _marketIds;
    mapping(uint32 market => Market) internal _markets;
    /// @dev Keys of the vault's resting orders; entries closed on the exchange are pruned lazily.
    mapping(uint32 market => uint256[] keys) internal _orders;

    // ---------------------------------------------------------------- events and errors

    event Deposited(
        address indexed sender,
        address indexed receiver,
        uint256 shares,
        uint256 quoteIn,
        uint256 baseIn
    );
    event Withdrawn(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 shares,
        uint256 quoteOut,
        uint256 baseOut
    );
    event Quoted(uint32 indexed market, uint256 cancelled, uint256[] placed);
    event MarketAdded(uint32 indexed market, Risk risk);
    event RiskSet(uint32 indexed market, Risk risk);
    event MarketRemoved(uint32 indexed market);
    event LimitsSet(Limits limits);
    event CapsSet(uint128 quoteCap, uint128 baseCap);
    event WithdrawLimitSet(uint16 bps);
    /// @notice A withdrawal paid `amount` of collateral as YES and NO claims of `market` because
    ///         the token refused the transfer; merging them returns exchange credit.
    event PaidInClaims(
        address indexed receiver, uint32 indexed market, uint8 collateral, uint256 amount
    );

    error InvalidConfig();
    error InvalidReceiver();
    error InvalidAmount();
    error SeedRequired();
    error EmptyVault();
    error CapExceeded();
    error Slippage();
    error WithdrawLimit();
    error UnsupportedToken();
    error UnknownMarket();
    error MarketLimit();
    error OpenPosition();
    error NotResolved();
    error OrderMarket();
    error OrderFlags();
    error OrderFee();
    error OrderExpiry();
    error OrderPrice();
    error OrderSize();
    error OrderLimit();
    error RestingCap();
    error ImbalanceCap();
    error CrossedQuotes();
    error StaleOracle();
    error SequencerDown();
    error QuoteSigner();

    constructor(Config memory c)
        ERC20(c.name, c.symbol)
        AccessControlDefaultAdminRules(c.adminDelay, c.admin)
    {
        address quote = c.exchange.quote();
        if (
            address(c.base) == quote || !c.exchange.pool(address(c.base)).listed
                || address(c.priceFeed).code.length == 0
                || (address(c.sequencerFeed) != address(0)
                    && address(c.sequencerFeed).code.length == 0)
        ) revert InvalidConfig();
        uint256 quoteDecimals = IERC20Metadata(quote).decimals();
        uint256 baseDecimals = IERC20Metadata(address(c.base)).decimals();
        uint256 feedDecimals = c.priceFeed.decimals();
        if (quoteDecimals > 18 || baseDecimals > 18 || feedDecimals > 18) revert InvalidConfig();
        EXCHANGE = c.exchange;
        QUOTE = IERC20(quote);
        BASE = c.base;
        PRICE_FEED = c.priceFeed;
        SEQUENCER_FEED = c.sequencerFeed;
        // Exchange price (raw quote per raw base x 1e18) = answer x 10^(quote decimals + 18)
        // / 10^(feed decimals + base decimals).
        uint256 up = quoteDecimals + 18;
        uint256 down = feedDecimals + baseDecimals;
        PRICE_NUMERATOR = up >= down ? 10 ** (up - down) : 1;
        PRICE_DENOMINATOR = up >= down ? 1 : 10 ** (down - up);
        QUOTE_TO_WAD = 10 ** (18 - quoteDecimals);
        BASE_TO_WAD = 10 ** (18 - baseDecimals);
    }

    // ---------------------------------------------------------------- accounting

    function _holdings() internal view returns (Holdings memory h) {
        (h,) = _survey();
    }

    /// @dev Everything the vault owns on the exchange, plus its tracked orders of each market as
    ///      the exchange reports them (in `_orders` order; zero `remaining` once closed).
    function _survey()
        internal
        view
        returns (Holdings memory h, IConditionalStocks.Resting[][] memory rest)
    {
        h.freeQuote = EXCHANGE.credit(address(this), address(QUOTE));
        h.freeBase = EXCHANGE.credit(address(this), address(BASE));
        h.quote = h.freeQuote;
        h.base = h.freeBase;
        h.markets = _marketIds;
        uint256 count = h.markets.length;
        h.claims = new Claims[](count);
        h.free = new Claims[](count);
        rest = new IConditionalStocks.Resting[][](count);
        for (uint256 i; i < count; ++i) {
            uint32 id = h.markets[i];
            IConditionalStocks.Account memory yes = EXCHANGE.account(id, 0, address(this));
            IConditionalStocks.Account memory no = EXCHANGE.account(id, 1, address(this));
            h.free[i] = Claims(yes.quote, no.quote, yes.base, no.base);
            Claims memory total = Claims(yes.quote, no.quote, yes.base, no.base);
            uint256[] memory keys = _orders[id];
            if (keys.length != 0) {
                uint256 tick = _markets[id].tick;
                IConditionalStocks.Resting[] memory r = EXCHANGE.restingOrders(keys);
                rest[i] = r;
                for (uint256 j; j < keys.length; ++j) {
                    IConditionalStocks.Resting memory o = r[j];
                    if (o.remaining == 0) continue;
                    bool yesBranch = ((keys[j] >> 32) & 1) == 0;
                    bool claimFunded = o.flags & CLAIM != 0;
                    if (o.flags & SELL == 0) {
                        uint256 reserved = _quoteUp(o.remaining, uint256(o.ticks) * tick);
                        if (!claimFunded) h.quote += reserved;
                        else if (yesBranch) total.yesQuote += reserved;
                        else total.noQuote += reserved;
                    } else if (!claimFunded) {
                        h.base += o.remaining;
                    } else if (yesBranch) {
                        total.yesBase += o.remaining;
                    } else {
                        total.noBase += o.remaining;
                    }
                }
            }
            h.claims[i] = total;
        }
    }

    /// @dev Quote and base holdings in the poorest and the richest branch of every market.
    function _totals(Holdings memory h)
        internal
        pure
        returns (uint256 quoteLow, uint256 quoteHigh, uint256 baseLow, uint256 baseHigh)
    {
        (quoteLow, quoteHigh, baseLow, baseHigh) = (h.quote, h.quote, h.base, h.base);
        for (uint256 i; i < h.claims.length; ++i) {
            Claims memory c = h.claims[i];
            quoteLow += Math.min(c.yesQuote, c.noQuote);
            quoteHigh += Math.max(c.yesQuote, c.noQuote);
            baseLow += Math.min(c.yesBase, c.noBase);
            baseHigh += Math.max(c.yesBase, c.noBase);
        }
    }

    // ---------------------------------------------------------------- orders

    /// @dev Cancels every tracked order; the exchange returns their escrow.
    function _cancelAll() internal {
        uint256[] memory keys = new uint256[](_orderCount());
        if (keys.length == 0) return;
        uint256 k;
        for (uint256 i; i < _marketIds.length; ++i) {
            uint32 id = _marketIds[i];
            uint256[] storage list = _orders[id];
            for (uint256 j; j < list.length; ++j) {
                keys[k++] = list[j];
            }
            delete _orders[id];
        }
        EXCHANGE.cancelMany(keys);
    }

    function _orderCount() internal view returns (uint256 count) {
        for (uint256 i; i < _marketIds.length; ++i) {
            count += _orders[_marketIds[i]].length;
        }
    }

    /// @dev Adds one live order (branch, stored or order-word flags, remaining, ticks) to `t`.
    function _tally(Tally memory t, uint256 branch, uint256 flags, uint256 remaining, uint256 ticks)
        internal
        pure
    {
        bool sell = flags & SELL != 0;
        // Claim-funded asks escrow the branch's stock claims, still the vault's.
        if (sell && flags & CLAIM != 0) {
            t.imbalance += branch == 0 ? int256(remaining) : -int256(remaining);
        }
        // YES bids and NO asks raise YES-minus-NO stock when filled; the others lower it.
        if (sell == (branch == 1)) t.raise += remaining;
        else t.lower += remaining;
        if (sell) t.ask[branch] = Math.min(t.ask[branch], ticks);
        else t.bid[branch] = Math.max(t.bid[branch], ticks);
    }

    /// @dev The exposure of market `id` from its account balances and the tallied orders.
    function _expose(uint32 id, Tally memory t) internal view returns (Exposure memory e) {
        IConditionalStocks.Account memory yes = EXCHANGE.account(id, 0, address(this));
        IConditionalStocks.Account memory no = EXCHANGE.account(id, 1, address(this));
        e.resting = uint256(yes.notional) + no.notional;
        e.imbalance = int256(uint256(yes.base)) - int256(uint256(no.base)) + t.imbalance;
        e.high = e.imbalance + int256(t.raise);
        e.low = e.imbalance - int256(t.lower);
        e.crossed = t.bid[0] >= t.ask[0] || t.bid[1] >= t.ask[1];
    }

    function _newTally() internal pure returns (Tally memory t) {
        t.ask = [type(uint256).max, type(uint256).max];
    }

    function _quoteUp(uint256 quantity, uint256 price) internal pure returns (uint256) {
        return Math.mulDiv(quantity, price, WAD, Math.Rounding.Ceil);
    }
}
