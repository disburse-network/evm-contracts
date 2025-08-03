import 'dotenv/config'
import {expect, jest, describe, it, beforeAll, afterAll} from '@jest/globals'

import {createServer, CreateServerReturnType} from 'prool'
import {anvil} from 'prool/instances'

import Sdk from '@1inch/cross-chain-sdk'
import {
    computeAddress,
    ContractFactory,
    JsonRpcProvider,
    MaxUint256,
    parseEther,
    parseUnits,
    randomBytes,
    Wallet as SignerWallet
} from 'ethers'
import {uint8ArrayToHex, UINT_40_MAX} from '@1inch/byte-utils'
import assert from 'node:assert'
import {ChainConfig, config} from './config'
import {Wallet} from './wallet'
import {Resolver} from './resolver'
import {EscrowFactory} from './escrow-factory'
import factoryContract from '../dist/contracts/TestEscrowFactory.sol/TestEscrowFactory.json'
import resolverContract from '../dist/contracts/Resolver.sol/Resolver.json'
import crypto from 'crypto'

const {Address} = Sdk

jest.setTimeout(1000 * 60)

const userPkDestinationChain = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const resolverPkDestinationChain = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'

// Use private keys from config for real transactions
const userPkSourceChain = config.chain.source.ownerPrivateKey
const resolverPkForSourceChain = config.chain.source.resolverPrivateKey
const resolverPkForDestinationChain = resolverPkDestinationChain

// eslint-disable-next-line max-lines-per-function
describe('Resolving example', () => {
    const srcChainId = config.chain.source.chainId
    const dstChainId = Sdk.NetworkEnum.ETHEREUM // APTOS and ethereum has the same chainId

    type Chain = {
        node?: CreateServerReturnType | undefined
        provider: JsonRpcProvider
        escrowFactory: string
        resolver: string
        createFork: boolean
    }

    let src: Chain
    let dst: Chain

    let srcChainUser: Wallet
    let dstChainUser: Wallet
    let srcChainResolver: Wallet
    let dstChainResolver: Wallet

    let srcFactory: EscrowFactory
    let dstFactory: EscrowFactory
    let srcResolverContract: Wallet
    let dstResolverContract: Wallet

    let srcTimestamp: bigint

    async function increaseTime(t: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, t * 1000))
    }

    beforeAll(async () => {
        ;[src] = await Promise.all([initChain(config.chain.source)])

        srcChainUser = new Wallet(userPkSourceChain, src.provider)
        srcChainResolver = new Wallet(resolverPkForSourceChain, src.provider)

        srcFactory = new EscrowFactory(src.provider, src.escrowFactory)

        // we need to approve the token to the limit order protocol
        await srcChainUser.approveToken(
            config.chain.source.tokens.USDC.address,
            config.chain.source.limitOrderProtocol,
            MaxUint256
        )

        srcResolverContract = new Wallet(resolverPkForSourceChain, src.provider)
        srcTimestamp = BigInt((await src.provider.getBlock('latest'))!.timestamp)
    })

    async function getBalance(srcToken: string): Promise<{user: bigint; resolver: bigint}> {
        return {
            user: await srcChainUser.tokenBalance(srcToken),
            resolver: await srcResolverContract.tokenBalance(srcToken)
        }
    }

    afterAll(async () => {
        src.provider.destroy()
        await Promise.all([src.node?.stop()])
    })

    // eslint-disable-next-line max-lines-per-function
    describe('Fill', () => {
        it('should swap Ethereum USDC -> Bsc USDC. Single fill only', async () => {
            const initialBalances = await getBalance(config.chain.source.tokens.USDC.address)

            // User creates order
            const secret = uint8ArrayToHex(randomBytes(32)) // note: use crypto secure random number in real world

            // Create SHA1 hashes of the Aptos addresses for EVM compatibility
            const aptosReceiverAddress = '0x8b48e313cf5275cf04f33d07245ec6c386f44316a6b2edd1a8ae645f2a349497'
            const aptosTakerAssetAddress = '0x000000000000000000000000000000000000000000000000000000000000000a'

            const receiverSha1 = '0x' + crypto.createHash('sha1').update(aptosReceiverAddress).digest('hex')
            const takerAssetSha1 = '0x' + crypto.createHash('sha1').update(aptosTakerAssetAddress).digest('hex')

            console.log('Original Aptos receiver address:', aptosReceiverAddress)
            console.log('Receiver SHA1 hash:', receiverSha1)
            console.log('Original Aptos taker asset address:', aptosTakerAssetAddress)
            console.log('Taker asset SHA1 hash:', takerAssetSha1)

            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: parseUnits('0.00001', 6),
                    takingAmount: parseUnits('0.00001', 6),
                    makerAsset: new Address(config.chain.source.tokens.USDC.address),
                    takerAsset: new Address(takerAssetSha1), // SHA1 hash of Aptos address
                    receiver: new Address(receiverSha1) // SHA1 hash of Aptos address
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10sec finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10sec finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId,
                    dstChainId,
                    srcSafetyDeposit: parseEther('0.000000001'), // lowering down the eth safe deposit for tests
                    dstSafetyDeposit: parseEther('0.000000001')
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(src.resolver),
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: false,
                    allowMultipleFills: false
                }
            )

            const signature = await srcChainUser.signOrder(srcChainId, order)
            const orderHash = order.getOrderHash(srcChainId)
            // Resolver fills order
            const resolverContract = new Resolver(src.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash}`)

            console.log('order', order)
            console.log('Order receiver SHA1 address:', order.receiver.toString())
            console.log('Order takerAsset SHA1 address:', order.takerAsset.toString())

            const fillAmount = order.makingAmount
            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await srcChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    order,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(order.extension)
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(order.takingAmount),
                    fillAmount
                )
            )

            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            await increaseTime(11)
            // User shares key after validation of dst escrow deployment

            console.log(`[${srcChainId}]`, `Withdrawing funds for resolver from ${srcEscrowAddress}`)
            const {txHash: resolverWithdrawHash} = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ${srcEscrowAddress} to ${src.resolver} in tx ${resolverWithdrawHash}`
            )
        })
    })
})

async function initChain(
    cnf: ChainConfig
): Promise<{
    node?: CreateServerReturnType
    provider: JsonRpcProvider
    escrowFactory: string
    resolver: string
    createFork: boolean
}> {
    const {node, provider} = await getProvider(cnf)
    const deployer = new SignerWallet(cnf.ownerPrivateKey, provider)

    // For Optimism mainnet, deploy contracts on-the-fly
    if (cnf.chainId === Sdk.NetworkEnum.OPTIMISM && !cnf.createFork) {
        console.log(`[${cnf.chainId}]`, `Using real Optimism mainnet - deploying contracts on-the-fly...`)
    }

    // deploy EscrowFactory
    const escrowFactory = await deploy(
        factoryContract,
        [
            cnf.limitOrderProtocol,
            cnf.wrappedNative, // feeToken,
            Address.fromBigInt(0n).toString(), // accessToken,
            deployer.address, // owner
            60 * 30, // src rescue delay
            60 * 30 // dst rescue delay
        ],
        provider,
        deployer
    )
    console.log(
        `Escrow factory contract deployed to`,
        escrowFactory,
        ' at chain ',
        cnf.chainId == Sdk.NetworkEnum.OPTIMISM ? 'Optimism' : 'BSC'
    )
    let resolverPk = ''
    if (cnf.chainId === Sdk.NetworkEnum.OPTIMISM) {
        resolverPk = resolverPkForSourceChain
    } else {
        resolverPk = resolverPkDestinationChain
    }
    // deploy Resolver contract
    const resolver = await deploy(
        resolverContract,
        [
            escrowFactory,
            cnf.limitOrderProtocol,
            computeAddress(resolverPk) // resolver as owner of contract
        ],
        provider,
        deployer
    )
    console.log(
        `Resolver contract deployed to`,
        resolver,
        ' at chain ',
        cnf.chainId == Sdk.NetworkEnum.OPTIMISM ? 'Optimism' : 'BSC'
    )

    return {node: node, provider, resolver, escrowFactory, createFork: cnf.createFork}
}

async function getProvider(cnf: ChainConfig): Promise<{node?: CreateServerReturnType; provider: JsonRpcProvider}> {
    if (!cnf.createFork) {
        return {
            provider: new JsonRpcProvider(cnf.url, cnf.chainId, {
                cacheTimeout: -1,
                staticNetwork: true
            })
        }
    }

    const node = createServer({
        instance: anvil({forkUrl: cnf.url, chainId: cnf.chainId}),
        limit: 1
    })
    await node.start()

    const address = node.address()
    assert(address)

    const provider = new JsonRpcProvider(`http://[${address.address}]:${address.port}/1`, cnf.chainId, {
        cacheTimeout: -1,
        staticNetwork: true
    })

    return {
        provider,
        node
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
