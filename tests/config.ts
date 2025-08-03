import {z} from 'zod'
import Sdk from '@1inch/cross-chain-sdk'
import * as process from 'node:process'

const bool = z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .pipe(z.boolean())

const ConfigSchema = z.object({
    SRC_CHAIN_RPC: z.string().url().default(process.env.SRC_CHAIN_RPC || 'https://optimism.publicnode.com'),
    SRC_CHAIN_CREATE_FORK: bool.default('false'), // Changed to false for real Optimism transactions
    OPTIMISM_PRIVATE_KEY: z.string().optional(), // Add private key for real transactions
    OPTIMISM_RESOLVER_PRIVATE_KEY: z.string().optional() // Add resolver private key
})

const fromEnv = ConfigSchema.parse(process.env)

export const config = {
    chain: {
        source: {
            chainId: 10, // Changed to Optimism
            url: fromEnv.SRC_CHAIN_RPC,
            createFork: fromEnv.SRC_CHAIN_CREATE_FORK,
            limitOrderProtocol: '0x111111125421ca6dc452d289314280a0f8842a65',
            wrappedNative: '0x4200000000000000000000000000000000000006', // WETH on Optimism
            ownerPrivateKey: fromEnv.OPTIMISM_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
            resolverPrivateKey: fromEnv.OPTIMISM_RESOLVER_PRIVATE_KEY || '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
            tokens: {
                USDC: {
                    address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC on Optimism
                    donor: '0x7f90122bf0700f9e7e1f688fe926940e8839f353' // USDC whale on Optimism
                }
            }
        }
    }
} as const

export type ChainConfig = (typeof config.chain)['source']
