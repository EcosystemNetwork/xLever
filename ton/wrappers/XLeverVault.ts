// ═══════════════════════════════════════════════════════════════
// XLeverVault — TypeScript wrapper for testing and deployment
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
    TupleItemInt,
    toNano,
} from '@ton/core';

// ── Message opcodes (must match messages.tact) ──
export const Opcodes = {
    Deposit:           0x1001,
    Withdraw:          0x1002,
    AdjustLeverage:    0x1003,
    DepositJunior:     0x1004,
    WithdrawJunior:    0x1005,
    UpdatePythFeed:    0x2001,
    SetProtocolState:  0x2002,
    WithdrawInsurance: 0x2003,
} as const;

// ── Types ──
export interface Position {
    depositAmount: bigint;
    leverageBps: number;
    entryTwap: bigint;
    lastFeeTimestamp: number;
    isActive: boolean;
}

export interface VaultInfo {
    assetSymbol: string;
    pythFeedId: bigint;
    totalSeniorDeposits: bigint;
    totalJuniorDeposits: bigint;
    insuranceFund: bigint;
    netExposure: bigint;
    protocolState: number;
}

export interface XLeverVaultConfig {
    owner: Address;
    vaultId: number;
    assetSymbol: string;
    usdcAddress: Address;
    pythFeedId: bigint;
}

export function xLeverVaultConfigToCell(config: XLeverVaultConfig): Cell {
    // The init data cell is built by the Tact compiler.
    // This helper is for manual / test usage.
    return beginCell()
        .storeAddress(config.owner)
        .storeUint(config.vaultId, 32)
        .storeStringTail(config.assetSymbol)
        .storeAddress(config.usdcAddress)
        .storeUint(config.pythFeedId, 256)
        .endCell();
}

export class XLeverVault implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address): XLeverVault {
        return new XLeverVault(address);
    }

    static createFromConfig(config: XLeverVaultConfig, code: Cell, workchain = 0): XLeverVault {
        const data = xLeverVaultConfigToCell(config);
        const init = { code, data };
        return new XLeverVault(contractAddress(workchain, init), init);
    }

    // ── Deploy ──
    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    // ── Senior deposit ──
    async sendDeposit(
        provider: ContractProvider,
        via: Sender,
        opts: { value: bigint; amount: bigint; leverageBps: number; queryId?: number },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.Deposit, 32)
                .storeUint(opts.amount, 128)
                .storeInt(opts.leverageBps, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .endCell(),
        });
    }

    // ── Withdraw ──
    async sendWithdraw(
        provider: ContractProvider,
        via: Sender,
        opts: { value: bigint; amount: bigint; queryId?: number },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.Withdraw, 32)
                .storeUint(opts.amount, 128)
                .storeUint(opts.queryId ?? 0, 64)
                .endCell(),
        });
    }

    // ── Adjust leverage ──
    async sendAdjustLeverage(
        provider: ContractProvider,
        via: Sender,
        opts: { value: bigint; newLeverageBps: number; queryId?: number },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.AdjustLeverage, 32)
                .storeInt(opts.newLeverageBps, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .endCell(),
        });
    }

    // ── Junior deposit ──
    async sendDepositJunior(
        provider: ContractProvider,
        via: Sender,
        opts: { value: bigint; amount: bigint; queryId?: number },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.DepositJunior, 32)
                .storeUint(opts.amount, 128)
                .storeUint(opts.queryId ?? 0, 64)
                .endCell(),
        });
    }

    // ── Junior withdraw ──
    async sendWithdrawJunior(
        provider: ContractProvider,
        via: Sender,
        opts: { value: bigint; shares: bigint; queryId?: number },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.WithdrawJunior, 32)
                .storeUint(opts.shares, 128)
                .storeUint(opts.queryId ?? 0, 64)
                .endCell(),
        });
    }

    // ── Admin: Update Pyth feed ──
    async sendUpdatePythFeed(
        provider: ContractProvider,
        via: Sender,
        opts: { value: bigint; newFeedId: bigint },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.UpdatePythFeed, 32)
                .storeUint(opts.newFeedId, 256)
                .endCell(),
        });
    }

    // ── Admin: Set protocol state ──
    async sendSetProtocolState(
        provider: ContractProvider,
        via: Sender,
        opts: { value: bigint; newState: number },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.SetProtocolState, 32)
                .storeUint(opts.newState, 8)
                .endCell(),
        });
    }

    // ── Admin: Withdraw insurance ──
    async sendWithdrawInsurance(
        provider: ContractProvider,
        via: Sender,
        opts: { value: bigint; amount: bigint; recipient: Address },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.WithdrawInsurance, 32)
                .storeUint(opts.amount, 128)
                .storeAddress(opts.recipient)
                .endCell(),
        });
    }

    // ═══════════════════════════════════════════════════════════
    // GETTERS
    // ═══════════════════════════════════════════════════════════

    async getVaultInfo(provider: ContractProvider): Promise<VaultInfo> {
        const result = await provider.get('vaultInfo', []);
        const stack = result.stack;
        return {
            assetSymbol: stack.readString(),
            pythFeedId: stack.readBigNumber(),
            totalSeniorDeposits: stack.readBigNumber(),
            totalJuniorDeposits: stack.readBigNumber(),
            insuranceFund: stack.readBigNumber(),
            netExposure: stack.readBigNumber(),
            protocolState: stack.readNumber(),
        };
    }

    async getPosition(provider: ContractProvider, user: Address): Promise<Position | null> {
        const result = await provider.get('getPosition', [
            { type: 'slice', cell: beginCell().storeAddress(user).endCell() },
        ]);
        const stack = result.stack;
        // Returns null if no position
        const optFlag = stack.readNumber();
        if (optFlag === 0) return null;
        return {
            depositAmount: stack.readBigNumber(),
            leverageBps: stack.readNumber(),
            entryTwap: stack.readBigNumber(),
            lastFeeTimestamp: stack.readNumber(),
            isActive: stack.readBoolean(),
        };
    }

    async getJuniorShares(provider: ContractProvider, user: Address): Promise<bigint> {
        const result = await provider.get('getJuniorShares', [
            { type: 'slice', cell: beginCell().storeAddress(user).endCell() },
        ]);
        return result.stack.readBigNumber();
    }

    async getTotalJuniorShares(provider: ContractProvider): Promise<bigint> {
        const result = await provider.get('totalJuniorShares', []);
        return result.stack.readBigNumber();
    }

    async getOwner(provider: ContractProvider): Promise<Address> {
        const result = await provider.get('owner', []);
        return result.stack.readAddress();
    }

    async getVaultId(provider: ContractProvider): Promise<number> {
        const result = await provider.get('vaultId', []);
        return result.stack.readNumber();
    }

    async getProtocolState(provider: ContractProvider): Promise<number> {
        const result = await provider.get('protocolState', []);
        return result.stack.readNumber();
    }

    async getTotalPositions(provider: ContractProvider): Promise<number> {
        const result = await provider.get('totalPositions', []);
        return result.stack.readNumber();
    }

    async getCalculateFee(provider: ContractProvider, amount: bigint, leverageBps: number): Promise<bigint> {
        const result = await provider.get('calculateFeeView', [
            { type: 'int', value: amount },
            { type: 'int', value: BigInt(leverageBps) },
        ]);
        return result.stack.readBigNumber();
    }
}
