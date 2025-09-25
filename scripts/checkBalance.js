// scripts/checkBalance.js

const { ethers } = require("hardhat");

// --- CONFIGURATION ---
const TOKEN_ADDRESS = "0xf97f4df75117a78c1a5a0dbb814af92458539fb4"; // LINK Token
const NEW_WHALE_ADDRESS_LINK = "0xd4b3e51c7fa014ace0bb423c49f2f31ddfebc656"; // All lowercase to avoid checksum errors

const TOKEN_DECIMALS = 18; // LINK has 18 decimals

// MODIFICATION: Using a minimal, direct ABI instead of relying on Hardhat's artifact resolution.
const MINIMAL_ERC20_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "function symbol() view returns (string)",
];

async function main() {
    console.log("--- Checking Whale Balance on Forked Network ---");

    // MODIFICATION: Using the direct ABI to create the contract instance.
    const token = await ethers.getContractAt(MINIMAL_ERC20_ABI, TOKEN_ADDRESS);
    
    const balance = await token.balanceOf(NEW_WHALE_ADDRESS_LINK);
    
    console.log(`Token: ${await token.symbol()}`);
    console.log(`Whale Address: ${NEW_WHALE_ADDRESS_LINK}`);
    console.log(`Balance: ${ethers.formatUnits(balance, TOKEN_DECIMALS)}`);
    console.log("-----------------------------------------------");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
