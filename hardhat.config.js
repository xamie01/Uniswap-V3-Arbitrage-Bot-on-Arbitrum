require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const privateKey = process.env.PRIVATE_KEY || "";
const alchemyApiKey = process.env.ALCHEMY_API_KEY || "";

if (!privateKey) {
  console.warn("PRIVATE_KEY not set in .env. Deployments will fail.");
}
if (!alchemyApiKey) {
  console.warn("ALCHEMY_API_KEY not set in .env. Forking and network connections will fail.");
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      { version: "0.8.24" }, // Exact match for ^0.8.24
      { version: "0.8.18" }  // For Uniswap V3/Sushiswap compatibility
    ]
  },
  networks: {
    hardhat: {
      forking: {
        url: `https://arb-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
      },
    },
    arbitrum: {
      url: `https://arb-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
      accounts: privateKey ? [privateKey] : [],
    },
    mainnet: {
      url: `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
      accounts: privateKey ? [privateKey] : [],
    },
    goerli: {
      url: `https://eth-goerli.g.alchemy.com/v2/${alchemyApiKey}`,
      accounts: privateKey ? [privateKey] : [],
    },
    polygon: {
      url: `https://polygon-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
      accounts: privateKey ? [privateKey] : [],
    },
  },
};
