import { toNano } from 'ton-core';
import { Helper } from '../wrappers/Helper';
import { compile, NetworkProvider } from '@ton-community/blueprint';

export async function run(provider: NetworkProvider) {
    const helper = provider.open(Helper.createFromConfig({}, await compile('Helper')));

    await helper.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(helper.address);

    // run methods on `helper`
}
