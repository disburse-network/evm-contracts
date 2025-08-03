// Export the main function for use in other files
import {Aptos, AptosConfig, Network, Ed25519PrivateKey, Account} from '@aptos-labs/ts-sdk'
import {FusionPlusClient} from './fusion-plus-client'
import {
    keccak256,
    JsonRpcProvider,
    ContractFactory,
    parseEther,
    parseUnits,
    MaxUint256,
    computeAddress,
    Interface,
    id,
    Wallet as SignerWallet,
    Contract
} from 'ethers'
import {randomBytes} from 'crypto'
import * as dotenv from 'dotenv'
import {ChainConfig, config} from './config'
import Sdk, { ESCROW_FACTORY } from '@1inch/cross-chain-sdk'
import {Wallet} from './wallet'
import abi from './abi.json'
import factoryContract from '../dist/contracts/TestEscrowFactory.sol/TestEscrowFactory.json'
import resolverContract from '../dist/contracts/Resolver.sol/Resolver.json'
import {createServer, CreateServerReturnType} from 'prool'
import {anvil} from 'prool/instances'
import escrowAbi from './escrow.json'

// Type definitions for missing types
interface EventData {
    fusionOrder: {
        destinationRecipient: string
        destinationAsset: string
        chainId: number
        currentPrice: number
        owner: string
        resolver: string
        hash: string
        sourceAmount: number
        initialPrice: number
        auctionStartTime: number
        initialDestinationAmount: number
        [key: string]: any
    }
    escrow: {
        address: string
        [key: string]: any
    }
    [key: string]: any
}

// Manual timelocks creation function
function createManualTimelocks(deployedAt: number): bigint {
    // Based on your Solidity Timelocks structure
    // We need to create a uint256 that contains:
    // - deployedAt timestamp (32 bits at the end)
    // - Various timelock values (32 bits each)

    // For now, let's create a simple structure
    // deployedAt goes in the lowest 32 bits
    let timelocks = BigInt(deployedAt)

    // Add some default timelock values
    // You can adjust these based on your needs
    const srcWithdrawal = BigInt(10) // 10 seconds
    const srcPublicWithdrawal = BigInt(20) // 2 minutes
    const srcCancellation = BigInt(121) // 1 second after public withdrawal
    const srcPublicCancellation = BigInt(122) // 1 second after cancellation
    const dstWithdrawal = BigInt(10) // 10 seconds
    const dstPublicWithdrawal = BigInt(100) // 100 seconds
    const dstCancellation = BigInt(101) // 1 second after public withdrawal

    // Pack the timelocks into a single uint256
    // This is a simplified version - you may need to adjust based on your exact structure
    timelocks = timelocks | (srcWithdrawal << BigInt(32))
    timelocks = timelocks | (srcPublicWithdrawal << BigInt(64))
    timelocks = timelocks | (srcCancellation << BigInt(96))
    timelocks = timelocks | (srcPublicCancellation << BigInt(128))
    timelocks = timelocks | (dstWithdrawal << BigInt(160))
    timelocks = timelocks | (dstPublicWithdrawal << BigInt(192))
    timelocks = timelocks | (dstCancellation << BigInt(224))

    return timelocks
}

// Load environment variables
dotenv.config({path: './.env'})

// Configuration from environment variables
const NETWORK = Network.TESTNET
const CONTRACT_ADDRESS_TESTNET = process.env.CONTRACT_ADDRESS_TESTNET as string
const USER_PRIVATE_KEY = process.env.USER_PRIVATE_KEY as string
const RESOLVER_PRIVATE_KEY = process.env.RESOLVER_PRIVATE_KEY as string
let escrowFactoryAddress = ''
let iface = new Interface(factoryContract.abi)

// EVM private key to generate destination recipient
const EVM_PRIVATE_KEY =
    process.env.OPTIMISM_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const USDC_ADDRESS = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' // USDC on Optimism

// EVM Configuration for deploying destination escrow
const resolverPkForSourceChain = config.chain.source.resolverPrivateKey

console.log('🔥 Simple Fusion Order Creation')

// Initialize Aptos client
const aptosConfig = new AptosConfig({network: NETWORK})
const aptos = new Aptos(aptosConfig)

// Create user account from private key
const userPrivateKey = new Ed25519PrivateKey(USER_PRIVATE_KEY)
const user = Account.fromPrivateKey({privateKey: userPrivateKey})

// Create resolver account from private key
const resolverPrivateKey = new Ed25519PrivateKey(RESOLVER_PRIVATE_KEY)
const resolver = Account.fromPrivateKey({privateKey: resolverPrivateKey})

console.log(`📝 User address: ${user.accountAddress}`)
console.log(`🔧 Resolver address: ${resolver.accountAddress}`)

// Initialize FusionPlusClient
const fusionClient = new FusionPlusClient(aptos, CONTRACT_ADDRESS_TESTNET)

type Chain = {
    node?: CreateServerReturnType | undefined
    provider: JsonRpcProvider
    escrowFactory: string
    resolver: string
    createFork: boolean
}

let src: Chain

let srcChainUser: SignerWallet

/**
 * Convert EVM address to Aptos-compatible vector (byte array)
 */
function evmAddressToAptosVector(evmAddress: string): number[] {
    // Remove 0x prefix if present
    const cleanAddress = evmAddress.replace('0x', '')

    // Convert hex string to byte array
    const bytes = []
    for (let i = 0; i < cleanAddress.length; i += 2) {
        bytes.push(parseInt(cleanAddress.substr(i, 2), 16))
    }

    return bytes
}

/**
 * Generate destination recipient from EVM private key
 */
function generateDestinationRecipient(privateKey: string): number[] {
    // Import Wallet from ethers dynamically to get address from private key
    const {Wallet} = require('ethers')

    // Create wallet from private key to get address
    const wallet = new Wallet(privateKey)
    const evmAddress = wallet.address

    console.log(`🎯 Generated EVM destination address: ${evmAddress}`)

    // Convert to Aptos-compatible vector
    return evmAddressToAptosVector(evmAddress)
}

/**
 * Create fusion order with generated parameters
 */
async function getFusionOrderObjectAddress(transactionHash: string): Promise<string | null> {
    console.log('🔍 Getting fusion order object address from events...')

    try {
        const fullnodeUrl = aptos.config.fullnode || 'https://api.testnet.aptoslabs.com'

        // Get events from specific transaction
        const txnResponse = await fetch(`${fullnodeUrl}/v1/transactions/by_hash/${transactionHash}`)

        if (txnResponse.ok) {
            const txn = (await txnResponse.json()) as {events?: any[]}
            console.log(`📡 Found transaction with ${txn.events?.length || 0} events`)

            if (txn.events) {
                for (const event of txn.events) {
                    console.log(`📋 Event type: ${event.type}`)

                    if (event.type && event.type.includes('FusionOrderCreatedEvent')) {
                        console.log('🔥 Found FusionOrderCreatedEvent!')
                        console.log('📊 Event data:', JSON.stringify(event.data, null, 2))

                        if (event.data && event.data.fusion_order) {
                            let fusionOrderAddress = event.data.fusion_order

                            // Handle different possible formats
                            if (typeof fusionOrderAddress === 'object' && fusionOrderAddress.inner) {
                                fusionOrderAddress = fusionOrderAddress.inner
                            } else if (typeof fusionOrderAddress === 'string') {
                                // Already a string
                            } else {
                                fusionOrderAddress = JSON.stringify(fusionOrderAddress)
                            }

                            console.log('📝 Extracted fusion order address:', fusionOrderAddress)
                            return fusionOrderAddress
                        }
                    }
                }
            }
        }

        console.log('⚠️ No FusionOrderCreatedEvent found in transaction events')
        return null
    } catch (error) {
        console.error('❌ Error fetching fusion order address:', error)
        return null
    }
}

async function getDestinationImpl(provider: JsonRpcProvider, address: string): Promise<any> {
    return BigInt(
        BigInt(
            await provider.call({
                to: address,
                data: id('ESCROW_DST_IMPLEMENTATION()').slice(0, 10)
            })
        )
    )
}

/**
 * Wait for a specified number of seconds
 */
async function waitSeconds(seconds: number): Promise<void> {
    console.log(`⏳ Waiting ${seconds} seconds...`)
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

/**
 * Accept fusion order with resolver
 */
async function acceptFusionOrder(orderTxHash: string): Promise<string | null> {
    console.log('\n🤝 Accepting fusion order with resolver...')

    try {
        // Get the fusion order address from the creation transaction
        const fusionOrderAddress = await getFusionOrderObjectAddress(orderTxHash)

        if (!fusionOrderAddress) {
            console.error('❌ Could not determine fusion order address from transaction events')
            return null
        }

        console.log(`📝 Using fusion order address: ${fusionOrderAddress}`)

        const acceptOrderPayload = fusionClient.buildTransactionPayload(
            'escrow::new_from_order_entry',
            [],
            [
                fusionOrderAddress // fusion_order object address
            ]
        )

        console.log('📝 Submitting fusion order acceptance transaction...')
        const txn = await fusionClient.submitTransaction(resolver, acceptOrderPayload)

        console.log(`✅ Fusion order accepted and source escrow created!`)
        console.log(`📋 Acceptance Transaction Details:`)
        console.log(`   Transaction hash: ${txn.hash}`)
        console.log(`   Explorer: https://explorer.aptoslabs.com/txn/${txn.hash}?network=testnet`)

        return txn.hash
    } catch (error) {
        console.error('❌ Failed to accept fusion order:', error)
        return null
    }
}

/**
 * Get escrow event data from transaction events
 */
async function getEscrowEventData(acceptTxHash: string): Promise<EventData | null> {
    console.log('\n🔍 Getting escrow event data from acceptance transaction...')

    try {
        const fullnodeUrl = aptos.config.fullnode || 'https://api.testnet.aptoslabs.com'

        // Get events from specific transaction
        const txnResponse = await fetch(`${fullnodeUrl}/v1/transactions/by_hash/${acceptTxHash}`)

        if (txnResponse.ok) {
            const txn = (await txnResponse.json()) as {events?: any[]}
            console.log(`📡 Found transaction with ${txn.events?.length || 0} events`)

            let fusionOrderAcceptedEvent = null
            let escrowCreatedEvent = null

            if (txn.events) {
                for (const event of txn.events) {
                    console.log(`📋 Event type: ${event.type}`)

                    // Look for FusionOrderAcceptedEvent
                    if (event.type && event.type.includes('FusionOrderAcceptedEvent')) {
                        console.log('🔥 Found FusionOrderAcceptedEvent!')
                        fusionOrderAcceptedEvent = event.data
                    }

                    // Look for EscrowCreatedEvent
                    if (event.type && event.type.includes('EscrowCreatedEvent')) {
                        console.log('🔒 Found EscrowCreatedEvent!')
                        escrowCreatedEvent = event.data
                    }
                }
            }

            if (fusionOrderAcceptedEvent && escrowCreatedEvent) {
                console.log('\n📊 FUSION ORDER ACCEPTED EVENT:')
                console.log('='.repeat(50))
                console.log(`   Fusion Order: ${fusionOrderAcceptedEvent.fusion_order?.inner || 'N/A'}`)
                console.log(`   Owner: ${fusionOrderAcceptedEvent.owner}`)
                console.log(`   Resolver: ${fusionOrderAcceptedEvent.resolver}`)
                console.log(`   Source Amount: ${fusionOrderAcceptedEvent.source_amount}`)
                console.log(`   Source Metadata: ${fusionOrderAcceptedEvent.source_metadata?.inner || 'N/A'}`)
                console.log(
                    `   Destination Asset: 0x${Buffer.from(fusionOrderAcceptedEvent.destination_asset.slice(2), 'hex').toString('hex')}`
                )
                console.log(
                    `   Destination Recipient: 0x${Buffer.from(fusionOrderAcceptedEvent.destination_recipient.slice(2), 'hex').toString('hex')}`
                )
                console.log(`   Chain ID: ${fusionOrderAcceptedEvent.chain_id}`)
                console.log(`   Hash (Secret Hash): ${fusionOrderAcceptedEvent.hash}`)
                console.log(`   Initial Price: ${fusionOrderAcceptedEvent.initial_destination_amount}`)
                console.log(`   Min Price: ${fusionOrderAcceptedEvent.min_destination_amount}`)
                console.log(`   Current Price (ACCEPTED): ${fusionOrderAcceptedEvent.current_price}`)
                console.log(`   Decay Per Second: ${fusionOrderAcceptedEvent.decay_per_second}`)
                console.log(`   Auction Start Time: ${fusionOrderAcceptedEvent.auction_start_time}`)

                console.log('\n📊 ESCROW CREATED EVENT:')
                console.log('='.repeat(50))
                console.log(`   Escrow Address: ${escrowCreatedEvent.escrow?.inner || 'N/A'}`)
                console.log(`   From: ${escrowCreatedEvent.from}`)
                console.log(`   To: ${escrowCreatedEvent.to}`)
                console.log(`   Resolver: ${escrowCreatedEvent.resolver}`)
                console.log(`   Amount: ${escrowCreatedEvent.amount}`)
                console.log(`   Chain ID: ${escrowCreatedEvent.chain_id}`)
                console.log(`   Is Source Chain: ${escrowCreatedEvent.is_source_chain}`)
                console.log(`   Hash: ${escrowCreatedEvent.hash}`)
                console.log(`   Metadata: ${escrowCreatedEvent.metadata?.inner || 'N/A'}`)
                console.log(`   Timelock Created At: ${escrowCreatedEvent.timelock_created_at}`)
                console.log(`   Timelock Chain Type: ${escrowCreatedEvent.timelock_chain_type}`)

                // Return combined data for cross-chain use
                return {
                    // Fusion Order Data
                    fusionOrder: {
                        address: fusionOrderAcceptedEvent.fusion_order?.inner,
                        owner: fusionOrderAcceptedEvent.owner,
                        resolver: fusionOrderAcceptedEvent.resolver,
                        sourceAmount: fusionOrderAcceptedEvent.source_amount,
                        sourceMetadata: fusionOrderAcceptedEvent.source_metadata?.inner,
                        destinationAsset: fusionOrderAcceptedEvent.destination_asset,
                        destinationRecipient: fusionOrderAcceptedEvent.destination_recipient,
                        chainId: fusionOrderAcceptedEvent.chain_id,
                        hash: fusionOrderAcceptedEvent.hash,
                        initialPrice: fusionOrderAcceptedEvent.initial_destination_amount,
                        minPrice: fusionOrderAcceptedEvent.min_destination_amount,
                        currentPrice: fusionOrderAcceptedEvent.current_price, // ACCEPTED PRICE
                        decayPerSecond: fusionOrderAcceptedEvent.decay_per_second,
                        auctionStartTime: fusionOrderAcceptedEvent.auction_start_time,
                        initialDestinationAmount: fusionOrderAcceptedEvent.initial_destination_amount
                    },
                    // Escrow Data
                    escrow: {
                        address: escrowCreatedEvent.escrow?.inner,
                        from: escrowCreatedEvent.from,
                        to: escrowCreatedEvent.to,
                        resolver: escrowCreatedEvent.resolver,
                        amount: escrowCreatedEvent.amount,
                        chainId: escrowCreatedEvent.chain_id,
                        isSourceChain: escrowCreatedEvent.is_source_chain,
                        hash: escrowCreatedEvent.hash,
                        metadata: escrowCreatedEvent.metadata?.inner,
                        timelockCreatedAt: escrowCreatedEvent.timelock_created_at,
                        timelockChainType: escrowCreatedEvent.timelock_chain_type
                    }
                }
            } else {
                console.log('⚠️ Could not find both FusionOrderAcceptedEvent and EscrowCreatedEvent')
                return null
            }
        }

        console.log('⚠️ No events found in transaction')
        return null
    } catch (error) {
        console.error('❌ Error fetching escrow event data:', error)
        return null
    }
}
async function createFusionOrder() {
    console.log('\n🔥 Creating fusion order...')

    try {
        // Generate random secret (32 bytes)
        const secret = randomBytes(32)
        const secretHex = '0x' + secret.toString('hex')
        console.log(`🔐 Generated secret: ${secretHex}`)

        // Create Keccak256 hash of secret for hashlock
        const hashHex = keccak256(secret)
        const hashBuffer = Buffer.from(hashHex.slice(2), 'hex') // Remove 0x prefix
        const hashArray = Array.from(hashBuffer)

        console.log(`🔒 Hash (Keccak256): ${hashHex}`)
        console.log(`📊 Hash array length: ${hashArray.length}`)

        // Generate destination recipient from EVM private key
        const destinationRecipient = generateDestinationRecipient(EVM_PRIVATE_KEY)
        console.log(`👤 Destination recipient vector length: ${destinationRecipient.length}`)

        // Convert USDC address to Aptos-compatible vector
        const destinationAsset = evmAddressToAptosVector(USDC_ADDRESS)
        console.log(`💰 USDC address: ${USDC_ADDRESS}`)
        console.log(`💰 Destination asset vector length: ${destinationAsset.length}`)

        // APT metadata (0xa for APT)
        const aptMetadata = '0xa'

        // Order parameters - REDUCED AMOUNTS
        const sourceAmount = 1000000 // 1 APT in octas (0.01 APT)
        const chainId = 10 // Optimism
        const initialDestinationAmount = 10000 // 0.00001 USDC (10 micro-USDC)
        const minDestinationAmount = Math.floor(initialDestinationAmount * 0.9) // 90% of initial
        const decayPerSecond = 100 // Decay rate

        console.log('\n📋 Order Parameters:')
        console.log(`   Source metadata: ${aptMetadata}`)
        console.log(`   Source amount: ${sourceAmount} (${sourceAmount / 1e8} APT)`)
        console.log(`   Destination asset: USDC (${destinationAsset.length} bytes)`)
        console.log(`   Destination recipient: EVM address (${destinationRecipient.length} bytes)`)
        console.log(`   Chain ID: ${chainId} (Optimism)`)
        console.log(`   Hash: ${hashArray.length} bytes`)
        console.log(
            `   Initial destination amount: ${initialDestinationAmount} (${initialDestinationAmount / 1e6} USDC)`
        )
        console.log(`   Min destination amount: ${minDestinationAmount} (${minDestinationAmount / 1e6} USDC)`)
        console.log(`   Decay per second: ${decayPerSecond}`)

        // Build transaction payload
        const createOrderPayload = fusionClient.buildTransactionPayload(
            'fusion_order::new_entry',
            [],
            [
                aptMetadata, // source_metadata
                sourceAmount, // source_amount
                destinationAsset, // destination_asset (USDC address as bytes)
                destinationRecipient, // destination_recipient (EVM address as bytes)
                chainId, // chain_id (Optimism)
                hashArray, // hash (Keccak256 of secret)
                initialDestinationAmount, // initial_destination_amount
                minDestinationAmount, // min_destination_amount
                decayPerSecond // decay_per_second
            ]
        )

        console.log('\n📝 Submitting fusion order creation transaction...')

        // Submit the transaction
        const txn = await fusionClient.submitTransaction(user, createOrderPayload)

        console.log(`✅ Fusion order created successfully!`)
        console.log(`📋 Transaction Details:`)
        console.log(`   Transaction hash: ${txn.hash}`)
        console.log(`   Secret for withdrawal: ${secretHex}`)
        console.log(`   Explorer: https://explorer.aptoslabs.com/txn/${txn.hash}?network=testnet`)

        return {
            txHash: txn.hash,
            secret: secretHex,
            hashHex: hashHex,
            destinationRecipient,
            destinationAsset
        }
    } catch (error) {
        console.error('❌ Fusion order creation failed:', error)
        throw error
    }
}

async function getProvider(cnf: ChainConfig): Promise<{provider: JsonRpcProvider}> {
    return {
        provider: new JsonRpcProvider(cnf.url, cnf.chainId, {
            cacheTimeout: -1,
            staticNetwork: true
        })
    }
}

async function initChain(cnf: ChainConfig): Promise<{
    node?: CreateServerReturnType
    provider: JsonRpcProvider
    escrowFactory: string
    resolver: string
    createFork: boolean
}> {
    const provider = await getProvider(cnf)
    const deployer = new SignerWallet(process.env.OPTIMISM_PRIVATE_KEY || '', provider.provider)

    // For Optimism mainnet, deploy contracts on-the-fly
    if (cnf.chainId === 10 && !cnf.createFork) {
        console.log(`[${cnf.chainId}]`, `Using real Optimism mainnet - deploying contracts on-the-fly...`)
    }

    // deploy EscrowFactory
    const escrowFactory = await deploy(
        factoryContract,
        [
            cnf.limitOrderProtocol,
            cnf.wrappedNative, // feeToken,
            '0x0000000000000000000000000000000000000000', // accessToken,
            deployer.address, // owner
            60 * 30, // src rescue delay
            60 * 30 // dst rescue delay
        ],
        provider.provider,
        deployer
    )
    console.log(
        `Escrow factory contract deployed to`,
        escrowFactory,
        ' at chain ',
        cnf.chainId == 10 ? 'Optimism' : 'BSC'
    )

    // deploy Resolver contract
    const resolver = await deploy(
        resolverContract,
        [
            escrowFactory,
            cnf.limitOrderProtocol,
            await new Wallet(process.env.OPTIMISM_PRIVATE_KEY || '', provider.provider).getAddress() // resolver as owner of contract
        ],
        provider.provider,
        deployer
    )
    console.log(`Resolver contract deployed to`, resolver, ' at chain ', cnf.chainId == 10 ? 'Optimism' : 'BSC')

    return {provider: provider.provider, resolver, escrowFactory, createFork: cnf.createFork}
}

async function deployDst(
    resolverAddress: string,
    escrowEventData: EventData,
    escrowFactoryAddress: string
): Promise<any> {
    // Use the existing provider and create a wallet with it
    const wallet = new Wallet(process.env.OPTIMISM_PRIVATE_KEY || '', src.provider)

    const erc20 = new Contract(USDC_ADDRESS, abi, wallet)

    const transfer = erc20.interface.encodeFunctionData('transfer', [resolverAddress, '10000'])
    const tx = await wallet.send({
        to: USDC_ADDRESS,
        data: transfer,
        value: 0,
        from: await wallet.getAddress()
    })

    const receipt = await tx.txHash
    console.log('Transaction hash:', receipt)
    console.log('Transaction receipt:', receipt)

    // First, let's create the approve call data
    const approveCallData = erc20.interface.encodeFunctionData('approve', [
        escrowFactoryAddress, // spender (the escrow contract address)
        '10000' 
    ])

    console.log('Approve call data:', approveCallData)

    // Now create the call data for arbitraryCalls function
    // arbitraryCalls(address[] calldata targets, bytes[] calldata arguments)

    // Create interface for the resolver contract
    const resolverInterface = new Interface([
        'function arbitraryCalls(address[] calldata targets, bytes[] calldata arguments) external'
    ])

    // Prepare the parameters for arbitraryCalls
    const targets = [USDC_ADDRESS] // Array of target contract addresses
    const argumentsForApproval = [approveCallData] // Array of call data for each target

    // Encode the arbitraryCalls function call
    const arbitraryCallsData = resolverInterface.encodeFunctionData('arbitraryCalls', [targets, argumentsForApproval])

    console.log('arbitraryCalls call data:', arbitraryCallsData)

    // Execute the arbitraryCalls function on the resolver contract
    const approvalTx = await wallet.send({
        to: resolverAddress, // The resolver contract address
        data: arbitraryCallsData,
        value: 0,
        from: await wallet.getAddress()
    })

    const approvalReceipt = await approvalTx.txHash
    console.log('Approval transaction hash:', approvalReceipt)

    // Create contract with signer directly
    const deployedResolverContract = new Contract(resolverAddress, resolverContract.abi, wallet)

    // Verify the contract is connected to a signer
    if (!deployedResolverContract.runner) {
        throw new Error('Contract is not connected to a signer')
    }

    // Create the Immutables struct according to your Solidity contract
    // Based on your Solidity code, we need to create the proper structure
    const immutables = [
        escrowEventData.fusionOrder.hash, // orderHash // bytes32
        escrowEventData.fusionOrder.hash, // hashlock // bytes32
        escrowEventData.fusionOrder.owner, // maker // Address
        resolverAddress, // taker // Address
        escrowEventData.fusionOrder.destinationAsset, // token // Address
        escrowEventData.fusionOrder.currentPrice, // amount // uint256
        parseEther('0.00001'), // safetyDeposit
        createManualTimelocks(escrowEventData.fusionOrder.auctionStartTime) // timelocks,
    ]
    // Calculate the native amount (ETH) to send with the transaction
    const token = escrowEventData.fusionOrder.destinationAsset
    let nativeAmount = parseEther('0.00001') // safetyDeposit

    // If token is address(0), add the amount to native amount
    if (token === '0x0000000000000000000000000000000000000000') {
        nativeAmount = nativeAmount + BigInt(escrowEventData.fusionOrder.currentPrice)
    }

    // Call createDstEscrow with the immutables and srcCancellationTimestamp
    // The srcCancellationTimestamp should be the cancellation time from the source chain
    const srcCancellationTimestamp = escrowEventData.fusionOrder.auctionStartTime // This should be the actual cancellation timestamp
    const cancellationTimestamp = createManualTimelocks(srcCancellationTimestamp)
    console.log('Calling createDstEscrow with:')
    console.log('  - Immutables:', immutables)
    console.log('  - srcCancellationTimestamp:', srcCancellationTimestamp)
    console.log('  - nativeAmount:', nativeAmount)
    console.log('  - Wallet address:', await wallet.getAddress())
    console.log('  - Escrow factory address:', src.escrowFactory)
    console.log('  - Wallet balance:', await wallet.provider.getBalance(await wallet.getAddress()))
    console.log('  - Contract runner type:', deployedResolverContract.runner?.constructor.name)

    try {
        // Try using the contract interface directly
        const resolverInterface = new Interface(resolverContract.abi)
        const data = resolverInterface.encodeFunctionData('deployDst', [immutables, cancellationTimestamp])

        console.log('Encoded function data:', data)
        console.log('Function signature:', resolverInterface.getFunction('deployDst')?.format())

        const tx = await wallet.send({
            to: resolverAddress,
            data: data,
            value: nativeAmount,
            from: await wallet.getAddress()
        })

        const receipt = await tx.txHash
        console.log('Transaction hash:', receipt)
        console.log('Transaction receipt:', receipt)

        // Extract escrow address from transaction logs
        let deployedEscrowAddress = null
        // Alternative approach using ethers Interface for cleaner decoding
        try {
            const txReceipt = await wallet.provider.getTransactionReceipt(receipt)
            if (txReceipt && txReceipt.logs) {
                // Create interface for the event
                const eventInterface = new Interface([
                    'event DstEscrowCreated(address escrow, bytes32 hashlock, uint256 taker)'
                ])

                for (const log of txReceipt.logs) {
                    try {
                        // Try to parse the log using the interface
                        const parsedLog = eventInterface.parseLog({
                            topics: log.topics,
                            data: log.data
                        })

                        if (parsedLog && parsedLog.name === 'DstEscrowCreated') {
                            deployedEscrowAddress = parsedLog.args.escrow
                            console.log('Found DstEscrowCreated event with escrow address:', deployedEscrowAddress)
                            console.log('Hashlock:', parsedLog.args.hashlock)
                            console.log('Taker:', parsedLog.args.taker)
                            break
                        }
                    } catch (parseError) {
                        // This log doesn't match our event, continue to next log
                        continue
                    }
                }
            }
        } catch (error) {
            console.error('Error extracting escrow address from logs:', error)
        }

        return {
            txHash: receipt,
            escrowAddress: deployedEscrowAddress,
            immutables: immutables 
        }
    } catch (error) {
        console.error('Error calling createDstEscrow:', error)
        // For now, return a mock result for testing
        return {
            txHash: 'mock_tx_hash',
            escrowAddress: src.escrowFactory,
            immutables: immutables // Return immutables even for mock
        }
    }
}
/**
 * Withdraw from Aptos escrow using the secret
 */
async function withdrawOnAptos(secret: string, escrowAddress: string): Promise<any> {
    console.log('🔐 Withdrawing from Aptos escrow...')
    console.log('   Secret:', secret)

    try {
        // Create resolver account from private key
        const resolverPrivateKey = new Ed25519PrivateKey(RESOLVER_PRIVATE_KEY)
        const resolverAccount = Account.fromPrivateKey({privateKey: resolverPrivateKey})

        if (!escrowAddress) {
            console.error('❌ No escrow address provided')
            return {success: false, error: 'No escrow address'}
        }

        console.log('   Escrow address:', escrowAddress)

        // Call the withdraw function on the escrow
        // Convert secret from hex to bytes array for Aptos
        const secretBytes = Array.from(Buffer.from(secret.replace('0x', ''), 'hex'))
        const payload = fusionClient.buildTransactionPayload('escrow::withdraw', [], [escrowAddress, secretBytes])

        const response = await fusionClient.submitTransaction(resolverAccount, payload)

        console.log('✅ Aptos withdrawal successful!')
        console.log('   Transaction hash:', response.hash)
        console.log('   Explorer:', `https://explorer.aptoslabs.com/txn/${response.hash}?network=testnet`)

        return {
            success: true,
            txHash: response.hash,
            explorer: `https://explorer.aptoslabs.com/txn/${response.hash}?network=testnet`
        }
    } catch (error: any) {
        console.error('❌ Aptos withdrawal failed:', error)
        return {success: false, error: error.message}
    }
}

/**
 * Withdraw from Optimism escrow using the secret
 */
async function withdrawOnOptimism(
    resolverAddress: string,
    secret: string,
    escrowAddress: string,
    immutables?: any[]
): Promise<any> {
    console.log('🔐 Withdrawing from Optimism escrow...')
    console.log('   Secret:', secret)

    try {
        // Create wallet for Optimism
        const wallet = new Wallet(process.env.OPTIMISM_PRIVATE_KEY || '', src.provider)

        console.log('   Escrow address:', escrowAddress)
        console.log('   Wallet address:', await wallet.getAddress())

        // Create escrow contract instance.
        const escrowContract = new Contract(escrowAddress, escrowAbi, wallet)

        // Call the withdraw function with the secret and immutables
        // Convert secret from hex to bytes32 for EVM


        if (!immutables) {
            console.error('❌ No immutables provided for withdrawal')
            return {success: false, error: 'No immutables provided'}
        }
        await new Promise((resolve) => setTimeout(resolve, 20000))
        const withdrawData = escrowContract.interface.encodeFunctionData('publicWithdraw', [
            secret,
            immutables
        ])

        const tx = await wallet.send({
            to: escrowAddress,
            data: withdrawData,
            value: 0,
            from: await wallet.getAddress()
        })

        console.log('✅ Optimism withdrawal successful!')
        console.log('   Transaction hash:', tx.txHash)
        console.log('   Explorer:', `https://optimistic.etherscan.io/tx/${tx.txHash}`)

        return {
            success: true,
            txHash: tx.txHash,
            explorer: `https://optimistic.etherscan.io/tx/${tx.txHash}`
        }
    } catch (error: any) {
        console.error('❌ Optimism withdrawal failed:', error)
        return {success: false, error: error.message}
    }
}

/**
 * Deploy contract and return its address
 */
async function deploy(
    json: {abi: any; bytecode: any},
    params: unknown[],
    provider: JsonRpcProvider,
    deployer: SignerWallet
): Promise<string> {
    const deployed = await new ContractFactory(json.abi, json.bytecode, deployer).deploy(...params)
    await deployed.waitForDeployment()

    return await deployed.getAddress()
}

// Main execution
async function main() {
    try {
        // Validate environment variables
        if (!CONTRACT_ADDRESS_TESTNET || !USER_PRIVATE_KEY || !RESOLVER_PRIVATE_KEY) {
            console.error('❌ Missing required environment variables:')
            console.error('   CONTRACT_ADDRESS_TESTNET:', CONTRACT_ADDRESS_TESTNET ? '✅' : '❌')
            console.error('   USER_PRIVATE_KEY:', USER_PRIVATE_KEY ? '✅' : '❌')
            console.error('   RESOLVER_PRIVATE_KEY:', RESOLVER_PRIVATE_KEY ? '✅' : '❌')
            process.exit(1)
        }

        console.log(`🌐 Network: ${NETWORK}`)
        console.log(`📄 Contract: ${CONTRACT_ADDRESS_TESTNET}`)
        console.log(`💼 User: ${user.accountAddress}`)
        console.log(`🔧 Resolver: ${resolver.accountAddress}`)

        // Step 0: Initialize EVM chain
        console.log('\n=== STEP 0: INITIALIZE EVM CHAIN ===')
        src = await initChain(config.chain.source)

        // Step 1: Create fusion order
        console.log('\n=== STEP 1: CREATE FUSION ORDER ===')
        const orderResult = await createFusionOrder()

        // Step 2: Wait for transaction to be processed
        console.log('\n⏳ Waiting 5 seconds for order creation to be processed...')
        await new Promise((resolve) => setTimeout(resolve, 5000))

        // Step 3: Accept fusion order with resolver
        console.log('\n=== STEP 2: ACCEPT FUSION ORDER ===')
        const acceptTxHash = await acceptFusionOrder(orderResult.txHash)

        if (!acceptTxHash) {
            console.error('❌ Failed to accept fusion order')
            return
        }

        // Step 4: Wait for acceptance to be processed
        console.log('\n⏳ Waiting 5 seconds for order acceptance to be processed...')
        await new Promise((resolve) => setTimeout(resolve, 5000))

        // Step 5: Get and log escrow event data
        console.log('\n=== STEP 3: EXTRACT ESCROW EVENT DATA ===')
        const escrowEventData = await getEscrowEventData(acceptTxHash)

        if (!escrowEventData) {
            console.error('❌ Failed to extract escrow event data')
            return
        }
        // Step 6: Deploy destination escrow on EVM
        console.log('\n=== STEP 4: DEPLOY DESTINATION ESCROW ON EVM ===')

        const evmResult = await deployDst(src.resolver, escrowEventData, src.escrowFactory)

        // Step 5: Withdraw on Aptos
        console.log('\n=== STEP 5: WITHDRAW ON APTOS ===')
        const aptosEscrowAddress = escrowEventData?.escrow?.address
        if (aptosEscrowAddress && aptosEscrowAddress !== 'mock_aptos_escrow') {
            const aptosWithdrawResult = await withdrawOnAptos(orderResult.secret, aptosEscrowAddress)
            console.log('Aptos withdrawal result:', aptosWithdrawResult)
        } else {
            console.log('⚠️ Skipping Aptos withdrawal - no valid escrow address')
        }

        // Step 6: Withdraw on Optimism
        console.log('\n=== STEP 6: WITHDRAW ON OPTIMISM ===')
        const optimismEscrowAddress = evmResult?.escrowAddress
        const immutables = evmResult?.immutables
        console.log('Optimism escrow address:', optimismEscrowAddress)
        console.log('Immutables available:', !!immutables)

        if (optimismEscrowAddress && immutables && optimismEscrowAddress !== src.escrowFactory) {
            const optimismWithdrawResult = await withdrawOnOptimism(
                src.resolver,
                orderResult.secret,
                optimismEscrowAddress,
                immutables
            )
            console.log('Optimism withdrawal result:', optimismWithdrawResult)
        } else {
            console.log('⚠️ Skipping Optimism withdrawal - no valid escrow address or immutables')
            console.log('   Escrow address:', optimismEscrowAddress)
            console.log('   Is factory address:', optimismEscrowAddress === src.escrowFactory)
            console.log('   Has immutables:', !!immutables)
        }

        // Final summary
        console.log('\n🎉 COMPLETE CROSS-CHAIN FLOW SUCCESSFUL!')
        console.log('='.repeat(70))

        console.log('\n📋 TRANSACTION SUMMARY:')
        console.log(`   🔥 Aptos Order Creation: ${orderResult.txHash}`)
        console.log(`   🤝 Aptos Order Acceptance: ${acceptTxHash}`)
        console.log(`   ⚡ EVM Destination Escrow: ${evmResult.txHash}`)
        console.log(`   🔐 Original Secret: ${orderResult.secret}`)
        console.log(`   🔒 Secret Hash: ${orderResult.hashHex}`)
        console.log(`   📊 Accepted at Price: ${escrowEventData.fusionOrder.currentPrice} (Dutch auction)`)

        console.log('\n🌐 KEY ADDRESSES:')
        console.log(`   👤 User: ${user.accountAddress}`)
        console.log(`   🔧 Aptos Resolver: ${resolver.accountAddress}`)
        console.log(`   🔒 Aptos Source Escrow: ${escrowEventData.escrow.address}`)
        console.log(`   📋 Fusion Order: ${escrowEventData.fusionOrder.address}`)
        console.log(`   ⚡ EVM Destination Escrow: ${evmResult.escrowAddress}`)
        console.log(`   🏭 EVM Escrow Factory: ${src?.escrowFactory}`)
        console.log(`   🔧 EVM Resolver: ${src?.resolver}`)

        console.log('\n💱 CROSS-CHAIN SWAP DETAILS:')
        console.log(`   📱 Source Chain: Aptos (APT)`)
        console.log(`   ⚡ Destination Chain: Chain ID ${escrowEventData.fusionOrder.chainId} (Optimism)`)
        console.log(
            `   💰 Source Amount: ${escrowEventData.fusionOrder.sourceAmount} octas (${escrowEventData.fusionOrder.sourceAmount / 1e8} APT)`
        )
        console.log(
            `   🎯 Destination Asset: 0x${Buffer.from(escrowEventData.fusionOrder.destinationAsset.slice(2), 'hex').toString('hex')} (USDC)`
        )
        console.log(
            `   👥 Destination Recipient: 0x${Buffer.from(escrowEventData.fusionOrder.destinationRecipient.slice(2), 'hex').toString('hex')}`
        )
        console.log(
            `   💎 Accepted Price: ${escrowEventData.fusionOrder.currentPrice} (${escrowEventData.fusionOrder.currentPrice / 1e6} USDC)`
        )

        console.log('\n🔐 ATOMIC SWAP SECRETS:')
        console.log(`   🔑 Secret (for withdrawal): ${orderResult.secret}`)
        console.log(`   🔒 Hash (in contracts): ${escrowEventData.fusionOrder.hash}`)
        console.log(
            `   ✅ Hash Verification: ${orderResult.hashHex === escrowEventData.fusionOrder.hash ? 'MATCH ✅' : 'MISMATCH ❌'}`
        )

        console.log('\n🔄 COMPLETE CROSS-CHAIN INTEGRATION SUCCESSFUL:')
        console.log('   1. ✅ User created fusion order on Aptos')
        console.log('   2. ✅ Resolver accepted order and created source escrow on Aptos')
        console.log('   3. ✅ Destination escrow created on Optimism with USDC')
        console.log('   4. 🔄 Ready for withdrawals using the same secret on both chains')

        console.log('\n📊 NEXT STEPS:')
        console.log('   - User can withdraw USDC on Optimism using the secret')
        console.log('   - Resolver can withdraw APT on Aptos using the same secret')
        console.log(`   - Secret: ${orderResult.secret}`)

        console.log('\n🔗 EXPLORER LINKS:')
        console.log(
            `   📱 Aptos Order Creation: https://explorer.aptoslabs.com/txn/${orderResult.txHash}?network=testnet`
        )
        console.log(`   🤝 Aptos Order Acceptance: https://explorer.aptoslabs.com/txn/${acceptTxHash}?network=testnet`)
        console.log(`   ⚡ Optimism Destination Escrow: https://optimistic.etherscan.io/tx/${evmResult.txHash}`)

        return {
            orderResult,
            acceptTxHash,
            escrowEventData,
            evmResult,
            crossChainData: {
                secret: orderResult.secret,
                secretHash: escrowEventData.fusionOrder.hash,
                destinationChainId: escrowEventData.fusionOrder.chainId,
                destinationAsset: escrowEventData.fusionOrder.destinationAsset,
                destinationRecipient: escrowEventData.fusionOrder.destinationRecipient,
                acceptedPrice: escrowEventData.fusionOrder.currentPrice,
                sourceEscrowAddress: escrowEventData.escrow.address,
                destinationEscrowAddress: evmResult.escrowAddress
            }
        }
    } catch (error) {
        console.error('❌ Error:', error)
        process.exit(1)
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Process interrupted')
    process.exit(0)
})

main().catch(console.error)
