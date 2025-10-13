Arbitrum Flashloan Arbitrage Bot (V3 - XAHMIE_01 Edition)
This advanced trading bot identifies and executes flashloan-powered arbitrage opportunities between Uniswap V3 and Sushiswap V3 on the Arbitrum network. It has been significantly upgraded from its original design to support multi-pair scanning, robust error handling, and a professional-grade testing environment.
This bot is designed to be deployed and run on the Arbitrum Mainnet or the Arbitrum Sepolia Testnet.
Key Features & Upgrades
 * Multi-Pair Scanning: Instead of watching a single token pair, the bot dynamically scans a list of configured tokens on every new block, dramatically increasing the chances of finding an opportunity.
 * Flashloan Powered: Utilizes Balancer flashloans to execute large trades with zero upfront capital.
 * V3 "Fee-Aware" Logic: The bot is intelligent enough to detect the most liquid fee tier (0.05%, 0.3%, 1%) for any given pair, allowing it to interact with a much wider range of markets.
 * Professional Test Environment: Comes with a suite of Hardhat scripts to deploy mock tokens and create a fully seeded, liquid, and predictable forked environment for safe and reliable testing.
 * MEV Protection Ready: The smart contract is designed with slippage protection to defend against common MEV attacks like sandwich attacks.
 * Telegram Integration: Features a fully integrated Telegram bot for remote control and monitoring, allowing you to start/stop the bot, check status, and receive real-time notifications of successful trades.
Technology Stack & Tools
 * Solidity: Smart Contract Development
 * JavaScript / Ethers.js: Off-chain logic, blockchain interaction, and testing
 * Hardhat: Ethereum development environment for compiling, testing, and deploying
 * Alchemy/Infura: High-performance RPC connection to the Arbitrum network
 * Balancer: Flashloan provider
 * Telegram: Remote control and monitoring
Setting Up Your Bot: The Definitive Guide
This guide will walk you through setting up, testing, and deploying your bot.
1. Initial Project Setup
 * Clone/Download the Repository
 * Install Dependencies: Open your terminal in the project folder and run:
   npm install

 * Create and Configure .env File: Create a .env file in the root of your project. Copy the contents of .env.example and fill in the values.
   * PRIVATE_KEY: The private key of the wallet you will use to deploy the contract and run the bot. This wallet will receive all profits.
   * ARBITRUM_RPC_URL: Your private HTTPS RPC URL for Arbitrum Mainnet from Alchemy or Infura.
   * ARBITRUM_SEPOLIA_RPC_URL: Your private HTTPS RPC URL for Arbitrum Sepolia Testnet from Alchemy or Infura.
   * ARB_FOR: The address of WETH on Arbitrum (0x82af49447d8a07e3bd95bd0d56f35241523fbab1). This is the token used for flashloans.
   * ARB_AGAINST_TOKENS: A comma-separated list of token addresses you want the bot to monitor against WETH. We will populate this later during testing.
   * PROFIT_THRESHOLD: The minimum percentage profit to trigger a trade (e.g., 0.1 for 0.1%).
   * TELEGRAM_BOT_TOKEN: Your secret token from Telegram's BotFather.
   * TELEGRAM_CHAT_ID: Your personal Telegram Chat ID for receiving messages.
2. The Professional Testing Workflow (Using a Hardhat Fork)
Before deploying to a live network, it is essential to test your bot in a controlled environment. This workflow uses mock tokens to create a perfect, repeatable test.
 * Open contracts/MockToken.sol: Ensure this file exists from our previous work. This is a simple, standard ERC20 contract.
 * Compile: Compile all contracts, including the new MockToken.
   npx hardhat compile

 * Start Your Fork: In Terminal 1, start a fresh, clean Hardhat node that is forked from Arbitrum Mainnet.
   npx hardhat clean && npx hardhat node

 * Deploy Mock Tokens: The runTestEnvironment.js script will deploy clean, predictable versions of tokens like LINK, UNI, etc., for your test. In Terminal 2, run:
   npx hardhat run scripts/runTestEnvironment.js --network localhost

 * Update .env with Mock Addresses: The script will output a line like ARB_AGAINST_TOKENS=0x.... Copy this entire line and paste it into your .env file. This tells your bot to use the newly deployed mock tokens for the test.
 * Run the Bot: In Terminal 3, start your arbitrage bot. It will now connect to your local fork and start watching your mock tokens.
   node bot.js

 * Observe: The runTestEnvironment.js script (still running in Terminal 2) will now automatically seed the pools and manipulate the market. Watch your bot.js terminal (Terminal 3) to see it detect the opportunities and execute the arbitrage trades. You should also receive notifications on Telegram.
3. Deploying to a Live Network (Arbitrum Sepolia or Mainnet)
Once you are confident with the results from local testing, you can deploy to a live network.
 * Fund Your Wallet: Ensure your deployment wallet has a sufficient amount of ETH on the target network (e.g., Arbitrum Sepolia ETH) to pay for gas fees.
 * Deploy the ArbitrageV3.sol Contract: Run the deployment script, specifying the target network.
   * For Testnet: npx hardhat run scripts/deployArbitrageV3.js --network arbitrumSepolia
   * For Mainnet: npx hardhat run scripts/deployArbitrageV3.js --network arbitrum
 * Update config.json: The deploy script will output your new contract address. Copy this address and paste it as the value for ARBITRAGE_V3_ADDRESS in your config.json file.
 * Update .env with Real Token Addresses: Replace the mock token addresses in your ARB_AGAINST_TOKENS variable with the real, official Arbitrum addresses for the tokens you want to trade.
 * Run the Bot Live: Start your bot. It will now be operating on the live network you deployed to.
   node bot.js

Telegram Bot Commands
Once your bot is running, you can control and monitor it from anywhere using these commands in your Telegram chat with the bot:
 * /start: Resumes scanning for arbitrage opportunities.
 * /stop: Pauses scanning for arbitrage opportunities.
 * /status: Shows a report of the bot's current state, successful trade count, and wallet balance.
 * /history: Displays a list of the last 5 successful trades.
 * /logs: Retrieves the last 15 lines from the console for remote debugging.
This bot is the result of a long and challenging development journey. It is a powerful tool built on a robust and professional architecture. Happy trading!


Sepolia addy for Uniswap

UNiswap V2
Factory  0xF62c03E08ada871A0bEb309762E260a7a6a880E6
Router 0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3

Uniswap V3 
Factory 0x0227628f3F023bb0B980b67D528571c95c6DaC1c
Router 0xb41b78Ce3D1BDEDE48A3d303eD2564F6d1F6fff0