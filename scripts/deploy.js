// scripts/deployArbitrageV3.js
const hre = require("hardhat");

async function main() {
  console.log("Deploying ArbitrageV3 contract to Ethereum Sepolia...");

  // MODIFICATION: All addresses converted to lowercase to prevent checksum errors.
  const balancerVault = "0xba12222222228d8ba445958a75a0704d566bf2c8";
  const uniswapRouter = "0x3bfa4769fb09eefc5ab0a6a6632373010b93bf0a";
  const sushiswapRouter = "0x838a51754f2554a2624d09b1a848a1402f7159f8";

  const ArbitrageV3 = await hre.ethers.getContractFactory("ArbitrageV3");
  const arbitrageV3 = await ArbitrageV3.deploy(balancerVault, uniswapRouter, sushiswapRouter);

  await arbitrageV3.waitForDeployment();
  const contractAddress = await arbitrageV3.getAddress();

  console.log(`✅ ArbitrageV3 contract deployed to Sepolia at: ${contractAddress}`);
  console.log(`--> Verify on Etherscan Sepolia: https://sepolia.etherscan.io/address/${contractAddress}`);
}

main().catch(console.error);
