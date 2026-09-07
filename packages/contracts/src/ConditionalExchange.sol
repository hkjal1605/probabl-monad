// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IConditionalSettlement } from "./interfaces/IConditionalSettlement.sol";
import { IConditionalTokens } from "./interfaces/IConditionalTokens.sol";
import { IIOCRouter } from "./interfaces/IIOCRouter.sol";
import { IMarketRegistry } from "./interfaces/IMarketRegistry.sol";
import { IOrderValidator } from "./interfaces/IOrderValidator.sol";
import { IProtocolAuthority } from "./interfaces/IProtocolAuthority.sol";
import { PriceMath } from "./libraries/PriceMath.sol";
import { ProtocolRoles } from "./libraries/ProtocolRoles.sol";
import {
    Branch,
    FundingKind,
    Market,
    MarketState,
    Order,
    OrderStateData,
    OrderStatus,
    SettlementFill,
    Side,
    TimeInForce
} from "./types/ProtocolTypes.sol";
import { ExpectedCtfReceiver } from "./utils/ExpectedCtfReceiver.sol";
import { ProtocolAccess } from "./utils/ProtocolAccess.sol";

/// @notice Per-order escrow and fill-accounting engine for both conditional stock books.
/// @dev Asset materialization is delegated atomically to one permanently configured settlement
///      contract. There is no general user balance, upgrade, or administrator withdrawal.
///      Settlement deducts signed-cap-bounded fees exclusively from received active claims.
contract ConditionalExchange is ProtocolAccess, ExpectedCtfReceiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ContractPaused();
    error DuplicateOrder(bytes32 orderHash);
    error FeeOnTransferUnsupported(address token);
    error InvalidAddress();
    error InvalidFill();
    error InvalidOrder();
    error InvalidOrderStatus(bytes32 orderHash, OrderStatus status);
    error MarketNotOpen(bytes32 marketId);
    error NotOrderMaker();
    error OrderNotReleasable();
    error RiskCapExceeded();
    error SettlementAlreadyConfigured();
    error SettlementNotConfigured();
    error IocRouterAlreadyConfigured();
    error UnauthorizedIocRouter(address caller);
    error ValidatorAlreadyConfigured();
    error ValidatorNotConfigured();

    event EmergencyPauseChanged(
        bool indexed paused, bytes32 indexed reasonHash, address indexed caller
    );
    event NonceInvalidated(address indexed maker, uint64 oldMinimumNonce, uint64 newMinimumNonce);
    event OrderOpened(
        bytes32 indexed orderHash,
        bytes32 indexed marketId,
        address indexed maker,
        address recipient,
        Branch branch,
        Side side,
        FundingKind fundingKind,
        TimeInForce tif,
        uint128 quantity,
        uint128 limitPriceRawX18,
        uint64 expiry,
        uint64 nonce,
        bytes32 salt,
        uint64 sequence,
        uint256 reserved,
        uint16 maxFeeBps
    );
    event OrderCancelled(
        bytes32 indexed orderHash,
        address indexed maker,
        uint128 unfilledQuantity,
        uint256 releasedAmount,
        bytes32 indexed reasonHash
    );
    event OrderFilled(
        bytes32 indexed buyOrderHash,
        bytes32 indexed sellOrderHash,
        bytes32 indexed marketId,
        Branch branch,
        uint128 fillQuantity,
        uint128 executionPriceRawX18,
        uint256 executionQuote,
        bytes32 makerOrderHash
    );
    event SettlementConfigured(address indexed settlement);
    event OrderValidatorConfigured(address indexed validator);
    event IocRouterConfigured(address indexed router);
    event OrderRecoveryRecipient(
        bytes32 indexed orderHash, address indexed maker, address indexed recipient
    );

    bytes32 public constant DEFAULT_ADMIN_ROLE = ProtocolRoles.DEFAULT_ADMIN_ROLE;
    bytes32 public constant MATCHER_ROLE = ProtocolRoles.MATCHER_ROLE;
    bytes32 public constant GUARDIAN_ROLE = ProtocolRoles.GUARDIAN_ROLE;
    bytes32 public constant CANCELLED_BY_MAKER = keccak256("CANCELLED_BY_MAKER");
    bytes32 public constant IOC_REMAINDER = keccak256("IOC_REMAINDER");
    bytes32 public constant ORDER_EXPIRED = keccak256("ORDER_EXPIRED");
    bytes32 public constant NONCE_INVALIDATED = keccak256("NONCE_INVALIDATED");
    bytes32 public constant MARKET_NOT_OPEN = keccak256("MARKET_NOT_OPEN");

    IMarketRegistry public immutable registry;
    IConditionalSettlement public settlement;
    IOrderValidator public orderValidator;
    address public iocRouter;

    bool public tradingPaused;

    mapping(bytes32 orderHash => OrderStateData state) private _orders;
    mapping(address maker => uint64 minimumNonce) public minimumNonce;
    mapping(bytes32 marketId => mapping(Branch branch => uint64 sequence)) public nextSequence;
    mapping(bytes32 marketId => uint256 openNotional) public marketOpenNotional;
    mapping(bytes32 marketId => mapping(address maker => uint256 openNotional)) public
        walletOpenNotional;
    mapping(address token => bool approved) private _settlementApprovalInitialized;

    constructor(
        IConditionalTokens conditionalTokens_,
        IMarketRegistry registry_,
        IProtocolAuthority authority_
    ) ProtocolAccess(authority_) ExpectedCtfReceiver(conditionalTokens_) {
        if (address(registry_) == address(0) || address(registry_).code.length == 0) {
            revert InvalidAddress();
        }
        if (
            address(registry_.ctf()) != address(conditionalTokens_)
                || address(registry_.authority()) != address(authority_)
        ) revert InvalidAddress();
        registry = registry_;
    }

    /// @notice Permanently connects the exchange to its stateless order validator.
    function configureOrderValidator(
        IOrderValidator validator_
    ) external onlyProtocolRole(DEFAULT_ADMIN_ROLE) {
        if (address(orderValidator) != address(0)) revert ValidatorAlreadyConfigured();
        if (
            address(validator_) == address(0) || address(validator_).code.length == 0
                || validator_.exchange() != address(this)
        ) revert InvalidAddress();
        orderValidator = validator_;
        emit OrderValidatorConfigured(address(validator_));
    }

    /// @notice Permanently connects the exchange to its non-upgradeable settlement contract.
    function configureSettlement(
        IConditionalSettlement settlement_
    ) external onlyProtocolRole(DEFAULT_ADMIN_ROLE) {
        if (address(settlement) != address(0)) revert SettlementAlreadyConfigured();
        if (
            address(settlement_) == address(0) || address(settlement_).code.length == 0
                || settlement_.exchange() != address(this)
                || address(settlement_.registry()) != address(registry)
                || address(settlement_.conditionalTokens()) != address(conditionalTokens)
        ) revert InvalidAddress();
        settlement = settlement_;
        conditionalTokens.setApprovalForAll(address(settlement_), true);
        emit SettlementConfigured(address(settlement_));
    }

    /// @notice Permanently connects the exchange to the bounded atomic IOC router.
    function configureIocRouter(
        IIOCRouter router_
    ) external onlyProtocolRole(DEFAULT_ADMIN_ROLE) {
        if (iocRouter != address(0)) revert IocRouterAlreadyConfigured();
        if (
            address(router_) == address(0) || address(router_).code.length == 0
                || router_.exchange() != address(this)
                || address(router_.authority()) != address(authority)
        ) revert InvalidAddress();
        iocRouter = address(router_);
        emit IocRouterConfigured(address(router_));
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override returns (bool) {
        return ExpectedCtfReceiver.supportsInterface(interfaceId);
    }

    function setTradingPaused(
        bool paused,
        bytes32 reasonHash
    ) external onlyProtocolRole(GUARDIAN_ROLE) {
        if (reasonHash == bytes32(0) || tradingPaused == paused) revert InvalidOrder();
        tradingPaused = paused;
        emit EmergencyPauseChanged(paused, reasonHash, msg.sender);
    }

    /// @notice Opens a signed, fully funded good-until-cancelled order.
    /// @dev Any address may relay the order; funding is always pulled from its signed maker.
    function openOrder(
        Order calldata order,
        bytes calldata signature
    ) external nonReentrant returns (bytes32 orderHash) {
        if (tradingPaused) revert ContractPaused();
        if (order.tif != TimeInForce.GTC) revert InvalidOrder();
        orderHash = _openOrder(order, signature);
    }

    /// @dev IOC entry point callable only by the permanently configured atomic router.
    function openIOCOrder(
        Order calldata order,
        bytes calldata signature
    ) external nonReentrant returns (bytes32 orderHash) {
        _requireIocRouter();
        if (tradingPaused) revert ContractPaused();
        if (order.tif != TimeInForce.IOC) revert InvalidOrder();
        orderHash = _openOrder(order, signature);
    }

    /// @dev Executes one IOC maker leg; the outer router transaction guarantees remainder release.
    function matchIOCOrders(
        Order calldata takerOrder,
        Order calldata makerOrder,
        uint128 fillQuantity
    ) external nonReentrant {
        _requireIocRouter();
        if (tradingPaused) revert ContractPaused();
        if (takerOrder.tif != TimeInForce.IOC || makerOrder.tif != TimeInForce.GTC) {
            revert InvalidOrder();
        }
        if (takerOrder.side == Side.BUY) {
            _executeMatch(takerOrder, makerOrder, fillQuantity);
        } else {
            _executeMatch(makerOrder, takerOrder, fillQuantity);
        }
    }

    /// @dev Cancels any live IOC remainder without affecting a completely filled IOC.
    function cancelIOCRemainder(
        bytes32 orderHash
    ) external nonReentrant {
        _requireIocRouter();
        OrderStateData storage state = _orders[orderHash];
        if (state.status == OrderStatus.FILLED) return;
        if (state.status != OrderStatus.OPEN) revert InvalidOrderStatus(orderHash, state.status);
        _cancelOrder(orderHash, state, IOC_REMAINDER, state.maker);
    }

    /// @notice Matches two already-open GTC orders at the earlier sequence's signed limit price.
    function matchOrders(
        Order calldata buyOrder,
        Order calldata sellOrder,
        uint128 fillQuantity
    ) external nonReentrant onlyProtocolRole(MATCHER_ROLE) {
        if (tradingPaused) revert ContractPaused();
        if (buyOrder.tif != TimeInForce.GTC || sellOrder.tif != TimeInForce.GTC) {
            revert InvalidOrder();
        }
        _executeMatch(buyOrder, sellOrder, fillQuantity);
    }

    /// @notice Cancels the caller's open order and returns its exact unfilled reservation.
    function cancelOrder(
        bytes32 orderHash
    ) external nonReentrant {
        OrderStateData storage state = _orders[orderHash];
        if (state.status != OrderStatus.OPEN) revert InvalidOrderStatus(orderHash, state.status);
        if (state.maker != msg.sender) revert NotOrderMaker();
        _cancelOrder(orderHash, state, CANCELLED_BY_MAKER, state.maker);
    }

    /// @notice Maker-authorized recovery when a smart wallet can no longer receive its escrow.
    /// @dev Permissionless release paths always return to the original maker.
    function cancelOrderTo(
        bytes32 orderHash,
        address recipient
    ) external nonReentrant {
        OrderStateData storage state = _orders[orderHash];
        if (state.status != OrderStatus.OPEN) revert InvalidOrderStatus(orderHash, state.status);
        if (state.maker != msg.sender) revert NotOrderMaker();
        if (recipient == address(0) || recipient == address(this)) revert InvalidAddress();
        emit OrderRecoveryRecipient(orderHash, state.maker, recipient);
        _cancelOrder(orderHash, state, CANCELLED_BY_MAKER, recipient);
    }

    /// @notice Invalidates every signed order whose nonce is lower than the new minimum.
    /// @dev Escrow for an already-open invalidated order is returned by its release function.
    function cancelUpTo(
        uint64 newMinimumNonce
    ) external {
        uint64 current = minimumNonce[msg.sender];
        if (newMinimumNonce <= current) revert InvalidOrder();
        minimumNonce[msg.sender] = newMinimumNonce;
        emit NonceInvalidated(msg.sender, current, newMinimumNonce);
    }

    function releaseExpiredOrder(
        bytes32 orderHash
    ) external nonReentrant {
        OrderStateData storage state = _orders[orderHash];
        if (state.status != OrderStatus.OPEN) revert InvalidOrderStatus(orderHash, state.status);
        if (block.timestamp < state.expiry) revert OrderNotReleasable();
        _cancelOrder(orderHash, state, ORDER_EXPIRED, state.maker);
    }

    function releaseInvalidatedOrder(
        bytes32 orderHash
    ) external nonReentrant {
        OrderStateData storage state = _orders[orderHash];
        if (state.status != OrderStatus.OPEN) revert InvalidOrderStatus(orderHash, state.status);
        if (state.nonce >= minimumNonce[state.maker]) revert OrderNotReleasable();
        _cancelOrder(orderHash, state, NONCE_INVALIDATED, state.maker);
    }

    function releaseClosedMarketOrder(
        bytes32 orderHash
    ) external nonReentrant {
        OrderStateData storage state = _orders[orderHash];
        if (state.status != OrderStatus.OPEN) revert InvalidOrderStatus(orderHash, state.status);
        MarketState current = registry.marketState(state.marketId);
        if (current == MarketState.OPEN) revert OrderNotReleasable();
        _cancelOrder(orderHash, state, MARKET_NOT_OPEN, state.maker);
    }

    function hashOrder(
        Order calldata order
    ) public view returns (bytes32) {
        IOrderValidator validator = orderValidator;
        if (address(validator) == address(0)) revert ValidatorNotConfigured();
        return validator.hashOrder(order);
    }

    function getOrderState(
        bytes32 orderHash
    ) external view returns (OrderStateData memory) {
        return _orders[orderHash];
    }

    function _openOrder(
        Order calldata order,
        bytes calldata signature
    ) private returns (bytes32 orderHash) {
        if (address(settlement) == address(0)) revert SettlementNotConfigured();
        IOrderValidator validator = orderValidator;
        if (address(validator) == address(0)) revert ValidatorNotConfigured();
        if (
            order.maker == address(0) || order.recipient == address(0)
                || order.maker == address(this) || order.recipient == address(this)
                || order.quantity == 0 || order.limitPriceRawX18 == 0
                || order.expiry <= block.timestamp || order.nonce < minimumNonce[order.maker]
        ) revert InvalidOrder();

        Market memory market = registry.getMarket(order.marketId);
        if (
            market.state != MarketState.OPEN || block.timestamp < market.tradingOpen
                || block.timestamp >= market.tradingCutoff || order.expiry > market.tradingCutoff
        ) revert MarketNotOpen(order.marketId);
        if (
            order.quantity % market.baseStep != 0
                || order.limitPriceRawX18 % market.priceTickRawX18 != 0
                || order.quantity > market.maxOrderQuantity
        ) revert InvalidOrder();

        uint256 orderNotional = PriceMath.quoteUp(order.quantity, order.limitPriceRawX18);
        if (orderNotional < market.minNotional || orderNotional > market.maxOrderNotional) {
            revert RiskCapExceeded();
        }

        uint256 newWalletOpenNotional =
            walletOpenNotional[order.marketId][order.maker] + orderNotional;
        uint256 newMarketOpenNotional = marketOpenNotional[order.marketId] + orderNotional;
        if (
            newWalletOpenNotional > market.maxWalletOpenNotional
                || newMarketOpenNotional > market.maxMarketOpenNotional
        ) revert RiskCapExceeded();

        orderHash = validator.validate(order, signature);
        if (_orders[orderHash].status != OrderStatus.NONE) revert DuplicateOrder(orderHash);

        uint256 reserved = order.side == Side.BUY ? orderNotional : order.quantity;
        uint64 sequence = nextSequence[order.marketId][order.branch];
        if (sequence == type(uint64).max) revert InvalidOrder();
        nextSequence[order.marketId][order.branch] = sequence + 1;

        _orders[orderHash] = OrderStateData({
            maker: order.maker,
            marketId: order.marketId,
            reserved: reserved,
            openNotional: orderNotional,
            remaining: order.quantity,
            limitPriceRawX18: order.limitPriceRawX18,
            sequence: sequence,
            expiry: order.expiry,
            nonce: order.nonce,
            branch: order.branch,
            side: order.side,
            fundingKind: order.fundingKind,
            status: OrderStatus.OPEN
        });
        walletOpenNotional[order.marketId][order.maker] = newWalletOpenNotional;
        marketOpenNotional[order.marketId] = newMarketOpenNotional;

        _pullOrderFunding(order, market, reserved);
        emit OrderOpened(
            orderHash,
            order.marketId,
            order.maker,
            order.recipient,
            order.branch,
            order.side,
            order.fundingKind,
            order.tif,
            order.quantity,
            order.limitPriceRawX18,
            order.expiry,
            order.nonce,
            order.salt,
            sequence,
            reserved,
            order.maxFeeBps
        );
    }

    function _executeMatch(
        Order calldata buyOrder,
        Order calldata sellOrder,
        uint128 fillQuantity
    ) private {
        if (
            buyOrder.side != Side.BUY || sellOrder.side != Side.SELL
                || buyOrder.marketId != sellOrder.marketId || buyOrder.branch != sellOrder.branch
                || fillQuantity == 0 || buyOrder.limitPriceRawX18 < sellOrder.limitPriceRawX18
        ) revert InvalidFill();

        bytes32 buyOrderHash = hashOrder(buyOrder);
        bytes32 sellOrderHash = hashOrder(sellOrder);
        if (buyOrderHash == sellOrderHash) revert InvalidFill();
        OrderStateData storage buyState = _orders[buyOrderHash];
        OrderStateData storage sellState = _orders[sellOrderHash];
        _requireFillable(buyOrderHash, buyState, buyOrder);
        _requireFillable(sellOrderHash, sellState, sellOrder);

        Market memory market = registry.getMarket(buyOrder.marketId);
        if (
            market.state != MarketState.OPEN || block.timestamp < market.tradingOpen
                || block.timestamp >= market.tradingCutoff
        ) revert MarketNotOpen(buyOrder.marketId);
        if (
            fillQuantity > buyState.remaining || fillQuantity > sellState.remaining
                || fillQuantity % market.baseStep != 0
        ) revert InvalidFill();

        bool bidIsMaker = buyState.sequence < sellState.sequence;
        uint128 executionPriceRawX18 =
            bidIsMaker ? buyOrder.limitPriceRawX18 : sellOrder.limitPriceRawX18;
        uint256 executionQuote = PriceMath.quoteDown(fillQuantity, executionPriceRawX18);
        if (executionQuote == 0) revert InvalidFill();

        uint256 buyerRelease =
            _consumeBuy(buyState, fillQuantity, executionQuote, buyOrder.limitPriceRawX18);
        _consumeSell(sellState, fillQuantity, sellOrder.limitPriceRawX18);

        _approveSettlementAssets(buyOrder, sellOrder, market);
        settlement.settleFill(
            SettlementFill({
                marketId: buyOrder.marketId,
                buyerMaker: buyOrder.maker,
                buyerRecipient: buyOrder.recipient,
                sellerMaker: sellOrder.maker,
                sellerRecipient: sellOrder.recipient,
                fillQuantity: fillQuantity,
                executionQuote: executionQuote,
                branch: buyOrder.branch,
                buyFundingKind: buyOrder.fundingKind,
                sellFundingKind: sellOrder.fundingKind,
                buyOrderHash: buyOrderHash,
                sellOrderHash: sellOrderHash,
                buyMaxFeeBps: buyOrder.maxFeeBps,
                sellMaxFeeBps: sellOrder.maxFeeBps,
                bidIsMaker: bidIsMaker
            })
        );
        _releaseBuyerImprovement(buyOrder, market, buyerRelease);

        emit OrderFilled(
            buyOrderHash,
            sellOrderHash,
            buyOrder.marketId,
            buyOrder.branch,
            fillQuantity,
            executionPriceRawX18,
            executionQuote,
            bidIsMaker ? buyOrderHash : sellOrderHash
        );
    }

    function _consumeBuy(
        OrderStateData storage state,
        uint128 fillQuantity,
        uint256 executionQuote,
        uint128 limitPriceRawX18
    ) private returns (uint256 release) {
        uint128 oldRemaining = state.remaining;
        uint128 newRemaining = oldRemaining - fillQuantity;
        uint256 newReserved = PriceMath.quoteUp(newRemaining, limitPriceRawX18);
        uint256 oldReserved = state.reserved;
        if (oldReserved < executionQuote + newReserved) revert InvalidFill();
        release = oldReserved - executionQuote - newReserved;

        state.remaining = newRemaining;
        state.reserved = newReserved;
        _reduceOpenNotional(state, newRemaining, limitPriceRawX18);
        if (newRemaining == 0) state.status = OrderStatus.FILLED;
    }

    function _consumeSell(
        OrderStateData storage state,
        uint128 fillQuantity,
        uint128 limitPriceRawX18
    ) private {
        uint128 oldRemaining = state.remaining;
        uint128 newRemaining = oldRemaining - fillQuantity;
        state.remaining = newRemaining;
        state.reserved -= fillQuantity;
        _reduceOpenNotional(state, newRemaining, limitPriceRawX18);
        if (newRemaining == 0) state.status = OrderStatus.FILLED;
    }

    function _reduceOpenNotional(
        OrderStateData storage state,
        uint128 newRemaining,
        uint128 limitPriceRawX18
    ) private {
        uint256 newOpenNotional = PriceMath.quoteUp(newRemaining, limitPriceRawX18);
        uint256 reduction = state.openNotional - newOpenNotional;
        state.openNotional = newOpenNotional;
        walletOpenNotional[state.marketId][state.maker] -= reduction;
        marketOpenNotional[state.marketId] -= reduction;
    }

    function _releaseBuyerImprovement(
        Order calldata buyOrder,
        Market memory market,
        uint256 buyerRelease
    ) private {
        if (buyerRelease == 0) return;
        if (buyOrder.fundingKind == FundingKind.WHOLE_COLLATERAL) {
            IERC20(market.quoteToken).safeTransfer(buyOrder.maker, buyerRelease);
        } else {
            uint256 activePosition = buyOrder.branch == Branch.YES
                ? market.quoteYesPositionId
                : market.quoteNoPositionId;
            conditionalTokens.safeTransferFrom(
                address(this), buyOrder.maker, activePosition, buyerRelease, ""
            );
        }
    }

    function _approveSettlementAssets(
        Order calldata buyOrder,
        Order calldata sellOrder,
        Market memory market
    ) private {
        if (buyOrder.fundingKind == FundingKind.WHOLE_COLLATERAL) {
            _ensureSettlementApproval(IERC20(market.quoteToken));
        }
        if (sellOrder.fundingKind == FundingKind.WHOLE_COLLATERAL) {
            _ensureSettlementApproval(IERC20(market.baseToken));
        }
    }

    function _pullOrderFunding(
        Order calldata order,
        Market memory market,
        uint256 amount
    ) private {
        if (order.fundingKind == FundingKind.WHOLE_COLLATERAL) {
            IERC20 token = IERC20(order.side == Side.BUY ? market.quoteToken : market.baseToken);
            uint256 balanceBefore = token.balanceOf(address(this));
            token.safeTransferFrom(order.maker, address(this), amount);
            if (token.balanceOf(address(this)) - balanceBefore != amount) {
                revert FeeOnTransferUnsupported(address(token));
            }
        } else {
            uint256 positionId = _activePosition(market, order.branch, order.side);
            _expectSingle(address(this), order.maker, positionId, amount);
            conditionalTokens.safeTransferFrom(order.maker, address(this), positionId, amount, "");
            _assertExpectedTransferReceived();
        }
    }

    function _cancelOrder(
        bytes32 orderHash,
        OrderStateData storage state,
        bytes32 reasonHash,
        address recipient
    ) private {
        uint128 unfilledQuantity = state.remaining;
        uint256 releasedAmount = state.reserved;
        uint256 releasedNotional = state.openNotional;

        state.remaining = 0;
        state.reserved = 0;
        state.openNotional = 0;
        state.status = OrderStatus.CANCELLED;
        walletOpenNotional[state.marketId][state.maker] -= releasedNotional;
        marketOpenNotional[state.marketId] -= releasedNotional;

        Market memory market = registry.getMarket(state.marketId);
        if (state.fundingKind == FundingKind.WHOLE_COLLATERAL) {
            IERC20 token = IERC20(state.side == Side.BUY ? market.quoteToken : market.baseToken);
            token.safeTransfer(recipient, releasedAmount);
        } else {
            uint256 positionId = _activePosition(market, state.branch, state.side);
            conditionalTokens.safeTransferFrom(
                address(this), recipient, positionId, releasedAmount, ""
            );
        }

        emit OrderCancelled(orderHash, state.maker, unfilledQuantity, releasedAmount, reasonHash);
    }

    function _requireFillable(
        bytes32 orderHash,
        OrderStateData storage state,
        Order calldata order
    ) private view {
        if (state.status != OrderStatus.OPEN) revert InvalidOrderStatus(orderHash, state.status);
        if (
            state.maker != order.maker || state.marketId != order.marketId
                || state.branch != order.branch || state.side != order.side
                || state.fundingKind != order.fundingKind
                || state.limitPriceRawX18 != order.limitPriceRawX18 || state.expiry != order.expiry
                || state.nonce != order.nonce || order.expiry <= block.timestamp
                || order.nonce < minimumNonce[order.maker]
        ) revert InvalidFill();
    }

    function _activePosition(
        Market memory market,
        Branch branch,
        Side side
    ) private pure returns (uint256) {
        if (side == Side.BUY) {
            return branch == Branch.YES ? market.quoteYesPositionId : market.quoteNoPositionId;
        }
        return branch == Branch.YES ? market.stockYesPositionId : market.stockNoPositionId;
    }

    function _ensureSettlementApproval(
        IERC20 token
    ) private {
        if (_settlementApprovalInitialized[address(token)]) return;
        _settlementApprovalInitialized[address(token)] = true;
        token.forceApprove(address(settlement), type(uint256).max);
    }

    function _requireIocRouter() private view {
        if (msg.sender != iocRouter) revert UnauthorizedIocRouter(msg.sender);
    }
}
