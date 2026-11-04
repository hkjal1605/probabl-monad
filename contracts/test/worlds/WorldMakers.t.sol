// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { WorldBooks } from "../../src/worlds/WorldBooks.sol";
import { WorldBooksAdmin } from "../../src/worlds/WorldBooksAdmin.sol";
import { WorldBooksBase } from "../../src/worlds/WorldBooksBase.sol";
import { IWorldQuoteMaker, WorldQuote } from "../../src/worlds/interfaces/IWorldBooks.sol";
import { MockToken } from "../Base.t.sol";
import { WorldsBase } from "./WorldsBase.t.sol";

/// @dev A contract maker whose hook behaviour the test picks.
contract ScriptedMaker is IWorldQuoteMaker {
    enum Mode {
        Accept,
        Reject,
        Revert,
        PaddedSelector,
        ReturnBomb,
        GasBomb,
        Reenter,
        CheckState
    }

    WorldBooks internal immutable books;
    Mode public mode;
    bytes public reentry;
    uint256 public calls;
    uint256 public seenCredit;
    uint256 public seenAtom;
    uint256 public seenCreditBefore;
    uint256 public burn;

    constructor(WorldBooks books_, MockToken token) {
        books = books_;
        token.approve(address(books_), type(uint256).max);
    }

    function setMode(Mode m) external {
        mode = m;
    }

    function setReentry(bytes calldata data) external {
        reentry = data;
    }

    function setBurn(uint256 gas_) external {
        burn = gas_;
    }

    function depositAll(uint256 amount) external {
        books.deposit(amount);
    }

    function onWorldFill(bytes32, WorldQuote calldata q, bytes32, bytes32, uint256 creditBefore)
        external
        returns (bytes4)
    {
        if (msg.sender != address(books)) revert("not books");
        ++calls;
        Mode m = mode;
        if (burn != 0) {
            uint256 stop = gasleft() - burn;
            while (gasleft() > stop) { }
        }
        if (m == Mode.Reject) return bytes4(0xdeadbeef);
        if (m == Mode.Revert) revert("no");
        if (m == Mode.PaddedSelector) {
            bytes4 sel = IWorldQuoteMaker.onWorldFill.selector;
            assembly ("memory-safe") {
                mstore(0, or(sel, 1))
                return(0, 32)
            }
        }
        if (m == Mode.ReturnBomb) {
            assembly ("memory-safe") {
                return(0, 64)
            }
        }
        if (m == Mode.GasBomb) {
            while (true) { }
        }
        if (m == Mode.Reenter) {
            (bool ok, bytes memory data) = address(books).call(reentry);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(data, 32), mload(data))
                }
            }
        }
        if (m == Mode.CheckState) {
            // The hook sees the balances after the fill.
            seenCredit = WorldBooksAdmin(address(books)).credit(address(this));
            seenAtom = WorldBooksAdmin(address(books)).atoms(q.book, address(this))[0];
            seenCreditBefore = creditBefore;
        }
        return IWorldQuoteMaker.onWorldFill.selector;
    }
}

/// @dev Contract makers and adversarial hooks.
contract WorldMakersTest is WorldsBase {
    uint16 internal constant ABOVE_240 = 0x70;
    uint64 internal id;
    ScriptedMaker internal sm;

    function setUp() public override {
        super.setUp();
        id = create(pricedDef());
        sm = new ScriptedMaker(books, usdg);
        usdg.mint(address(sm), 10_000e6);
        sm.depositAll(10_000e6);
    }

    function _contractQuote(uint128 units, uint128 price) internal returns (WorldQuote memory q) {
        q = quote(id, alice, ABOVE_240, units, 0, false, price);
        q.nonce = uint256(uint160(address(sm))) << 96 | ++nonceCounter;
    }

    function _take(WorldQuote memory q) internal {
        vm.prank(alice);
        books.fillQuote(q, bytes32(0), bytes32(0));
    }

    function _rejected(WorldQuote memory q) internal {
        uint256 credit_ = credit(address(sm));
        uint256 held = atoms(id, alice)[4];
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.MakerRejected.selector);
        books.fillQuote(q, bytes32(0), bytes32(0));
        eq(credit(address(sm)), credit_, "maker unchanged");
        eq(atoms(id, alice)[4], held, "taker unchanged");
        ok(!wb.nonceUsed(address(sm), q.nonce), "nonce unspent");
    }

    function testAcceptingMakerFillsFromItsOwnCredit() public {
        _take(_contractQuote(1000e6, 10e6));
        eq(sm.calls(), 1, "hook called");
        eq(credit(address(sm)), 10_000e6 - 990e6, "split from its credit");
        eq(atoms(id, alice)[4], 1000e6, "delivered");
    }

    function testHookSeesTheBalancesAfterTheFill() public {
        sm.setMode(ScriptedMaker.Mode.CheckState);
        _take(_contractQuote(1000e6, 10e6));
        eq(sm.seenCredit(), 10_000e6 - 990e6, "credit after");
        eq(sm.seenAtom(), 1000e6, "atoms after");
        eq(sm.seenCreditBefore(), 10_000e6, "credit before");
    }

    function testEveryNonAcceptingAnswerRevertsTheFill() public {
        ScriptedMaker.Mode[5] memory modes = [
            ScriptedMaker.Mode.Reject,
            ScriptedMaker.Mode.Revert,
            ScriptedMaker.Mode.PaddedSelector,
            ScriptedMaker.Mode.ReturnBomb,
            ScriptedMaker.Mode.GasBomb
        ];
        for (uint256 i; i < modes.length; ++i) {
            sm.setMode(modes[i]);
            _rejected(_contractQuote(1000e6, 10e6));
        }
    }

    function testHookGasBudget() public {
        sm.setBurn(900_000);
        _take(_contractQuote(10, 1));
        sm.setBurn(1_010_000);
        _rejected(_contractQuote(10, 1));
    }

    function testTooLittleGasForTheHookRevertsEverything() public {
        sm.setBurn(200_000);
        WorldQuote memory q = _contractQuote(1000e6, 10e6);
        uint256 before = credit(alice);
        vm.prank(alice);
        (bool success,) = address(books).call{ gas: 260_000 }(
            abi.encodeCall(WorldBooks.fillQuote, (q, bytes32(0), bytes32(0)))
        );
        ok(!success, "starved hook fails the fill");
        eq(credit(alice), before, "no partial fill");
    }

    function testHookCannotReenter() public {
        sm.setMode(ScriptedMaker.Mode.Reenter);
        bytes[5] memory calls_ = [
            abi.encodeCall(WorldBooks.deposit, (1)),
            abi.encodeCall(WorldBooks.withdraw, (1, address(sm))),
            abi.encodeCall(WorldBooks.split, (id, 1)),
            abi.encodeCall(WorldBooks.redeem, (id)),
            abi.encodeCall(WorldBooksAdmin.claimFees, (address(sm), 1))
        ];
        for (uint256 i; i < calls_.length; ++i) {
            sm.setReentry(calls_[i]);
            _rejected(_contractQuote(1000e6, 10e6));
        }
    }

    function testMakerContractOnlyRisksItsOwnFunds() public {
        // A contract that accepts every fill still pays only from its own credit: naming it
        // cannot move anyone else's balance.
        uint256 makerBefore = credit(maker);
        _take(_contractQuote(5000e6, 1e6));
        eq(credit(maker), makerBefore, "wallet maker untouched");
        _take(_contractQuote(5000e6, 1e6));
        // Beyond its credit the fill reverts before the hook.
        WorldQuote memory q = _contractQuote(5000e6, 1e6);
        vm.prank(alice);
        vm.expectRevert(WorldBooksBase.InsufficientFunds.selector);
        books.fillQuote(q, bytes32(0), bytes32(0));
    }

    function testContractNonceSpaceIsSeparate() public {
        // The same low counter under the wallet maker and the contract maker are distinct nonces.
        WorldQuote memory q = _contractQuote(10, 1);
        _take(q);
        WorldQuote memory w = quote(id, alice, ABOVE_240, 10, 0, false, 1);
        w.nonce = q.nonce & ((uint256(1) << 96) - 1);
        fill(makerKey, w);
        ok(wb.nonceUsed(maker, w.nonce) && wb.nonceUsed(address(sm), q.nonce), "both used");
    }
}
