// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksBase } from "./ConditionalStocksBase.sol";

/// @title ConditionalStocksAdmin
/// @notice Governance, market lifecycle, resolution, trading delegation, claim transfers and
///         views of `ConditionalStocks`. Deployed by and bound to one `ConditionalStocks`, which
///         reaches it by delegatecall: every function here runs on that contract's storage.
/// @dev Called directly it only reads and writes its own empty storage.
contract ConditionalStocksAdmin is ConditionalStocksBase {
    constructor(address quote_) ConditionalStocksBase(quote_) { }

    // ---------------------------------------------------------------- governance

    function configure(
        address marketAdmin_,
        address guardian_,
        address resolutionAdmin_,
        uint16 makerBps,
        uint16 takerBps
    ) external {
        if (msg.sender != _admin) revert Unauthorized();
        if (marketAdmin_ == address(0) || guardian_ == address(0) || resolutionAdmin_ == address(0))
        {
            revert InvalidAddress();
        }
        if (makerBps > MAX_FEE_BPS || takerBps > MAX_FEE_BPS) revert FeeCap();
        _marketAdmin = marketAdmin_;
        _resolutionAdmin = resolutionAdmin_;
        _control = Control(guardian_, _control.paused, makerBps, takerBps);
        emit Configured(marketAdmin_, guardian_, resolutionAdmin_, makerBps, takerBps);
    }

    /// @notice Starts a delayed admin transfer; a zero successor cancels a pending one.
    function proposeAdmin(address successor) external {
        if (msg.sender != _admin) revert Unauthorized();
        if (successor == _admin) revert InvalidAddress();
        uint64 after_ = uint64(block.timestamp) + ADMIN_DELAY;
        _pendingAdmin = successor;
        _adminAfter = after_;
        emit AdminProposed(successor, after_);
    }

    function acceptAdmin() external {
        if (msg.sender != _pendingAdmin || msg.sender == address(0)) revert Unauthorized();
        if (block.timestamp < _adminAfter) revert AdminDelay();
        _admin = msg.sender;
        _pendingAdmin = address(0);
        _adminAfter = 0;
        emit AdminAccepted(msg.sender);
    }

    /// @notice Halts every placement. Cancellation, custody and positions keep working.
    function pause(bool paused, bytes32 reason) external {
        Control memory c = _control;
        if (msg.sender != c.guardian) revert Unauthorized();
        if (reason == bytes32(0) || paused == c.paused) revert InvalidTerms();
        _control.paused = paused;
        emit PauseSet(paused, reason);
    }

    /// @notice Whitelists a base token for custody. Listing is a market-admin decision.
    function listPool(address token) external {
        if (msg.sender != _marketAdmin) revert Unauthorized();
        if (_pools[token].listed || token.code.length == 0) revert InvalidState();
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(0x313ce567));
        if (!ok || data.length < 32) revert InvalidAddress();
        uint256 decimals = abi.decode(data, (uint256));
        if (decimals > 36) revert InvalidTerms();
        _pools[token] = Pool(0, uint8(decimals), true);
        emit PoolListed(token, uint8(decimals));
    }

    /// @notice Lists a market in SCHEDULED state. Its terms and Polymarket mapping are immutable.
    ///         Notional caps are raw quote units; `maxSteps` bounds the order quantity in steps.
    function createMarket(MarketParams calldata p, string calldata metadataUri)
        external
        returns (uint32 id)
    {
        if (msg.sender != _marketAdmin) revert Unauthorized();
        if (!_pools[p.base].listed || p.base == QUOTE) revert InvalidAddress();
        if (
            p.condition == bytes32(0) || p.rulesHash == bytes32(0)
                || !((p.yesIndex == 1 && p.noIndex == 2) || (p.yesIndex == 2 && p.noIndex == 1))
                || bytes(metadataUri).length == 0 || bytes(metadataUri).length > MAX_URI
                || keccak256(bytes(metadataUri)) != p.metadataHash || p.cutoff <= p.open
                || p.cutoff <= block.timestamp
        ) revert InvalidTerms();
        _validateCaps(p);
        id = ++_marketCount;
        _terms[id] = Terms({
            base: p.base,
            state: SCHEDULED,
            open: p.open,
            cutoff: p.cutoff,
            tick: p.tick,
            step: p.step,
            maxSteps: p.maxSteps,
            minNotional: p.minNotional,
            maxOrder: p.maxOrder,
            maxWallet: p.maxWallet,
            maxMarket: p.maxMarket
        });
        emit MarketCreated(id, p, metadataUri);
    }

    /// @dev One step at the smallest tick-aligned price reaching the minimum notional must be
    ///      placeable, and two such orders must fit the market cap.
    function _validateCaps(MarketParams calldata p) private pure {
        if (
            p.step == 0 || p.tick == 0 || p.maxSteps == 0 || p.minNotional == 0
                || p.maxOrder < p.minNotional || p.maxWallet < p.maxOrder
                || p.maxMarket < p.maxWallet
        ) revert InvalidTerms();
        uint256 step = p.step;
        uint256 tick = p.tick;
        if (step * tick / WAD == 0) revert InvalidTerms();
        uint256 ticks = (uint256(p.minNotional) - 1) * WAD / (step * tick) + 1;
        uint256 price = ticks * tick;
        if (price > type(uint128).max) revert InvalidTerms();
        uint256 notional = _quoteUp(step, price);
        if (notional > p.maxOrder || notional * 2 > p.maxMarket) revert CapExceeded();
    }

    /// @notice 0 open, 1 freeze (market admin or guardian, with a reason hash), 2 freeze at
    ///         cutoff (anyone), 3 begin resolution (`reason` is the resolution commitment),
    ///         4 archive a redeemable market (with a reason hash).
    function lifecycle(uint32 id, uint8 action, bytes32 reason) external {
        Terms storage t = _terms[id];
        uint8 state = t.state;
        if (state == 0) revert InvalidState();
        if (action == 0) {
            if (msg.sender != _marketAdmin) revert Unauthorized();
            if (state != SCHEDULED || block.timestamp < t.open || block.timestamp >= t.cutoff) {
                revert InvalidState();
            }
            state = OPEN;
        } else if (action == 1) {
            if (msg.sender != _marketAdmin && msg.sender != _control.guardian) {
                revert Unauthorized();
            }
            if (reason == bytes32(0) || (state != SCHEDULED && state != OPEN)) {
                revert InvalidState();
            }
            state = FROZEN;
        } else if (action == 2) {
            if (state != OPEN || block.timestamp < t.cutoff) revert InvalidState();
            state = FROZEN;
        } else if (action == 3) {
            if (msg.sender != _marketAdmin) revert Unauthorized();
            if (state != FROZEN || reason == bytes32(0)) revert InvalidState();
            _commitments[id] = reason;
            state = AWAITING;
        } else if (action == 4) {
            if (msg.sender != _marketAdmin) revert Unauthorized();
            if (state != REDEEMABLE || reason == bytes32(0)) revert InvalidState();
            state = ARCHIVED;
        } else {
            revert InvalidState();
        }
        t.state = state;
        emit MarketState(id, state, msg.sender, reason);
    }

    /// @notice The commitment the market admin prepares before the resolution admin resolves.
    function resolutionHash(uint32 id, uint8 yes, uint8 no, bytes32 evidence_, string calldata uri)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                "PROBABL_EVM_RESOLUTION_V1",
                block.chainid,
                address(this),
                id,
                yes,
                no,
                evidence_,
                keccak256(bytes(uri))
            )
        );
    }

    /// @notice Records YES (1,0), NO (0,1) or INVALID (1,1) exactly as committed.
    function resolve(uint32 id, uint8 yes, uint8 no, bytes32 evidence_, string calldata uri)
        external
    {
        if (msg.sender != _resolutionAdmin) revert Unauthorized();
        _payoutDenominator(yes, no);
        if (evidence_ == bytes32(0) || bytes(uri).length == 0 || bytes(uri).length > MAX_URI) {
            revert InvalidTerms();
        }
        Terms storage t = _terms[id];
        if (t.state != AWAITING) revert InvalidState();
        if (_commitments[id] != resolutionHash(id, yes, no, evidence_, uri)) revert Commitment();
        Book storage b = _books[id];
        b.payoutYes = yes;
        b.payoutNo = no;
        b.resolvedAt = uint40(block.timestamp);
        delete _commitments[id];
        _evidence[id] = evidence_;
        t.state = REDEEMABLE;
        emit MarketResolved(id, yes, no, evidence_, uri, msg.sender);
    }

    /// @notice Moves accrued fee claims to an owner's claim balance.
    function claimFees(uint32 id, uint8 branch, uint8 collateral, address to, uint256 amount)
        external
    {
        if (msg.sender != _admin) revert Unauthorized();
        _collateral(id, collateral);
        if (branch > 1 || amount == 0 || to == address(0)) revert InvalidTerms();
        Fees storage f = _fees[uint256(id) << 1 | branch];
        if (collateral == 0) f.quote -= _u128(amount);
        else f.base -= _u128(amount);
        _claim(id, branch, collateral, to, amount, true);
        emit FeesClaimed(id, _asset(branch, collateral), to, amount);
    }

    // ---------------------------------------------------------------- claims

    function transferClaim(uint32 id, uint8 branch, uint8 collateral, address to, uint256 amount)
        external
    {
        _collateral(id, collateral);
        if (branch > 1 || amount == 0 || to == address(0) || to == msg.sender) {
            revert InvalidTerms();
        }
        _claim(id, branch, collateral, msg.sender, amount, false);
        _claim(id, branch, collateral, to, amount, true);
        emit ClaimTransferred(id, msg.sender, to, _asset(branch, collateral), amount);
    }

    // ---------------------------------------------------------------- delegation

    /// @notice Grants a trading key limited to placing (and optionally cancelling) orders for
    ///         the caller, in one market or all (`market` 0). Proceeds always stay with the
    ///         owner. Every placement consumes its full notional from `totalQuote`, which never
    ///         refills. Re-approving a key replaces its grant and leaves every order placed under
    ///         the previous one unfillable and publicly releasable.
    function approveDelegate(
        address delegate,
        uint32 market,
        uint40 expiresAt,
        uint128 maxOrderQuote,
        uint128 totalQuote,
        uint16 maxFeeBps,
        uint8 permissions
    ) external {
        if (delegate == address(0) || delegate == msg.sender) {
            revert InvalidDelegation();
        }
        if (
            expiresAt <= block.timestamp || expiresAt - block.timestamp > MAX_GRANT_LIFETIME
                || maxOrderQuote == 0 || totalQuote < maxOrderQuote || maxFeeBps > MAX_FEE_BPS
                || (permissions != TRADE && permissions != TRADE | CANCEL)
                || (market != 0 && _terms[market].state == 0)
        ) revert InvalidDelegation();
        uint64 epoch = _traders[msg.sender].delegationEpoch;
        uint32 generation = _grants[msg.sender][delegate].generation + 1;
        _grants[msg.sender][delegate] = Grant({
            market: market,
            expiresAt: expiresAt,
            epoch: epoch,
            generation: generation,
            maxFeeBps: maxFeeBps,
            permissions: permissions,
            revoked: false,
            maxOrderQuote: maxOrderQuote,
            remainingQuote: totalQuote
        });
        emit DelegateApproved(
            msg.sender,
            delegate,
            market,
            epoch,
            generation,
            expiresAt,
            maxOrderQuote,
            totalQuote,
            maxFeeBps,
            permissions
        );
    }

    function revokeDelegate(address delegate) external {
        Grant storage g = _grants[msg.sender][delegate];
        if (g.permissions == 0 || g.revoked) revert InvalidDelegation();
        g.revoked = true;
        emit DelegateRevoked(msg.sender, delegate);
    }

    /// @notice Invalidates every grant of the caller at once.
    function revokeAllDelegates() external {
        uint64 epoch = ++_traders[msg.sender].delegationEpoch;
        emit DelegatesRevoked(msg.sender, epoch);
    }

    /// @notice Makes every resting order of the caller unfillable and publicly releasable.
    function invalidateOrders() external {
        uint64 epoch = ++_traders[msg.sender].epoch;
        emit OrdersInvalidated(msg.sender, epoch);
    }

    // ---------------------------------------------------------------- views

    function quote() external view returns (address) {
        return QUOTE;
    }

    function admin() external view returns (address) {
        return _admin;
    }

    function pendingAdmin() external view returns (address successor, uint64 acceptableAfter) {
        return (_pendingAdmin, _adminAfter);
    }

    function roles()
        external
        view
        returns (address marketAdmin, address guardian, address resolutionAdmin)
    {
        return (_marketAdmin, _control.guardian, _resolutionAdmin);
    }

    function control() external view returns (Control memory) {
        return _control;
    }

    function marketCount() external view returns (uint32) {
        return _marketCount;
    }

    function pool(address token) external view returns (Pool memory) {
        return _pools[token];
    }

    function credit(address owner, address token) external view returns (uint256) {
        return _credit[owner][token];
    }

    function terms(uint32 id) external view returns (Terms memory) {
        return _terms[id];
    }

    function book(uint32 id) external view returns (Book memory) {
        return _books[id];
    }

    function backing(uint32 id) external view returns (Backing memory) {
        return _backing[id];
    }

    function fees(uint32 id, uint8 branch) external view returns (Fees memory) {
        return _fees[uint256(id) << 1 | branch];
    }

    function account(uint32 id, uint8 branch, address owner)
        external
        view
        returns (Account memory)
    {
        return _accounts[uint256(id) << 1 | branch][owner];
    }

    function commitment(uint32 id) external view returns (bytes32) {
        return _commitments[id];
    }

    function evidence(uint32 id) external view returns (bytes32) {
        return _evidence[id];
    }

    function order(uint256 key) external view returns (Order memory, address delegate) {
        return (_orders[key], _delegates[key]);
    }

    function trader(address owner) external view returns (Trader memory) {
        return _traders[owner];
    }

    function grant(address owner, address delegate) external view returns (Grant memory) {
        return _grants[owner][delegate];
    }
}
