import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    SendMode,
} from '@ton/core';
import { Helper } from './Helper';
import { randomInt } from 'crypto';

export type MasterConfig = {
    owner: Address;
    nft: Address;
    jettonWallet: Address;
    offers: Dictionary<Address, bigint>;
    amount: bigint;
    loanDuration: bigint;
    aprAmount: bigint;
    helperCode: Cell;
    platform: Address;
    nftFee: bigint;
    platformFee: bigint;
};

export function masterConfigToCell(config: MasterConfig): Cell {
    return beginCell()
        .storeAddress(config.owner)
        .storeAddress(config.nft)
        .storeAddress(config.jettonWallet)
        .storeUint(0, 1)
        .storeUint(0, 1)
        .storeDict(config.offers)
        .storeRef(
            beginCell()
                .storeCoins(config.amount)
                .storeUint(config.loanDuration, 64)
                .storeCoins(config.aprAmount)
                .storeRef(config.helperCode)
                .storeAddress(config.platform)
                .storeCoins(config.nftFee)
                .storeUint(config.platformFee, 64)
                .storeUint(BigInt(Math.floor(Math.random() * 1e9)), 32)
                .endCell(),
        )
        .endCell();
}

export class Master implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Master(address);
    }

    static createFromConfig(config: MasterConfig, code: Cell, workchain = 0) {
        const data = masterConfigToCell(config);
        const init = { code, data };
        return new Master(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendCencel(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            queryId: bigint;
        },
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x72551da1, 32).storeUint(opts.queryId, 64).endCell(),
        });
    }

    async sendChangeData(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            queryId: bigint;
            jettonWallet?: Address;
            amount?: bigint;
            loanDuration?: bigint;
            aprAmount?: bigint;
        },
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x7160e2b5, 32)
                .storeUint(opts.queryId, 64)
                .storeMaybeBuilder(opts.jettonWallet ? beginCell().storeAddress(opts.jettonWallet) : null)
                .storeMaybeCoins(opts.amount)
                .storeMaybeUint(opts.loanDuration, 64)
                .storeMaybeCoins(opts.aprAmount)
                .endCell(),
        });
    }

    async sendMakeOffer(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: { queryId: bigint; owner: Address; offerAmount: bigint; aprAmount: bigint; loanDuration: bigint },
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeUint(opts.queryId, 64)
                .storeAddress(opts.owner)
                .storeCoins(opts.offerAmount)
                .storeCoins(opts.aprAmount)
                .storeUint(opts.loanDuration, 64)
                .endCell(),
        });
    }

    async getContractData(provider: ContractProvider): Promise<{
        owner: Address;
        nft: Address;
        jettonWallet: Address;
        active: bigint;
        offerAccept: bigint;
        offers: Dictionary<Address, bigint>;
        amount: bigint;
        loanDuration: bigint;
        aprAmount: bigint;
        helperCode: Cell;
        platform: Address;
        platformFee: bigint;
    }> {
        const res = (await provider.get('get_contract_data', [])).stack;
        return {
            owner: res.readAddress(),
            nft: res.readAddress(),
            jettonWallet: res.readAddress(),
            active: res.readBigNumber(),
            offerAccept: res.readBigNumber(),
            offers:
                res
                    .readCellOpt()
                    ?.beginParse()
                    .loadDictDirect(Dictionary.Keys.Address(), Dictionary.Values.BigInt(0)) ??
                Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigInt(0)),
            amount: res.readBigNumber(),
            loanDuration: res.readBigNumber(),
            aprAmount: res.readBigNumber(),
            helperCode: res.readCell(),
            platform: res.readAddress(),
            platformFee: res.readBigNumber(),
        };
    }

    async getHelper(provider: ContractProvider, jettonWallet: Address, user: Address): Promise<Helper> {
        const stack = (
            await provider.get('get_helper_address', [
                { type: 'slice', cell: beginCell().storeAddress(jettonWallet).endCell() },
                { type: 'slice', cell: beginCell().storeAddress(user).endCell() },
            ])
        ).stack;
        return Helper.createFromAddress(stack.readAddress());
    }
}
