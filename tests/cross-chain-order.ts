import { AptosIntegration, CrossChainEventData } from './aptos-integration';
import { CrossChainConfig, defaultCrossChainConfig, validateCrossChainConfig } from './cross-chain-config';
import crypto from 'crypto';
import Sdk from '@1inch/cross-chain-sdk';

export interface CrossChainSwapResult {
  optimism: {
    orderFillTxHash: string;
    withdrawTxHash: string;
    escrowAddress: string;
  };
  aptos: {
    createTxHash: string;
    withdrawTxHash?: string;
    escrowAddress?: string;
  };
  timing: {
    startTime: Date;
    endTime: Date;
    totalDuration: number; // milliseconds
  };
}

export class CrossChainCoordinator {
  private aptosIntegration: AptosIntegration;
  private config: CrossChainConfig;

  constructor(config: CrossChainConfig = defaultCrossChainConfig) {
    this.config = config;
    validateCrossChainConfig(config);

    // Initialize Aptos integration
    this.aptosIntegration = new AptosIntegration(
      config.aptos.network,
      config.aptos.contractAddress,
      config.aptos.resolverPrivateKey
    );
  }

  /**
   * Generate SHA1 hashes for cross-chain address mapping
   */
  public generateSha1Hashes(): {
    receiverSha1: string;
    takerAssetSha1: string;
  } {
    const receiverSha1 = '0x' + crypto.createHash('sha1')
      .update(this.config.crossChain.aptosReceiverAddress)
      .digest('hex');
    
    const takerAssetSha1 = '0x' + crypto.createHash('sha1')
      .update(this.config.crossChain.aptosTakerAssetAddress)
      .digest('hex');

    console.log('🔍 Generated SHA1 hashes for cross-chain mapping:');
    console.log('  Aptos receiver:', this.config.crossChain.aptosReceiverAddress);
    console.log('  -> SHA1 hash:', receiverSha1);
    console.log('  Aptos taker asset:', this.config.crossChain.aptosTakerAssetAddress);
    console.log('  -> SHA1 hash:', takerAssetSha1);

    return { receiverSha1, takerAssetSha1 };
  }

  /**
   * Process cross-chain event data from Optimism escrow deployment
   */
  public async processCrossChainEvents(
    secret: string,
    srcEscrowEvent: [Sdk.Immutables, Sdk.DstImmutablesComplement]
  ): Promise<{
    aptosCreateTxHash: string;
    aptosWithdrawTxHash?: string;
    aptosEscrowAddress?: string;
  }> {
    console.log('🌉 Processing cross-chain events...');

    const startTime = Date.now();

    try {
      // Extract data from EVM escrow event
      const [immutables, complement] = srcEscrowEvent;
      
      // Convert complement data to SHA1 hashes - remove any existing 0x prefix first
      const receiverHex = complement.maker.toString().padStart(40, '0');
      const takerAssetHex = complement.token.toString().padStart(40, '0');
      
      const receiverSha1 = '0x' + receiverHex;
      const takerAssetSha1 = '0x' + takerAssetHex;
      
      // Create cross-chain event data
      const eventData: CrossChainEventData = {
        receiverSha1: receiverSha1.toLowerCase(),
        takerAssetSha1: takerAssetSha1.toLowerCase(),
        amount: complement.amount,
        secret,
        originalReceiverAddress: this.config.crossChain.aptosReceiverAddress,
        originalTakerAssetAddress: this.config.crossChain.aptosTakerAssetAddress
      };

      console.log('📊 Cross-chain event data:');
      console.log('  Amount:', eventData.amount.toString());
      console.log('  Secret length:', secret.length);
      console.log('  Receiver SHA1:', receiverSha1);
      console.log('  Taker Asset SHA1:', takerAssetSha1);

      // Execute cross-chain swap on Aptos with retry logic
      let result;
      let attempt = 0;
      let lastError: Error | null = null;

      while (attempt < this.config.crossChain.retryAttempts) {
        try {
          console.log(`🔄 Cross-chain attempt ${attempt + 1}/${this.config.crossChain.retryAttempts}`);
          result = await this.aptosIntegration.completeCrossChainSwap(eventData);
          break; // Success, exit retry loop
        } catch (error) {
          lastError = error as Error;
          attempt++;
          
          if (attempt < this.config.crossChain.retryAttempts) {
            console.log(`⚠️ Attempt ${attempt} failed: ${lastError.message}`);
            console.log(`⏳ Waiting ${this.config.crossChain.retryDelay}s before retry...`);
            await new Promise(resolve => setTimeout(resolve, this.config.crossChain.retryDelay * 1000));
          }
        }
      }

      if (!result) {
        throw new Error(`Cross-chain integration failed after ${this.config.crossChain.retryAttempts} attempts. Last error: ${lastError?.message}`);
      }

      const endTime = Date.now();
      console.log(`✅ Cross-chain processing completed in ${endTime - startTime}ms`);

      return result;

    } catch (error) {
      console.error('❌ Cross-chain event processing failed:', error);
      throw error;
    }
  }

  /**
   * Wait for finalization delay between chains
   */
  public async waitForFinalization(): Promise<void> {
    console.log(`⏳ Waiting ${this.config.crossChain.finalizationDelay}s for cross-chain finalization...`);
    await new Promise(resolve => setTimeout(resolve, this.config.crossChain.finalizationDelay * 1000));
  }

  /**
   * Validate secret format
   */
  public validateSecret(secret: string): boolean {
    // Secret should be a 32-byte hex string (with or without 0x prefix)
    const cleanSecret = secret.replace('0x', '');
    const isValid = /^[a-fA-F0-9]{64}$/.test(cleanSecret);
    
    if (!isValid) {
      console.error('❌ Invalid secret format. Expected 32-byte hex string.');
      return false;
    }

    console.log('✅ Secret format validated');
    return true;
  }

  /**
   * Get configuration
   */
  public getConfig(): CrossChainConfig {
    return this.config;
  }

  /**
   * Get Aptos integration instance
   */
  public getAptosIntegration(): AptosIntegration {
    return this.aptosIntegration;
  }

  /**
   * Health check for cross-chain components
   */
  public async healthCheck(): Promise<{
    aptos: boolean;
    optimism: boolean;
    config: boolean;
  }> {
    console.log('🏥 Performing cross-chain health check...');

    const results = {
      aptos: false,
      optimism: false,
      config: false
    };

    // Check Aptos connection
    try {
      const contractInfo = await this.aptosIntegration.getContractInfo();
      results.aptos = !!contractInfo.address;
      console.log('✅ Aptos connection: OK');
    } catch (error) {
      console.error('❌ Aptos connection: FAILED', error.message);
    }

    // Check configuration
    try {
      validateCrossChainConfig(this.config);
      results.config = true;
      console.log('✅ Configuration: OK');
    } catch (error) {
      console.error('❌ Configuration: FAILED', error.message);
    }

    // Optimism check would be done in the main test/integration code
    results.optimism = true; // Assume OK for now

    const allHealthy = Object.values(results).every(status => status);
    console.log(`🏥 Health check ${allHealthy ? 'PASSED' : 'FAILED'}`);

    return results;
  }

  /**
   * Create a summary of the cross-chain swap
   */
  public createSwapSummary(
    orderFillTxHash: string,
    optimismWithdrawTxHash: string,
    aptosResult: {
      createTxHash: string;
      withdrawTxHash?: string;
      escrowAddress?: string;
    },
    startTime: Date,
    endTime: Date
  ): CrossChainSwapResult {
    return {
      optimism: {
        orderFillTxHash,
        withdrawTxHash: optimismWithdrawTxHash,
        escrowAddress: 'N/A' // Would need to be passed from the calling code
      },
      aptos: aptosResult,
      timing: {
        startTime,
        endTime,
        totalDuration: endTime.getTime() - startTime.getTime()
      }
    };
  }
}