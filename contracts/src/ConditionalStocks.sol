// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksAdmin } from "./ConditionalStocksAdmin.sol";
import { ConditionalStocksBase } from "./ConditionalStocksBase.sol";

/// @title ConditionalStocks
/// @notice Fully collateralized event-conditional stock markets. One contract holds every
///         deposit in an internal ledger: protocol-wide token credit, per-market YES/NO claims
///         and per-order escrow. Trading moves ledger entries only; tokens move on deposit and
///         withdrawal. A market pairs the deployment quote token with one base (stock) token and
///         runs one order book per branch: "stock if YES" against "quote if YES", and the same
///         for NO.
/// @dev Non-upgradeable: no deployed function can change. New functions can only be added as
///      extensions after a 14-day exit window (`ConditionalStocksAdmin.proposeExtension`), and
///      withdrawals are never pausable. Orders rest on chain keyed by (market, branch, sequence). A taker's
///      transaction carries a plan of resting makers chosen off chain and settles them
///      atomically. Prices are raw quote units per raw base unit x 1e18 (a multiple of the market
///      tick); quantities are raw base units (a multiple of the market step). Governance,
///      delegation, lifecycle and view functions live in the immutable `ConditionalStocksAdmin`
///      module, reached by delegatecall through the fallback, which keeps this runtime under the
///      EIP-170 limit without adding a call to any trading path.
contract ConditionalStocks is ConditionalStocksBase {
    // Order word flags (bits 32..39 of the packed order).
    uint256 internal constant F_BRANCH = 1;
    uint256 internal constant F_SELL = 2;
    uint256 internal constant F_CLAIM = 4;
    uint256 internal constant F_IOC = 8;

    address internal immutable MODULE;

    /// @dev In-memory taker state of one placement.
    struct Taker {
        address owner;
        uint32 market;
        uint256 branch;
        bool sell;
        bool claim;
        uint16 maxFee;
        uint64 ticks;
        uint256 price;
        uint256 remaining;
        uint256 filled;
        uint256 seq;
        uint16 carry;
        uint256 paid;
        uint256 received;
        uint256 inactive;
        uint256 baseFee;
        uint256 quoteFee;
        uint256 quoteBacking;
        uint256 baseBacking;
    }

    constructor(
        address quote_,
        address admin_,
        address marketAdmin_,
        address guardian_,
        address resolutionAdmin_
    ) ConditionalStocksBase(quote_) {
        if (
            admin_ == address(0) || marketAdmin_ == address(0) || guardian_ == address(0)
                || resolutionAdmin_ == address(0)
        ) revert InvalidAddress();
        MODULE = address(new ConditionalStocksAdmin(quote_));
        _admin = admin_;
        _marketAdmin = marketAdmin_;
        _resolutionAdmin = resolutionAdmin_;
        _control = Control(guardian_, false, 0, 0);
        (bool ok, bytes memory data) = quote_.staticcall(abi.encodeWithSelector(0x313ce567));
        if (!ok || data.length < 32) revert InvalidAddress();
        uint256 decimals = abi.decode(data, (uint256));
        if (decimals > 36) revert InvalidTerms();
        _pools[quote_] = Pool(0, uint8(decimals), true);
        emit AdminAccepted(admin_);
        emit PoolListed(quote_, uint8(decimals), bytes32(0));
        emit Configured(marketAdmin_, guardian_, resolutionAdmin_, 0, 0);
    }

    /// @notice The immutable module implementing governance, delegation and views.
    function module() external view returns (address) {
        return MODULE;
    }

    fallback() external {
        address target = MODULE;
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    // ---------------------------------------------------------------- custody

    /// @notice Credits the tokens actually received (a fee-on-transfer token credits its net).
    function deposit(address token, uint256 amount) external nonReentrant {
        Pool storage pool = _pools[token];
        if (!pool.listed || amount == 0) revert InvalidTerms();
        uint256 before = _balance(token);
        _call(token, abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount));
        uint256 received = _balance(token) - before;
        if (received == 0 || received > amount) revert TransferFailed();
        pool.liability = _u128(pool.liability + received);
        _credit[msg.sender][token] += received;
        emit Deposited(msg.sender, token, received);
    }

    /// @notice Withdraws unreserved credit to a destination chosen by the owner.
    function withdraw(address token, uint256 amount, address to) external nonReentrant {
        if (amount == 0 || to == address(0) || to == address(this)) revert InvalidTerms();
        uint256 available = _credit[msg.sender][token];
        if (available < amount) revert InsufficientFunds();
        _credit[msg.sender][token] = available - amount;
        _pools[token].liability -= uint128(amount);
        _call(token, abi.encodeWithSelector(0xa9059cbb, to, amount));
        emit Withdrawn(msg.sender, token, amount, to);
    }

    /// @notice Converts underlying credit into equal YES and NO claims. Collateral 0 is the
    ///         quote token, 1 the market's base token.
    function split(uint32 id, uint8 collateral, uint256 amount) external {
        address token = _collateral(id, collateral);
        if (amount == 0) revert InvalidTerms();
        uint256 available = _credit[msg.sender][token];
        if (available < amount) revert InsufficientFunds();
        _credit[msg.sender][token] = available - amount;
        _back(id, collateral, amount, true);
        _claim(id, 0, collateral, msg.sender, amount, true);
        _claim(id, 1, collateral, msg.sender, amount, true);
        emit PositionChanged(id, msg.sender, 0, collateral, amount, amount, amount);
    }

    /// @notice Converts equal YES and NO claims back into underlying credit, in any state.
    function merge(uint32 id, uint8 collateral, uint256 amount) external {
        address token = _collateral(id, collateral);
        if (amount == 0) revert InvalidTerms();
        _claim(id, 0, collateral, msg.sender, amount, false);
        _claim(id, 1, collateral, msg.sender, amount, false);
        _back(id, collateral, amount, false);
        _credit[msg.sender][token] += amount;
        emit PositionChanged(id, msg.sender, 1, collateral, amount, amount, amount);
    }

    /// @notice Burns claims of a resolved market for their payout. An INVALID (1/2 each)
    ///         payout never discards a fractional raw unit: redeem an even total.
    function redeem(uint32 id, uint8 collateral, uint256 yes, uint256 no) external {
        address token = _collateral(id, collateral);
        uint8 state = _terms[id].state;
        if (state != REDEEMABLE && state != ARCHIVED) revert InvalidState();
        if (yes == 0 && no == 0) revert InvalidTerms();
        Book memory b = _books[id];
        uint256 denominator = _payoutDenominator(b.payoutYes, b.payoutNo);
        uint256 numerator = yes * b.payoutYes + no * b.payoutNo;
        if (numerator % denominator != 0) revert FractionalRedemption();
        uint256 amount = numerator / denominator;
        if (yes != 0) _claim(id, 0, collateral, msg.sender, yes, false);
        if (no != 0) _claim(id, 1, collateral, msg.sender, no, false);
        if (amount != 0) {
            _back(id, collateral, amount, false);
            _credit[msg.sender][token] += amount;
        }
        emit PositionChanged(id, msg.sender, 2, collateral, yes, no, amount);
    }

    // ---------------------------------------------------------------- trading

    /// @notice Places an order and fills it against planned resting makers.
    /// @param o Packed order: market(32) | flags(8) << 32 | maxFeeBps(16) << 40
    ///          | expiry(40) << 56 | ticks(64) << 96 | quantity(96) << 160.
    ///          Flags: 1 NO branch, 2 sell, 4 claim-funded, 8 immediate-or-cancel.
    ///          A buy pays the quote (its underlying credit, or its active-branch quote claim);
    ///          a sell delivers the base (credit, or its active-branch base claim). An
    ///          underlying-funded side receives the opposite-branch claim of what it paid.
    /// @param p Packed plan: nextSeq(32) | deadline(40) << 32 | minFill(96) << 72. `nextSeq` is
    ///          the branch sequence the planner observed; every planned maker is older, and a
    ///          resting remainder must not cross an opposite order placed since.
    /// @param m Up to eight maker sequences + 1, 32 bits each from the low end; 0 ends the list.
    ///          Makers fill greedily in order, each capped by what remains. A maker closed,
    ///          expired, invalidated, delegation-revoked or priced out of its fee cap since
    ///          planning is skipped.
    /// @return key The order key: market << 40 | branch << 32 | seq.
    function place(uint256 o, uint256 p, uint256 m) external returns (uint256 key) {
        return _place(msg.sender, address(0), o, p, m);
    }

    /// @notice Delegated placement within the owner's grant; the delegate signs and pays gas.
    function placeFor(address owner, uint256 o, uint256 p, uint256 m)
        external
        returns (uint256 key)
    {
        if (owner == msg.sender || owner == address(0)) {
            revert InvalidDelegation();
        }
        return _place(owner, msg.sender, o, p, m);
    }

    function _place(address owner, address delegate, uint256 o, uint256 p, uint256 m)
        private
        returns (uint256 key)
    {
        Control memory c = _control;
        if (c.paused) revert NotTrading();
        Taker memory t;
        t.owner = owner;
        t.market = uint32(o);
        uint256 flags = uint8(o >> 32);
        t.branch = flags & F_BRANCH;
        t.sell = flags & F_SELL != 0;
        t.claim = flags & F_CLAIM != 0;
        t.maxFee = uint16(o >> 40);
        uint40 expiry = uint40(o >> 56);
        t.ticks = uint64(o >> 96);
        uint256 quantity = o >> 160;

        Terms memory tm = _terms[t.market];
        if (tm.state != OPEN || block.timestamp < tm.open || block.timestamp >= tm.cutoff) {
            revert NotTrading();
        }
        if (expiry <= block.timestamp || expiry > tm.cutoff) revert Expired();
        uint256 nextSeq = uint32(p);
        {
            uint256 deadline = uint40(p >> 32);
            if (block.timestamp >= deadline || deadline > expiry) revert StalePlan();
        }
        if (
            flags > 15 || t.maxFee > MAX_FEE_BPS || quantity == 0 || t.ticks == 0
                || quantity % tm.step != 0 || quantity > uint256(tm.step) * tm.maxSteps
        ) revert InvalidOrder();
        t.price = uint256(t.ticks) * tm.tick;
        if (t.price > type(uint128).max) revert InvalidOrder();
        uint256 notional = _quoteUp(quantity, t.price);
        if (notional < tm.minNotional || notional > tm.maxOrder) revert CapExceeded();

        Book memory b = _books[t.market];
        t.seq = t.branch == 0 ? b.seqYes : b.seqNo;
        if (nextSeq > t.seq) revert StalePlan();
        if (t.branch == 0) b.seqYes = uint32(t.seq + 1);
        else b.seqNo = uint32(t.seq + 1);

        uint32 generation;
        if (delegate != address(0)) {
            Grant storage g = _grants[owner][delegate];
            Grant memory gm = g;
            if (!_authorized(gm, _traders[owner].delegationEpoch, t.market, TRADE)) {
                revert DelegationInactive();
            }
            if (expiry > gm.expiresAt || t.maxFee > gm.maxFeeBps) revert InvalidDelegation();
            if (notional > gm.maxOrderQuote || notional > gm.remainingQuote) {
                revert DelegateBudget();
            }
            g.remainingQuote = gm.remainingQuote - uint128(notional);
            generation = gm.generation;
        }
        emit OrderPlaced(t.market, owner, o, t.seq, delegate);

        t.remaining = quantity;
        uint256 prefix = uint256(t.market) << 40 | t.branch << 32;
        key = prefix | t.seq;
        for (uint256 i; i < MAX_MAKERS && t.remaining != 0; ++i) {
            uint256 entry = uint32(m >> (32 * i));
            if (entry == 0) break;
            if (entry > nextSeq) revert StalePlan();
            _fill(t, c, tm.tick, prefix | (entry - 1), b);
        }
        if (t.filled < uint96(p >> 72)) revert StalePlan();

        uint256 restNotional;
        if (flags & F_IOC == 0 && t.remaining != 0) {
            if (!_raceFree(t, nextSeq)) revert StalePlan();
            _record(t);
            restNotional = _quoteUp(t.remaining, t.price);
            _orders[key] = Order({
                remaining: uint96(t.remaining),
                ticks: t.ticks,
                expiry: expiry,
                carry: t.carry,
                maxFeeBps: t.maxFee,
                flags: uint8(flags & (F_SELL | F_CLAIM))
                    | (delegate == address(0) ? 0 : S_DELEGATED),
                owner: owner,
                epoch: _traders[owner].epoch,
                generation: generation
            });
            if (delegate != address(0)) _delegates[key] = delegate;
            b.openNotional = _u64(b.openNotional + restNotional);
            if (b.openNotional > tm.maxMarket) revert CapExceeded();
        }
        _settleTaker(t, restNotional, tm);
        _books[t.market] = b;
    }

    /// @dev Applies the taker's aggregated ledger changes once, after every maker fill (which
    ///      may have touched the same owner's balances in a self-match).
    function _settleTaker(Taker memory t, uint256 restNotional, Terms memory tm) private {
        uint256 mb = uint256(t.market) << 1 | t.branch;
        bool resting = restNotional != 0;
        uint256 debit = t.paid + (resting ? (t.sell ? t.remaining : restNotional) : 0);
        mapping(address => Account) storage accounts = _accounts[mb];
        if (!t.claim) {
            if (debit != 0) {
                address token = t.sell ? tm.base : QUOTE;
                uint256 available = _credit[t.owner][token];
                if (available < debit) revert InsufficientFunds();
                _credit[t.owner][token] = available - debit;
            }
            if (t.inactive != 0) {
                _claim(t.market, 1 - t.branch, t.sell ? 1 : 0, t.owner, t.inactive, true);
            }
        }
        Account memory a = accounts[t.owner];
        if (t.claim) {
            if (t.sell) {
                if (a.base < debit) revert InsufficientFunds();
                a.base -= uint96(debit);
            } else {
                if (a.quote < debit) revert InsufficientFunds();
                a.quote -= uint96(debit);
            }
        }
        if (t.sell) a.quote = _u96(a.quote + t.received);
        else a.base = _u96(a.base + t.received);
        if (resting) {
            a.notional = _u64(a.notional + restNotional);
            if (a.notional + _accounts[mb ^ 1][t.owner].notional > tm.maxWallet) {
                revert CapExceeded();
            }
        }
        accounts[t.owner] = a;
        if (t.quoteBacking != 0 || t.baseBacking != 0) {
            Backing memory bk = _backing[t.market];
            _backing[t.market] =
                Backing(_u128(bk.quote + t.quoteBacking), _u128(bk.base + t.baseBacking));
        }
        if (t.quoteFee != 0 || t.baseFee != 0) {
            Fees memory f = _fees[mb];
            _fees[mb] = Fees(_u128(f.quote + t.quoteFee), _u128(f.base + t.baseFee));
        }
    }

    /// @dev Fills one planned maker. The maker's changes are written here; the taker's are
    ///      aggregated in `t` and applied by `_settleTaker`.
    function _fill(Taker memory t, Control memory c, uint256 tick, uint256 key, Book memory b)
        private
    {
        Order memory mo = _orders[key];
        if (mo.remaining == 0) return; // Filled or cancelled since planning.
        if (
            (mo.flags & S_SELL != 0) == t.sell || (t.sell ? mo.ticks < t.ticks : mo.ticks > t.ticks)
        ) revert StalePlan();
        Trader memory mt = _traders[mo.owner];
        if (
            mo.expiry <= block.timestamp || mo.epoch != mt.epoch || c.makerBps > mo.maxFeeBps
                || (mo.flags & S_DELEGATED != 0 && !_delegateLive(key, mo, mt))
        ) return;
        if (c.takerBps > t.maxFee) revert FeeCap();

        uint256 q = t.remaining < mo.remaining ? t.remaining : mo.remaining;
        uint256 makerPrice = uint256(mo.ticks) * tick;
        uint256 quoteAmount = q * makerPrice / WAD;
        if (quoteAmount == 0) revert StalePlan();
        uint256 makerReduction =
            _quoteUp(mo.remaining, makerPrice) - _quoteUp(mo.remaining - q, makerPrice);
        uint256 mb = uint256(t.market) << 1 | t.branch;
        Account memory a = _accounts[mb][mo.owner];
        a.notional -= uint64(makerReduction);
        bool makerClaim = mo.flags & S_CLAIM != 0;
        uint256 buyerFee;
        uint256 sellerFee;
        uint256 improvement;
        if (!t.sell) {
            // The taker buys from a resting ask at the ask price.
            (buyerFee, t.carry) = _fee(q, c.takerBps, t.carry);
            (sellerFee, mo.carry) = _fee(quoteAmount, c.makerBps, mo.carry);
            improvement =
                _quoteUp(t.remaining, t.price) - _quoteUp(t.remaining - q, t.price) - quoteAmount;
            a.quote = _u96(a.quote + quoteAmount - sellerFee);
            _accounts[mb][mo.owner] = a;
            if (!makerClaim) {
                t.baseBacking += q;
                _claim(t.market, 1 - t.branch, 1, mo.owner, q, true);
            }
            t.received += q - buyerFee;
            t.paid += quoteAmount;
            if (!t.claim) {
                t.quoteBacking += quoteAmount;
                t.inactive += quoteAmount;
            }
        } else {
            // The taker sells into a resting bid at the bid price; the bid keeps its improvement.
            (buyerFee, mo.carry) = _fee(q, c.makerBps, mo.carry);
            (sellerFee, t.carry) = _fee(quoteAmount, c.takerBps, t.carry);
            improvement = makerReduction - quoteAmount;
            a.base = _u96(a.base + q - buyerFee);
            if (makerClaim) a.quote = _u96(a.quote + improvement);
            _accounts[mb][mo.owner] = a;
            if (!makerClaim) {
                t.quoteBacking += quoteAmount;
                _claim(t.market, 1 - t.branch, 0, mo.owner, quoteAmount, true);
                if (improvement != 0) _credit[mo.owner][QUOTE] += improvement;
            }
            t.received += quoteAmount - sellerFee;
            t.paid += q;
            if (!t.claim) {
                t.baseBacking += q;
                t.inactive += q;
            }
        }
        t.baseFee += buyerFee;
        t.quoteFee += sellerFee;
        b.openNotional = uint64(b.openNotional - makerReduction);
        t.remaining -= q;
        t.filled += q;
        if (mo.remaining == q) {
            delete _orders[key];
            if (mo.flags & S_DELEGATED != 0) delete _delegates[key];
        } else {
            mo.remaining = uint96(mo.remaining - q);
            _orders[key] = mo;
        }
        emit Trade(
            t.market,
            q | uint256(uint32(key)) << 96 | t.seq << 128 | t.branch << 160,
            quoteAmount | improvement << 128,
            buyerFee | sellerFee << 128
        );
    }

    function _delegateLive(uint256 key, Order memory mo, Trader memory mt)
        private
        view
        returns (bool)
    {
        Grant memory g = _grants[mo.owner][_delegates[key]];
        return g.generation == mo.generation
            && _authorized(g, mt.delegationEpoch, uint32(key >> 40), TRADE);
    }

    /// @dev A resting order must not cross an opposite order placed since its plan (which the
    ///      plan could not match): that race would leave the book crossed. Only resting
    ///      placements are recorded, tagged with their sequence; older ranges fail closed.
    function _raceFree(Taker memory t, uint256 nextSeq) private view returns (bool) {
        if (t.seq - nextSeq > RECENT) return false;
        uint256 mb = uint256(t.market) << 1 | t.branch;
        for (uint256 s = nextSeq; s < t.seq; ++s) {
            uint256 entry = _recent[mb << 3 | (s % RECENT) >> 1] >> ((s & 1) * 128);
            if (uint32(entry) != s + 1) continue; // Did not rest.
            bool sell = uint8(entry >> 96) != 0;
            uint64 ticks = uint64(entry >> 32);
            if (sell != t.sell && (t.sell ? t.ticks <= ticks : t.ticks >= ticks)) return false;
        }
        return true;
    }

    function _record(Taker memory t) private {
        uint256 slot = (uint256(t.market) << 1 | t.branch) << 3 | (t.seq % RECENT) >> 1;
        uint256 shift = (t.seq & 1) * 128;
        uint256 entry = (t.seq + 1) | uint256(t.ticks) << 32 | (t.sell ? uint256(1) : 0) << 96;
        _recent[slot] = _recent[slot] & ~(uint256(type(uint128).max) << shift) | entry << shift;
    }

    /// @notice Cancels a resting order. Its owner, or the delegate that placed it holding CANCEL
    ///         permission, may always cancel; anyone may release an order that can no longer
    ///         fill (closed market, expired, invalidated, or placed under an inactive grant).
    ///         The reservation always returns to the owner.
    function cancel(uint256 key) external {
        if (!_cancel(key)) revert InvalidOrder();
    }

    /// @notice Cancels `key` and places `o` atomically: a requote in one transaction.
    function replace(uint256 key, uint256 o, uint256 p, uint256 m) external returns (uint256) {
        if (!_cancel(key)) revert InvalidOrder();
        return _place(msg.sender, address(0), o, p, m);
    }

    /// @notice Batch cancellation; entries already closed are skipped.
    function cancelMany(uint256[] calldata keys) external {
        for (uint256 i; i < keys.length; ++i) {
            _cancel(keys[i]);
        }
    }

    function _cancel(uint256 key) private returns (bool) {
        Order memory mo = _orders[key];
        if (mo.remaining == 0) return false;
        uint32 id = uint32(key >> 40);
        Terms memory tm = _terms[id];
        if (msg.sender != mo.owner) {
            Trader memory mt = _traders[mo.owner];
            bool delegated = mo.flags & S_DELEGATED != 0;
            bool releasable = tm.state != OPEN || block.timestamp >= mo.expiry
                || mo.epoch != mt.epoch || (delegated && !_delegateLive(key, mo, mt));
            if (!releasable) {
                if (!delegated || msg.sender != _delegates[key]) revert Unauthorized();
                Grant memory g = _grants[mo.owner][msg.sender];
                if (
                    g.generation != mo.generation || !_authorized(g, mt.delegationEpoch, id, CANCEL)
                ) revert Unauthorized();
            }
        }
        uint256 mb = uint256(id) << 1 | (key >> 32 & 1);
        uint256 notional = _quoteUp(mo.remaining, uint256(mo.ticks) * tm.tick);
        bool sell = mo.flags & S_SELL != 0;
        Account memory a = _accounts[mb][mo.owner];
        a.notional -= uint64(notional);
        if (mo.flags & S_CLAIM == 0) {
            _credit[mo.owner][sell ? tm.base : QUOTE] += sell ? mo.remaining : notional;
        } else if (sell) {
            a.base = _u96(a.base + mo.remaining);
        } else {
            a.quote = _u96(a.quote + notional);
        }
        _accounts[mb][mo.owner] = a;
        _books[id].openNotional -= uint64(notional);
        delete _orders[key];
        if (mo.flags & S_DELEGATED != 0) delete _delegates[key];
        emit OrderCancelled(id, key);
        return true;
    }

    // ---------------------------------------------------------------- internals

    function _back(uint32 id, uint8 collateral, uint256 amount, bool add) private {
        Backing memory bk = _backing[id];
        if (collateral == 0) {
            bk.quote = add ? _u128(bk.quote + amount) : uint128(bk.quote - amount);
        } else {
            bk.base = add ? _u128(bk.base + amount) : uint128(bk.base - amount);
        }
        _backing[id] = bk;
    }

    function _fee(uint256 gross, uint256 rate, uint16 carry)
        private
        pure
        returns (uint256 fee, uint16 next)
    {
        if (rate == 0) return (0, carry);
        uint256 numerator = gross * rate + carry;
        return (numerator / BPS, uint16(numerator % BPS));
    }

    function _balance(address token) private view returns (uint256) {
        (bool ok, bytes memory data) =
            token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        if (!ok || data.length < 32) revert TransferFailed();
        return abi.decode(data, (uint256));
    }

    function _call(address token, bytes memory payload) private {
        (bool ok, bytes memory data) = token.call(payload);
        if (!ok || (data.length != 0 && (data.length < 32 || !abi.decode(data, (bool))))) {
            revert TransferFailed();
        }
    }
}
