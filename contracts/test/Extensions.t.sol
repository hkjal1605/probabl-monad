// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";
import { Base, MockToken } from "./Base.t.sol";

/// @dev An extension module: shares the exchange layout and keeps its own state namespaced.
contract MockExtension is ConditionalStocksBase {
    bytes32 private constant SLOT = keccak256("probabl.test.extension");

    constructor(address quote_) ConditionalStocksBase(quote_) { }

    /// @dev Runs in the exchange's context: its caller, market count and ledger.
    function ping() external view returns (address sender, uint32 markets, uint256 quoteCredit) {
        return (msg.sender, _marketCount, _credit[msg.sender][QUOTE]);
    }

    function setValue(uint256 value_) external {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            sstore(slot, value_)
        }
    }

    function value() external view returns (uint256 v) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            v := sload(slot)
        }
    }

    /// @dev Same selector as the exchange's `withdraw`: must never be reachable.
    function withdraw(address, uint256, address) external pure {
        revert("hijacked");
    }
}

contract ExtensionsTest is Base {
    MockExtension internal ext;
    MockExtension internal viaExchange;

    function setUp() public override {
        super.setUp();
        ext = new MockExtension(address(usdc));
        viaExchange = MockExtension(address(cs));
    }

    function _selectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](3);
        s[0] = MockExtension.ping.selector;
        s[1] = MockExtension.setValue.selector;
        s[2] = MockExtension.value.selector;
    }

    function _activateAll(address module_) internal {
        vm.prank(admin);
        view_.proposeExtension(_selectors(), module_);
        vm.warp(now_() + 14 days);
        bytes4[] memory s = _selectors();
        for (uint256 i; i < s.length; ++i) {
            view_.activateExtension(s[i]);
        }
    }

    function testExtensionActivatesOnlyAfterTheExitWindow() public {
        vm.expectRevert(ConditionalStocksBase.UnknownSelector.selector);
        viaExchange.ping();

        vm.recordLogs();
        vm.prank(admin);
        view_.proposeExtension(_selectors(), address(ext));
        eq(vm.getRecordedLogs().length, 3, "one proposal event per selector");
        (address active, address pending, uint64 at) = view_.extension(MockExtension.ping.selector);
        ok(active == address(0) && pending == address(ext), "pending, not active");
        eq(at, now_() + 14 days, "fourteen-day window");

        vm.expectRevert(ConditionalStocksBase.AdminDelay.selector);
        view_.activateExtension(MockExtension.ping.selector);
        vm.warp(now_() + 14 days - 1);
        vm.expectRevert(ConditionalStocksBase.AdminDelay.selector);
        view_.activateExtension(MockExtension.ping.selector);
        vm.expectRevert(ConditionalStocksBase.UnknownSelector.selector);
        viaExchange.ping();

        vm.warp(now_() + 1);
        vm.prank(carol); // Activation is permissionless once the window has passed.
        view_.activateExtension(MockExtension.ping.selector);
        (active, pending, at) = view_.extension(MockExtension.ping.selector);
        ok(active == address(ext) && pending == address(0) && at == 0, "activated");

        // Executes in the exchange's context: caller, market count and ledger are the exchange's.
        vm.prank(alice);
        (address sender, uint32 markets, uint256 quoteCredit) = viaExchange.ping();
        ok(sender == alice, "msg.sender preserved");
        eq(markets, 1, "exchange storage");
        eq(quoteCredit, credit(alice, address(usdc)), "exchange ledger");
        // Selectors not yet activated stay unreachable.
        vm.expectRevert(ConditionalStocksBase.UnknownSelector.selector);
        viaExchange.value();
    }

    function testExtensionStateIsNamespacedInTheExchange() public {
        _activateAll(address(ext));
        viaExchange.setValue(42);
        eq(viaExchange.value(), 42, "stored in the exchange");
        eq(ext.value(), 0, "not in the module's own storage");
        eq(view_.marketCount(), 1, "core layout untouched");
    }

    function testExtensionsCannotReplaceDeployedFunctions() public {
        bytes4[] memory s = new bytes4[](1);
        s[0] = MockExtension.withdraw.selector;
        vm.prank(admin);
        view_.proposeExtension(s, address(ext));
        vm.warp(now_() + 14 days);
        view_.activateExtension(s[0]);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        cs.withdraw(address(usdc), 100e6, alice);
        eq(usdc.balanceOf(alice), before + 100e6, "the exchange's own withdraw ran");
    }

    function testWithdrawalsWorkThroughoutAPendingProposal() public {
        vm.prank(admin);
        view_.proposeExtension(_selectors(), address(ext));
        uint256 before = usdc.balanceOf(bob);
        uint256 all = credit(bob, address(usdc));
        vm.prank(bob);
        cs.withdraw(address(usdc), all, bob);
        eq(credit(bob, address(usdc)), 0, "exited during the window");
        eq(usdc.balanceOf(bob), before + all, "tokens returned");
    }

    function testOnlyAdminProposesAndAdminOrGuardianCancels() public {
        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        vm.prank(guardian);
        view_.proposeExtension(_selectors(), address(ext));

        vm.prank(admin);
        view_.proposeExtension(_selectors(), address(ext));
        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        vm.prank(alice);
        view_.cancelExtension(MockExtension.ping.selector);
        vm.prank(guardian);
        view_.cancelExtension(MockExtension.ping.selector);
        vm.prank(admin);
        view_.cancelExtension(MockExtension.value.selector);
        vm.expectRevert(ConditionalStocksBase.InvalidState.selector);
        vm.prank(admin);
        view_.cancelExtension(MockExtension.ping.selector);

        vm.warp(now_() + 14 days);
        vm.expectRevert(ConditionalStocksBase.InvalidState.selector);
        view_.activateExtension(MockExtension.ping.selector);
        view_.activateExtension(MockExtension.setValue.selector);
        viaExchange.setValue(1);
        vm.expectRevert(ConditionalStocksBase.UnknownSelector.selector);
        viaExchange.ping();
    }

    function testRemovalTakesTheSameWindow() public {
        _activateAll(address(ext));
        bytes4[] memory s = new bytes4[](1);
        s[0] = MockExtension.ping.selector;
        vm.prank(admin);
        view_.proposeExtension(s, address(0));
        viaExchange.ping(); // Still active during the window.
        vm.warp(now_() + 14 days);
        view_.activateExtension(s[0]);
        vm.expectRevert(ConditionalStocksBase.UnknownSelector.selector);
        viaExchange.ping();
    }

    function testReproposalRestartsTheWindow() public {
        bytes4[] memory s = new bytes4[](1);
        s[0] = MockExtension.ping.selector;
        vm.prank(admin);
        view_.proposeExtension(s, address(ext));
        vm.warp(now_() + 10 days);
        MockExtension other = new MockExtension(address(usdc));
        vm.prank(admin);
        view_.proposeExtension(s, address(other));
        vm.warp(now_() + 5 days);
        vm.expectRevert(ConditionalStocksBase.AdminDelay.selector);
        view_.activateExtension(s[0]);
        vm.warp(now_() + 9 days);
        view_.activateExtension(s[0]);
        (address active,,) = view_.extension(s[0]);
        ok(active == address(other), "latest proposal activated");
    }

    function testProposalValidation() public {
        vm.startPrank(admin);
        vm.expectRevert(ConditionalStocksBase.InvalidTerms.selector);
        view_.proposeExtension(new bytes4[](0), address(ext));
        vm.expectRevert(ConditionalStocksBase.InvalidTerms.selector);
        view_.proposeExtension(_selectors(), address(0xBEEF)); // No code.
        bytes4[] memory zero = new bytes4[](1);
        vm.expectRevert(ConditionalStocksBase.InvalidTerms.selector);
        view_.proposeExtension(zero, address(ext));
        vm.expectRevert(ConditionalStocksBase.InvalidTerms.selector);
        view_.proposeExtension(_selectors(), address(0)); // Removing what is not active.
        vm.stopPrank();
        vm.expectRevert(ConditionalStocksBase.InvalidState.selector);
        view_.activateExtension(MockExtension.ping.selector);
    }

    function testUnknownSelectorsAndDirectModuleCallsRevert() public {
        (bool success,) = address(cs).call(abi.encodeWithSelector(bytes4(0xdeadbeef)));
        ok(!success, "unknown selector");
        address module_ = view_.module();
        ok(module_ != address(cs) && module_.code.length != 0, "the module is its own contract");
        (success,) = module_.call(abi.encodeWithSelector(MockExtension.ping.selector));
        ok(!success, "the module's own storage has no extensions");
    }

    function testMarketIdentityIsStoredOnChain() public {
        bytes32 eventKey = keccak256(abi.encode(keccak256("condition"), uint8(1), uint8(2)));
        ok(view_.eventKey(market) == eventKey, "event key");
        ok(view_.underlying(address(stock)) == NVDA_UNDERLYING, "underlying");
        ok(view_.underlying(address(usdc)) == bytes32(0), "the quote has none");
        ok(
            view_.marketKey(market) == keccak256(abi.encode(eventKey, NVDA_UNDERLYING)),
            "market key"
        );
        ok(view_.eventKey(99) == bytes32(0) && view_.marketKey(99) == bytes32(0), "no market");

        // The YES side is part of the event: the same condition with sides swapped differs.
        ConditionalStocksBase.MarketParams memory p = params(uint40(T0), uint40(T0 + 1 days));
        p.yesIndex = 2;
        p.noIndex = 1;
        vm.prank(marketAdmin);
        uint32 swapped = view_.createMarket(p, "ipfs://metadata");
        ok(view_.eventKey(swapped) != eventKey, "sides are part of the event");
    }

    function testListingRequiresAnUnderlying() public {
        MockToken token = new MockToken("TSLA", 18);
        vm.expectRevert(ConditionalStocksBase.InvalidTerms.selector);
        vm.prank(marketAdmin);
        view_.listPool(address(token), bytes32(0));
    }
}
