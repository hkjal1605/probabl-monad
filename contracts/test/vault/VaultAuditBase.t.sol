// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { IConditionalStocks } from "../../src/vault/interfaces/IConditionalStocks.sol";
import { VaultBase } from "./VaultBase.t.sol";

/// @dev Multi-market helpers on top of the seeded-vault fixture.
abstract contract VaultAuditBase is VaultBase {
    bytes32 internal constant EVIDENCE = keccak256("evidence");
    string internal constant URI = "https://evidence.example/packet";

    address internal attacker = address(0xBAD);

    /// @dev Creates, opens and registers another market of the vault's stock.
    function _newMarket(uint40 cutoff) internal returns (uint32 id) {
        id = createMarket(uint40(T0 - 1), cutoff);
        vm.prank(marketAdmin);
        view_.lifecycle(id, 0, bytes32(0));
        vm.prank(curator);
        ops.addMarket(id, risk());
    }

    function _resolve(uint32 id, uint8 yes, uint8 no) internal {
        vm.prank(guardian);
        view_.lifecycle(id, 1, keccak256("event ended"));
        bytes32 commitment = view_.resolutionHash(id, yes, no, EVIDENCE, URI);
        vm.prank(marketAdmin);
        view_.lifecycle(id, 3, commitment);
        vm.prank(resolver);
        view_.resolve(id, yes, no, EVIDENCE, URI);
    }

    /// @dev `from` splits `amount` of collateral in market `id` and sends one branch to the vault.
    function _donate(address from, uint32 id, uint8 branch, uint8 collateral, uint256 amount)
        internal
    {
        vm.startPrank(from);
        cs.split(id, collateral, amount);
        view_.transferClaim(id, branch, collateral, address(vault), amount);
        vm.stopPrank();
    }

    /// @dev A resting vault order in market `id`, valid for five minutes.
    function _vo(uint32 id, uint8 branch, bool sell, bool claim, uint64 ticks, uint256 qty)
        internal
        view
        returns (DeltaVaultBase.Placement memory)
    {
        O memory o = O(id, branch, sell, claim, false, 50, uint40(now_() + 5 minutes), ticks, qty);
        return DeltaVaultBase.Placement(pack(o), plan(seqOf(id, branch), now_() + 60, 0));
    }

    function _quoteIn(uint32 id, DeltaVaultBase.Placement[] memory places)
        internal
        returns (uint256[] memory keys)
    {
        vm.prank(keeper);
        keys = ops.update(id, new uint256[](0), places);
    }

    function _remaining(uint256 k) internal view returns (uint256) {
        (IConditionalStocks.Order memory o,) = IConditionalStocks(address(cs)).order(k);
        return o.remaining;
    }

    function _acct(uint32 id, uint8 branch, address who)
        internal
        view
        returns (IConditionalStocks.Account memory)
    {
        return IConditionalStocks(address(cs)).account(id, branch, who);
    }
}
