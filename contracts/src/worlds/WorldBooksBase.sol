// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IEventOracle } from "./interfaces/IEventOracle.sol";
import { BookDef, WorldQuote } from "./interfaces/IWorldBooks.sol";

/// @notice Storage layout, types, events and shared helpers of `WorldBooks`.
/// @dev `WorldBooks` (custody, positions, fills, redemption) and `WorldBooksAdmin` (governance,
///      books, fixing, delegation and views, executed by delegatecall from the former) inherit
///      this single layout. Neither may declare state variables of its own.
abstract contract WorldBooksBase {
    // ---------------------------------------------------------------- constants

    uint256 internal constant BPS = 10_000;
    uint16 internal constant MAX_FEE_BPS = 1_000;
    uint256 internal constant MAX_LEGS = 6;
    uint256 internal constant MAX_STRIKES = 8;
    uint32 internal constant MAX_STALENESS = 1 days;
    /// @dev How long a fixing proposal stands before it can be finalized: the guardian's window
    ///      to hold a provably-last round that is nonetheless wrong (a feed glitch).
    uint64 internal constant FIX_WINDOW = 1 hours;
    /// @dev How long after a book starts awaiting its fixing, with no proposal, the two-key
    ///      fallback may set the price.
    uint64 internal constant FIX_DEADLINE = 1 days;
    uint64 internal constant ADMIN_DELAY = 2 days;
    uint64 internal constant MAX_GRANT_LIFETIME = 90 days;
    uint256 internal constant MAX_URI = 512;
    /// @dev Gas a maker contract's `onWorldFill` may use. The world vault's costliest hook (six
    ///      legs, every slot written cold) uses about 300k on Ethereum's schedule; chains that
    ///      price cold storage higher (Monad) need the headroom. Only the taker who chose the
    ///      maker's quote pays for it.
    uint256 internal constant FILL_HOOK_GAS = 1_000_000;
    /// @dev secp256k1n / 2: higher `s` values are the malleable twin of a valid signature.
    uint256 internal constant HALF_ORDER =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    // EventOracle states.
    uint8 internal constant E_UNKNOWN = 0;
    uint8 internal constant E_FROZEN = 1;
    uint8 internal constant E_COMMITTED = 2;
    uint8 internal constant E_YES = 3;
    uint8 internal constant E_NO = 4;
    uint8 internal constant E_INVALID = 5;

    // Stored book status.
    uint8 internal constant UNDECIDED = 1;
    uint8 internal constant FAILED = 2;
    uint8 internal constant PASSED = 3;
    uint8 internal constant FIXED = 4;

    // Book states of the `state` view.
    uint8 internal constant S_TRADING = 1;
    uint8 internal constant S_HALTED = 2;
    uint8 internal constant S_CLOSED = 3;
    uint8 internal constant S_AWAITING_FIX = 4;
    uint8 internal constant S_FAILED = 5;
    uint8 internal constant S_PASSED = 6;
    uint8 internal constant S_FIXED = 7;

    // Delegation permissions.
    uint8 internal constant BUY = 1;
    uint8 internal constant SELL = 2;

    bytes32 internal constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 internal constant NAME_HASH = keccak256("Probabl Worlds");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    bytes32 internal constant WORLD_QUOTE_TYPEHASH = keccak256(
        "WorldQuote(address taker,uint64 book,uint16 mask,uint128 units,uint128 refund,bool sell,"
        "uint128 price,uint40 expiry,uint64 makerData,uint256 nonce)"
    );

    // ---------------------------------------------------------------- errors

    error Unauthorized();
    error InvalidAddress();
    error InvalidTerms();
    error InvalidBook();
    error InvalidBundle();
    error InvalidState();
    error UnknownBook();
    error NotTrading();
    error NotDecided();
    error Expired();
    error BadSignature();
    error NonceUsed();
    error SelfTrade();
    error MakerRejected();
    error FeeCap();
    error InsufficientFunds();
    error NothingToRedeem();
    error InvalidDelegation();
    error DelegationInactive();
    error DelegateBudget();
    error InvalidFix();
    error StaleFix();
    error FixWindow();
    error FixHeld();
    error Commitment();
    error AdminDelay();
    error TransferFailed();
    error Reentrancy();
    error Overflow();

    // ---------------------------------------------------------------- events

    event Configured(address bookAdmin, address guardian, address resolutionAdmin);
    event AdminProposed(address indexed successor, uint64 acceptableAfter);
    event AdminAccepted(address indexed admin);
    event PauseSet(bool paused, bytes32 reason);
    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount, address to);
    event BookCreated(
        uint64 indexed book, bytes32 indexed defHash, BookDef def, string metadataUri
    );
    event BookFrozen(uint64 indexed book, bool frozen, bytes32 reason, address actor);
    /// @param kind 0 split, 1 merge.
    event PositionChanged(uint64 indexed book, address indexed owner, uint8 kind, uint256 amount);
    event AtomsTransferred(
        uint64 indexed book, address indexed from, address indexed to, uint8 atom, uint256 amount
    );
    /// @param bundle mask(16) | sell(8) << 16; `units` and `refund` as quoted.
    event WorldFill(
        uint64 indexed book,
        address indexed maker,
        address indexed taker,
        uint256 bundle,
        uint256 units,
        uint256 refund,
        uint256 price,
        uint256 fee,
        uint256 nonce,
        address delegate
    );
    event BookDecided(uint64 indexed book, uint8 status, uint8 winner);
    event Redeemed(uint64 indexed book, address indexed owner, uint8 winner, uint256 amount);
    event FixProposed(
        uint64 indexed book, uint80 roundId, uint256 price, uint40 updatedAt, address actor
    );
    event FixHeldSet(uint64 indexed book, address actor);
    event FixCommitted(uint64 indexed book, bytes32 commitment, address actor);
    event FixResolved(uint64 indexed book, uint256 price, bytes32 evidence, string uri);
    event FeesClaimed(address indexed to, uint256 amount);
    event NoncesInvalidated(address indexed maker, uint256 word, uint256 bits);
    event DelegateApproved(
        address indexed owner,
        address indexed delegate,
        uint64 epoch,
        uint40 expiresAt,
        uint128 maxBuy,
        uint128 totalBuy,
        uint128 maxSell,
        uint128 totalSell,
        uint16 maxFeeBps,
        uint8 permissions
    );
    event DelegateRevoked(address indexed owner, address indexed delegate);
    event DelegatesRevoked(address indexed owner, uint64 epoch);

    // ---------------------------------------------------------------- types

    /// @dev Two slots. `wants` bit i: leg i needs YES. `status` is UNDECIDED until the book is
    ///      decided, then FAILED, PASSED or FIXED with `winner` the paying atom.
    struct Book {
        address feed;
        uint40 fixingTime;
        uint40 cutoff;
        uint16 feeBps;
        uint32 maxStaleness;
        uint8 legCount;
        uint8 strikeCount;
        uint8 wants;
        uint8 status;
        uint8 winner;
        bool frozen;
        bool held;
    }

    /// @dev The standing fixing proposal: `proposedAt` zero means none.
    struct Fix {
        uint128 price;
        uint40 updatedAt;
        uint40 proposedAt;
        uint80 roundId;
    }

    /// @dev Buys spend `remainingBuy` (price plus fee); sells spend `remainingSell` (the
    ///      bundle's largest payout). Neither refills.
    struct Delegation {
        uint40 expiresAt;
        uint64 epoch;
        uint16 maxFeeBps;
        uint8 permissions;
        bool revoked;
    }

    struct Budget {
        uint128 maxBuy;
        uint128 remainingBuy;
        uint128 maxSell;
        uint128 remainingSell;
    }

    // ---------------------------------------------------------------- storage

    address internal immutable QUOTE;
    IEventOracle internal immutable ORACLE;

    address internal _admin;
    address internal _pendingAdmin;
    uint64 internal _adminAfter;
    address internal _bookAdmin;
    address internal _resolutionAdmin;
    address internal _guardian;
    bool internal _paused;
    uint64 internal _bookCount;
    bool transient _locked;

    /// @dev Everything the contract owes: credit, book backing and unclaimed fees. Its token
    ///      balance never falls below this.
    uint256 internal _liability;
    uint256 internal _fees;
    mapping(address owner => uint256) internal _credit;
    mapping(uint64 book => Book) internal _books;
    mapping(uint64 book => bytes32[6]) internal _legs;
    mapping(uint64 book => uint128[8]) internal _strikes;
    mapping(uint64 book => bytes32) internal _underlyings;
    mapping(uint64 book => Fix) internal _fixes;
    mapping(uint64 book => bytes32) internal _fixCommitments;
    /// @dev Full sets outstanding: before a decision, every atom's supply; after it, the winning
    ///      atom's.
    mapping(uint64 book => uint256) internal _backing;
    /// @dev Atom balances, two uint128 per word: atom i in word i / 2, high half when i is odd.
    mapping(uint64 book => mapping(address owner => uint256[5])) internal _atoms;
    mapping(bytes32 defHash => uint64) internal _bookOf;
    /// @dev Used quote nonces: 256 per word.
    mapping(address maker => mapping(uint256 word => uint256 bits)) internal _nonces;
    mapping(address owner => uint64) internal _delegationEpochs;
    mapping(address owner => mapping(address delegate => Delegation)) internal _grants;
    mapping(address owner => mapping(address delegate => Budget)) internal _budgets;

    constructor(address quote_, address oracle_) {
        if (quote_.code.length == 0 || oracle_.code.length == 0) revert InvalidAddress();
        QUOTE = quote_;
        ORACLE = IEventOracle(oracle_);
    }

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    // ---------------------------------------------------------------- atoms

    function _atomCount(Book memory b) internal pure returns (uint256) {
        return b.feed == address(0) ? 2 : uint256(b.strikeCount) + 2;
    }

    function _loadAtoms(uint64 id, address owner, uint256 count)
        internal
        view
        returns (uint256[] memory balances)
    {
        uint256[5] storage words = _atoms[id][owner];
        balances = new uint256[](count);
        for (uint256 i; i < count; i += 2) {
            uint256 word = words[i >> 1];
            balances[i] = uint128(word);
            if (i + 1 < count) balances[i + 1] = word >> 128;
        }
    }

    /// @dev Writes back every balance, each checked to fit 128 bits.
    function _storeAtoms(uint64 id, address owner, uint256[] memory balances) internal {
        uint256[5] storage words = _atoms[id][owner];
        uint256 count = balances.length;
        for (uint256 i; i < count; i += 2) {
            uint256 word = _u128(balances[i]);
            if (i + 1 < count) word |= uint256(_u128(balances[i + 1])) << 128;
            words[i >> 1] = word;
        }
    }

    // ---------------------------------------------------------------- book state

    function _legKeys(uint64 id, uint256 count) internal view returns (bytes32[] memory keys) {
        bytes32[6] storage stored = _legs[id];
        keys = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            keys[i] = stored[i];
        }
    }

    /// @dev Counts legs that failed (resolved against the world, or INVALID) and passed, whether
    ///      an unresolved leg is frozen or committed, and the latest resolution among passed legs.
    function _legStatus(uint64 id, Book memory b)
        internal
        view
        returns (uint256 failed, uint256 passed, bool halted, uint256 lastResolved)
    {
        (uint8[] memory states, uint40[] memory resolvedAt) =
            ORACLE.outcomes(_legKeys(id, b.legCount));
        for (uint256 i; i < states.length; ++i) {
            uint8 s = states[i];
            bool wantYes = (b.wants >> i) & 1 == 1;
            if (s == E_INVALID || (s == E_YES && !wantYes) || (s == E_NO && wantYes)) {
                ++failed;
            } else if (s == E_YES || s == E_NO) {
                ++passed;
                if (resolvedAt[i] > lastResolved) lastResolved = resolvedAt[i];
            } else if (s == E_FROZEN || s == E_COMMITTED) {
                halted = true;
            }
        }
    }

    /// @dev The book's state as the `state` view reports it.
    function _stateOf(uint64 id, Book memory b) internal view returns (uint8) {
        if (b.status == FAILED) return S_FAILED;
        if (b.status == PASSED) return S_PASSED;
        if (b.status == FIXED) return S_FIXED;
        (uint256 failed, uint256 passed, bool halted,) = _legStatus(id, b);
        if (failed != 0) return S_FAILED;
        bool allPassed = passed == b.legCount;
        if (allPassed && b.feed == address(0)) return S_PASSED;
        if (allPassed && block.timestamp >= b.fixingTime) return S_AWAITING_FIX;
        if (block.timestamp >= b.cutoff) return S_CLOSED;
        if (halted || b.frozen) return S_HALTED;
        return S_TRADING;
    }

    /// @dev Latches a book's outcome once its legs settle it: any failed leg makes atom 0 win,
    ///      and every leg passing makes atom 1 of an event-only book win. A book with a feed is
    ///      decided only by its fixing.
    function _decide(uint64 id, Book memory b) internal returns (uint8 status, uint8 winner) {
        if (b.status != UNDECIDED) return (b.status, b.winner);
        (uint256 failed, uint256 passed,,) = _legStatus(id, b);
        if (failed != 0) {
            status = FAILED;
        } else if (passed == b.legCount && b.feed == address(0)) {
            (status, winner) = (PASSED, 1);
        } else {
            return (UNDECIDED, 0);
        }
        Book storage s = _books[id];
        s.status = status;
        s.winner = winner;
        emit BookDecided(id, status, winner);
    }

    /// @dev The bucket atom holding `price`: one plus the number of strikes at or below it.
    function _bucket(uint64 id, uint256 strikeCount, uint256 price) internal view returns (uint8) {
        uint128[8] storage strikes = _strikes[id];
        uint256 atom = 1;
        for (uint256 i; i < strikeCount; ++i) {
            if (price >= strikes[i]) ++atom;
            else break;
        }
        return uint8(atom);
    }

    // ---------------------------------------------------------------- quotes

    function _digest(WorldQuote calldata q) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
        return keccak256(
            abi.encodePacked(hex"1901", domain, keccak256(abi.encode(WORLD_QUOTE_TYPEHASH, q)))
        );
    }

    function _u128(uint256 value) internal pure returns (uint128) {
        if (value > type(uint128).max) revert Overflow();
        return uint128(value);
    }
}
