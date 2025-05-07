import { Blockchain, SandboxContract, TreasuryContract, printTransactionFees } from '@ton/sandbox';
import { Address, Cell, Dictionary, beginCell, toNano } from '@ton/core';
import { Master } from '../wrappers/Master';
import { Helper } from '../wrappers/Helper';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { JettonMinter } from '../wrappers/JettonMinter';
import { NFTCollection } from '../wrappers/NFTCollection';
import { JettonWallet } from '../wrappers/JettonWallet';

describe('Master', () => {
    let codeMaster: Cell;
    let codeHelper: Cell;
    let codeJettonMinter: Cell;
    let codeJettonWallet: Cell;
    let codeNFTCollection: Cell;
    let codeNFTItem: Cell;

    beforeAll(async () => {
        codeMaster = await compile('Master');
        codeHelper = await compile('Helper');
        codeJettonMinter = await compile('JettonMinter');
        codeJettonWallet = await compile('JettonWallet');
        codeNFTCollection = await compile('NFTCollection');
        codeNFTItem = await compile('NFTItem');
    });

    let blockchain: Blockchain;
    let master: SandboxContract<Master>;
    let jettonMinter: SandboxContract<JettonMinter>;
    let collection: SandboxContract<NFTCollection>;
    let users: SandboxContract<TreasuryContract>[];
    let usersJettonWallet: SandboxContract<JettonWallet>[];

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        blockchain = await Blockchain.create();
        blockchain.now = 1600000000;

        users = await blockchain.createWallets(5);
        usersJettonWallet = [];

        // deploy jetton minter
        jettonMinter = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: users[0].address,
                    content: Cell.EMPTY,
                    walletCode: codeJettonWallet,
                },
                codeJettonMinter,
            ),
        );
        await jettonMinter.sendDeploy(users[0].getSender(), toNano('0.05'));

        for (let i = 0; i < users.length; i++) {
            usersJettonWallet.push(
                blockchain.openContract(
                    JettonWallet.createFromAddress(await jettonMinter.getWalletAddressOf(users[i].address)),
                ),
            );
        }

        await jettonMinter.sendMint(
            users[0].getSender(),
            toNano('0.05'),
            toNano('0.1'),
            users[2].address,
            toNano('10000'),
        );

        await jettonMinter.sendMint(
            users[0].getSender(),
            toNano('0.05'),
            toNano('0.1'),
            users[0].address,
            toNano('10000'),
        );

        collection = blockchain.openContract(
            NFTCollection.createFromConfig(
                {
                    owner: users[0].address,
                    collectionContent: Cell.EMPTY,
                    commonContent: Cell.EMPTY,
                    itemCode: codeNFTItem,
                    royaltyBase: 100n,
                    royaltyFactor: 100n,
                },
                codeNFTCollection,
            ),
        );
        await collection.sendDeploy(users[0].getSender(), toNano('0.05'));

        const item = (await collection.sendMint(users[0].getSender(), toNano('1'), 0)).result;

        master = blockchain.openContract(
            Master.createFromConfig(
                {
                    owner: users[0].address,
                    nft: item.address,
                    jettonWallet: users[0].address,
                    offers: Dictionary.empty(Dictionary.Keys.Address()),
                    amount: toNano('1000'),
                    loanDuration: 100n,
                    aprAmount: toNano('100'),
                    helperCode: codeHelper,
                    platform: users[3].address,
                    nftFee: toNano('0.03'),
                    platformFee: toNano('0.1'),
                },
                codeMaster,
            ),
        );

        const deployer = await blockchain.treasury('deployer');

        const deployResult = await master.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: master.address,
            deploy: true,
            success: true,
        });

        master.sendChangeData(users[0].getSender(), toNano('0.05'), {
            queryId: 0n,
            jettonWallet: await jettonMinter.getWalletAddressOf(master.address),
        });
    });

    it('should activate lending contract', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);
    });

    it('should change lending parametrs', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        await master.sendChangeData(users[0].getSender(), toNano('0.05'), {
            queryId: 0n,
            amount: toNano('2000'),
            loanDuration: 200n,
            aprAmount: toNano('200'),
            jettonWallet: users[4].address,
        });

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(users[4].address);
        expect(masterData.loanDuration).toEqual(200n);
        expect(masterData.amount).toEqual(toNano('2000'));
        expect(masterData.aprAmount).toEqual(toNano('200'));
        expect(masterData.platform).toEqualAddress(users[3].address);
    });

    it('should delete lending', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        await master.sendCencel(users[0].getSender(), toNano('0.05'), {
            queryId: 0n,
        });

        expect((await blockchain.getContract(master.address)).accountState?.type).not.toEqual('active');
    });

    it('should deploy offer', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),

            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        expect(res.transactions).toHaveTransaction({
            from: master.address,
            to: (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            deploy: true,
            success: true,
        });

        let helperData = await blockchain
            .openContract(
                Helper.createFromAddress(
                    (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                ),
            )
            .getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
    });

    it('should not deploy offer (not enough tons)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.05'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        expect(
            (
                await blockchain.getContract(
                    (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                )
            ).accountState?.type,
        ).not.toEqual('active');
    });

    it('should not deploy offer (not enough jettons)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('900'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        expect(
            (
                await blockchain.getContract(
                    (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                )
            ).accountState?.type,
        ).not.toEqual('active');
    });

    it('should not deploy offer (small amount jettons)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('900'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(beginCell().storeCoins(toNano('900')).storeCoins(toNano('100')).storeUint(100n, 64).endCell())
                .endCell(),
        );

        expect(
            (
                await blockchain.getContract(
                    (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                )
            ).accountState?.type,
        ).not.toEqual('active');
    });

    it('should not deploy offer (small loan duration)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(10n, 64).endCell())
                .endCell(),
        );

        expect(
            (
                await blockchain.getContract(
                    (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                )
            ).accountState?.type,
        ).not.toEqual('active');
    });

    it('should not deploy offer (small apr amount)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(beginCell().storeCoins(toNano('1000')).storeCoins(toNano('1')).storeUint(100n, 64).endCell())
                .endCell(),
        );

        expect(
            (
                await blockchain.getContract(
                    (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                )
            ).accountState?.type,
        ).not.toEqual('active');
    });

    it('should not deploy offer (not active landing)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        let res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        expect(
            (
                await blockchain.getContract(
                    (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                )
            ).accountState?.type,
        ).not.toEqual('active');
    });

    it('should accept offer', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
    });

    it('should not deploy offer (offer alredy accepted)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.1'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[3].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        expect(
            (
                await blockchain.getContract(
                    (await master.getHelper(usersJettonWallet[3].address, users[2].address)).address,
                )
            ).accountState?.type,
        ).not.toEqual('active');
    });

    it('should not accept offer (not enough tons)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.02'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        expect(res.transactions).toHaveTransaction({
            exitCode: 703,
        });
    });

    it('should not accept offer (wrong sender)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[1].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        expect(res.transactions).toHaveTransaction({
            exitCode: 700,
        });
    });

    it('should not accept offer (wrong sender)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        expect(res.transactions).toHaveTransaction({
            exitCode: 701,
        });
    });

    it('should delete offer', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        await helper.sendCencel(users[2].getSender(), toNano('0.05'), {
            queryId: 0n,
        });

        expect((await blockchain.getContract(helper.address)).accountState?.type).not.toEqual('active');
    });

    it('should not delete offer (offer accepted)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendCencel(users[2].getSender(), toNano('0.05'), {
            queryId: 0n,
        });

        expect(res.transactions).toHaveTransaction({
            exitCode: 701,
        });
    });

    it('should not delete lending (offer accepted)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await master.sendCencel(users[0].getSender(), toNano('0.05'), {
            queryId: 0n,
        });

        expect(res.transactions).toHaveTransaction({
            exitCode: 701,
        });
    });

    it('should pay out', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        let balance = await usersJettonWallet[2].getJettonBalance();

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await usersJettonWallet[0].sendTransfer(
            users[0].getSender(),
            toNano('0.05'),
            toNano('0.20'),
            helper.address,
            toNano('1000') + toNano('100'),
            Cell.EMPTY,
        );

        expect(await usersJettonWallet[3].getJettonBalance()).toEqual(toNano('10'));
        expect(await item.getOwner()).toEqualAddress(users[0].address);
        expect(await usersJettonWallet[2].getJettonBalance()).toEqual(toNano('90') + balance);
        expect((await blockchain.getContract(helper.address)).accountState?.type).not.toEqual('active');
    });

    it('should pay out ton', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await master.sendChangeData(users[0].getSender(), toNano('0.05'), {
            queryId: 0n,
            jettonWallet: Address.parse('UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ'),
            amount: toNano('10'),
            aprAmount: toNano('1'),
        });

        masterData = await master.getContractData();

        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(
            Address.parse('UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ'),
        );
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('10'));
        expect(masterData.aprAmount).toEqual(toNano('1'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await master.sendMakeOffer(users[2].getSender(), toNano('11'), {
            queryId: 0n,
            owner: users[2].address,
            offerAmount: toNano('10'),
            aprAmount: toNano('1'),
            loanDuration: 100n,
        });

        let helper = blockchain.openContract(
            Helper.createFromAddress(
                (
                    await master.getHelper(
                        Address.parse('UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ'),
                        users[2].address,
                    )
                ).address,
            ),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            Address.parse('UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ'),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(
            Address.parse('UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ'),
        );
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('10'));
        expect(helperData.aprAmount).toEqual(toNano('1'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            Address.parse('UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ'),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(
            Address.parse('UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ'),
        );
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('10'));
        expect(helperData.aprAmount).toEqual(toNano('1'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendPayLoan(users[0].getSender(), toNano('11.5'), {
            queryId: 0n,
        });

        expect(await item.getOwner()).toEqualAddress(users[0].address);
        expect((await blockchain.getContract(helper.address)).accountState?.type).not.toEqual('active');
    });

    it('should not pay out', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        let balance = await usersJettonWallet[2].getJettonBalance();

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        blockchain.now = 1600000000 + 101;

        res = await helper.sendCheck(users[2].getSender(), toNano('0.25'), {
            queryId: 0n,
        });

        expect(await item.getOwner()).toEqualAddress(users[2].address);
        expect((await blockchain.getContract(helper.address)).accountState?.type).not.toEqual('active');
        expect((await blockchain.getContract(master.address)).accountState?.type).not.toEqual('active');
    });

    it('should offer new settings', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendOffer(users[2].getSender(), toNano('0.05'), {
            queryId: 0n,
            loanDuration: 200n,
            aprAmount: toNano('200'),
            extraReward: toNano('10'),
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(toNano('200'));
        expect(helperData.offerLoanDuration).toEqual(200n);
        expect(helperData.offerExtraReward).toEqual(toNano('10'));
        expect(helperData.offerTurn).toEqualAddress(users[2].address);
    });

    it('should change offer settings', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendOffer(users[2].getSender(), toNano('0.05'), {
            queryId: 0n,
            loanDuration: 200n,
            aprAmount: toNano('200'),
            extraReward: toNano('10'),
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(toNano('200'));
        expect(helperData.offerLoanDuration).toEqual(200n);
        expect(helperData.offerExtraReward).toEqual(toNano('10'));
        expect(helperData.offerTurn).toEqualAddress(users[2].address);

        res = await helper.sendOffer(users[2].getSender(), toNano('0.05'), {
            queryId: 0n,
            loanDuration: 100n,
            aprAmount: toNano('100'),
            extraReward: toNano('5'),
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(toNano('100'));
        expect(helperData.offerLoanDuration).toEqual(100n);
        expect(helperData.offerExtraReward).toEqual(toNano('5'));
        expect(helperData.offerTurn).toEqualAddress(users[2].address);
    });

    it('should not change offer settings (not his turn)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendOffer(users[2].getSender(), toNano('0.05'), {
            queryId: 0n,
            loanDuration: 200n,
            aprAmount: toNano('200'),
            extraReward: toNano('10'),
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(toNano('200'));
        expect(helperData.offerLoanDuration).toEqual(200n);
        expect(helperData.offerExtraReward).toEqual(toNano('10'));
        expect(helperData.offerTurn).toEqualAddress(users[2].address);

        res = await helper.sendOffer(users[0].getSender(), toNano('0.05'), {
            queryId: 0n,
            loanDuration: 100n,
            aprAmount: toNano('100'),
            extraReward: toNano('5'),
        });

        expect(res.transactions).toHaveTransaction({
            exitCode: 700,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(toNano('200'));
        expect(helperData.offerLoanDuration).toEqual(200n);
        expect(helperData.offerExtraReward).toEqual(toNano('10'));
        expect(helperData.offerTurn).toEqualAddress(users[2].address);
    });

    it('should accept new settings', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendOffer(users[2].getSender(), toNano('0.05'), {
            queryId: 0n,
            loanDuration: 200n,
            aprAmount: toNano('200'),
            extraReward: toNano('10'),
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(toNano('200'));
        expect(helperData.offerLoanDuration).toEqual(200n);
        expect(helperData.offerExtraReward).toEqual(toNano('10'));
        expect(helperData.offerTurn).toEqualAddress(users[2].address);

        await helper.sendConsider(users[0].getSender(), toNano('0.05'), {
            queryId: 0n,
            flag: 1n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('210'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(200n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(0n);
        expect(helperData.offerLoanDuration).toEqual(0n);
        expect(helperData.offerExtraReward).toEqual(0n);
        expect(helperData.offerTurn).toEqualAddress(master.address);
    });

    it('should reject new settings', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendOffer(users[2].getSender(), toNano('0.05'), {
            queryId: 0n,
            loanDuration: 200n,
            aprAmount: toNano('200'),
            extraReward: toNano('10'),
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(toNano('200'));
        expect(helperData.offerLoanDuration).toEqual(200n);
        expect(helperData.offerExtraReward).toEqual(toNano('10'));
        expect(helperData.offerTurn).toEqualAddress(users[2].address);

        await helper.sendConsider(users[0].getSender(), toNano('0.05'), {
            queryId: 0n,
            flag: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(0n);
        expect(helperData.offerLoanDuration).toEqual(0n);
        expect(helperData.offerExtraReward).toEqual(0n);
        expect(helperData.offerTurn).toEqualAddress(master.address);
    });

    it('should not reject and accept new settings (not his turn)', async () => {
        const item = blockchain.openContract(await collection.getNftItemByIndex(0n));

        let masterData = await master.getContractData();
        expect(masterData.active).toEqual(0n);

        let res = await item.sendTransfer(users[0].getSender(), toNano('1'), master.address);

        masterData = await master.getContractData();
        expect(masterData.active).toEqual(1n);
        expect(masterData.nft).toEqualAddress(item.address);
        expect(masterData.owner).toEqualAddress(users[0].address);
        expect(masterData.jettonWallet).toEqualAddress(await jettonMinter.getWalletAddressOf(master.address));
        expect(masterData.loanDuration).toEqual(100n);
        expect(masterData.amount).toEqual(toNano('1000'));
        expect(masterData.aprAmount).toEqual(toNano('100'));
        expect(masterData.platform).toEqualAddress(users[3].address);

        res = await usersJettonWallet[2].sendTransfer(
            users[2].getSender(),
            toNano('0.05'),
            toNano('0.25'),
            master.address,
            toNano('1000'),
            beginCell()
                .storeUint(0x2c504e2d, 32)
                .storeAddress(users[2].address)
                .storeAddress(
                    await jettonMinter.getWalletAddressOf(
                        (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
                    ),
                )
                .storeAddress(usersJettonWallet[2].address)
                .storeRef(
                    beginCell().storeCoins(toNano('1000')).storeCoins(toNano('100')).storeUint(100n, 64).endCell(),
                )
                .endCell(),
        );

        let helper = blockchain.openContract(
            Helper.createFromAddress((await master.getHelper(usersJettonWallet[2].address, users[2].address)).address),
        );

        let helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(0n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendAccept(users[0].getSender(), toNano('0.10'), {
            queryId: 0n,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);

        res = await helper.sendOffer(users[2].getSender(), toNano('0.05'), {
            queryId: 0n,
            loanDuration: 200n,
            aprAmount: toNano('200'),
            extraReward: toNano('10'),
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(toNano('200'));
        expect(helperData.offerLoanDuration).toEqual(200n);
        expect(helperData.offerExtraReward).toEqual(toNano('10'));
        expect(helperData.offerTurn).toEqualAddress(users[2].address);

        res = await helper.sendConsider(users[2].getSender(), toNano('0.05'), {
            queryId: 0n,
            flag: 0n,
        });

        expect(res.transactions).toHaveTransaction({
            exitCode: 700,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(toNano('200'));
        expect(helperData.offerLoanDuration).toEqual(200n);
        expect(helperData.offerExtraReward).toEqual(toNano('10'));
        expect(helperData.offerTurn).toEqualAddress(users[2].address);

        res = await helper.sendConsider(users[2].getSender(), toNano('0.05'), {
            queryId: 0n,
            flag: 1n,
        });

        expect(res.transactions).toHaveTransaction({
            exitCode: 700,
        });

        helperData = await helper.getContractData();
        expect(helperData.master).toEqualAddress(master.address);
        expect(helperData.owner).toEqualAddress(users[2].address);
        expect(helperData.jettonWallet).toEqualAddress(
            await jettonMinter.getWalletAddressOf(
                (await master.getHelper(usersJettonWallet[2].address, users[2].address)).address,
            ),
        );
        expect(helperData.ownerJettonWallet).toEqualAddress(usersJettonWallet[2].address);
        expect(helperData.paidAmount).toEqual(0n);
        expect(helperData.amount).toEqual(toNano('1000'));
        expect(helperData.aprAmount).toEqual(toNano('100'));
        expect(helperData.platform).toEqualAddress(users[3].address);
        expect(helperData.loanDuration).toEqual(100n);
        expect(helperData.accepted).toEqual(1600000000n);
        expect(helperData.masterOwner).toEqualAddress(users[0].address);
        expect(helperData.offerAprAmount).toEqual(toNano('200'));
        expect(helperData.offerLoanDuration).toEqual(200n);
        expect(helperData.offerExtraReward).toEqual(toNano('10'));
        expect(helperData.offerTurn).toEqualAddress(users[2].address);
    });
});
