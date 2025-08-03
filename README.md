# Cross-Chain Atomic Swap: Optimism ↔ Aptos

A bidirectional cross-chain atomic swap implementation between Optimism (EVM) and Aptos (Move VM) using 1inch's Fusion protocol and hash-based address verification for non-EVM chains.

## 🌉 Overview

This project implements a complete cross-chain atomic swap system that enables secure token exchanges between Optimism and Aptos networks. The system uses 1inch's Fusion protocol for order management and implements a novel hash-based verification system for handling different address formats across chains.

### Key Features

- **Bidirectional Swaps**: Support for both Aptos → Optimism and Optimism → Aptos swaps
- **Hash-Based Address Verification**: Handles non-EVM address formats (Aptos, Sui, NEAR, Stellar, etc.)
- **1inch Fusion Integration**: Leverages 1inch's limit order protocol for order management
- **Atomic Execution**: Ensures either both sides complete or neither does
- **Decay-Based Dutch Auctions**: Dynamic pricing with time decay for optimal market rates
- **Multi-Chain Support**: Extensible architecture for additional chains

## 🔄 Swap Flow

### Aptos → Optimism (create-order.ts)
1. **Order Creation**: User creates a fusion order on Aptos with destination Optimism address
2. **Order Acceptance**: Resolver accepts the order and creates source escrow on Aptos
3. **Destination Deployment**: Resolver deploys destination escrow on Optimism with USDC
4. **Withdrawal**: Both parties can withdraw using the same secret

### Optimism → Aptos (aptos-integration.ts)
1. **EVM Order**: User creates order on Optimism with Aptos destination
2. **Cross-Chain Processing**: Resolver processes EVM events and creates Aptos escrow
3. **Hash Verification**: SHA1 hashes verify address compatibility
4. **Atomic Completion**: Withdrawal available on both chains

## 🏗️ Architecture

### Core Components

#### Smart Contracts
- **EscrowFactory**: Deploys escrow contracts on both chains
- **Resolver**: Coordinates cross-chain operations and manages secrets
- **Escrow Contracts**: Hold tokens and manage withdrawal logic
- **Limit Order Protocol**: 1inch's order management system

#### Integration Layer
- **FusionPlusClient**: Aptos contract interaction wrapper
- **Cross-Chain Coordinator**: Orchestrates multi-chain operations
- **Hash Verification System**: Handles address format differences

### Technology Stack

- **EVM Chains**: Solidity contracts with Foundry testing
- **Aptos**: Move contracts with TypeScript SDK
- **1inch Fusion**: Cross-chain order protocol
- **TypeScript**: Primary development language
- **Jest**: Testing framework
- **Ethers.js**: EVM interaction library

## 🔐 Hash-Based Address Verification

We have implemented hash-based verification for addresses on chains that have addresses longer than 32 bytes or use non-convertible formats — for example, NEAR has 40-byte addresses, and Stellar has addresses that are 40 bytes or longer.

To solve this, the user signs the hash of the receiving address and provides the signed order to the relayer along with extra data containing the actual address. When broadcasting the intent from the relayer to the resolver, the resolver detects that the chain ID corresponds to a non-EVM chain and accepts the address provided by the relayer. It then verifies the relayed address by taking its hash and comparing it to the hash emitted on-chain.

This approach allows us to support multiple address formats from EVM itself, which is a major unlock for chains like NEAR and Stellar.

## 🎯 Decay-Based Dutch Auctions

Apart from this, we have also implemented decay-based Dutch auctions, which allow resolvers to pick orders at their preferred market rate, while giving users the ability to set the minimum price they are willing to accept.

For example, if a user wants to swap 1 APTOS for 100 USDC, they can set:
- **Initial amount**: 102 USDC
- **Decay per second**: 0.2 USDC
- **Minimum acceptable amount**: 98 USDC

This means the resolver can accept the order at any time within the next 20 seconds. If the resolver accepts after 10 seconds, the user would receive exactly 100 USDC on the destination chain.

We have also preserved the hash lock and time lock properties from our Non-EVM contracts, ensuring security and decentralization.

### Implementation Details

```typescript
// Hash verification for non-EVM addresses
private verifySha1Hashes(eventData: CrossChainEventData): boolean {
  const expectedReceiverSha1 = '0x' + crypto.createHash('sha1')
    .update(eventData.originalReceiverAddress)
    .digest('hex');
  
  const expectedTakerAssetSha1 = '0x' + crypto.createHash('sha1')
    .update(eventData.originalTakerAssetAddress)
    .digest('hex');

  return isReceiverMatch && isTakerAssetMatch;
}
```

## 🚀 Getting Started

### Prerequisites

- Node.js >= 22
- Foundry
- Aptos CLI
- Optimism RPC access

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd evm-contracts

# Install dependencies
npm install

# Build contracts
forge build
```

### Environment Setup

Create a `.env` file with the following variables:

```env
# Aptos Configuration
CONTRACT_ADDRESS_TESTNET=<aptos-contract-address>
USER_PRIVATE_KEY=<aptos-user-private-key>
RESOLVER_PRIVATE_KEY=<aptos-resolver-private-key>

# Optimism Configuration
OPTIMISM_PRIVATE_KEY=<optimism-private-key>
OPTIMISM_RESOLVER_PRIVATE_KEY=<optimism-resolver-private-key>
SRC_CHAIN_RPC=https://optimism.publicnode.com
```

### Running Tests

```bash
# Run all tests
npm run test:all

# Run cross-chain tests
npm run test:cross-chain

# Run Aptos integration tests
npm run test:aptos

# Create a new order (Aptos → Optimism)
npm run create-order

# Run integration demo
npm run integration-demo
```

## 📁 Project Structure

```
evm-contracts/
├── contracts/
│   ├── src/
│   │   ├── Resolver.sol          # Cross-chain coordination
│   │   └── TestEscrowFactory.sol # Escrow deployment
│   └── lib/
│       └── cross-chain-swap/     # 1inch Fusion protocol
├── tests/
│   ├── create-order.ts           # Aptos → Optimism flow
│   ├── aptos-integration.ts      # Optimism → Aptos flow
│   ├── fusion-plus-client.ts     # Aptos contract wrapper
│   └── config.ts                 # Chain configuration
└── scripts/
    └── setup-optimism.sh         # Optimism setup
```

## 🔧 How It's Built

### Technology Choices

**1inch Fusion Protocol**: We chose 1inch's Fusion protocol for its robust order management system and proven security model. The protocol provides:
- Decentralized order matching
- MEV protection
- Cross-chain order coordination
- Built-in safety mechanisms

**Aptos Integration**: We leverage Aptos's Move VM for:
- Formal verification capabilities
- Resource-based security model
- High throughput and low latency
- Native cross-chain messaging

**Hash-Based Verification**: Our custom solution addresses the fundamental challenge of cross-chain address compatibility:
- SHA1 hashing for address verification
- Support for non-EVM address formats
- Backward compatibility with EVM chains
- Extensible for future chains

### Architecture Decisions

**Bidirectional Design**: Instead of one-way bridges, we implemented true bidirectional swaps:
- Same codebase handles both directions
- Consistent user experience
- Reduced complexity in maintenance

**Modular Escrow System**: Each swap creates two escrow contracts:
- Source escrow holds user's tokens
- Destination escrow holds resolver's tokens
- Atomic withdrawal ensures fairness

**Decay-Based Dutch Auctions**: Our innovative pricing mechanism allows resolvers to pick orders at their preferred market rate while giving users control over minimum acceptable prices:

- **Initial Amount**: User sets starting price (e.g., 102 USDC for 1 APT)
- **Decay Per Second**: Continuous price reduction (e.g., 0.2 USDC/second)
- **Minimum Amount**: User's floor price (e.g., 98 USDC minimum)
- **Time Window**: Resolver can accept anytime within the decay period
- **Fair Pricing**: Resolver gets optimal rate, user gets guaranteed minimum

### Integration Benefits

**1inch Partnership**: Using 1inch's Fusion protocol provides:
- Battle-tested security model
- Extensive audit coverage
- Active community support
- Proven MEV protection

**Cross-Chain SDK**: The 1inch cross-chain SDK offers:
- Standardized interfaces
- Multi-chain support
- Built-in safety checks
- Comprehensive documentation

## 🧪 Testing

### Test Categories

1. **Unit Tests**: Individual contract functions
2. **Integration Tests**: Cross-chain workflows
3. **End-to-End Tests**: Complete swap scenarios
4. **Security Tests**: Edge cases and failure modes

### Running Specific Tests

```bash
# Test Aptos → Optimism flow
npm run create-order

# Test Optimism → Aptos flow
npm run test:aptos

# Test cross-chain coordination
npm run test:cross-chain
```

## 🔒 Security Features

- **Atomic Execution**: Either both sides complete or neither does
- **Secret Management**: Cryptographic secrets ensure fair execution
- **Timelock Protection**: Prevents indefinite token locking
- **Hash Verification**: Prevents address spoofing attacks
- **MEV Protection**: Dutch auction mechanism reduces front-running

## 🌐 Supported Networks

### Currently Supported
- **Optimism**: Mainnet and testnet
- **Aptos**: Mainnet and testnet

### Planned Support
- **NEAR**: 40-byte address support
- **Stellar**: Non-EVM address format
- **Additional EVM chains**: Ethereum, Polygon, BSC

## 📊 Performance

- **Transaction Speed**: < 30 seconds for complete swap
- **Gas Efficiency**: Optimized for L2 networks
- **Cross-Chain Latency**: Minimal overhead from hash verification
- **Scalability**: Modular design supports multiple chains

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🔗 Links

- [1inch Fusion Protocol](https://docs.1inch.io/)
- [Aptos Documentation](https://aptos.dev/)
- [Optimism Documentation](https://docs.optimism.io/)
- [Cross-Chain SDK](https://github.com/1inch/cross-chain-sdk)

---

**Built with ❤️ using 1inch Fusion Protocol and Aptos Move VM**
