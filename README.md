#V3 FLASHLOAN ARBITRAGE BOT - ALL COMMANDS

## SETUP (Run Once)

```bash
# 1. Install dependencies
npm install

# 2. Create .env file
cp .env.example .env

# 3. Edit .env with your values
nano .env
# Add:
# ETH_SEPOLIA_RPC_URL=https://eth-sepolia.alchemyapi.io/v2/YOUR_KEY
# PRIVATE_KEY=0xYOUR_PRIVATE_KEY
# ARB_FOR=0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9
# ARB_AGAINST=0x...YOUR_TOKEN...
# TELEGRAM_BOT_TOKEN=YOUR_TOKEN
# TELEGRAM_CHAT_ID=YOUR_CHAT_ID
# PROFIT_THRESHOLD=0.1
# MIN_PROFIT_THRESHOLD=0.001
# FLASH_LOAN_FEE=0.0009
# SLIPPAGE_TOLERANCE=50

# 4. Deploy contracts
npx hardhat compile

# 5. Deploy ArbitrageV3
npx hardhat run scripts/deploy.js --network sepolia

# 6. Copy contract address to config.json
# Edit config.json: "ARBITRAGE_V3_ADDRESS": "0x..."
```

---

## FILE CREATION (Run Once)

```bash
# Create v2v3flashloanbot.js from artifact "v2v3flashloanbot.js - V2â†”V3 Arbitrage with Flashloan"
# Create scripts/v3manipulate_improved.js from artifact "scripts/v3manipulate_improved.js - Market Manipulation"
# Verify helpers/profitCalculator.js exists (should already be there)

# Check files created
ls -la v2v3flashloanbot.js
ls -la scripts/v3manipulate_improved.js
ls -la helpers/profitCalculator.js
```

---

## VERIFY SETUP

```bash
# Check syntax
node -c v2v3flashloanbot.js
node -c scripts/v3manipulate_improved.js
node -c helpers/profitCalculator.js

# Check .env values
cat .env | grep -E "PRIVATE_KEY|ETH_SEPOLIA|ARB_"

# Check config.json
cat config.json | grep ARBITRAGE_V3_ADDRESS
```

---

## TESTING PHASE (24 Hours)

```bash
# Test 1: Deploy mock tokens
npx hardhat run scripts/deployMocks.js --network sepolia

# Test 2: Test profit calculations
npx hardhat run scripts/testProfitCalculations.js --network localhost

# Test 3: Check if contract deployed correctly
npx hardhat console --network sepolia
# Inside console:
> const arbitrage = await ethers.getContractAt('ArbitrageV3', '0x...ADDRESS...')
> await arbitrage.owner()
# Should return your wallet address
> exit()
```

---

## OPERATION (Daily Usage)

### Terminal 1: Create Price Differences

```bash
# Run once to create price gap
npx hardhat run scripts/v3manipulate_improved.js --network sepolia

# Run 2-3 more times to widen gap
npx hardhat run scripts/v3manipulate_improved.js --network sepolia
npx hardhat run scripts/v3manipulate_improved.js --network sepolia
npx hardhat run scripts/v3manipulate_improved.js --network sepolia
```

### Terminal 2: Run Bot (MAIN)

```bash
# Start bot (runs continuously)
node v2v3flashloanbot.js
```

### Terminal 3: Monitor (Optional)

```bash
# Check gas prices
npx hardhat console --network sepolia
> const fees = await ethers.provider.getFeeData()
> ethers.formatUnits(fees.gasPrice, 'gwei')
> exit()

# Check wallet balance
npx hardhat console --network sepolia
> const balance = await ethers.provider.getBalance('0x...YOUR_ADDRESS...')
> ethers.formatEther(balance)
> exit()

# Check token balance
npx hardhat console --network sepolia
> const token = await ethers.getContractAt('ERC20', '0x...TOKEN_ADDRESS...')
> ethers.formatEther(await token.balanceOf('0x...YOUR_ADDRESS...'))
> exit()

# Get swap quote V2
npx hardhat console --network sepolia
> const router = await ethers.getContractAt('IUniswapV2Router02', config.UNISWAP.V2_ROUTER_02_ADDRESS)
> await router.getAmountsOut(ethers.parseEther('0.1'), ['0x...TOKEN0...', '0x...TOKEN1...'])
> exit()
```

---

## TELEGRAM MONITORING (While Bot Running)

```
Send these commands to your Telegram bot:

/start     â†’ Resume bot scanning
/stop      â†’ Pause bot scanning
/status    â†’ Check current status, trade count, balance
/history   â†’ View last 5 trades with profits
/logs      â†’ View last 15 console logs
```

---

## TROUBLESHOOTING COMMANDS

```bash
# If bot not finding opportunities - check prices
npx hardhat console --network sepolia
> const v2Router = await ethers.getContractAt('IUniswapV2Router02', '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3')
> const v2Price = await v2Router.getAmountsOut(ethers.parseEther('0.1'), ['0x...WETH...', '0x...TOKEN...'])
> ethers.formatEther(v2Price[1])
> exit()

# Check if V2 pool exists
npx hardhat console --network sepolia
> const factory = await ethers.getContractAt('IUniswapV2Factory', '0xF62c03E08ada871A0bEb309762E260a7a6a880E6')
> const pair = await factory.getPair('0x...TOKEN0...', '0x...TOKEN1...')
> pair
# Should NOT be 0x0000000000000000000000000000000000000000
> exit()

# Check ETH balance for gas
npx hardhat console --network sepolia
> await ethers.provider.getBalance('0x...YOUR_ADDRESS...')
# Should be > 0.5 ETH for testing
> exit()

# Get Sepolia ETH from faucet if needed
# Visit: https://sepoliafaucet.com
```

---

## OPTIMIZATION COMMANDS

```bash
# Lower threshold if no opportunities found
# Edit .env:
PROFIT_THRESHOLD=0.05

# Restart bot
node v2v3flashloanbot.js

# Run manipulation more times to widen gap
npx hardhat run scripts/v3manipulate_improved.js --network sepolia
npx hardhat run scripts/v3manipulate_improved.js --network sepolia
npx hardhat run scripts/v3manipulate_improved.js --network sepolia

# If too much gas cost, wait for lower gas prices
# Check: https://sepolia.etherscan.io/gastracker
```

---

## MAINTENANCE COMMANDS

```bash
# Restart bot (clean state)
# Press Ctrl+C to stop
node v2v3flashloanbot.js

# View transaction history
# Visit: https://sepolia.etherscan.io
# Search your wallet address

# Check contract balance
npx hardhat console --network sepolia
> const token = await ethers.getContractAt('ERC20', '0x...TOKEN...')
> ethers.formatEther(await token.balanceOf('0x...CONTRACT_ADDRESS...'))
> exit()

# Approve tokens to routers (if needed)
npx hardhat console --network sepolia
> const token = await ethers.getContractAt('ERC20', '0x...TOKEN...')
> const tx = await token.approve('0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3', ethers.MaxUint256)
> await tx.wait()
> exit()

# Check logs
tail -100 console.log

# Restart everything
pkill -f "node v2v3flashloanbot.js"
npx hardhat run scripts/v3manipulate_improved.js --network sepolia
node v2v3flashloanbot.js
```

---

## DEBUG COMMANDS

```bash
# Check if ArbitrageV3 is deployed
npx hardhat console --network sepolia
> const arbitrage = await ethers.getContractAt('ArbitrageV3', '0x...ADDRESS...')
> await arbitrage.owner()
> exit()

# View recent blocks
npx hardhat console --network sepolia
> const block = await ethers.provider.getBlockNumber()
> block
> exit()

# Check pending transactions
npx hardhat console --network sepolia
> const tx = await ethers.provider.getTransaction('0x...TX_HASH...')
> await tx.wait()
> exit()

# Simulate trade (check if it would work)
npx hardhat console --network sepolia
> const router = await ethers.getContractAt('IUniswapV2Router02', '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3')
> try { await router.getAmountsOut(ethers.parseEther('0.1'), ['0x...TOKEN0...', '0x...TOKEN1...']) } catch(e) { console.log('Error:', e.message) }
> exit()

# Check contract approval status
npx hardhat console --network sepolia
> const token = await ethers.getContractAt('ERC20', '0x...TOKEN...')
> const allowance = await token.allowance('0x...OWNER...', '0x...ROUTER...')
> ethers.formatEther(allowance)
> exit()

# View contract events
npx hardhat console --network sepolia
> const arbitrage = await ethers.getContractAt('ArbitrageV3', '0x...ADDRESS...')
> const events = await arbitrage.queryFilter('*')
> events.slice(-5)
> exit()
```

---

## PRODUCTION DEPLOYMENT (After 24h Testing)

```bash
# Deploy to mainnet (ONLY after successful testing)
# Update .env:
ETH_ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY

# Deploy contract to mainnet
npx hardhat run scripts/deploy.js --network arbitrum

# Update config.json with mainnet contract address

# Update .env for mainnet:
ARB_FOR=0x82af49447d8a07e3bd95bd0d56f35241523fbab1  # Actual WETH on Arbitrum
ARB_AGAINST=0x...                                    # Actual token

# Run manipulation on mainnet
npx hardhat run scripts/v3manipulate_improved.js --network arbitrum

# Run bot on mainnet
node v2v3flashloanbot.js
```

---

## QUICK REFERENCE - Daily Workflow

```bash
# DAY 1: SETUP (30 minutes)
npm install
cp .env.example .env
# Edit .env
npx hardhat compile
npx hardhat run scripts/deploy.js --network sepolia
# Update config.json

# DAY 1: FILE CREATION
# Create v2v3flashloanbot.js from artifact
# Create scripts/v3manipulate_improved.js from artifact
node -c v2v3flashloanbot.js

# DAY 1-2: TESTING (24+ hours)
npx hardhat run scripts/deployMocks.js --network sepolia
npx hardhat run scripts/testProfitCalculations.js --network localhost

# DAILY: OPERATION
# Terminal 1:
npx hardhat run scripts/v3manipulate_improved.js --network sepolia
npx hardhat run scripts/v3manipulate_improved.js --network sepolia

# Terminal 2:
node v2v3flashloanbot.js

# Telegram:
/status
/history
/logs

# Terminal 3 (Monitor):
npx hardhat console --network sepolia
# Check prices, balances, etc.
```

---

## COMPLETE SETUP IN ONE GO

```bash
# Copy-paste this entire block to set up everything quickly

# Step 1: Setup
npm install
cp .env.example .env

# Step 2: Edit .env (you need to do this manually with your values)
# nano .env

# Step 3: Compile and deploy
npx hardhat compile
npx hardhat run scripts/deploy.js --network sepolia

# Step 4: Note the contract address, then update config.json
# nano config.json

# Step 5: Create the bot files (from artifacts)
# Create v2v3flashloanbot.js
# Create scripts/v3manipulate_improved.js

# Step 6: Verify
node -c v2v3flashloanbot.js
node -c scripts/v3manipulate_improved.js

# Step 7: Test
npx hardhat run scripts/deployMocks.js --network sepolia

# Step 8: Run (in separate terminals)
# Terminal 1:
npx hardhat run scripts/v3manipulate_improved.js --network sepolia

# Terminal 2:
node v2v3flashloanbot.js

# Terminal 3 (Monitor):
npx hardhat console --network sepolia
```

---

## COMMON ISSUES & FIXES

```bash
# Issue: "Module not found: profitCalculator"
# Fix: Verify file exists
ls -la helpers/profitCalculator.js

# Issue: "ARBITRAGE_V3_ADDRESS not in config"
# Fix: Deploy contract and update config.json
npx hardhat run scripts/deploy.js --network sepolia

# Issue: Bot not finding opportunities
# Fix: Run manipulation script more times
npx hardhat run scripts/v3manipulate_improved.js --network sepolia
npx hardhat run scripts/v3manipulate_improved.js --network sepolia
npx hardhat run scripts/v3manipulate_improved.js --network sepolia

# Issue: High gas costs
# Fix: Wait for lower gas prices or reduce trade size
# Check: https://sepolia.etherscan.io/gastracker

# Issue: Transaction reverted
# Fix: Check Etherscan for error
# Visit: https://sepolia.etherscan.io/tx/0x...YOUR_TX_HASH...

# Issue: No Telegram alerts
# Fix: Verify bot token and chat ID in .env
cat .env | grep TELEGRAM

# Issue: Insufficient balance for gas
# Fix: Get Sepolia ETH from faucet
# Visit: https://sepoliafaucet.com
```

---

## MONITORING DASHBOARDS

```
Real-time Monitoring:
 Telegram: /status /history /logs
Etherscan: https://sepolia.etherscan.io (search wallet)
Gas Tracker: https://sepolia.etherscan.io/gastracker
Console: Watch for profit logs

Daily Review:
â
 Total trades executed: Check /history in Telegram
 Total profit: Calculate from trade logs
Success rate: Count successful vs failed trades
â€¢ Average profit: Total profit / number of trades
```

---

**That's everything! Just follow the commands in order. Good luck! **
