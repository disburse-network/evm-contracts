import {id, Interface, JsonRpcProvider} from 'ethers'
import Sdk from '@1inch/cross-chain-sdk'
import EscrowFactoryContract from '../dist/contracts/EscrowFactory.sol/EscrowFactory.json'
import crypto from 'crypto'

export class EscrowFactory {
    private iface = new Interface(EscrowFactoryContract.abi)

    constructor(
        private readonly provider: JsonRpcProvider,
        private readonly address: string
    ) {}

    public async getSourceImpl(): Promise<Sdk.Address> {
        return Sdk.Address.fromBigInt(
            BigInt(
                await this.provider.call({
                    to: this.address,
                    data: id('ESCROW_SRC_IMPLEMENTATION()').slice(0, 10)
                })
            )
        )
    }

    public async getDestinationImpl(): Promise<Sdk.Address> {
        return Sdk.Address.fromBigInt(
            BigInt(
                await this.provider.call({
                    to: this.address,
                    data: id('ESCROW_DST_IMPLEMENTATION()').slice(0, 10)
                })
            )
        )
    }

    public async getSrcDeployEvent(blockHash: string): Promise<[Sdk.Immutables, Sdk.DstImmutablesComplement]> {
        const event = this.iface.getEvent('SrcEscrowCreated')!

        // Retry logic with delay for real networks
        for (let i = 0; i < 5; i++) {
            console.log(`Attempt ${i + 1}/5: Trying to get logs for block ${blockHash}`)

            try {
                // Try with block hash first
                let logs = await this.provider.getLogs({
                    blockHash,
                    address: this.address,
                    topics: [event.topicHash]
                })

                // If no logs found, try with block number
                if (logs.length === 0) {
                    console.log(`No logs found with blockHash, trying with block number...`)
                    const block = await this.provider.getBlock(blockHash)
                    if (block) {
                        logs = await this.provider.getLogs({
                            fromBlock: block.number,
                            toBlock: block.number,
                            address: this.address,
                            topics: [event.topicHash]
                        })
                    }
                }

                console.log(`Found ${logs.length} logs`)

                if (logs.length > 0) {
                    const [data] = logs.map((l) => this.iface.decodeEventLog(event, l.data))

                    const immutables = data.at(0)
                    const complement = data.at(1)

                                         // CORRECT - Work directly with the BigInt:
                     console.log(`Successfully parsed event logs on attempt ${i + 1}`)
                     
                     // Check receiver (complement[0])
                     const receiverRawUint256 = complement[0] // This is the receiver from the event
                     console.log('Receiver Raw uint256 value:', receiverRawUint256.toString())
                     console.log('Receiver Raw uint256 hex:', receiverRawUint256.toString(16))
                     const emittedReceiverSha1 = '0x' + receiverRawUint256.toString(16).padStart(40, '0')
                     console.log('Emitted receiver SHA1 hash:', emittedReceiverSha1)
                     
                     // Check taker asset (complement[2])
                     const takerAssetRawUint256 = complement[2] // This is the taker asset from the event
                     console.log('Taker asset Raw uint256 value:', takerAssetRawUint256.toString())
                     console.log('Taker asset Raw uint256 hex:', takerAssetRawUint256.toString(16))
                     const emittedTakerAssetSha1 = '0x' + takerAssetRawUint256.toString(16).padStart(40, '0')
                     console.log('Emitted taker asset SHA1 hash:', emittedTakerAssetSha1)

                     const localReceiverSha1 = '0x' + crypto.createHash('sha1').update('0x8b48e313cf5275cf04f33d07245ec6c386f44316a6b2edd1a8ae645f2a349497').digest('hex');
                     const localTakerAssetSha1 = '0x' + crypto.createHash('sha1').update('0x000000000000000000000000000000000000000000000000000000000000000a').digest('hex');
                     
                     console.log('Local receiver SHA1:', localReceiverSha1);
                     console.log('Local taker asset SHA1:', localTakerAssetSha1);
                     
                     // Check if emitted hashes match our local hashes
                     const isReceiverMatch = emittedReceiverSha1.toLowerCase() === localReceiverSha1.toLowerCase();
                     const isTakerAssetMatch = emittedTakerAssetSha1.toLowerCase() === localTakerAssetSha1.toLowerCase();
                     
                     console.log('Is receiver match?', isReceiverMatch);
                     console.log('Is taker asset match?', isTakerAssetMatch);
                     console.log('SHA1 verification successful:', isReceiverMatch && isTakerAssetMatch);
                    return [
                        Sdk.Immutables.new({
                            orderHash: immutables[0],
                            hashLock: Sdk.HashLock.fromString(immutables[1]),
                            maker: Sdk.Address.fromBigInt(immutables[2]),
                            taker: Sdk.Address.fromBigInt(immutables[3]),
                            token: Sdk.Address.fromBigInt(immutables[4]),
                            amount: immutables[5],
                            safetyDeposit: immutables[6],
                            timeLocks: Sdk.TimeLocks.fromBigInt(immutables[7])
                        }),
                        Sdk.DstImmutablesComplement.new({
                            maker: Sdk.Address.fromBigInt(complement[0]),
                            amount: complement[1],
                            token: Sdk.Address.fromBigInt(complement[2]),
                            safetyDeposit: complement[3]
                        })
                    ]
                }
            } catch (error) {
                console.log(`Attempt ${i + 1} failed:`, error.message)
            }

            // Wait before retry (2 seconds for first retry, then 3, 4, 5 seconds)
            if (i < 4) {
                const delay = (i + 2) * 1000
                console.log(`Waiting ${delay}ms before retry...`)
                await new Promise((resolve) => setTimeout(resolve, delay))
            }
        }

        throw new Error(`Failed to get SrcEscrowCreated event logs after 5 attempts for block ${blockHash}`)
    }
}
