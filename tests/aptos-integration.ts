import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Account } from "@aptos-labs/ts-sdk";
import { FusionPlusClient } from "./fusion-plus-client";
import crypto from 'crypto';

export interface AptosEscrowData {
  recipientAddress: string;
  metadata: string;
  amount: bigint;
  chainId: number;
  hash: Uint8Array;
}

export interface CrossChainEventData {
  receiverSha1: string;
  takerAssetSha1: string;
  amount: bigint;
  secret: string;
  originalReceiverAddress: string;
  originalTakerAssetAddress: string;
}

export class AptosIntegration {
  private aptos: Aptos;
  private fusionClient: FusionPlusClient;
  private contractAddress: string;
  private resolverAccount: Account;

  constructor(
    network: Network,
    contractAddress: string,
    resolverPrivateKey: string
  ) {
    const config = new AptosConfig({ network });
    this.aptos = new Aptos(config);
    this.contractAddress = contractAddress;
    this.fusionClient = new FusionPlusClient(this.aptos, contractAddress);
    
    // Create resolver account from private key
    const resolverPrivateKeyObj = new Ed25519PrivateKey(resolverPrivateKey);
    this.resolverAccount = Account.fromPrivateKey({ privateKey: resolverPrivateKeyObj });
  }

  /**
   * Verify SHA1 hashes match expected Aptos addresses
   */
  private verifySha1Hashes(eventData: CrossChainEventData): boolean {
    const expectedReceiverSha1 = '0x' + crypto.createHash('sha1')
      .update(eventData.originalReceiverAddress)
      .digest('hex');
    
    const expectedTakerAssetSha1 = '0x' + crypto.createHash('sha1')
      .update(eventData.originalTakerAssetAddress)
      .digest('hex');

    // Clean any double 0x prefixes from the incoming data
    const cleanReceiverSha1 = eventData.receiverSha1.replace(/^0x0x/, '0x');
    const cleanTakerAssetSha1 = eventData.takerAssetSha1.replace(/^0x0x/, '0x');

    const isReceiverMatch = cleanReceiverSha1.toLowerCase() === expectedReceiverSha1.toLowerCase();
    const isTakerAssetMatch = cleanTakerAssetSha1.toLowerCase() === expectedTakerAssetSha1.toLowerCase();

    console.log('SHA1 Verification:');
    console.log('  Receiver match:', isReceiverMatch);
    console.log('  Taker asset match:', isTakerAssetMatch);
    console.log('  Expected receiver SHA1:', expectedReceiverSha1);
    console.log('  Actual receiver SHA1:', cleanReceiverSha1);
    console.log('  Expected taker asset SHA1:', expectedTakerAssetSha1);
    console.log('  Actual taker asset SHA1:', cleanTakerAssetSha1);

    return isReceiverMatch && isTakerAssetMatch;
  }

  /**
   * Create destination escrow on Aptos based on cross-chain event data
   */
  async createDestinationEscrow(eventData: CrossChainEventData): Promise<{
    txHash: string;
    escrowAddress?: string;
  }> {
    console.log('🔒 Creating destination escrow on Aptos...');

    // Verify SHA1 hashes first
    if (!this.verifySha1Hashes(eventData)) {
      throw new Error('SHA1 hash verification failed - addresses do not match');
    }

    try {
      // Convert the secret to hash for hashlock
      const secretBytes = Buffer.from(eventData.secret.replace('0x', ''), 'hex');
      const hashArray = Array.from(secretBytes);

      // Use the original receiver address (not the SHA1 hash)
      const recipientAddress = eventData.originalReceiverAddress.startsWith('0x') 
        ? eventData.originalReceiverAddress 
        : '0x' + eventData.originalReceiverAddress;

      // Use the original taker asset address for metadata (not the SHA1 hash)
      const metadata = eventData.originalTakerAssetAddress;

      console.log('Escrow parameters:');
      console.log('  Recipient:', recipientAddress);
      console.log('  Metadata:', metadata);
      console.log('  Amount:', eventData.amount.toString());
      console.log('  Chain ID:', 10); // Optimism chain ID
      console.log('  Hash length:', hashArray.length);

      // Create escrow payload
      const createEscrowPayload = this.fusionClient.buildTransactionPayload(
        "escrow::new_from_resolver_entry",
        [],
        [
          recipientAddress, // recipient_address
          metadata, // metadata (taker asset)
          Number(eventData.amount), // amount (convert bigint to number)
          10, // chain_id (Optimism)
          hashArray, // hash (secret hash)
        ]
      );

      console.log('📝 Submitting escrow creation transaction...');
      const txn = await this.fusionClient.submitTransaction(this.resolverAccount, createEscrowPayload);
      
      console.log('✅ Destination escrow created:', txn.hash);

      // Try to get escrow address from events
      const escrowAddress = await this.getEscrowObjectAddress(txn.hash);
      
      return {
        txHash: txn.hash,
        escrowAddress
      };

    } catch (error) {
      console.error('❌ Failed to create destination escrow:', error);
      throw error;
    }
  }

  /**
   * Withdraw from destination escrow using the secret
   */
  async withdrawFromDestinationEscrow(escrowAddress: string, secret: string): Promise<string> {
    console.log('💸 Withdrawing from destination escrow on Aptos...');

    try {
      // Convert secret to bytes array
      const secretBytes = Buffer.from(secret.replace('0x', ''), 'hex');
      const secretArray = Array.from(secretBytes);

      const withdrawPayload = this.fusionClient.buildTransactionPayload(
        "escrow::withdraw",
        [],
        [
          escrowAddress, // escrow object address
          secretArray, // secret to verify against hashlock
        ]
      );

      console.log('📝 Submitting escrow withdraw transaction...');
      const txn = await this.fusionClient.submitTransaction(this.resolverAccount, withdrawPayload);
      
      console.log('✅ Destination escrow withdrawn:', txn.hash);
      return txn.hash;

    } catch (error) {
      console.error('❌ Failed to withdraw from destination escrow:', error);
      throw error;
    }
  }

  /**
   * Get escrow object address from transaction events
   */
  private async getEscrowObjectAddress(transactionHash: string): Promise<string | undefined> {
    console.log('🔍 Getting escrow object address from events...');
    
    try {
      const fullnodeUrl = this.aptos.config.fullnode + '/v1';
      
      // Get events from specific transaction
      const txnResponse = await fetch(`${fullnodeUrl}/transactions/by_hash/${transactionHash}`);
      
      if (txnResponse.ok) {
        const txn = await txnResponse.json();
        console.log(`📡 Found transaction with ${txn.events?.length || 0} events`);
        
        if (txn.events) {
          for (const event of txn.events) {
            if (event.type && event.type.includes("EscrowCreatedEvent")) {
              console.log("🔒 Found EscrowCreatedEvent in transaction!");
              
              if (event.data && event.data.escrow) {
                let escrowAddress = event.data.escrow;
                
                // Handle different possible formats
                if (typeof escrowAddress === 'object' && escrowAddress.inner) {
                  escrowAddress = escrowAddress.inner;
                } else if (typeof escrowAddress === 'string') {
                  // Already a string
                } else {
                  escrowAddress = JSON.stringify(escrowAddress);
                }
                
                console.log("📝 Extracted escrow address:", escrowAddress);
                return escrowAddress;
              }
            }
          }
        }
      }
      
      console.log("⚠️ No EscrowCreatedEvent found in transaction events");
      return undefined;
      
    } catch (error) {
      console.error("❌ Error fetching escrow address from events:", error);
      return undefined;
    }
  }

  /**
   * Complete cross-chain swap process
   */
  async completeCrossChainSwap(eventData: CrossChainEventData): Promise<{
    createTxHash: string;
    withdrawTxHash?: string;
    escrowAddress?: string;
  }> {
    console.log('🌉 Starting cross-chain swap completion on Aptos...');

    // Step 1: Create destination escrow
    const { txHash: createTxHash, escrowAddress } = await this.createDestinationEscrow(eventData);

    // Step 2: Wait a bit for transaction to be processed
    console.log('⏳ Waiting for escrow creation to be processed...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 3: Withdraw from destination escrow if we have the address
    let withdrawTxHash: string | undefined;
    
    if (escrowAddress) {
      try {
        withdrawTxHash = await this.withdrawFromDestinationEscrow(escrowAddress, eventData.secret);
      } catch (error) {
        console.warn('⚠️ Failed to withdraw from destination escrow:', error);
        // Don't throw error here, return partial success
      }
    } else {
      console.warn('⚠️ Could not determine escrow address, skipping withdrawal');
    }

    return {
      createTxHash,
      withdrawTxHash,
      escrowAddress
    };
  }

  /**
   * Get resolver account address
   */
  getResolverAddress(): string {
    return this.resolverAccount.accountAddress.toString();
  }

  /**
   * Get contract info
   */
  async getContractInfo() {
    return this.fusionClient.getContractInfo();
  }
}