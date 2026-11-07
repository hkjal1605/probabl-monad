// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice One leg of a world: a venue event, by its `EventOracle` key, and the outcome the world
///         needs from it.
struct Leg {
    bytes32 eventKey;
    bool wantYes;
}

/// @notice Everything that defines a book. `keccak256(abi.encode(def))` identifies it.
/// @param legs 1 to 6 distinct events, all of which must go their chosen way for the world to
///        happen.
/// @param feed Chainlink-style feed of the underlying fixed at `fixingTime`; zero for an
///        event-only book, which has no fixing and no strikes.
/// @param underlying The asset the feed prices (e.g. "US:NVDA"); informational.
/// @param fixingTime When the price is read; the fixing is the feed's last round at or before it.
/// @param maxStaleness How old (at `fixingTime`) that round may be.
/// @param strikes 1 to 8 strictly ascending feed answers. They split the fixing into buckets:
///        atom 1 is below the first strike, atom j is at or above strike j-1 and below strike j,
///        and the last atom is at or above the last strike.
/// @param cutoff Trading stops at this time; at most `fixingTime` for a book with a feed.
/// @param feeBps Taker fee on the price of every fill, at most 1000.
/// @param metadataHash keccak256 of the metadata URI (titles, rules links).
struct BookDef {
    Leg[] legs;
    address feed;
    bytes32 underlying;
    uint40 fixingTime;
    uint32 maxStaleness;
    uint128[] strikes;
    uint40 cutoff;
    uint16 feeBps;
    bytes32 metadataHash;
}

/// @notice A maker's signed offer to one taker: the taker buys (`sell` false) or sells (`sell`
///         true) a bundle of `units` of every atom in `mask` (bits 1 and up; bit 0 is never set)
///         plus `refund` units of atom 0, for `price` raw quote units before the fee. One unit of
///         an atom pays one raw quote unit if that atom wins.
/// @param makerData Signed and passed to a maker contract's hook (the world vault puts its quote
///        epoch here); free for a wallet maker.
/// @param nonce Below 2^96: the maker is the wallet that signed. At or above it: the maker is the
///        contract in the top 160 bits, and its `onWorldFill` hook decides. Each nonce fills once.
/// @dev A quote stays fillable until `expiry` whatever happens to the book's legs meanwhile, as
///      long as the book trades: a wallet maker keeps expiries short (a leg resolving the
///      world's way makes its earlier quotes cheap), or voids them with `invalidateNonces`.
struct WorldQuote {
    address taker;
    uint64 book;
    uint16 mask;
    uint128 units;
    uint128 refund;
    bool sell;
    uint128 price;
    uint40 expiry;
    uint64 makerData;
    uint256 nonce;
}

/// @notice A book as the `book` view returns it.
/// @param status 1 undecided, 2 failed (atom 0 won), 3 passed (event-only, atom 1 won), 4 fixed.
struct BookView {
    address feed;
    bytes32 underlying;
    uint40 fixingTime;
    uint32 maxStaleness;
    uint40 cutoff;
    uint16 feeBps;
    uint8 legCount;
    uint8 strikeCount;
    uint8 atomCount;
    uint8 status;
    uint8 winner;
    bool frozen;
    bool held;
}

/// @notice The part of `WorldBooks` its makers and the world vault use.
interface IWorldBooks {
    function quote() external view returns (address);

    function oracle() external view returns (address);

    function credit(address owner) external view returns (uint256);

    function atoms(uint64 book, address owner) external view returns (uint256[] memory);

    function book(uint64 book) external view returns (BookView memory);

    function legs(uint64 book) external view returns (bytes32[] memory keys, bool[] memory wantYes);

    function state(uint64 book) external view returns (uint8);

    function deposit(uint256 amount) external;

    function withdraw(uint256 amount, address to) external;

    function merge(uint64 book, uint256 amount) external;

    function redeem(uint64 book) external returns (uint256);
}

/// @notice A contract maker. `WorldBooks` calls it after moving the balances of a fill that names
///         it, with its lock held and a fixed gas budget; anything but this selector returned
///         reverts the fill.
/// @dev `WorldBooks` checks no signature for a contract maker: it moves the named contract's
///      balances on the taker's say-so and relies on this hook to refuse. A maker must verify
///      `r`/`vs` over `digest` itself (and its own limits), or anyone can fill against it; so must
///      any account with code, EIP-7702 delegations included, that holds credit here.
interface IWorldQuoteMaker {
    /// @param makerCreditBefore The maker's credit before the fill.
    function onWorldFill(
        bytes32 digest,
        WorldQuote calldata q,
        bytes32 r,
        bytes32 vs,
        uint256 makerCreditBefore
    ) external returns (bytes4);
}
