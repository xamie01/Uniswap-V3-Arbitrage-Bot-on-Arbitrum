// helpers/rpcManager.js
const { ethers } = require("ethers");

/**
 * Multi-RPC failover manager for reliability and free-tier usage control.
 */
const RPC_URLS = [
  process.env.ARBITRUM_RPC_ALCHEMY,   // Alchemy mainnet
  process.env.ARBITRUM_RPC_BLAST,     // BlastAPI or other backup
  process.env.ARBITRUM_RPC_INFURA,    // Infura fallback
  process.env.ARBITRUM_RPC_PUBLIC     // Public node fallback
];

let currentIndex = 0;
let provider = new ethers.JsonRpcProvider(RPC_URLS[currentIndex]);

async function getProvider() {
  try {
    // Test connectivity every 5 blocks
    const block = await provider.getBlockNumber();
    return provider;
  } catch (err) {
    console.warn(`⚠️ RPC ${RPC_URLS[currentIndex]} failed, switching...`);
    currentIndex = (currentIndex + 1) % RPC_URLS.length;
    provider = new ethers.JsonRpcProvider(RPC_URLS[currentIndex]);
    console.log(`🔁 Switched to RPC ${RPC_URLS[currentIndex]}`);
    return provider;
  }
}

module.exports = { getProvider };
