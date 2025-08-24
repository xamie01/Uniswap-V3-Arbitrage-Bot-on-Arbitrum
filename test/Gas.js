const { expect } = require("chai");
const { ethers } = require("hardhat");
const config = require("../config.json");
require("dotenv").config();

const arbFor = process.env.ARB_FOR || "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"; // WETH
const arbAgainst = process.env.ARB_AGAINST || "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // Native USDC

describe("ArbitrageV3 Contract", function () {
  let arbitrage;

  beforeEach(async function () {
    // Deploy the contract with V3 routers and Balancer V3 Vault
    const ArbitrageV3 = await ethers.getContractFactory("ArbitrageV3");
    arbitrage = await ArbitrageV3.deploy(
      config.BALANCERV3.VAULT_ADDRESS,
      config.UNISWAPV3.V3_ROUTER_02_ADDRESS,
      config.SUSHISWAPV3.V3_ROUTER_02_ADDRESS
    );
    await arbitrage.waitForDeployment();
    console.log("ArbitrageV3 deployed at:", await arbitrage.getAddress());
    if (!arbitrage) throw new Error("Arbitrage contract deployment failed");
  });

  it("Should estimate gas for executeTrade", async function () {
    // Parameters for executeTrade
    const params = {
      startOnUniswap: true,
      token0: arbFor,
      token1: arbAgainst,
      flashAmount: ethers.parseUnits("0.1", 18), // 1 WETH
    };

    const estimatedGas = await arbitrage.estimateGas.executeTrade(
      params.startOnUniswap,
      params.token0,
      params.token1,
      params.flashAmount
    );

    console.log(`Estimated Gas: ${estimatedGas.toString()}`);
    expect(estimatedGas.toNumber()).to.be.greaterThan(0);
  });
});
