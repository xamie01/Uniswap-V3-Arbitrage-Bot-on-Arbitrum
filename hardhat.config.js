// hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    hardhat: {
      forking: {
        // Prefer forking Sepolia when available; fallback to ARBITRUM_RPC_URL if provided
        url: process.env.ETH_SEPOLIA_RPC_URL || process.env.ARBITRUM_RPC_URL,
        // Only set blockNumber when explicitly provided to avoid invalid defaults
        ...(process.env.FORK_BLOCK_NUMBER ? { blockNumber: parseInt(process.env.FORK_BLOCK_NUMBER) } : {})
      }
    },
    sepolia: {
      url: process.env.ETH_SEPOLIA_RPC_URL,
      // Only include accounts if PRIVATE_KEY is set to avoid passing 'undefined'
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  }
};
