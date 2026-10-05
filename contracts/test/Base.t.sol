// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocks } from "../src/ConditionalStocks.sol";
import { ConditionalStocksAdmin } from "../src/ConditionalStocksAdmin.sol";
import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";

interface Vm {
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
}

contract MockToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    uint256 public feeBps;
    bool public noReturn;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory symbol_, uint8 decimals_) {
        name = symbol_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function setFee(uint256 bps) external {
        feeBps = bps;
    }

    function setNoReturn(bool value) external {
        noReturn = value;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        if (noReturn) assembly { return(0, 0) }
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        if (noReturn) assembly { return(0, 0) }
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        uint256 fee = amount * feeBps / 10_000;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
    }
}

/// @dev Shared deployment, market and order helpers.
abstract contract Base {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint8 internal constant YES = 0;
    uint8 internal constant NO = 1;
    uint256 internal constant WAD = 1e18;
    uint128 internal constant TICK = 1e4; // $0.01 per whole 18-decimal token, USDC raw x 1e18.
    uint96 internal constant STEP = 1e15; // 0.001 token.
    uint256 internal constant T0 = 1_800_000_000;
    bytes32 internal constant NVDA_UNDERLYING = bytes32("US:NVDA");

    address internal admin = address(0xA11CE);
    address internal marketAdmin = address(0xA0);
    address internal guardian = address(0x6A);
    address internal resolver = address(0x5E);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0);
    address internal carol = address(0xC0);
    address internal bot = address(0xB07);

    MockToken internal usdc;
    MockToken internal stock;
    ConditionalStocks internal cs;
    ConditionalStocksAdmin internal view_; // The admin ABI at the exchange address.
    uint32 internal market;

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockToken("USDC", 6);
        stock = new MockToken("NVDA", 18);
        cs = new ConditionalStocks(address(usdc), admin, marketAdmin, guardian, resolver);
        view_ = ConditionalStocksAdmin(address(cs));
        vm.prank(marketAdmin);
        view_.listPool(address(stock), NVDA_UNDERLYING);
        market = createMarket(uint40(T0 - 1), uint40(T0 + 30 days));
        vm.prank(marketAdmin);
        view_.lifecycle(market, 0, bytes32(0));
        for (uint256 i; i < 4; ++i) {
            address user = [alice, bob, carol, bot][i];
            fund(user, 1_000_000e6, 10_000e18);
        }
    }

    function params(uint40 open, uint40 cutoff)
        internal
        view
        returns (ConditionalStocksBase.MarketParams memory p)
    {
        p = ConditionalStocksBase.MarketParams({
            base: address(stock),
            condition: keccak256("condition"),
            yesIndex: 1,
            noIndex: 2,
            rulesHash: keccak256("rules"),
            metadataHash: keccak256(bytes("ipfs://metadata")),
            open: open,
            cutoff: cutoff,
            tick: TICK,
            step: STEP,
            maxSteps: 1_000_000,
            minNotional: 1e6,
            maxOrder: 1e11,
            maxWallet: 1e12,
            maxMarket: 1e13,
            makerBps: 0,
            takerBps: 0
        });
    }

    function createMarket(uint40 open, uint40 cutoff) internal returns (uint32 id) {
        vm.prank(marketAdmin);
        id = view_.createMarket(params(open, cutoff), "ipfs://metadata");
    }

    /// @dev Opens a market with the default terms and these fee rates, and points the order
    ///      helpers at it.
    function useFees(uint16 makerBps, uint16 takerBps) internal {
        ConditionalStocksBase.MarketParams memory p =
            params(uint40(now_() - 1), uint40(T0 + 30 days));
        p.makerBps = makerBps;
        p.takerBps = takerBps;
        vm.prank(marketAdmin);
        market = view_.createMarket(p, "ipfs://metadata");
        vm.prank(marketAdmin);
        view_.lifecycle(market, 0, bytes32(0));
    }

    /// @dev Sets the current market's maker rebate: this share of each fill's taker fee, in bps of
    ///      the fee, goes to the filled maker.
    function useRebate(uint16 rebateBps) internal {
        vm.prank(marketAdmin);
        view_.setMakerRebate(market, rebateBps);
    }

    function fund(address user, uint256 quoteAmount, uint256 baseAmount) internal {
        usdc.mint(user, quoteAmount);
        stock.mint(user, baseAmount);
        vm.startPrank(user);
        usdc.approve(address(cs), type(uint256).max);
        stock.approve(address(cs), type(uint256).max);
        cs.deposit(address(usdc), quoteAmount);
        cs.deposit(address(stock), baseAmount);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ packing

    struct O {
        uint32 market;
        uint8 branch;
        bool sell;
        bool claim;
        bool ioc;
        uint16 maxFee;
        uint40 expiry;
        uint64 ticks;
        uint256 quantity;
    }

    function pack(O memory o) internal pure returns (uint256) {
        uint256 flags = uint256(o.branch) | (o.sell ? 2 : 0) | (o.claim ? 4 : 0) | (o.ioc ? 8 : 0);
        return uint256(o.market) | flags << 32 | uint256(o.maxFee) << 40 | uint256(o.expiry) << 56
            | uint256(o.ticks) << 96 | o.quantity << 160;
    }

    function plan(uint256 nextSeq, uint256 deadline, uint256 minFill)
        internal
        pure
        returns (uint256)
    {
        return nextSeq | deadline << 32 | minFill << 72;
    }

    function makers(uint256[] memory seqs) internal pure returns (uint256 m) {
        for (uint256 i; i < seqs.length; ++i) {
            m |= (seqs[i] + 1) << (32 * i);
        }
    }

    function one(uint256 seq) internal pure returns (uint256) {
        return seq + 1;
    }

    function seqOf(uint32 id, uint8 branch) internal view returns (uint256) {
        ConditionalStocksBase.Book memory b = view_.book(id);
        return branch == 0 ? b.seqYes : b.seqNo;
    }

    function key(uint32 id, uint8 branch, uint256 seq) internal pure returns (uint256) {
        return uint256(id) << 40 | uint256(branch) << 32 | seq;
    }

    /// @dev A resting (GTC) order with an empty plan at the current book.
    function rest(address user, uint8 branch, bool sell, bool claim, uint64 ticks, uint256 qty)
        internal
        returns (uint256)
    {
        O memory o = O(market, branch, sell, claim, false, 1_000, uint40(T0 + 10 days), ticks, qty);
        uint256 seq = seqOf(market, branch);
        vm.prank(user);
        return cs.place(pack(o), plan(seq, now_() + 60, 0), 0);
    }

    /// @dev An immediate-or-cancel taker against listed makers.
    function take(
        address user,
        uint8 branch,
        bool sell,
        bool claim,
        uint64 ticks,
        uint256 qty,
        uint256 m
    ) internal returns (uint256) {
        O memory o = O(market, branch, sell, claim, true, 1_000, uint40(T0 + 10 days), ticks, qty);
        uint256 seq = seqOf(market, branch);
        vm.prank(user);
        return cs.place(pack(o), plan(seq, now_() + 60, 0), m);
    }

    /// @dev block.timestamp is cached across vm.warp under via-ir; read the VM instead.
    function now_() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    function credit(address user, address token) internal view returns (uint256) {
        return view_.credit(user, token);
    }

    function acct(address user, uint8 branch)
        internal
        view
        returns (ConditionalStocksBase.Account memory)
    {
        return view_.account(market, branch, user);
    }

    function eq(uint256 a, uint256 b, string memory message) internal pure {
        if (a != b) revert(string.concat(message, ": ", _str(a), " != ", _str(b)));
    }

    function ok(bool condition, string memory message) internal pure {
        if (!condition) revert(message);
    }

    function _str(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        bytes memory buffer;
        while (value != 0) {
            buffer = abi.encodePacked(bytes1(uint8(48 + value % 10)), buffer);
            value /= 10;
        }
        return string(buffer);
    }
}
