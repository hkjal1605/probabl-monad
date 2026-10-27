// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksAdmin } from "../../src/ConditionalStocksAdmin.sol";
import { ConditionalStocksBase } from "../../src/ConditionalStocksBase.sol";
import { DeltaVault } from "../../src/vault/DeltaVault.sol";
import { DeltaVaultAdmin } from "../../src/vault/DeltaVaultAdmin.sol";
import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { IConditionalStocks } from "../../src/vault/interfaces/IConditionalStocks.sol";
import { VaultAuditBase } from "./VaultAuditBase.t.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev A tokenized stock whose issuer can pause transfers.
contract PausableStock {
    string public constant name = "NVDAx";
    string public constant symbol = "NVDAx";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    bool public paused;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setPaused(bool p) external {
        paused = p;
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
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        require(!paused, "paused");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// @dev Regressions for the Δ-vault findings of the September 2026 audit: each test fails on
///      the audited code and passes on the fix.
contract VaultAuditFixesTest is VaultAuditBase {
    uint32 internal other;

    function _live(uint32 id) internal view returns (uint256 n) {
        uint256[] memory keys = ops.orders(id);
        for (uint256 i; i < keys.length; ++i) {
            if (_remaining(keys[i]) != 0) n++;
        }
    }

    /// @dev Fills leave the vault 15 NVDA-if-NO; the keeper then escrows all of it in a
    ///      claim-funded NO ask (claims first) and quotes whole-funded orders around it: eight
    ///      live orders over two markets.
    function _book() internal returns (uint256 claimAsk) {
        other = _newMarket(uint40(T0 + 30 days));
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](3);
        places[0] = vo(YES, true, false, 10_300, 10 * NVDA);
        places[1] = vo(NO, false, false, 9700, 5 * NVDA);
        places[2] = vo(YES, false, false, 9900, 3 * NVDA);
        uint256[] memory keys = quote(places);
        fill(alice, keys[0], 10 * NVDA);
        fill(bob, keys[1], 5 * NVDA);
        fill(bob, keys[2], 3 * NVDA);

        uint256 noClaims = _acct(market, NO, address(vault)).base / STEP * STEP;
        DeltaVaultBase.Placement[] memory a = new DeltaVaultBase.Placement[](3);
        a[0] = _vo(market, NO, true, true, 10_000, noClaims);
        a[1] = _vo(market, YES, false, false, 10_000, 20 * NVDA);
        a[2] = _vo(market, YES, true, false, 10_600, 20 * NVDA);
        claimAsk = _quoteIn(market, a)[0];
        DeltaVaultBase.Placement[] memory b = new DeltaVaultBase.Placement[](4);
        b[0] = _vo(other, YES, false, false, 9900, 20 * NVDA);
        b[1] = _vo(other, YES, true, false, 10_100, 20 * NVDA);
        b[2] = _vo(other, NO, false, false, 9800, 20 * NVDA);
        b[3] = _vo(other, NO, true, false, 10_200, 20 * NVDA);
        _quoteIn(other, b);
        a = new DeltaVaultBase.Placement[](1);
        a[0] = _vo(market, NO, false, false, 9700, 20 * NVDA);
        _quoteIn(market, a);
        eq(_live(market) + _live(other), 8, "8 live quotes across 2 markets");
    }

    /// @dev M-01: a dust withdrawal that needs the NO stock claims escrowed in the claim-funded
    ///      ask releases that ask only; the seven other quotes keep resting.
    function testDustWithdrawalReleasesOnlyTheEscrowItNeeds() public {
        give(attacker, 1000e6, 10e18);
        vm.prank(attacker);
        vault.deposit(1000e6, 10e18, 0, attacker);
        uint256 claimAsk = _book();
        uint256 free = _acct(market, NO, address(vault)).base;
        ok(free < STEP, "NO stock claims escrowed down to a sub-step remainder");
        uint256 total = ops.holdings().claims[0].noBase;
        uint256 s = supply();
        uint256 dust = ((free + 1) * s + total - 1) / total;
        vm.prank(attacker);
        vault.withdraw(dust, 0, 0, attacker, attacker);
        eq(_remaining(claimAsk), 0, "the escrow it needed was released");
        eq(_live(market) + _live(other), 7, "every other quote still rests");
        eq(ops.orders(other).length, 4, "the other market is untouched");
    }

    function testOrdinaryWithdrawalKeepsTheWholeFundedBook() public {
        _book();
        uint256 lp = supply() / 100;
        vm.prank(vaultAdmin);
        vault.withdraw(lp, 0, 0, vaultAdmin, vaultAdmin);
        eq(_live(market) + _live(other), 7, "only the fully escrowed claim ask is released");
    }

    /// @dev A withdrawal whose plain quote exceeds the free credit releases the whole-funded
    ///      bids, and nothing that is not needed.
    function testPlainShortfallReleasesWholeFundedBidsOnly() public {
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](2);
        places[0] = vo(YES, false, false, 9900, 190 * NVDA); // 18,810 of 100,000 USDC escrowed
        places[1] = vo(YES, true, false, 10_100, 50 * NVDA); // 50 of 1,000 NVDA escrowed
        uint256[] memory keys = quote(places);
        uint256 most = supply() * 9 / 10; // needs 90% of the quote, 90% of the stock
        vm.prank(vaultAdmin);
        vault.withdraw(most, 0, 0, vaultAdmin, vaultAdmin);
        eq(_remaining(keys[0]), 0, "the bid's escrow was needed");
        eq(_remaining(keys[1]), 50 * NVDA, "the ask keeps resting");
    }

    /// @dev L-01: dust below one order's minimum no longer blocks removal; a tradable position
    ///      still does.
    function testDustDoesNotBlockRemoveMarket() public {
        fund(attacker, 10e6, 1e18);
        uint32 fresh = _newMarket(uint40(T0 + 20 days));
        _donate(attacker, fresh, YES, 0, 1);
        _donate(attacker, fresh, NO, 1, STEP - 1);
        vm.prank(curator);
        ops.removeMarket(fresh);
        ok(!ops.market(fresh).listed, "removed");

        uint32 kept = _newMarket(uint40(T0 + 20 days));
        _donate(attacker, kept, YES, 0, 1e6); // the minimum notional
        vm.expectRevert(DeltaVaultBase.OpenPosition.selector);
        vm.prank(curator);
        ops.removeMarket(kept);
    }

    /// @dev L-02: while the stock's issuer pauses transfers, a withdrawal still pays the quote
    ///      tokens and pays the stock as YES and NO claims, which merge back into credit.
    function testIssuerPausePaysTheStockInClaims() public {
        PausableStock x = new PausableStock();
        vm.prank(marketAdmin);
        view_.listPool(address(x), bytes32("US:NVDAx"));
        DeltaVaultBase.Config memory c = config(address(0));
        c.base = IERC20(address(x));
        DeltaVault v = new DeltaVault(c);
        uint32 id = _xMarket(address(x));
        bytes32 curatorRole = v.CURATOR_ROLE();
        vm.startPrank(vaultAdmin);
        v.grantRole(curatorRole, curator);
        DeltaVaultAdmin(address(v)).setCaps(type(uint128).max, type(uint128).max);
        vm.stopPrank();
        vm.prank(curator);
        DeltaVaultAdmin(address(v)).addMarket(id, risk());

        usdc.mint(vaultAdmin, 100_000e6);
        x.mint(vaultAdmin, 1000e18);
        vm.startPrank(vaultAdmin);
        usdc.approve(address(v), type(uint256).max);
        x.approve(address(v), type(uint256).max);
        v.deposit(100_000e6, 1000e18, 0, vaultAdmin);
        vm.stopPrank();

        x.setPaused(true);
        uint256 shares = v.balanceOf(vaultAdmin) / 10;
        (uint256 q, uint256 b,) = v.previewWithdraw(shares);
        uint256 before = usdc.balanceOf(vaultAdmin);
        vm.prank(vaultAdmin);
        v.withdraw(shares, 0, 0, vaultAdmin, vaultAdmin);
        eq(usdc.balanceOf(vaultAdmin) - before, q, "quote tokens paid");
        IConditionalStocks ex = IConditionalStocks(address(cs));
        eq(ex.account(id, 0, vaultAdmin).base, b, "stock-if-YES paid");
        eq(ex.account(id, 1, vaultAdmin).base, b, "stock-if-NO paid");
        vm.prank(vaultAdmin);
        ConditionalStocksAdmin(address(cs)).merge(id, 1, b);
        eq(ex.credit(vaultAdmin, address(x)), b, "merged into exchange credit");
    }

    function _xMarket(address token) internal returns (uint32 id) {
        ConditionalStocksBase.MarketParams memory p = params(uint40(T0 - 1), uint40(T0 + 30 days));
        p.base = token;
        p.metadataHash = keccak256(bytes("ipfs://x"));
        vm.prank(marketAdmin);
        id = view_.createMarket(p, "ipfs://x");
        vm.prank(marketAdmin);
        view_.lifecycle(id, 0, bytes32(0));
    }
}
