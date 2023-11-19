import { Blockchain, SandboxContract } from '@ton-community/sandbox';
import { Cell, toNano } from 'ton-core';
import { Master } from '../wrappers/Master';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';

describe('Master', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Master');
    });

    let blockchain: Blockchain;
    let master: SandboxContract<Master>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        master = blockchain.openContract(Master.createFromConfig({}, code));

        const deployer = await blockchain.treasury('deployer');

        const deployResult = await master.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: master.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and master are ready to use
    });
});
