// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { EventOracle } from "../../src/worlds/EventOracle.sol";
import { WorldsBase } from "./WorldsBase.t.sol";

contract EventOracleTest is WorldsBase {
    bytes32 internal constant EVIDENCE = keccak256("evidence");
    string internal constant EVIDENCE_URI = "ipfs://evidence";

    function _hash(bytes32 key, uint8 outcome) internal view returns (bytes32) {
        return oracle.resolutionHash(key, outcome, EVIDENCE, EVIDENCE_URI);
    }

    function testResolvesYesNoAndInvalidAsCommitted() public {
        bytes32[3] memory keys = [A, B, C];
        uint8[3] memory outcomes = [YES, NO, INVALID];
        for (uint256 i; i < 3; ++i) {
            bytes32 h = _hash(keys[i], outcomes[i]);
            vm.prank(bookAdmin);
            oracle.commit(keys[i], h);
            (uint8 s,) = oracle.outcome(keys[i]);
            eq(s, 2, "committed");
            vm.warp(T0 + i + 1);
            vm.prank(resolver);
            oracle.resolve(keys[i], outcomes[i], EVIDENCE, EVIDENCE_URI);
            (uint8 state, uint40 at) = oracle.outcome(keys[i]);
            eq(state, outcomes[i], "outcome");
            eq(at, T0 + i + 1, "resolvedAt");
            eq(uint256(oracle.commitment(keys[i])), 0, "commitment cleared");
            eq(uint256(oracle.evidence(keys[i])), uint256(EVIDENCE), "evidence");
        }
        bytes32[] memory list = new bytes32[](3);
        list[0] = A;
        list[1] = B;
        list[2] = C;
        (uint8[] memory states, uint40[] memory at_) = oracle.outcomes(list);
        eq(states[0], YES, "A");
        eq(states[1], NO, "B");
        eq(states[2], INVALID, "C");
        eq(at_[2], T0 + 3, "C at");
    }

    function testResolutionIsFinal() public {
        resolve(A, YES);
        bytes32 h = _hash(A, NO);
        vm.startPrank(bookAdmin);
        vm.expectRevert(EventOracle.InvalidState.selector);
        oracle.commit(A, h);
        vm.expectRevert(EventOracle.InvalidState.selector);
        oracle.reopen(A, "oops");
        vm.expectRevert(EventOracle.InvalidState.selector);
        oracle.freeze(A, "again");
        vm.stopPrank();
        vm.prank(resolver);
        vm.expectRevert(EventOracle.InvalidState.selector);
        oracle.resolve(A, NO, EVIDENCE, EVIDENCE_URI);
    }

    function testResolveMustMatchTheCommitment() public {
        bytes32 h = _hash(A, YES);
        vm.prank(bookAdmin);
        oracle.commit(A, h);
        vm.startPrank(resolver);
        vm.expectRevert(EventOracle.Commitment.selector);
        oracle.resolve(A, NO, EVIDENCE, EVIDENCE_URI);
        vm.expectRevert(EventOracle.Commitment.selector);
        oracle.resolve(A, YES, keccak256("other"), EVIDENCE_URI);
        vm.expectRevert(EventOracle.Commitment.selector);
        oracle.resolve(A, YES, EVIDENCE, "ipfs://other");
        vm.stopPrank();
    }

    function testResolveNeedsACommitment() public {
        vm.prank(resolver);
        vm.expectRevert(EventOracle.InvalidState.selector);
        oracle.resolve(A, YES, EVIDENCE, EVIDENCE_URI);
        vm.prank(guardian);
        oracle.freeze(A, "known");
        vm.prank(resolver);
        vm.expectRevert(EventOracle.InvalidState.selector);
        oracle.resolve(A, YES, EVIDENCE, EVIDENCE_URI);
    }

    function testRejectsBadOutcomesAndEvidence() public {
        bytes32 h = _hash(A, YES);
        vm.prank(bookAdmin);
        oracle.commit(A, h);
        vm.startPrank(resolver);
        uint8[4] memory bad = [0, 1, 2, 6];
        for (uint256 i; i < 4; ++i) {
            vm.expectRevert(EventOracle.InvalidTerms.selector);
            oracle.resolve(A, bad[i], EVIDENCE, EVIDENCE_URI);
        }
        vm.expectRevert(EventOracle.InvalidTerms.selector);
        oracle.resolve(A, YES, bytes32(0), EVIDENCE_URI);
        vm.expectRevert(EventOracle.InvalidTerms.selector);
        oracle.resolve(A, YES, EVIDENCE, "");
        bytes memory long = new bytes(513);
        vm.expectRevert(EventOracle.InvalidTerms.selector);
        oracle.resolve(A, YES, EVIDENCE, string(long));
        vm.stopPrank();
    }

    function testHashIsBoundToChainAndContract() public {
        bytes32 h = _hash(A, YES);
        EventOracle other = new EventOracle(admin, bookAdmin, guardian, resolver);
        ok(other.resolutionHash(A, YES, EVIDENCE, EVIDENCE_URI) != h, "contract-bound");
        vm.chainId(999);
        ok(oracle.resolutionHash(A, YES, EVIDENCE, EVIDENCE_URI) != h, "chain-bound");
    }

    function testRoles() public {
        bytes32 h = _hash(A, YES);
        vm.expectRevert(EventOracle.Unauthorized.selector);
        oracle.commit(A, h);
        vm.prank(guardian);
        vm.expectRevert(EventOracle.Unauthorized.selector);
        oracle.commit(A, h);
        vm.prank(bookAdmin);
        vm.expectRevert(EventOracle.Unauthorized.selector);
        oracle.resolve(A, YES, EVIDENCE, EVIDENCE_URI);
        vm.prank(alice);
        vm.expectRevert(EventOracle.Unauthorized.selector);
        oracle.freeze(A, "x");
        vm.prank(guardian);
        oracle.freeze(A, "x");
        vm.prank(guardian);
        vm.expectRevert(EventOracle.Unauthorized.selector);
        oracle.reopen(A, "x");
        vm.prank(bookAdmin);
        oracle.reopen(A, "x");
        (uint8 s,) = oracle.outcome(A);
        eq(s, 0, "reopened");
    }

    function testFreezeAndCommitStates() public {
        bytes32 hYes = _hash(A, YES);
        bytes32 hNo = _hash(A, NO);
        vm.startPrank(bookAdmin);
        vm.expectRevert(EventOracle.InvalidTerms.selector);
        oracle.freeze(A, bytes32(0));
        vm.expectRevert(EventOracle.InvalidTerms.selector);
        oracle.freeze(bytes32(0), "x");
        oracle.freeze(A, "x");
        vm.expectRevert(EventOracle.InvalidState.selector);
        oracle.freeze(A, "x");
        oracle.commit(A, hYes);
        // A replacement commitment, then reopening clears it.
        oracle.commit(A, hNo);
        eq(uint256(oracle.commitment(A)), uint256(hNo), "replaced");
        oracle.reopen(A, "premature");
        eq(uint256(oracle.commitment(A)), 0, "cleared");
        vm.expectRevert(EventOracle.InvalidState.selector);
        oracle.reopen(A, "again");
        vm.expectRevert(EventOracle.InvalidTerms.selector);
        oracle.commit(A, bytes32(0));
        vm.stopPrank();
        // After reopening, the old commitment no longer resolves.
        vm.prank(resolver);
        vm.expectRevert(EventOracle.InvalidState.selector);
        oracle.resolve(A, NO, EVIDENCE, EVIDENCE_URI);
    }

    function testAdminTransferIsDelayed() public {
        vm.prank(alice);
        vm.expectRevert(EventOracle.Unauthorized.selector);
        oracle.proposeAdmin(alice);
        vm.prank(admin);
        oracle.proposeAdmin(alice);
        vm.prank(alice);
        vm.expectRevert(EventOracle.AdminDelay.selector);
        oracle.acceptAdmin();
        vm.warp(T0 + 2 days);
        vm.prank(bob);
        vm.expectRevert(EventOracle.Unauthorized.selector);
        oracle.acceptAdmin();
        vm.prank(alice);
        oracle.acceptAdmin();
        eq(uint160(oracle.admin()), uint160(alice), "admin");
        vm.prank(admin);
        vm.expectRevert(EventOracle.Unauthorized.selector);
        oracle.configure(bob, bob, bob);
        vm.prank(alice);
        oracle.configure(bob, carol, alice);
        (address m, address g, address r) = oracle.roles();
        eq(uint160(m), uint160(bob), "market admin");
        eq(uint160(g), uint160(carol), "guardian");
        eq(uint160(r), uint160(alice), "resolver");
        vm.prank(alice);
        vm.expectRevert(EventOracle.InvalidAddress.selector);
        oracle.configure(address(0), carol, alice);
    }

    function testConstructorRejectsZeroRoles() public {
        vm.expectRevert(EventOracle.InvalidAddress.selector);
        new EventOracle(address(0), bookAdmin, guardian, resolver);
        vm.expectRevert(EventOracle.InvalidAddress.selector);
        new EventOracle(admin, bookAdmin, guardian, address(0));
    }
}
