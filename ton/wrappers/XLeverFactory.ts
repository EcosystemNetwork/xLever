// ═══════════════════════════════════════════════════════════════
// XLeverFactory — TypeScript wrapper for testing and deployment
// ═══════════════════════════════════════════════════════════════

import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    toNano,
} from '@ton/core';

// ── Message opcodes ──
export const FactoryOpcodes = {
    CreateVault: 0x3001,
} as const;

// ── Types ──
export interface VaultRecord {
    vaultAddress: Address;
    assetSymbol: string;
    pythFeedId: bigint;
    createdAt: number;
}

export interface XLeverFactoryConfig {
    owner: Address;
    defaultUsdcAddress: Address;
}

export function xLeverFactoryConfigToCell(config: XLeverFactoryConfig): Cell {
    return beginCell()
        .storeAddress(config.owner)
        .storeAddress(config.defaultUsdcAddress)
        .endCell();
}

export class XLeverFactory implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address): XLeverFactory {
        return new XLeverFactory(address);
    }

    static createFromConfig(config: XLeverFactoryConfig, code: Cell, workchain = 0): XLeverFactory {
        const data = xLeverFactoryConfigToCell(config);
        const init = { code, data };
        return new XLeverFactory(contractAddress(workchain, init), init);
    }

    // ── Deploy ──
    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    // ── Create a vault ──
    async sendCreateVault(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            assetSymbol: string;
            pythFeedId: bigint;
            usdcAddress: Address;
            queryId?: number;
        },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FactoryOpcodes.CreateVault, 32)
                .storeStringTail(opts.assetSymbol)
                .storeUint(opts.pythFeedId, 256)
                .storeAddress(opts.usdcAddress)
                .storeUint(opts.queryId ?? 0, 64)
                .endCell(),
        });
    }

    // ═══════════════════════════════════════════════════════════
    // GETTERS
    // ═══════════════════════════════════════════════════════════

    async getVaultCount(provider: ContractProvider): Promise<number> {
        const result = await provider.get('vaultCount', []);
        return result.stack.readNumber();
    }

    async getVault(provider: ContractProvider, vaultId: number): Promise<VaultRecord | null> {
        const result = await provider.get('getVault', [
            { type: 'int', value: BigInt(vaultId) },
        ]);
        const stack = result.stack;
        const optFlag = stack.readNumber();
        if (optFlag === 0) return null;
        return {
            vaultAddress: stack.readAddress(),
            assetSymbol: stack.readString(),
            pythFeedId: stack.readBigNumber(),
            createdAt: stack.readNumber(),
        };
    }

    async getVaultAddressBySymbol(provider: ContractProvider, symbol: string): Promise<Address | null> {
        const result = await provider.get('getVaultAddressBySymbol', [
            { type: 'slice', cell: beginCell().storeStringTail(symbol).endCell() },
        ]);
        const stack = result.stack;
        try {
            return stack.readAddressOpt();
        } catch {
            return null;
        }
    }

    async getOwner(provider: ContractProvider): Promise<Address> {
        const result = await provider.get('owner', []);
        return result.stack.readAddress();
    }

    async getDefaultUsdcAddress(provider: ContractProvider): Promise<Address> {
        const result = await provider.get('defaultUsdcAddress', []);
        return result.stack.readAddress();
    }
}
