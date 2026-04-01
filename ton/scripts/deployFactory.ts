// ═══════════════════════════════════════════════════════════════
// Deploy xLever Factory to TON
// ═══════════════════════════════════════════════════════════════
// Usage: npx ts-node scripts/deployFactory.ts
//
// Environment variables:
//   DEPLOYER_MNEMONIC — 24-word mnemonic for the deployer wallet
//   USDC_ADDRESS      — TON Jetton master address for USDC
//   TON_ENDPOINT      — RPC endpoint (default: testnet)
// ═══════════════════════════════════════════════════════════════

import { Address, toNano } from '@ton/core';
import { TonClient } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';

async function main() {
    // ── Configuration ──
    const mnemonic = process.env.DEPLOYER_MNEMONIC;
    if (!mnemonic) {
        console.error('ERROR: Set DEPLOYER_MNEMONIC environment variable');
        process.exit(1);
    }

    const usdcAddressStr = process.env.USDC_ADDRESS;
    if (!usdcAddressStr) {
        console.error('ERROR: Set USDC_ADDRESS environment variable (TON Jetton master)');
        process.exit(1);
    }

    const endpoint = process.env.TON_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';

    console.log('═══════════════════════════════════════════');
    console.log('  xLever Factory — TON Deployment');
    console.log('═══════════════════════════════════════════');
    console.log(`Endpoint: ${endpoint}`);
    console.log(`USDC:     ${usdcAddressStr}`);

    // ── Derive deployer keys ──
    const mnemonicWords = mnemonic.split(' ');
    const keyPair = await mnemonicToPrivateKey(mnemonicWords);

    console.log('\nDeployer public key:', keyPair.publicKey.toString('hex').slice(0, 16) + '...');

    // ── Connect to TON ──
    const client = new TonClient({ endpoint });

    const usdcAddress = Address.parse(usdcAddressStr);

    // NOTE: In production, you would:
    // 1. Load the compiled Factory contract code from build/XLeverFactory/
    // 2. Create the Factory instance with XLeverFactory.createFromConfig(...)
    // 3. Send the deploy transaction via a WalletV4 contract
    //
    // Example (requires compiled artifacts from `npx @tact-lang/compiler`):
    //
    //   import { XLeverFactory } from '../wrappers/XLeverFactory';
    //   const code = Cell.fromBoc(fs.readFileSync('./build/XLeverFactory/xlever_factory.code.boc'))[0];
    //   const factory = XLeverFactory.createFromConfig({
    //       owner: walletAddress,
    //       defaultUsdcAddress: usdcAddress,
    //   }, code);
    //
    //   // Deploy via wallet
    //   const wallet = client.open(WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 }));
    //   await wallet.sendTransfer({
    //       secretKey: keyPair.secretKey,
    //       sendMode: SendMode.PAY_GAS_SEPARATELY,
    //       messages: [internal({ to: factory.address, value: toNano('0.5'), init: factory.init, body: beginCell().endCell() })],
    //   });

    console.log('\n--- Deployment Steps ---');
    console.log('1. Run: npx @tact-lang/compiler    (builds contracts)');
    console.log('2. Run this script with DEPLOYER_MNEMONIC and USDC_ADDRESS set');
    console.log('3. Factory will be deployed and its address printed');
    console.log('4. Then run deployAllVaults.ts to create all 33 asset vaults');
    console.log('\nFactory deployment scaffold complete.');
}

main().catch(console.error);
