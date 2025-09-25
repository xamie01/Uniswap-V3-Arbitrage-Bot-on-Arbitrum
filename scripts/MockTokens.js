// scripts/deployMocks.js
const { ethers } = require("hardhat");
async function main() {
    console.log("--- Deploying Mock Tokens to Arbitrum Sepolia ---");
    const MockTokenFactory = await ethers.getContractFactory("MockToken");
    const tokens = { "LINK": "ChainLink (Mock)", "ARB": "Arbitrum (Mock)", "UNI": "Uniswap (Mock)" };
    console.log("\n--> Copy these lines into your .env file:\n");
    for (const symbol in tokens) {
        const mockToken = await MockTokenFactory.deploy(tokens[symbol], symbol);
        await mockToken.waitForDeployment();
        console.log(`MOCK_${symbol}_ADDRESS=${await mockToken.getAddress()}`);
    }
}
main().catch(console.error);
