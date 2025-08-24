const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ArbitrageV3 Contract", function () {
  let arbitrage, owner, whale, token0, token1, flashAmount;

  beforeEach(async function () {
    // Load config
    const config = require("../config.json");

    // Deploy the contract
    const ArbitrageV3 = await ethers.getContractFactory("ArbitrageV3");
    arbitrage = await ArbitrageV3.deploy(
      config.BALANCERV3.VAULT_ADDRESS,
      config.UNISWAPV3.V3_ROUTER_02_ADDRESS,
      config.SUSHISWAPV3.V3_ROUTER_02_ADDRESS
    );
    await arbitrage.waitForDeployment();

    // Get signers
    [owner] = await ethers.getSigners();

    // Impersonate a whale with funds
    whale = await ethers.getImpersonatedSigner("0xC6962004f452bE9203591991D15f6b388e09E8D0");
    if (!whale || !whale.address) {
      throw new Error(`Failed to impersonate signer: ${"0xC6962004f452bE9203591991D15f6b388e09E8D0"}. Check address validity or network fork.`);
    }
    await network.provider.send("hardhat_setBalance", [
      whale.address,
      ethers.toBeHex(ethers.parseEther("10"))
    ]);

    // Set test tokens and amount from .env or defaults
    token0 = process.env.ARB_FOR || "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"; // WETH
    token1 = process.env.ARB_AGAINST || "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // Native USDC
    flashAmount = ethers.parseUnits("0.1", 18); // Reduced to 0.1 WETH to minimize slippage

    // Mock token balances for the whale
    await network.provider.send("hardhat_setStorageAt", [
      token0, // WETH
      ethers.solidityPackedKeccak256(["uint256", "uint256"], [ethers.toBeHex(whale.address), 3]),
      ethers.zeroPadValue(ethers.toBeHex(ethers.parseUnits("1000", 18)), 32)
    ]);
    await network.provider.send("hardhat_setStorageAt", [
      token1, // Native USDC
      ethers.solidityPackedKeccak256(["uint256", "uint256"], [ethers.toBeHex(whale.address), 3]),
      ethers.zeroPadValue(ethers.toBeHex(ethers.parseUnits("1000000", 6)), 32)
    ]);
  });

  it("Should deploy the contract correctly", async function () {
    expect(await arbitrage.getAddress()).to.be.properAddress;
    expect(await arbitrage.owner()).to.equal(owner.address);
  });

  it("Should execute a flash loan trade", async function () {
    try {
      const tx = await arbitrage.connect(owner).executeTrade(true, token0, token1, flashAmount, { gasLimit: 3000000 });
      const receipt = await tx.wait();
      console.log("Transaction succeeded:", tx.hash);
      console.log("Logs:", receipt.logs); // Debug logs from contract
    } catch (error) {
      console.error("Transaction reverted:", error.reason);
      throw error;
    }
    await expect(
      arbitrage.connect(owner).executeTrade(true, token0, token1, flashAmount, { gasLimit: 3000000 })
    ).to.not.be.reverted;
  });
});
