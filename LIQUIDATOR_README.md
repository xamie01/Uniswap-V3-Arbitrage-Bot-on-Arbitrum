# Liquidator Feature — README

This document describes the Liquidator scaffold added to the repository and the exact steps & TODOs required to make it test-ready on Sepolia (or a local fork).

## What was added
- contracts/Liquidator.sol — Aave flash-loan receiver scaffold with protocol adapter stubs (Aave, Compound, Maker).
- scripts/deployLiquidator.js — deploy script for the Liquidator contract.
- liquidatorBot.js — off-chain monitor scaffold that calls the contract when a vulnerable borrower is detected.
- scripts/testLiquidation.js — placeholder helper with local-fork testing suggestions.

Important: the scaffold contains TODO placeholders and is NOT production-ready. Do not deploy to mainnet yet.

## Goals
- Use Aave flash loans to fund on-chain liquidations for multiple lending protocols.
- Provide adapters so the same contract can perform protocol-specific liquidation calls.
- Provide off-chain monitor that finds undercollateralized borrowers and triggers the liquidation flow.

## Required files and ABIs you must supply
Place ABI JSON files in `/abi` (create folder) or update imports accordingly.
- Aave: ILendingPool / IAddressesProvider / IFlashLoanReceiver (Aave v2 or v3 ABI appropriate for target network)
- Compound: Comptroller and cToken partial ABIs
- Maker: CDP Manager ABI (if you plan to support Maker)
- Routers: Uniswap V2 Router, Uniswap V3 Router/Quoter

## Required env vars (add to `.env`)
- ETH_SEPOLIA_RPC_URL - Sepolia RPC endpoint
- PRIVATE_KEY - deployer/private key (0x...)
- AAVE_LENDING_POOL - Aave LendingPool address for target network (TODO)
- LIQUIDATOR_ADDRESS - set after deploy
- UNISWAP_V2_ROUTER - Router used for swaps
- UNISWAP_V3_ROUTER - Router used for swaps
- (optional) PROTOCOL_COMPOUND=true and COMPOUND_COMPTROLLER=0x...
- (optional) PROTOCOL_MAKER=true and MAKER_CDPS_MANAGER=0x...
- LIQUIDATOR_OWNER - owner address
- MAX_SLIPPAGE_PERCENT - numeric

## How to compile & deploy (Sepolia)
1. Compile contracts:

```bash
npx hardhat compile
```

2. Deploy Liquidator (Sepolia):

```bash
# Ensure .env has PRIVATE_KEY and ETH_SEPOLIA_RPC_URL
npx hardhat run scripts/deployLiquidator.js --network sepolia
```

3. Copy the deployed Liquidator address printed by the script into `.env` as `LIQUIDATOR_ADDRESS`.

## How to test locally (recommended)
1. Start a local fork of Sepolia (or Arbitrum if you want real Sushiswap pools):

```bash
npx hardhat node --fork $ETH_SEPOLIA_RPC_URL --fork-block-number <recent_block>
```

2. Deploy Liquidator to localhost:

```bash
npx hardhat run scripts/deployLiquidator.js --network localhost
```

3. Use repo scripts (e.g., `scripts/manipulate.js` or `scripts/v3manipulate.js`) to create an undercollateralized borrower or to seed pools.

4. Run the test helper (placeholder) or call the contract manually from a Hardhat console:

```bash
npx hardhat console --network localhost
> const Liquidator = await ethers.getContractAt('Liquidator', process.env.LIQUIDATOR_ADDRESS)
> await Liquidator.executeLiquidation(1, borrower, debtToken, debtAmount, collateralToken, '0x')
```

## TODO checklist — what remains to be implemented to make this test-ready
- [ ] Provide Aave LendingPool address in `.env` (AAVE_LENDING_POOL) and confirm which Aave version (v2 or v3) to use.
- [ ] Add Aave ABI files to `/abi` and update the contract and scripts to import/use them where needed.
- [ ] Implement `_liquidateOnAave` in `Liquidator.sol`:
  - Approve tokens to Aave, call the correct liquidation function, handle seized collateral.
  - Implement swap logic (Uniswap/Sushi) to convert seized collateral into the borrowed asset to repay the flash loan.
- [ ] Implement Compound adapter `_liquidateOnCompound` (Comptroller / cToken `liquidateBorrow`).
- [ ] (Optional) Implement Maker adapter `_liquidateOnMaker` if targeting Maker Vaults.
- [ ] Implement and test swap helpers (on-chain or use DEX router calls) to repay flash loan and capture profit.
- [ ] Add extensive unit tests (Hardhat) simulating liquidation flows on a fork.
- [ ] Harden access control, reentrancy guards and safety checks; add events for all critical actions.
- [ ] Add gas limits and slippage constraints configurable via `.env`.
- [ ] Add monitoring logic in `liquidatorBot.js` to detect undercollateralized borrowers (on-chain health checks) and to estimate profit before executing.
- [ ] Add logging/alerts (Telegram integration is already in repo) and persistence for trade history.
- [ ] Security review & audit before any mainnet use.

## Suggested incremental implementation plan
1. Wire Aave adapter fully (complete `_liquidateOnAave`) and test on a local fork.
2. Implement swap flow using Uniswap V3 quoter to estimate returns and set slippage limits.
3. Add off-chain monitoring for Aave health factors and attempt a real liquidation on the fork.
4. Add Compound adapter and repeat tests.
5. Finalize configs, add tests, and prepare for staging on Sepolia.

## Notes & security
- Flash loans and liquidations are high-risk operations. Use testnets and forks until fully tested.
- Do not store or commit private keys. Use environment variables or a secrets manager on production.
- This scaffold is intentionally minimal and contains TODO placeholders. Treat it as a starting point, not a finished product.

If you want I can now:
- implement the Aave adapter end-to-end (requires you to provide the Aave LendingPool address or allow me to use the canonical testnet address),
- add ABI files into `/abi` and update the contract to import them, or
- implement the on-chain swap flow using Uniswap V3 router and quoter and wire it into the adapter.

Which of those would you like next?
