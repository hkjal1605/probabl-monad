// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { EventOracle } from "../../src/worlds/EventOracle.sol";
import { WorldBooks } from "../../src/worlds/WorldBooks.sol";
import { WorldBooksAdmin } from "../../src/worlds/WorldBooksAdmin.sol";
import { WorldBooksBase } from "../../src/worlds/WorldBooksBase.sol";
import { BookDef, BookView, Leg, WorldQuote } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { MockToken } from "../Base.t.sol";
import { MockPriceFeed } from "../mocks/MockPriceFeed.sol";

interface WVm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function warp(uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function expectRevert() external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function assume(bool) external;
    function label(address, string calldata) external;
    function chainId(uint256) external;
    function getBlockTimestamp() external view returns (uint256);
    function toString(uint256) external pure returns (string memory);
    function addr(uint256 privateKey) external pure returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        pure
        returns (uint8 v, bytes32 r, bytes32 s);
    function etch(address target, bytes calldata code) external;
}

/// @dev The oracle, books and a feed, Maya's world and helpers shared by the worlds suites.
///      Units are raw USDG (6 decimals); one atom unit pays one raw unit.
abstract contract WorldsBase {
    WVm internal constant vm = WVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant T0 = 1_800_000_000;
    uint256 internal constant SECP256K1_N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    bytes32 internal constant A = keccak256("event A: trade deal");
    bytes32 internal constant B = keccak256("event B: S-1");
    bytes32 internal constant C = keccak256("event C: GPU order");
    bytes32 internal constant NVDA = bytes32("US:NVDA");
    string internal constant URI = "ipfs://world";

    uint8 internal constant YES = 3;
    uint8 internal constant NO = 4;
    uint8 internal constant INVALID = 5;

    address internal admin = address(0xA11CE);
    address internal bookAdmin = address(0xA0);
    address internal guardian = address(0x6A);
    address internal resolver = address(0x5E);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0);
    address internal carol = address(0xC0);
    address internal delegate = address(0xDE1);

    uint256 internal makerKey = 0xBEEF;
    address internal maker;
    uint256 internal maker2Key = 0xCAFE;
    address internal maker2;

    MockToken internal usdg;
    EventOracle internal oracle;
    WorldBooks internal books;
    /// The admin module's ABI at the books address.
    WorldBooksAdmin internal wb;
    MockPriceFeed internal feed;

    uint256 internal nonceCounter;

    function setUp() public virtual {
        vm.warp(T0);
        maker = vm.addr(makerKey);
        maker2 = vm.addr(maker2Key);
        usdg = new MockToken("USDG", 6);
        oracle = new EventOracle(admin, bookAdmin, guardian, resolver);
        books = new WorldBooks(address(usdg), address(oracle), admin, bookAdmin, guardian, resolver);
        wb = WorldBooksAdmin(address(books));
        feed = new MockPriceFeed(8, "NVDA / USD", 1, 209e8, T0);
        address[6] memory users = [alice, bob, carol, maker, maker2, delegate];
        for (uint256 i; i < users.length; ++i) {
            fund(users[i], 1_000_000e6);
        }
    }

    // ------------------------------------------------------------ funding

    function fund(address user, uint256 amount) internal {
        usdg.mint(user, amount);
        vm.startPrank(user);
        usdg.approve(address(books), type(uint256).max);
        books.deposit(amount);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ books

    function legs3() internal pure returns (Leg[] memory l) {
        l = new Leg[](3);
        l[0] = Leg(A, true);
        l[1] = Leg(B, true);
        l[2] = Leg(C, true);
    }

    function strikes5() internal pure returns (uint128[] memory s) {
        s = new uint128[](5);
        s[0] = 220e8;
        s[1] = 230e8;
        s[2] = 240e8;
        s[3] = 250e8;
        s[4] = 260e8;
    }

    /// Maya's book: three legs, NVDA fixed at T0 + 28 days, five strikes, a 1% fee.
    function pricedDef() internal view returns (BookDef memory d) {
        d = BookDef({
            legs: legs3(),
            feed: address(feed),
            underlying: NVDA,
            fixingTime: uint40(T0 + 28 days),
            maxStaleness: 1 hours,
            strikes: strikes5(),
            cutoff: uint40(T0 + 27 days),
            feeBps: 100,
            metadataHash: keccak256(bytes(URI))
        });
    }

    function eventDef() internal pure returns (BookDef memory d) {
        uint128[] memory none = new uint128[](0);
        d = BookDef({
            legs: legs3(),
            feed: address(0),
            underlying: bytes32(0),
            fixingTime: 0,
            maxStaleness: 0,
            strikes: none,
            cutoff: uint40(T0 + 27 days),
            feeBps: 100,
            metadataHash: keccak256(bytes(URI))
        });
    }

    function create(BookDef memory d) internal returns (uint64 id) {
        vm.prank(bookAdmin);
        id = wb.createBook(d, URI);
    }

    function resolve(bytes32 key, uint8 outcome) internal {
        bytes32 evidence = keccak256(abi.encode(key, outcome));
        bytes32 h = oracle.resolutionHash(key, outcome, evidence, "ipfs://evidence");
        vm.prank(bookAdmin);
        oracle.commit(key, h);
        vm.prank(resolver);
        oracle.resolve(key, outcome, evidence, "ipfs://evidence");
    }

    function passAll() internal {
        resolve(A, YES);
        resolve(B, YES);
        resolve(C, YES);
    }

    // ------------------------------------------------------------ quotes

    function quote(
        uint64 id,
        address taker,
        uint16 mask,
        uint128 units,
        uint128 refund,
        bool sell,
        uint128 price
    ) internal returns (WorldQuote memory q) {
        q = WorldQuote({
            taker: taker,
            book: id,
            mask: mask,
            units: units,
            refund: refund,
            sell: sell,
            price: price,
            expiry: uint40(now_() + 60),
            makerData: 0,
            nonce: ++nonceCounter
        });
    }

    /// @dev The EIP-712 digest, computed independently of the contract.
    function digestOf(WorldQuote memory q) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Probabl Worlds"),
                keccak256("1"),
                block.chainid,
                address(books)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "WorldQuote(address taker,uint64 book,uint16 mask,uint128 units,uint128 refund,bool sell,uint128 price,uint40 expiry,uint64 makerData,uint256 nonce)"
                ),
                q.taker,
                q.book,
                q.mask,
                q.units,
                q.refund,
                q.sell,
                q.price,
                q.expiry,
                q.makerData,
                q.nonce
            )
        );
        return keccak256(abi.encodePacked(hex"1901", domain, structHash));
    }

    function sign(uint256 key, WorldQuote memory q) internal view returns (bytes32 r, bytes32 vs) {
        (uint8 v, bytes32 r_, bytes32 s) = vm.sign(key, digestOf(q));
        r = r_;
        vs = bytes32(uint256(s) | (v == 28 ? uint256(1) << 255 : 0));
    }

    /// @dev `taker` fills `q` signed by `key`.
    function fill(uint256 key, WorldQuote memory q) internal {
        (bytes32 r, bytes32 vs) = sign(key, q);
        vm.prank(q.taker);
        books.fillQuote(q, r, vs);
    }

    // ------------------------------------------------------------ reads

    function atoms(uint64 id, address owner) internal view returns (uint256[] memory) {
        return wb.atoms(id, owner);
    }

    function credit(address owner) internal view returns (uint256) {
        return wb.credit(owner);
    }

    /// @dev Every atom's supply equals the book's backing (for the owners listed).
    function supplyOf(uint64 id, uint256 atom, address[] memory owners)
        internal
        view
        returns (uint256 total)
    {
        for (uint256 i; i < owners.length; ++i) {
            total += wb.atoms(id, owners[i])[atom];
        }
    }

    function now_() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    function eq(uint256 a, uint256 b, string memory message) internal pure {
        if (a != b) revert(string.concat(message, ": ", _str(a), " != ", _str(b)));
    }

    function ok(bool condition, string memory message) internal pure {
        if (!condition) revert(message);
    }

    function _str(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        bytes memory buffer;
        while (value != 0) {
            buffer = abi.encodePacked(bytes1(uint8(48 + value % 10)), buffer);
            value /= 10;
        }
        return string(buffer);
    }
}
