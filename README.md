# cross-chain-resolver-example

## Installation

Install example deps

```shell
pnpm install
```

Install [foundry](https://book.getfoundry.sh/getting-started/installation)

```shell
curl -L https://foundry.paradigm.xyz | bash
```

Install contract deps

```shell
forge install
```

## Running

### For Real Optimism Mainnet Transactions

To run tests with real transactions on Optimism mainnet and fork transactions on BSC:

```shell
# Set environment variables for real Optimism transactions
export SRC_CHAIN_RPC=https://mainnet.optimism.io
export DST_CHAIN_RPC=https://bsc-dataseed1.binance.org
export SRC_CHAIN_CREATE_FORK=false
export DST_CHAIN_CREATE_FORK=true
export OPTIMISM_PRIVATE_KEY=your_optimism_private_key_here
export OPTIMISM_RESOLVER_PRIVATE_KEY=your_optimism_resolver_private_key_here



# Run tests
pnpm test

# Or use the convenience script (requires private keys to be set)
pnpm run test:optimism
```

### For Fork Testing (Default)

To run tests with fork transactions on both chains:

```shell
SRC_CHAIN_RPC=ETH_FORK_URL DST_CHAIN_RPC=BNB_FORK_URL pnpm test
```

### Public RPC URLs

| Chain    | Url                          |
|----------|------------------------------|
| Optimism | https://optimism.publicnode.com  |
| BSC      | wss://bsc-rpc.publicnode.com |

## Test Accounts

### For Fork Testing (Default)

```
(0) 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" Owner of EscrowFactory
(1) 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" User
(2) 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" Resolver
```

### For Real Optimism Transactions

When using real Optimism mainnet transactions, you need to provide your own private keys:

- `OPTIMISM_PRIVATE_KEY`: Your Optimism wallet private key (for user transactions)
- `OPTIMISM_RESOLVER_PRIVATE_KEY`: Your Optimism resolver wallet private key (for resolver transactions)

**⚠️ WARNING**: Never commit real private keys to version control. Use environment variables or secure key management.

### Token Requirements

For real Optimism transactions, ensure your wallets have:

1. **USDC on Optimism**: `0x0b2c639c533813f4aa9d7837caf62653d097ff85`
2. **ETH for gas fees**: Sufficient ETH for transaction fees
3. **Approval for 1inch Limit Order Protocol**: The test will approve USDC for the Limit Order Protocol

For BSC fork testing, the test will automatically fund accounts with USDC from the donor address.

### Fork vs Real Transactions

| Aspect | Fork Testing | Real Optimism Transactions |
|--------|--------------|---------------------------|
| **Cost** | Free (simulated) | Real gas fees and token costs |
| **Risk** | None | Real financial risk |
| **Setup** | Automatic funding | Manual wallet funding required |
| **Speed** | Instant | Depends on network congestion |
| **Use Case** | Development/testing | Production validation |

### Contract Deployment

When running real Optimism transactions, the test will deploy the EscrowFactory and Resolver contracts on Optimism mainnet on-the-fly during test execution. This ensures fresh contracts for each test run.
# evm-contracts
# evm-contracts
