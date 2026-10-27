// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Vm } from "../Base.t.sol";
import { TestnetXStockToken } from "./TestnetXStockToken.sol";

/// @dev The testnet copy of an xStock serves the mainnet token's metadata, permit domain and
///      multiplier, and mints to anyone.
contract TestnetXStockTokenTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    string internal constant TERMS = "https://www.backedassets.fi/legal-documentation";

    TestnetXStockToken internal token;

    function setUp() public {
        token = new TestnetXStockToken("Tesla xStock", "TSLAx", TERMS, "1.1.0", 1e18, 1e18, 0);
    }

    function testMirrorsMainnetMetadata() public view {
        ok(keccak256(bytes(token.name())) == keccak256("Tesla xStock"), "name");
        ok(keccak256(bytes(token.symbol())) == keccak256("TSLAx"), "symbol");
        ok(token.decimals() == 18, "decimals");
        ok(keccak256(bytes(token.terms())) == keccak256(bytes(TERMS)), "terms");
        ok(keccak256(bytes(token.VERSION())) == keccak256("1.1.0"), "version");
        ok(token.multiplier() == 1e18, "multiplier");
        ok(token.newMultiplier() == 1e18 && token.multiplierNonce() == 0, "multiplier update");
        ok(!token.paused(), "paused");
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Tesla xStock"),
                keccak256("1"),
                block.chainid,
                address(token)
            )
        );
        ok(token.DOMAIN_SEPARATOR() == domain, "permit domain");
    }

    function testAnyoneMints() public {
        vm.prank(address(0xBEEF));
        token.mint(address(0xBEEF), 3e18);
        ok(token.balanceOf(address(0xBEEF)) == 3e18, "minted");
    }

    function ok(bool condition, string memory message) internal pure {
        require(condition, message);
    }
}
