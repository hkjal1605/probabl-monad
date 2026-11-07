// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { WorldBooksBase } from "./WorldBooksBase.sol";
import { IPriceFeed } from "./interfaces/IPriceFeed.sol";
import { BookDef, BookView, WorldQuote } from "./interfaces/IWorldBooks.sol";

/// @title WorldBooksAdmin
/// @notice Governance, book creation, fixing, delegation and views of `WorldBooks`. Deployed by
///         and bound to one `WorldBooks`, which reaches it by delegatecall: every function here
///         runs on that contract's storage.
/// @dev Called directly it only reads and writes its own empty storage.
contract WorldBooksAdmin is WorldBooksBase {
    /// @dev This module's own address: under the delegatecall, `address(this)` is `WorldBooks`.
    address private immutable SELF = address(this);

    constructor(address quote_, address oracle_) WorldBooksBase(quote_, oracle_) { }

    // ---------------------------------------------------------------- governance

    function configure(address bookAdmin_, address guardian_, address resolutionAdmin_) external {
        if (msg.sender != _admin) revert Unauthorized();
        if (bookAdmin_ == address(0) || guardian_ == address(0) || resolutionAdmin_ == address(0)) {
            revert InvalidAddress();
        }
        _bookAdmin = bookAdmin_;
        _guardian = guardian_;
        _resolutionAdmin = resolutionAdmin_;
        emit Configured(bookAdmin_, guardian_, resolutionAdmin_);
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

    /// @notice Halts every fill. Custody, positions and redemption keep working.
    function pause(bool paused_, bytes32 reason) external {
        if (msg.sender != _guardian) revert Unauthorized();
        if (reason == bytes32(0) || paused_ == _paused) revert InvalidTerms();
        _paused = paused_;
        emit PauseSet(paused_, reason);
    }

    /// @notice Moves accrued fees into `to`'s credit.
    function claimFees(address to, uint256 amount) external nonReentrant {
        if (msg.sender != _admin) revert Unauthorized();
        if (to == address(0) || to == address(this) || amount == 0) revert InvalidTerms();
        uint256 available = _fees;
        if (available < amount) revert InsufficientFunds();
        _fees = available - amount;
        _credit[to] += amount;
        emit FeesClaimed(to, amount);
    }

    // ---------------------------------------------------------------- books

    /// @notice Creates a book, or returns the existing one with the same definition. Every leg
    ///         must still be unknown in the oracle. See `BookDef` for the rules.
    function createBook(BookDef calldata def, string calldata metadataUri)
        external
        nonReentrant
        returns (uint64 id)
    {
        if (msg.sender != _bookAdmin) revert Unauthorized();
        bytes32 defHash = keccak256(abi.encode(def));
        id = _bookOf[defHash];
        if (id != 0) return id;

        uint256 legCount = def.legs.length;
        if (legCount == 0 || legCount > MAX_LEGS) revert InvalidBook();
        bytes32[] memory keys = new bytes32[](legCount);
        uint8 wants;
        for (uint256 i; i < legCount; ++i) {
            bytes32 key = def.legs[i].eventKey;
            if (key == bytes32(0)) revert InvalidBook();
            for (uint256 j; j < i; ++j) {
                if (keys[j] == key) revert InvalidBook();
            }
            keys[i] = key;
            // forge-lint: disable-next-line(incorrect-shift)
            if (def.legs[i].wantYes) wants |= uint8(1 << i);
        }
        (uint8[] memory states,) = ORACLE.outcomes(keys);
        for (uint256 i; i < legCount; ++i) {
            if (states[i] != E_UNKNOWN) revert InvalidBook();
        }

        uint256 strikeCount = def.strikes.length;
        if (def.feed == address(0)) {
            if (
                strikeCount != 0 || def.fixingTime != 0 || def.maxStaleness != 0
                    || def.underlying != bytes32(0)
            ) revert InvalidBook();
        } else {
            if (
                strikeCount == 0 || strikeCount > MAX_STRIKES || def.underlying == bytes32(0)
                    || def.maxStaleness == 0 || def.maxStaleness > MAX_STALENESS
                    || def.fixingTime < def.cutoff
            ) revert InvalidBook();
            _checkFeed(def.feed);
            uint256 previous;
            for (uint256 i; i < strikeCount; ++i) {
                uint256 strike = def.strikes[i];
                if (strike <= previous) revert InvalidBook();
                previous = strike;
            }
        }
        if (def.cutoff <= block.timestamp) revert InvalidBook();
        if (def.feeBps > MAX_FEE_BPS) revert FeeCap();
        if (
            bytes(metadataUri).length == 0 || bytes(metadataUri).length > MAX_URI
                || keccak256(bytes(metadataUri)) != def.metadataHash
        ) revert InvalidBook();

        id = ++_bookCount;
        _books[id] = Book({
            feed: def.feed,
            fixingTime: def.fixingTime,
            cutoff: def.cutoff,
            feeBps: def.feeBps,
            maxStaleness: def.maxStaleness,
            legCount: uint8(legCount),
            strikeCount: uint8(strikeCount),
            wants: wants,
            status: UNDECIDED,
            winner: 0,
            frozen: false,
            held: false
        });
        bytes32[6] storage storedLegs = _legs[id];
        for (uint256 i; i < legCount; ++i) {
            storedLegs[i] = keys[i];
        }
        uint128[8] storage storedStrikes = _strikes[id];
        for (uint256 i; i < strikeCount; ++i) {
            storedStrikes[i] = def.strikes[i];
        }
        if (def.underlying != bytes32(0)) _underlyings[id] = def.underlying;
        _bookOf[defHash] = id;
        emit BookCreated(id, defHash, def, metadataUri);
    }

    /// @notice Stops (`frozen`) or restarts trading in one book. The book admin and the guardian
    ///         may freeze; only the book admin unfreezes.
    function setFrozen(uint64 id, bool frozen, bytes32 reason) external {
        if (msg.sender != _bookAdmin && (msg.sender != _guardian || !frozen)) {
            revert Unauthorized();
        }
        Book storage b = _books[id];
        if (b.legCount == 0) revert UnknownBook();
        if (reason == bytes32(0) || b.frozen == frozen) revert InvalidTerms();
        b.frozen = frozen;
        emit BookFrozen(id, frozen, reason, msg.sender);
    }

    function _checkFeed(address feed) private view {
        if (feed.code.length == 0) revert InvalidBook();
        (bool ok, bytes memory data) = feed.staticcall(abi.encodeCall(IPriceFeed.decimals, ()));
        if (!ok || data.length < 32 || abi.decode(data, (uint256)) > 18) revert InvalidBook();
    }

    // ---------------------------------------------------------------- fixing

    /// @notice Proposes the feed round `roundId` as a book's fixing (anyone can call). The book
    ///         must await its fixing (every leg passed, the fixing time reached). The round must
    ///         be at or before the fixing time, at most `maxStaleness` older, and provably the
    ///         last round at or before it: either the feed's latest round (no later round can
    ///         carry an earlier timestamp), or the round right after it is past the fixing time.
    ///         So no proposal can pick an earlier round, and one proposal stands per book; a
    ///         feed with gaps in its round ids, or a phase change at the fixing, falls back to the
    ///         two-key path.
    function proposeFix(uint64 id, uint80 roundId) external nonReentrant {
        Book memory b = _awaitingFix(id);
        if (b.held || _fixCommitments[id] != bytes32(0)) revert FixHeld();
        if (_fixes[id].proposedAt != 0) revert StaleFix();
        IPriceFeed feed = IPriceFeed(b.feed);
        (, int256 answer,, uint256 updatedAt,) = feed.getRoundData(roundId);
        if (
            answer <= 0 || uint256(answer) > type(uint128).max || updatedAt == 0
                || updatedAt > b.fixingTime || updatedAt + b.maxStaleness < b.fixingTime
                || !_lastAtOrBefore(feed, roundId, b.fixingTime)
        ) revert InvalidFix();
        _fixes[id] =
            Fix(uint128(uint256(answer)), uint40(updatedAt), uint40(block.timestamp), roundId);
        emit FixProposed(id, roundId, uint256(answer), uint40(updatedAt), msg.sender);
    }

    /// @dev Whether no round after `roundId` is at or before `fixingTime`: it is the latest, or
    ///      its successor is later. Round ids and timestamps only grow.
    function _lastAtOrBefore(IPriceFeed feed, uint80 roundId, uint256 fixingTime)
        private
        view
        returns (bool)
    {
        (uint80 latest,,,,) = feed.latestRoundData();
        if (latest == roundId) return true;
        if (roundId == type(uint80).max) return false;
        try feed.getRoundData(roundId + 1) returns (
            uint80, int256, uint256, uint256 nextUpdatedAt, uint80
        ) {
            return nextUpdatedAt > fixingTime;
        } catch {
            return false;
        }
    }

    /// @notice Decides a book by its proposal once it has stood FIX_WINDOW (anyone can call). A
    ///         held fixing, or one with a fallback price committed, only resolves through the
    ///         fallback.
    function finalizeFix(uint64 id) external nonReentrant returns (uint8 winner) {
        Book memory b = _awaitingFix(id);
        if (b.held || _fixCommitments[id] != bytes32(0)) revert FixHeld();
        Fix memory f = _fixes[id];
        if (f.proposedAt == 0) revert InvalidFix();
        if (block.timestamp < uint256(f.proposedAt) + FIX_WINDOW) revert FixWindow();
        winner = _fixed(id, b, f.price);
    }

    /// @notice The guardian stops a book's fixing from finalizing, leaving it to the two-key
    ///         fallback (a manipulated or wrong round).
    function holdFix(uint64 id) external {
        if (msg.sender != _guardian) revert Unauthorized();
        Book storage b = _books[id];
        if (b.legCount == 0) revert UnknownBook();
        if (b.feed == address(0) || b.status != UNDECIDED || b.held) revert InvalidState();
        b.held = true;
        emit FixHeldSet(id, msg.sender);
    }

    /// @notice The book admin commits a fallback price (`fixHash`) for a book whose fixing is
    ///         held, or that has awaited it FIX_DEADLINE with no proposal. A book starts awaiting
    ///         at the later of its fixing time and its last leg's resolution.
    function commitFix(uint64 id, bytes32 commitment_) external nonReentrant {
        if (msg.sender != _bookAdmin) revert Unauthorized();
        if (commitment_ == bytes32(0)) revert InvalidTerms();
        Book memory b = _books[id];
        if (b.legCount == 0) revert UnknownBook();
        uint256 since = _awaitingSince(id, b);
        if (!b.held && (_fixes[id].proposedAt != 0 || block.timestamp < since + FIX_DEADLINE)) {
            revert FixWindow();
        }
        _fixCommitments[id] = commitment_;
        emit FixCommitted(id, commitment_, msg.sender);
    }

    /// @notice The resolution admin sets the committed fallback price, deciding the book.
    function resolveFix(uint64 id, uint256 price, bytes32 evidence, string calldata uri)
        external
        nonReentrant
        returns (uint8 winner)
    {
        if (msg.sender != _resolutionAdmin) revert Unauthorized();
        if (
            price == 0 || price > type(uint128).max || evidence == bytes32(0)
                || bytes(uri).length == 0 || bytes(uri).length > MAX_URI
        ) revert InvalidTerms();
        bytes32 committed = _fixCommitments[id];
        if (committed == bytes32(0) || committed != fixHash(id, price, evidence, uri)) {
            revert Commitment();
        }
        Book memory b = _books[id];
        _awaitingSince(id, b);
        delete _fixCommitments[id];
        winner = _fixed(id, b, price);
        emit FixResolved(id, price, evidence, uri);
    }

    /// @notice The commitment the book admin prepares for a fallback price.
    function fixHash(uint64 id, uint256 price, bytes32 evidence, string calldata uri)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                "PROBABL_EVM_FIX_V1",
                block.chainid,
                address(this),
                id,
                price,
                evidence,
                keccak256(bytes(uri))
            )
        );
    }

    /// @dev Reverts unless the book awaits its fixing: undecided, with a feed, every leg passed
    ///      and the fixing time reached.
    function _awaitingFix(uint64 id) private view returns (Book memory b) {
        b = _books[id];
        if (b.legCount == 0) revert UnknownBook();
        _awaitingSince(id, b);
    }

    /// @dev When the book started awaiting its fixing; reverts unless it does.
    function _awaitingSince(uint64 id, Book memory b) private view returns (uint256 since) {
        if (b.feed == address(0) || b.status != UNDECIDED) revert InvalidState();
        (uint256 failed, uint256 passed,, uint256 lastResolved) = _legStatus(id, b);
        if (failed != 0 || passed != b.legCount || block.timestamp < b.fixingTime) {
            revert InvalidState();
        }
        since = lastResolved > b.fixingTime ? lastResolved : b.fixingTime;
    }

    function _fixed(uint64 id, Book memory b, uint256 price) private returns (uint8 winner) {
        winner = _bucket(id, b.strikeCount, price);
        Book storage s = _books[id];
        s.status = FIXED;
        s.winner = winner;
        delete _fixes[id];
        emit BookDecided(id, FIXED, winner);
    }

    // ---------------------------------------------------------------- delegation

    /// @notice Grants a key that fills quotes for the caller: buys (`permissions` 1) spending at
    ///         most `maxBuy` per fill and `totalBuy` in all (price plus fee), sells (2) at most
    ///         `maxSell` per fill and `totalSell` in all (the bundle's largest payout), or both
    ///         (3). Proceeds always stay with the owner. Replaces an existing grant to the key and
    ///         its budgets whole, so a key watching the mempool could spend the old budget first:
    ///         to cut a budget safely, revoke the key, then approve it again.
    function approveDelegate(
        address delegate,
        uint40 expiresAt,
        uint128 maxBuy,
        uint128 totalBuy,
        uint128 maxSell,
        uint128 totalSell,
        uint16 maxFeeBps,
        uint8 permissions
    ) external {
        if (delegate == address(0) || delegate == msg.sender) {
            revert InvalidDelegation();
        }
        if (
            expiresAt <= block.timestamp || expiresAt - block.timestamp > MAX_GRANT_LIFETIME
                || permissions == 0 || permissions > (BUY | SELL) || maxFeeBps > MAX_FEE_BPS
                || (permissions & BUY != 0 && (maxBuy == 0 || totalBuy < maxBuy))
                || (permissions & SELL != 0 && (maxSell == 0 || totalSell < maxSell))
        ) revert InvalidDelegation();
        uint64 epoch = _delegationEpochs[msg.sender];
        _grants[msg.sender][delegate] = Delegation({
            expiresAt: expiresAt,
            epoch: epoch,
            maxFeeBps: maxFeeBps,
            permissions: permissions,
            revoked: false
        });
        _budgets[msg.sender][delegate] = Budget(
            permissions & BUY != 0 ? maxBuy : 0,
            permissions & BUY != 0 ? totalBuy : 0,
            permissions & SELL != 0 ? maxSell : 0,
            permissions & SELL != 0 ? totalSell : 0
        );
        emit DelegateApproved(
            msg.sender,
            delegate,
            epoch,
            expiresAt,
            maxBuy,
            totalBuy,
            maxSell,
            totalSell,
            maxFeeBps,
            permissions
        );
    }

    function revokeDelegate(address delegate) external {
        Delegation storage g = _grants[msg.sender][delegate];
        if (g.permissions == 0 || g.revoked) revert InvalidDelegation();
        g.revoked = true;
        emit DelegateRevoked(msg.sender, delegate);
    }

    /// @notice Invalidates every grant of the caller at once.
    function revokeAllDelegates() external {
        uint64 epoch = ++_delegationEpochs[msg.sender];
        emit DelegatesRevoked(msg.sender, epoch);
    }

    // ---------------------------------------------------------------- views

    function module() external view returns (address) {
        return SELF;
    }

    function quote() external view returns (address) {
        return QUOTE;
    }

    function oracle() external view returns (address) {
        return address(ORACLE);
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
        returns (address bookAdmin, address guardian, address resolutionAdmin)
    {
        return (_bookAdmin, _guardian, _resolutionAdmin);
    }

    function paused() external view returns (bool) {
        return _paused;
    }

    function bookCount() external view returns (uint64) {
        return _bookCount;
    }

    function bookOf(bytes32 defHash) external view returns (uint64) {
        return _bookOf[defHash];
    }

    function book(uint64 id) external view returns (BookView memory v) {
        Book memory b = _books[id];
        v = BookView({
            feed: b.feed,
            underlying: _underlyings[id],
            fixingTime: b.fixingTime,
            maxStaleness: b.maxStaleness,
            cutoff: b.cutoff,
            feeBps: b.feeBps,
            legCount: b.legCount,
            strikeCount: b.strikeCount,
            atomCount: b.legCount == 0 ? 0 : uint8(_atomCount(b)),
            status: b.status,
            winner: b.winner,
            frozen: b.frozen,
            held: b.held
        });
    }

    function legs(uint64 id) external view returns (bytes32[] memory keys, bool[] memory wantYes) {
        Book memory b = _books[id];
        keys = _legKeys(id, b.legCount);
        wantYes = new bool[](b.legCount);
        for (uint256 i; i < b.legCount; ++i) {
            wantYes[i] = (b.wants >> i) & 1 == 1;
        }
    }

    function strikes(uint64 id) external view returns (uint256[] memory out) {
        uint256 count = _books[id].strikeCount;
        out = new uint256[](count);
        uint128[8] storage stored = _strikes[id];
        for (uint256 i; i < count; ++i) {
            out[i] = stored[i];
        }
    }

    /// @notice 0 unknown book, 1 trading, 2 halted (a leg frozen or committed, or the book
    ///         frozen), 3 closed (past the cutoff, awaiting legs), 4 awaiting its fixing,
    ///         5 failed (atom 0 wins), 6 passed (atom 1 of an event-only book wins), 7 fixed.
    ///         States 5 and 6 may not be latched yet (`settle`). The global pause is separate.
    function state(uint64 id) external view returns (uint8) {
        Book memory b = _books[id];
        if (b.legCount == 0) return 0;
        return _stateOf(id, b);
    }

    function fix(uint64 id) external view returns (Fix memory) {
        return _fixes[id];
    }

    function fixCommitment(uint64 id) external view returns (bytes32) {
        return _fixCommitments[id];
    }

    function credit(address owner) external view returns (uint256) {
        return _credit[owner];
    }

    function atoms(uint64 id, address owner) external view returns (uint256[] memory) {
        Book memory b = _books[id];
        if (b.legCount == 0) return new uint256[](0);
        return _loadAtoms(id, owner, _atomCount(b));
    }

    function backing(uint64 id) external view returns (uint256) {
        return _backing[id];
    }

    function fees() external view returns (uint256) {
        return _fees;
    }

    function liability() external view returns (uint256) {
        return _liability;
    }

    function nonceUsed(address maker, uint256 nonce) external view returns (bool) {
        return (_nonces[maker][nonce >> 8] >> (nonce & 255)) & 1 == 1;
    }

    function delegationEpoch(address owner) external view returns (uint64) {
        return _delegationEpochs[owner];
    }

    function grant(address owner, address delegate)
        external
        view
        returns (Delegation memory g, Budget memory b)
    {
        return (_grants[owner][delegate], _budgets[owner][delegate]);
    }

    /// @notice The EIP-712 digest a maker signs for `q`.
    function quoteDigest(WorldQuote calldata q) external view returns (bytes32) {
        return _digest(q);
    }
}
