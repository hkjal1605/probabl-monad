// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DeltaVaultBase } from "./DeltaVaultBase.sol";
import { IConditionalStocks } from "./interfaces/IConditionalStocks.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title DeltaVaultAdmin
/// @notice Quoting, settlement, curation, governance and views of `DeltaVault`. Deployed by and
///         bound to one `DeltaVault`, which reaches it by delegatecall: every function here runs
///         on that vault's storage and address, so the vault owns every order it places.
/// @dev Called directly it only reads and writes its own empty storage.
contract DeltaVaultAdmin is DeltaVaultBase {
    constructor(Config memory c) DeltaVaultBase(c) { }

    // ---------------------------------------------------------------- keeper

    /// @notice Cancels vault orders of market `id` and posts new quotes in it, then checks the
    ///         market's resting-notional, imbalance and crossing limits. Every new order rests
    ///         whole (planned against no makers, not immediate-or-cancel), is priced within the
    ///         market band around the oracle price, accepts at most the vault fee cap, expires
    ///         within the TTL and before the cutoff buffer, and stays under the order cap.
    /// @return keys Exchange keys of the placed orders.
    function update(uint32 id, uint256[] calldata cancels, Placement[] calldata places)
        external
        nonReentrant
        onlyRole(KEEPER_ROLE)
        returns (uint256[] memory keys)
    {
        Market memory m = _markets[id];
        if (!m.listed) revert UnknownMarket();
        for (uint256 i; i < cancels.length; ++i) {
            if (uint32(cancels[i] >> 40) != id) revert OrderMarket();
        }
        if (cancels.length != 0) EXCHANGE.cancelMany(cancels);

        keys = new uint256[](places.length);
        if (places.length != 0) {
            _requireNotPaused();
            Limits memory l = _limits;
            uint256 spot = _oraclePrice(l.maxOracleAge);
            for (uint256 i; i < places.length; ++i) {
                _validate(id, m, l, spot, places[i].order);
                keys[i] = EXCHANGE.place(places[i].order, places[i].plan, 0);
            }
        }
        Tally memory t = _track(id, keys, places);
        if (places.length != 0) {
            if (_orderCount() > MAX_ORDERS) {
                // Orders filled or released in markets not updated lately still count: forget them.
                for (uint256 i; i < _marketIds.length; ++i) {
                    if (_marketIds[i] != id) _prune(_marketIds[i]);
                }
                if (_orderCount() > MAX_ORDERS) revert OrderLimit();
            }
            Exposure memory e = _expose(id, t);
            if (e.crossed) revert CrossedQuotes();
            if (e.resting > m.risk.maxResting) revert RestingCap();
            // An imbalance already beyond the cap (after a cap cut or a claim donation) may
            // shrink but not grow.
            int256 cap = int256(uint256(m.risk.maxImbalance));
            if (e.high > _max(cap, e.imbalance) || e.low < _min(-cap, e.imbalance)) {
                revert ImbalanceCap();
            }
        }
        emit Quoted(id, cancels.length, keys);
    }

    /// @notice Merges the paired YES/NO claims of market `id` into plain credit. No holding's
    ///         value or share entitlement changes.
    function merge(uint32 id) external nonReentrant onlyRole(KEEPER_ROLE) {
        if (!_markets[id].listed) revert UnknownMarket();
        IConditionalStocks.Account memory yes = EXCHANGE.account(id, 0, address(this));
        IConditionalStocks.Account memory no = EXCHANGE.account(id, 1, address(this));
        uint256 amount = Math.min(yes.quote, no.quote);
        if (amount != 0) EXCHANGE.merge(id, 0, amount);
        amount = Math.min(yes.base, no.base);
        if (amount != 0) EXCHANGE.merge(id, 1, amount);
    }

    /// @notice Cancels every resting vault order (keeper or guardian).
    function cancelAll() external nonReentrant {
        if (!hasRole(KEEPER_ROLE, msg.sender)) _checkRole(GUARDIAN_ROLE);
        _cancelAll();
    }

    /// @notice Redeems the vault's claims in a resolved market and drops the market, first
    ///         releasing any orders left there. Anyone may call it.
    function settle(uint32 id) external nonReentrant {
        if (!_markets[id].listed) revert UnknownMarket();
        uint8 state = EXCHANGE.terms(id).state;
        if (state != REDEEMABLE && state != ARCHIVED) revert NotResolved();
        _releaseOrders(id);
        IConditionalStocks.Book memory b = EXCHANGE.book(id);
        IConditionalStocks.Account memory yes = EXCHANGE.account(id, 0, address(this));
        IConditionalStocks.Account memory no = EXCHANGE.account(id, 1, address(this));
        _redeem(id, 0, yes.quote, no.quote, b);
        _redeem(id, 1, yes.base, no.base, b);
        _dropMarket(id);
    }

    // ---------------------------------------------------------------- curation

    /// @notice Registers a market of the vault's stock that has not reached its cutoff.
    function addMarket(uint32 id, Risk calldata risk) external onlyRole(CURATOR_ROLE) {
        if (_markets[id].listed) revert InvalidConfig();
        if (_marketIds.length == MAX_MARKETS) revert MarketLimit();
        IConditionalStocks.Terms memory t = EXCHANGE.terms(id);
        if (
            t.base != address(BASE) || (t.state != SCHEDULED && t.state != OPEN)
                || t.cutoff <= block.timestamp
        ) revert UnknownMarket();
        _checkRisk(risk);
        _markets[id] = Market(risk, t.tick, t.cutoff, true);
        _marketIds.push(id);
        emit MarketAdded(id, risk);
    }

    function setRisk(uint32 id, Risk calldata risk) external onlyRole(CURATOR_ROLE) {
        if (!_markets[id].listed) revert UnknownMarket();
        _checkRisk(risk);
        _markets[id].risk = risk;
        emit RiskSet(id, risk);
    }

    /// @notice Drops a market in which the vault holds no tradable claims, cancelling its
    ///         orders. Claims below one order's minimum (less base than one step, less quote
    ///         than the minimum notional), such as a dust donation, stay with the vault untracked.
    function removeMarket(uint32 id) external nonReentrant onlyRole(CURATOR_ROLE) {
        if (!_markets[id].listed) revert UnknownMarket();
        _releaseOrders(id);
        IConditionalStocks.Terms memory t = EXCHANGE.terms(id);
        IConditionalStocks.Account memory yes = EXCHANGE.account(id, 0, address(this));
        IConditionalStocks.Account memory no = EXCHANGE.account(id, 1, address(this));
        if (
            yes.quote >= t.minNotional || no.quote >= t.minNotional || yes.base >= t.step
                || no.base >= t.step
        ) revert OpenPosition();
        _dropMarket(id);
    }

    function setLimits(Limits calldata l) external onlyRole(CURATOR_ROLE) {
        if (
            l.maxTtl == 0 || l.maxTtl > MAX_TTL || l.maxOracleAge == 0
                || l.maxOracleAge > MAX_ORACLE_AGE || l.maxFeeBps > MAX_FEE_BPS
        ) revert InvalidConfig();
        _limits = l;
        emit LimitsSet(l);
    }

    // ---------------------------------------------------------------- governance

    /// @notice Deposits stop once the richest-branch quote or base holdings would pass these.
    function setCaps(uint128 quoteCap, uint128 baseCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _quoteCap = quoteCap;
        _baseCap = baseCap;
        emit CapsSet(quoteCap, baseCap);
    }

    /// @notice Net share outflow allowed per window, in bps of the supply at its start.
    function setWithdrawLimit(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps < MIN_WITHDRAW_LIMIT_BPS || bps > BPS) revert InvalidConfig();
        _withdrawLimitBps = bps;
        emit WithdrawLimitSet(bps);
    }

    /// @notice Stops deposits and quoting and makes every resting vault order unfillable.
    function pause() external nonReentrant onlyRole(GUARDIAN_ROLE) {
        _pause();
        EXCHANGE.invalidateOrders();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------- views

    function limits() external view returns (Limits memory) {
        return _limits;
    }

    function caps() external view returns (uint128 quoteCap, uint128 baseCap) {
        return (_quoteCap, _baseCap);
    }

    function withdrawLimitBps() external view returns (uint16) {
        return _withdrawLimitBps;
    }

    function markets() external view returns (uint32[] memory) {
        return _marketIds;
    }

    function market(uint32 id) external view returns (Market memory) {
        return _markets[id];
    }

    /// @notice Tracked order keys of a market, including ones closed since the last prune.
    function orders(uint32 id) external view returns (uint256[] memory) {
        return _orders[id];
    }

    function holdings() external view nonReentrantView returns (Holdings memory) {
        return _holdings();
    }

    /// @notice Quote and base holdings in the poorest and the richest branch of every market.
    function totals()
        external
        view
        nonReentrantView
        returns (uint256 quoteLow, uint256 quoteHigh, uint256 baseLow, uint256 baseHigh)
    {
        return _totals(_holdings());
    }

    function exposure(uint32 id) external view nonReentrantView returns (Exposure memory) {
        if (!_markets[id].listed) revert UnknownMarket();
        return _restingExposure(id);
    }

    // ---------------------------------------------------------------- RFQ quotes

    /// @notice The exchange's check of an RFQ quote naming this vault as its maker
    ///         (`IQuoteMaker`): signed by a keeper, while quoting is not paused, in a registered
    ///         market, within the band around the oracle price, the lifetime and cutoff limits
    ///         and the order cap, and leaving the worst-case YES-minus-NO stock within the cap
    ///         after `fill`, as `update` requires of every order. Returns its selector to accept.
    function acceptQuote(bytes32 digest, uint256 terms, uint256 fill, bytes32 r, bytes32 vs)
        external
        view
        nonReentrantView
        returns (bytes4)
    {
        address signer = ecrecover(
            digest, uint8(uint256(vs) >> 255) + 27, r, vs & bytes32(type(uint256).max >> 1)
        );
        if (signer == address(0) || !hasRole(KEEPER_ROLE, signer)) revert QuoteSigner();
        _requireNotPaused();
        uint32 id = uint32(terms);
        Market memory m = _markets[id];
        if (!m.listed) revert UnknownMarket();
        Limits memory l = _limits;
        uint256 expiry = uint40(terms >> 56);
        if (expiry > block.timestamp + l.maxTtl || expiry + m.risk.cutoffBuffer > m.cutoff) {
            revert OrderExpiry();
        }
        uint256 spot = _oraclePrice(l.maxOracleAge);
        uint256 price = uint256(uint64(terms >> 96)) * m.tick;
        uint256 band = Math.mulDiv(spot, m.risk.bandBps, BPS);
        if (price + band < spot || price > spot + band) revert OrderPrice();
        if (_quoteUp(terms >> 160, price) > m.risk.maxOrder) revert OrderSize();
        Exposure memory e = _restingExposure(id);
        // YES bids and NO asks raise YES-minus-NO stock; YES asks and NO bids lower it.
        uint256 flags = uint8(terms >> 32);
        int256 cap = int256(uint256(m.risk.maxImbalance));
        if ((flags & SELL != 0) == (flags & 1 == 1)
                ? e.high + int256(fill) > _max(cap, e.imbalance)
                : e.low - int256(fill) < _min(-cap, e.imbalance)) revert ImbalanceCap();
        return this.acceptQuote.selector;
    }

    /// @notice ERC-1271: a signature is the vault's when a keeper made it, so a venue can check a
    ///         quote's signer before routing an order to it. Accepts 65-byte (r, s, v) and
    ///         64-byte (r, vs) signatures.
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        if (signature.length != 64 && signature.length != 65) return 0xffffffff;
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v;
        if (signature.length == 65) {
            v = uint8(signature[64]);
        } else {
            v = uint8(uint256(s) >> 255) + 27;
            s &= bytes32(type(uint256).max >> 1);
        }
        address signer = ecrecover(hash, v, r, s);
        return signer != address(0) && hasRole(KEEPER_ROLE, signer)
            ? bytes4(0x1626ba7e)
            : bytes4(0xffffffff);
    }

    /// @notice Shares that may still leave in the current withdrawal window.
    function withdrawable() external view returns (uint256) {
        Window memory w = _window;
        if (block.timestamp >= w.start + WITHDRAW_WINDOW) {
            return Math.mulDiv(totalSupply(), _withdrawLimitBps, BPS);
        }
        uint256 allowed = Math.mulDiv(w.supply, _withdrawLimitBps, BPS) + w.inflow;
        return allowed > w.outflow ? allowed - w.outflow : 0;
    }

    /// @notice The oracle price in exchange units (raw quote per raw base x 1e18). Reverts when
    ///         the price, or the L2 sequencer, cannot be trusted.
    function oraclePrice() external view returns (uint256) {
        return _oraclePrice(_limits.maxOracleAge);
    }

    // ---------------------------------------------------------------- internals

    /// @dev The exposure of market `id` with its tracked resting orders.
    function _restingExposure(uint32 id) internal view returns (Exposure memory) {
        uint256[] memory keys = _orders[id];
        Tally memory t = _newTally();
        if (keys.length != 0) {
            IConditionalStocks.Resting[] memory r = EXCHANGE.restingOrders(keys);
            for (uint256 j; j < keys.length; ++j) {
                if (r[j].remaining != 0) {
                    _tally(t, (keys[j] >> 32) & 1, r[j].flags, r[j].remaining, r[j].ticks);
                }
            }
        }
        return _expose(id, t);
    }

    function _validate(uint32 id, Market memory m, Limits memory l, uint256 spot, uint256 o)
        internal
        view
    {
        if (uint32(o) != id) revert OrderMarket();
        if (uint8(o >> 32) & IOC != 0) revert OrderFlags();
        if (uint16(o >> 40) > l.maxFeeBps) revert OrderFee();
        uint256 expiry = uint40(o >> 56);
        if (expiry > block.timestamp + l.maxTtl || expiry + m.risk.cutoffBuffer > m.cutoff) {
            revert OrderExpiry();
        }
        uint256 price = uint256(uint64(o >> 96)) * m.tick;
        uint256 band = Math.mulDiv(spot, m.risk.bandBps, BPS);
        if (price > type(uint128).max || price + band < spot || price > spot + band) {
            revert OrderPrice();
        }
        if (_quoteUp(o >> 160, price) > m.risk.maxOrder) revert OrderSize();
    }

    /// @dev The oracle price in exchange units; reverts unless the feed (and the L2 sequencer,
    ///      where tracked) can be trusted.
    function _oraclePrice(uint256 maxAge) internal view returns (uint256 price) {
        if (address(SEQUENCER_FEED) != address(0)) {
            (, int256 status, uint256 startedAt,,) = SEQUENCER_FEED.latestRoundData();
            if (
                status != 0 || startedAt == 0 || startedAt > block.timestamp
                    || block.timestamp - startedAt <= SEQUENCER_GRACE
            ) revert SequencerDown();
        }
        (, int256 answer,, uint256 updatedAt,) = PRICE_FEED.latestRoundData();
        if (
            answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp
                || block.timestamp - updatedAt > maxAge
        ) revert StaleOracle();
        price = Math.mulDiv(uint256(answer), PRICE_NUMERATOR, PRICE_DENOMINATOR);
        if (price == 0) revert StaleOracle();
    }

    /// @dev Rewrites the tracked orders of market `id`: closed ones are forgotten and `added`
    ///      (just placed from `places`, so resting whole) take their slots first. Returns the
    ///      tally of the live orders.
    function _track(uint32 id, uint256[] memory added, Placement[] calldata places)
        internal
        returns (Tally memory t)
    {
        t = _newTally();
        uint256[] storage list = _orders[id];
        uint256[] memory old = list;
        uint256 w;
        if (old.length != 0) {
            IConditionalStocks.Resting[] memory r = EXCHANGE.restingOrders(old);
            for (uint256 j; j < old.length; ++j) {
                IConditionalStocks.Resting memory o = r[j];
                if (o.remaining == 0) continue;
                if (w != j) list[w] = old[j];
                ++w;
                _tally(t, (old[j] >> 32) & 1, o.flags, o.remaining, o.ticks);
            }
        }
        for (uint256 i; i < added.length; ++i) {
            if (w < old.length) list[w] = added[i];
            else list.push(added[i]);
            ++w;
            uint256 o = places[i].order;
            _tally(t, uint8(o >> 32) & 1, uint8(o >> 32), o >> 160, uint64(o >> 96));
        }
        for (uint256 n = old.length; n > w; --n) {
            list.pop();
        }
    }

    /// @dev Forgets orders the exchange has closed (filled, cancelled or released).
    function _prune(uint32 id) internal {
        uint256[] storage list = _orders[id];
        uint256[] memory old = list;
        if (old.length == 0) return;
        IConditionalStocks.Resting[] memory r = EXCHANGE.restingOrders(old);
        uint256 w;
        for (uint256 j; j < old.length; ++j) {
            if (r[j].remaining == 0) continue;
            if (w != j) list[w] = old[j];
            ++w;
        }
        for (uint256 n = old.length; n > w; --n) {
            list.pop();
        }
    }

    /// @dev Cancels every tracked order of a market; the exchange returns their escrow.
    function _releaseOrders(uint32 id) internal {
        uint256[] memory keys = _orders[id];
        if (keys.length == 0) return;
        delete _orders[id];
        EXCHANGE.cancelMany(keys);
    }

    function _dropMarket(uint32 id) internal {
        delete _markets[id];
        uint256 last = _marketIds.length - 1;
        for (uint256 i; i <= last; ++i) {
            if (_marketIds[i] == id) {
                _marketIds[i] = _marketIds[last];
                _marketIds.pop();
                break;
            }
        }
        emit MarketRemoved(id);
    }

    /// @dev Redeems resolved claims; an INVALID (1/2 each) payout leaves an odd raw unit behind.
    function _redeem(
        uint32 id,
        uint8 collateral,
        uint256 yes,
        uint256 no,
        IConditionalStocks.Book memory b
    ) internal {
        if (b.payoutYes == 1 && b.payoutNo == 1 && (yes + no) % 2 == 1) {
            if (yes > no) --yes;
            else --no;
        }
        if (yes != 0 || no != 0) EXCHANGE.redeem(id, collateral, yes, no);
    }

    function _checkRisk(Risk calldata r) internal pure {
        if (
            r.bandBps == 0 || r.bandBps > MAX_BAND_BPS || r.cutoffBuffer > MAX_CUTOFF_BUFFER
                || r.maxOrder > r.maxResting
        ) revert InvalidConfig();
    }

    function _max(int256 a, int256 b) internal pure returns (int256) {
        return a > b ? a : b;
    }

    function _min(int256 a, int256 b) internal pure returns (int256) {
        return a < b ? a : b;
    }
}
