// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BookView, IWorldBooks, WorldQuote } from "../interfaces/IWorldBooks.sol";
import { WorldVaultBase } from "./WorldVaultBase.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title WorldVaultAdmin
/// @notice The maker hook, risk tracking, curation, governance and views of `WorldVault`.
///         Deployed by and bound to one `WorldVault`, which reaches it by delegatecall: every
///         function here runs on that contract's storage.
/// @dev Called directly it only reads and writes its own empty storage.
contract WorldVaultAdmin is WorldVaultBase {
    /// @dev This module's own address: under the delegatecall, `address(this)` is the vault.
    address private immutable SELF = address(this);

    constructor(
        IWorldBooks books,
        address admin,
        uint48 adminDelay,
        string memory name_,
        string memory symbol_
    ) WorldVaultBase(books, admin, adminDelay, name_, symbol_) { }

    // ---------------------------------------------------------------- the maker hook

    /// @notice `WorldBooks` asks after moving the balances of a fill naming the vault as maker.
    ///         `makerData` carries the quote epoch (low 24 bits) and the signing time (the next
    ///         40). The fill is accepted only when:
    ///         - a keeper signed the quote for the current epoch, not in the future, living at
    ///           most `maxTtl` from signing and ending `cutoffBuffer` before the book's cutoff;
    ///         - its size and price are within the caps, and the price keeps `marginBps` of the
    ///           payout range inside it;
    ///         - no leg of the book resolved at or after the signing (a stale price);
    ///         - the day's exposure stays within `maxDailyExposureBps` of the reference value;
    ///         - and, when the fill grows the book's risk, the book is eligible and its risk and
    ///           each leg's are within their caps;
    ///         - and, when it lowers the guaranteed value, that stays above the loss floor.
    ///         A fill that neither grows risk nor lowers the guaranteed value is always accepted
    ///         within the first four conditions, so the vault can always unwind.
    function onWorldFill(
        bytes32 digest,
        WorldQuote calldata q,
        bytes32 r,
        bytes32 vs,
        uint256 makerCreditBefore
    ) external nonReentrant returns (bytes4) {
        if (msg.sender != address(BOOKS)) revert Unauthorized();
        _requireNotPaused();
        if (!hasRole(KEEPER_ROLE, ECDSA.recover(digest, r, vs))) revert QuoteSigner();
        if (uint24(q.makerData) != uint24(_quoteEpoch)) revert QuoteEpoch();
        uint256 signedAt = uint40(q.makerData >> 24);

        Limits memory l = _limits;
        Risk memory k = _risk;
        BookView memory b = BOOKS.book(q.book);
        if (
            signedAt > block.timestamp || q.expiry > signedAt + l.maxTtl
                || uint256(q.expiry) + l.cutoffBuffer > b.cutoff
        ) revert QuoteExpiry();
        (uint256 minPay, uint256 maxPay) = _payRange(q, b.atomCount);
        if (maxPay > k.maxQuoteSize || q.price > k.maxQuotePrice) revert QuoteSize();
        uint256 margin = (maxPay - minPay) * l.marginBps / BPS;
        if (q.sell ? q.price > maxPay - margin : q.price < minPay + margin) revert QuotePrice();
        bytes32[] memory keys = _legsOf(q.book);
        (, uint40[] memory resolvedAt) = ORACLE.outcomes(keys);
        for (uint256 i; i < resolvedAt.length; ++i) {
            if (resolvedAt[i] != 0 && resolvedAt[i] >= signedAt) revert LegJustResolved();
        }
        uint256 ref = _refNav;
        _spendExposure(
            q.sell ? q.price - minPay : maxPay - q.price, ref * k.maxDailyExposureBps / BPS
        );

        uint256 creditAfter = BOOKS.credit(address(this));
        uint256 guaranteedBefore = makerCreditBefore + _sumLo;
        (uint256 oldRisk, uint256 newRisk) = _sync(
            q.book, keys, SafeCast.toInt256(makerCreditBefore) - SafeCast.toInt256(creditAfter)
        );
        if (newRisk > oldRisk) {
            _checkEligible(b, l);
            if (newRisk > k.maxBookRisk) revert BookRisk();
            for (uint256 i; i < keys.length; ++i) {
                if (_legRisk[keys[i]] > k.maxLegRisk) revert LegRisk();
            }
        }
        uint256 guaranteedAfter = creditAfter + _sumLo;
        if (guaranteedAfter < guaranteedBefore && guaranteedAfter < ref - ref * k.maxLossBps / BPS)
        {
            revert LossCap();
        }
        return this.onWorldFill.selector;
    }

    function _checkEligible(BookView memory b, Limits memory l) private view {
        uint256 decision = b.feed == address(0) ? b.cutoff : b.fixingTime;
        if (
            b.legCount == 0 || b.legCount > l.maxLegs || b.feeBps > l.maxFeeBps
                || (b.feed == address(0) ? !l.eventOnly : !_feeds[b.feed])
                || decision > block.timestamp + l.maxTenor
        ) revert IneligibleBook();
    }

    /// @dev Adds a fill's exposure to the day's; reverts past the day's budget.
    function _spendExposure(uint256 exposure, uint256 budget) private {
        Day memory d = _day;
        uint64 today = uint64(block.timestamp / 1 days);
        uint256 used = (d.day == today ? uint256(d.used) : 0) + exposure;
        if (used > budget) revert DailyExposure();
        _day = Day(today, uint192(used));
    }

    // ---------------------------------------------------------------- positions

    /// @notice Merges `amount` full sets the vault holds in `book` back into credit.
    function merge(uint64 book, uint256 amount) external nonReentrant onlyRole(KEEPER_ROLE) {
        BOOKS.merge(book, amount);
        _sync(book, _legsOf(book), -SafeCast.toInt256(amount));
    }

    /// @notice Redeems the vault's atoms of every decided book listed and drops their positions
    ///         (anyone can call). Books not yet decided are skipped.
    function settle(uint64[] calldata books) external nonReentrant {
        for (uint256 i; i < books.length; ++i) {
            uint64 book = books[i];
            uint8 s = BOOKS.state(book);
            if (s < S_FAILED || s > S_FIXED) continue;
            uint256[] memory balances = BOOKS.atoms(book, address(this));
            bool any;
            for (uint256 j; j < balances.length; ++j) {
                if (balances[j] != 0) any = true;
            }
            if (any) BOOKS.redeem(book);
            _clear(book, _legsOf(book));
        }
    }

    /// @notice Re-reads the vault's atoms of `book` (anyone can call), e.g. after a transfer of
    ///         atoms to the vault, which can only lower its risk.
    function sync(uint64 book) external nonReentrant {
        _sync(book, _legsOf(book), 0);
    }

    // ---------------------------------------------------------------- curation and governance

    function setLimits(Limits calldata l) external onlyRole(CURATOR_ROLE) {
        if (
            l.maxTtl > MAX_TTL || l.cutoffBuffer > MAX_CUTOFF_BUFFER || l.maxLegs > MAX_LEGS
                || l.maxFeeBps > MAX_FEE_BPS || l.marginBps > BPS
        ) revert InvalidLimits();
        _limits = l;
        emit LimitsSet(l);
    }

    function setRisk(Risk calldata k) external onlyRole(CURATOR_ROLE) {
        if (k.maxLossBps > BPS || k.maxDailyExposureBps > BPS) revert InvalidLimits();
        _risk = k;
        emit RiskSet(k);
    }

    function setFeed(address feed, bool allowed) external onlyRole(CURATOR_ROLE) {
        if (feed == address(0)) revert InvalidLimits();
        _feeds[feed] = allowed;
        emit FeedSet(feed, allowed);
    }

    function setDepositCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _depositCap = cap;
        emit DepositCapSet(cap);
    }

    function setOpenDeposits(bool open) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _openDeposits = open;
        emit OpenDepositsSet(open);
    }

    function setWithdrawLimit(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps < MIN_WITHDRAW_LIMIT_BPS || bps > BPS) revert InvalidLimits();
        _withdrawLimitBps = bps;
        emit WithdrawLimitSet(bps);
    }

    function setMaxMarkMove(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > BPS) revert InvalidLimits();
        _maxMarkMoveBps = bps;
        emit MaxMarkMoveSet(bps);
    }

    /// @notice Pauses deposits and quoting and voids every outstanding quote.
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
        uint64 epoch = ++_quoteEpoch;
        emit QuoteEpochAdvanced(epoch);
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Voids every outstanding quote without pausing (keeper rotation).
    function advanceQuoteEpoch() external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && !hasRole(KEEPER_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        uint64 epoch = ++_quoteEpoch;
        emit QuoteEpochAdvanced(epoch);
    }

    /// @notice Lets the closed batch be marked at exactly `nav` beyond the move limit; the
    ///         bounds still apply.
    function approveMark(uint64 id, uint256 nav) external onlyRole(GUARDIAN_ROLE) {
        if (id == 0 || id != _closedBatch) revert BatchState();
        _approvedMarks[id] = nav + 1;
        emit MarkApproved(id, nav);
    }

    // ---------------------------------------------------------------- views

    function module() external view returns (address) {
        return SELF;
    }

    function limits() external view returns (Limits memory) {
        return _limits;
    }

    function risk() external view returns (Risk memory) {
        return _risk;
    }

    function feedAllowed(address feed) external view returns (bool) {
        return _feeds[feed];
    }

    function position(uint64 book) external view returns (Position memory) {
        return _positions[book];
    }

    function legRisk(bytes32 eventKey) external view returns (uint256) {
        return _legRisk[eventKey];
    }

    /// @notice The vault's credit on `WorldBooks`, its tracked lowest and highest atom sums, and
    ///         the guaranteed and best values they give.
    function totals()
        external
        view
        returns (uint256 credit, uint256 sumLo, uint256 sumHi, uint256 guaranteed, uint256 best)
    {
        credit = BOOKS.credit(address(this));
        sumLo = _sumLo;
        sumHi = _sumHi;
        guaranteed = credit + sumLo;
        best = credit + sumHi;
    }

    function quoteEpoch() external view returns (uint64) {
        return _quoteEpoch;
    }

    function day() external view returns (Day memory) {
        return _day;
    }

    function batch(uint64 id) external view returns (Batch memory) {
        return _batches[id];
    }

    /// @notice The batch taking requests and the closed batch awaiting its mark (zero: none).
    function batches() external view returns (uint64 open, uint64 closed) {
        return (_batchId, _closedBatch);
    }

    function requests(uint64 id, address owner)
        external
        view
        returns (uint256 assets, uint256 shares)
    {
        return (_deposits[id][owner], _redeems[id][owner]);
    }

    function approvedMark(uint64 id) external view returns (bool approved, uint256 nav) {
        uint256 v = _approvedMarks[id];
        return (v != 0, v == 0 ? 0 : v - 1);
    }

    function refNav() external view returns (uint256) {
        return _refNav;
    }

    function lastNavPerShare() external view returns (uint256) {
        return _lastNavPerShare;
    }

    function depositCap() external view returns (uint256) {
        return _depositCap;
    }

    function openDeposits() external view returns (bool) {
        return _openDeposits;
    }

    function withdrawLimitBps() external view returns (uint16) {
        return _withdrawLimitBps;
    }

    function maxMarkMoveBps() external view returns (uint16) {
        return _maxMarkMoveBps;
    }

    /// @notice Assets the vault holds outside `WorldBooks`: pending deposits and unclaimed
    ///         results; and the shares it holds for owners.
    function held()
        external
        view
        returns (uint256 pendingAssets, uint256 owedAssets, uint256 escrowShares)
    {
        return (_pendingAssets, _owedAssets, _escrowShares);
    }
}
