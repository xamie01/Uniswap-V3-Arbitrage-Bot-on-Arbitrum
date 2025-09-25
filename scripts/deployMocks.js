// scripts/deployMocks.js
const { ethers } = require("hardhat");

// The amount of each mock token to mint to your wallet
const MINT_AMOUNT = ethers.parseEther("1000000"); // We will mint 1,000,000 of each token

const tokensToCreate = {
    "LINK": { name: "ChainLink (Mock)" },
    "ARB": { name: "Arbitrum (Mock)" },
    "UNI": { name: "Uniswap (Mock)" }
};

async function main() {
    console.log("--- Deploying and Minting Mock Tokens to Sepolia Testnet ---");
    
    // Get the wallet that is deploying the contracts
    const [deployer] = await ethers.getSigners();
    console.log(`Tokens will be minted to this address: ${deployer.address}`);

    const MockTokenFactory = await ethers.getContractFactory("MockToken");
    
    console.log("\n--> ACTION REQUIRED: Copy these lines and build your ARB_AGAINST_TOKENS line in your .env file:\n");
    for (const symbol in tokensToCreate) {
        const config = tokensToCreate[symbol];

        // 1. Deploy the token
        const mockToken = await MockTokenFactory.deploy(config.name, symbol);
        await mockToken.waitForDeployment();
        const address = await mockToken.getAddress();
        console.log(`- ${symbol} (Mock) Address: ${address}`);

        // 2. Mint a starting balance to the deployer's wallet
        const mintTx = await mockToken.mint(deployer.address, MINT_AMOUNT);
        await mintTx.wait();
        console.log(`  Successfully minted ${ethers.formatEther(MINT_AMOUNT)} ${symbol} to your wallet.`);
    }
    console.log("\n--> Deployment and minting complete. Update your .env file now.\n");
}

main().catch(error => {
    console.error("A fatal error occurred:", error);
    process.exit(1);
});
