import { Aptos, Account, AccountAddress } from "@aptos-labs/ts-sdk";

export class FusionPlusClient {
  private aptos: Aptos;
  private contractAddress: string;

  constructor(aptos: Aptos, contractAddress: string) {
    this.aptos = aptos;
    this.contractAddress = contractAddress;
  }

  /**
   * Get basic contract information
   */
  async getContractInfo() {
    try {
      const accountInfo = await this.aptos.getAccountInfo({
        accountAddress: this.contractAddress,
      });
      
      const modules = await this.aptos.getAccountModules({
        accountAddress: this.contractAddress,
      });

      return {
        address: this.contractAddress,
        sequenceNumber: accountInfo.sequence_number,
        modules: modules.map(m => m.abi?.name || 'unknown'),
      };
    } catch (error) {
      console.error("Error getting contract info:", error);
      throw error;
    }
  }

  /**
   * Call a view function on the contract
   */
  async callViewFunction<T = any>(
    functionName: string,
    typeArguments: string[] = [],
    functionArguments: any[] = []
  ): Promise<T> {
    try {
      const payload = {
        function: `${this.contractAddress}::${functionName}` as any,
        typeArguments,
        functionArguments,
      };

      const result = await this.aptos.view({ payload });
      return result as T;
    } catch (error) {
      console.error(`Error calling view function ${functionName}:`, error);
      throw error;
    }
  }

  /**
   * Build a transaction payload for contract interaction
   */
  buildTransactionPayload(
    functionName: string,
    typeArguments: string[] = [],
    functionArguments: any[] = []
  ) {
    return {
      function: `${this.contractAddress}::${functionName}`,
      typeArguments,
      functionArguments,
    };
  }

  /**
   * Submit a transaction to the contract
   */
  async submitTransaction(
    signer: Account,
    payload: any
  ) {
    try {
      const transaction = await this.aptos.transaction.build.simple({
        sender: signer.accountAddress,
        data: payload,
      });

      const committedTxn = await this.aptos.signAndSubmitTransaction({
        signer,
        transaction,
      });

      await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      });

      return committedTxn;
    } catch (error) {
      console.error("Error submitting transaction:", error);
      throw error;
    }
  }

  /**
   * Get account resources for the contract
   */
  async getContractResources() {
    try {
      const resources = await this.aptos.getAccountResources({
        accountAddress: this.contractAddress,
      });
      return resources;
    } catch (error) {
      console.error("Error getting contract resources:", error);
      throw error;
    }
  }

  /**
   * Get specific resource from the contract
   */
  async getContractResource<T extends Record<string, any>>(resourceType: string): Promise<T> {
    try {
      const resource = await this.aptos.getAccountResource<T>({
        accountAddress: this.contractAddress,
        resourceType: resourceType as any,
      });
      return resource;
    } catch (error) {
      console.error(`Error getting resource ${resourceType}:`, error);
      throw error;
    }
  }
} 