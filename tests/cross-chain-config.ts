import { Network } from "@aptos-labs/ts-sdk";

export interface CrossChainConfig {
  aptos: {
    network: Network;
    contractAddress: string;
    resolverPrivateKey: string;
    ownerPrivateKey: string;
    userPrivateKey: string;
  };
  optimism: {
    rpcUrl: string;
    chainId: number;
    ownerPrivateKey: string;
    resolverPrivateKey: string;
  };
  crossChain: {
    // Known Aptos addresses that will be hashed for EVM compatibility
    aptosReceiverAddress: string;
    aptosTakerAssetAddress: string;
    // Timing settings
    finalizationDelay: number; // seconds to wait between chains
    retryAttempts: number;
    retryDelay: number; // seconds
  };
}

export const defaultCrossChainConfig: CrossChainConfig = {
  aptos: {
    network: Network.TESTNET,
    contractAddress: process.env.CONTRACT_ADDRESS_TESTNET || "0xd4d479bbcad621f806f2ed82aae05c6bcb98b01c02a056933d074729f4872192",
    resolverPrivateKey: process.env.RESOLVER_PRIVATE_KEY as string,
    ownerPrivateKey: process.env.OWNER_PRIVATE_KEY as string,
    userPrivateKey: process.env.USER_PRIVATE_KEY as string,
  },
  optimism: {
    rpcUrl: process.env.SRC_CHAIN_RPC || 'https://optimism.publicnode.com',
    chainId: 10, // Optimism mainnet
    ownerPrivateKey: process.env.OPTIMISM_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    resolverPrivateKey: process.env.OPTIMISM_RESOLVER_PRIVATE_KEY || '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
  crossChain: {
    // These addresses are used for cross-chain mapping via SHA1 hashing
    aptosReceiverAddress: '0x8b48e313cf5275cf04f33d07245ec6c386f44316a6b2edd1a8ae645f2a349497',
    aptosTakerAssetAddress: '0x000000000000000000000000000000000000000000000000000000000000000a', // APT token
    finalizationDelay: 5, // 5 seconds
    retryAttempts: 3,
    retryDelay: 2, // 2 seconds
  }
};

/**
 * Validate cross-chain configuration
 */
export function validateCrossChainConfig(config: CrossChainConfig): void {
  const requiredEnvVars = [
    'CONTRACT_ADDRESS_TESTNET',
    'RESOLVER_PRIVATE_KEY',
    'OWNER_PRIVATE_KEY',
    'USER_PRIVATE_KEY',
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables for cross-chain setup:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    throw new Error('Missing required environment variables');
  }

  // Validate Aptos addresses
  if (!config.crossChain.aptosReceiverAddress.startsWith('0x') || 
      config.crossChain.aptosReceiverAddress.length !== 66) {
    throw new Error('Invalid Aptos receiver address format');
  }

  if (!config.crossChain.aptosTakerAssetAddress.startsWith('0x') || 
      config.crossChain.aptosTakerAssetAddress.length !== 66) {
    throw new Error('Invalid Aptos taker asset address format');
  }

  console.log('✅ Cross-chain configuration validated successfully');
}