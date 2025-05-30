import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';

export type HelperConfig = {
    helperId: bigint;
    master: Address;
    jettonWallet: Address;
    ownerJettonWallet: Address;
    owner: Address;
    masterOwner: Address;
    platform: Address;
    amount: bigint;
    loanDuration: bigint;
    aprAmount: bigint;
};

export function helperConfigToCell(config: HelperConfig): Cell {
    return beginCell()
        .storeRef(
            beginCell()
                .storeUint(config.helperId, 64)
                .storeAddress(config.master)
                .storeAddress(config.jettonWallet)
                .storeAddress(config.ownerJettonWallet)
                .storeCoins(0)
                .endCell(),
        )
        .storeRef(
            beginCell()
                .storeAddress(config.owner)
                .storeAddress(config.masterOwner)
                .storeAddress(config.platform)
                .endCell(),
        )
        .storeCoins(config.amount)
        .storeUint(config.loanDuration, 64)
        .storeCoins(config.aprAmount)
        .storeUint(0, 64)
        .endCell();
}

export class Helper implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Helper(address);
    }

    static createFromConfig(config: HelperConfig, code: Cell, workchain = 0) {
        const data = helperConfigToCell(config);
        const init = { code, data };
        return new Helper(contractAddress(workchain, init), init);
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

    async sendAccept(
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
            body: beginCell().storeUint(0x5d4df4e8, 32).storeUint(opts.queryId, 64).endCell(),
        });
    }

    async sendChangeData(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            queryId: bigint;
            loanDuration?: bigint;
            aprAmount?: bigint;
        },
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0xad68b31, 32)
                .storeUint(opts.queryId, 64)
                .storeMaybeUint(opts.loanDuration, 64)
                .storeMaybeCoins(opts.aprAmount)
                .endCell(),
        });
    }

    async sendCheck(provider: ContractProvider) {
        await provider.external(Cell.EMPTY);
    }

    async sendChangeAmount(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            queryId: bigint;
            amount: bigint;
        },
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x1eae57b3, 32).storeUint(opts.queryId, 64).storeCoins(opts.amount).endCell(),
        });
    }

    async sendOffer(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            queryId: bigint;
            loanDuration: bigint;
            aprAmount: bigint;
            extraReward: bigint;
        },
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x7c820f0d, 32)
                .storeUint(opts.queryId, 64)
                .storeUint(opts.loanDuration, 64)
                .storeCoins(opts.aprAmount)
                .storeCoins(opts.extraReward)
                .endCell(),
        });
    }

    async sendConsider(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            queryId: bigint;
            flag: bigint;
        },
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x648fa1a7, 32).storeUint(opts.queryId, 64).storeUint(opts.flag, 1).endCell(),
        });
    }

    async sendPayLoan(provider: ContractProvider, via: Sender, value: bigint, opts: { queryId: bigint }) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x5a7cab79, 32).storeUint(opts.queryId, 64).endCell(),
        });
    }

    async getContractData(provider: ContractProvider): Promise<{
        isActive: boolean;
        helperId: bigint;
        master: Address;
        jettonWallet: Address;
        ownerJettonWallet: Address;
        paidAmount: bigint;
        owner: Address;
        masterOwner: Address;
        platform: Address;
        amount: bigint;
        loanDuration: bigint;
        aprAmount: bigint;
        accepted: bigint;
        offerLoanDuration: bigint;
        offerAprAmount: bigint;
        offerExtraReward: bigint;
        offerTurn: Address;
    }> {
        const res = (await provider.get('get_contract_data', [])).stack;
        return {
            isActive: res.readBoolean(),
            helperId: res.readBigNumber(),
            master: res.readAddress(),
            jettonWallet: res.readAddress(),
            ownerJettonWallet: res.readAddress(),
            paidAmount: res.readBigNumber(),
            owner: res.readAddress(),
            masterOwner: res.readAddress(),
            platform: res.readAddress(),
            amount: res.readBigNumber(),
            loanDuration: res.readBigNumber(),
            aprAmount: res.readBigNumber(),
            accepted: res.readBigNumber(),
            offerLoanDuration: res.readBigNumber(),
            offerAprAmount: res.readBigNumber(),
            offerExtraReward: res.readBigNumber(),
            offerTurn: res.readAddress(),
        };
    }
}
