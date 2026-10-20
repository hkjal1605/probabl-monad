// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Vm } from "../Base.t.sol";
import { TestnetStockToken } from "./TestnetStockToken.sol";
import { TestnetPermitToken, TestnetToken } from "./TestnetToken.sol";

/// @dev The testnet copy of a Robinhood Stock Token serves the mainnet token's metadata, permit
///      domain and UI multiplier, and only its deployer schedules multiplier changes.
contract TestnetStockTokenTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 internal constant UID = bytes32(uint256(0x915f477416294f5099a5e0e09f327ce5));
    string internal constant NAME = "NVIDIA \xe2\x80\xa2 Robinhood Token";

    TestnetStockToken internal token;

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new TestnetStockToken(
            NAME,
            "NVDA",
            UID,
            "https://robinhood.com/stocktoken/rhj",
            1e18,
            1.000775159164630595e18,
            1_788_998_430
        );
    }

    function testMirrorsMainnetMetadata() public view {
        ok(keccak256(bytes(token.name())) == keccak256(bytes(NAME)), "name");
        ok(keccak256(bytes(token.symbol())) == keccak256("NVDA"), "symbol");
        ok(token.decimals() == 18, "decimals");
        ok(token.uid() == UID, "uid");
        ok(
            keccak256(bytes(token.terms())) == keccak256("https://robinhood.com/stocktoken/rhj"),
            "terms"
        );
        ok(token.uiMultiplier() == 1.000775159164630595e18, "multiplier");
        ok(!token.paused(), "paused");
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes(NAME)),
                keccak256("1"),
                block.chainid,
                address(token)
            )
        );
        ok(token.DOMAIN_SEPARATOR() == domain, "permit domain");
    }

    function testUiAmountsAndScheduledMultiplier() public {
        token.mint(address(this), 2e18);
        ok(token.balanceOfUI(address(this)) == 2.00155031832926119e18, "UI balance");
        token.updateMultiplier(2e18, block.timestamp + 1 days);
        ok(token.uiMultiplier() == 1.000775159164630595e18, "before effectiveAt");
        vm.warp(block.timestamp + 1 days);
        ok(token.uiMultiplier() == 2e18, "from effectiveAt");
        ok(token.totalSupplyUI() == 4e18, "UI supply");
    }

    function testOnlyTheDeployerUpdatesTheMultiplier() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(TestnetStockToken.Unauthorized.selector);
        token.updateMultiplier(2e18, 0);
    }

    function testDecimals() public {
        ok(new TestnetToken("Coinbase Wrapped BTC", "cbBTC", 8).decimals() == 8, "plain");
        ok(new TestnetPermitToken("WETH", "WETH", 18).decimals() == 18, "permit");
    }

    function ok(bool condition, string memory message) internal pure {
        require(condition, message);
    }
}
