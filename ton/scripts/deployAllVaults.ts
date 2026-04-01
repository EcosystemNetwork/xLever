// ═══════════════════════════════════════════════════════════════
// Deploy all 33 xLever Vaults via Factory
// ═══════════════════════════════════════════════════════════════
// Usage: npx ts-node scripts/deployAllVaults.ts
//
// Environment variables:
//   DEPLOYER_MNEMONIC  — 24-word mnemonic
//   FACTORY_ADDRESS    — deployed factory contract address
//   USDC_ADDRESS       — TON Jetton master for USDC
//   TON_ENDPOINT       — RPC endpoint (default: testnet)
// ═══════════════════════════════════════════════════════════════

import { Address, toNano, beginCell, SendMode, internal } from '@ton/core';
import { TonClient } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';

// ── All 33 xLever assets with Pyth feed IDs ──
const ASSETS: { sym: string; name: string; feed: string }[] = [
    // Index ETFs
    { sym: 'QQQ',  name: 'Nasdaq-100 ETF',                  feed: '0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d' },
    { sym: 'SPY',  name: 'S&P 500 ETF',                     feed: '0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5' },
    { sym: 'VUG',  name: 'Vanguard Growth ETF',             feed: '0x8c64b089d95170429ba39ec229a0a6fc36b267e09c3210fbb9d9eb2d4c203bc5' },
    { sym: 'VGK',  name: 'Vanguard FTSE Europe ETF',        feed: '0x0648195b6826d833f3c4eb261c81223a90ceb3a26e86e9b18f6e11f0212cad18' },
    { sym: 'VXUS', name: 'Vanguard Total Intl Stock ETF',   feed: '0x48a13d42218646bba8cc114cd394a283b11c0e07dd14a885efd5caec640c5289' },
    { sym: 'SGOV', name: 'iShares 0-3M Treasury Bond ETF',  feed: '0x8d6a29bb5ed522931d711bb12c4bbf92af986936e52af582032913b5ffcbf4d5' },

    // Sector ETFs
    { sym: 'SMH',  name: 'VanEck Semiconductor ETF',        feed: '0x2487b620e66468404ba251bfaa6b8382774010cbb5d504ac48ec263e0b1934aa' },
    { sym: 'XLE',  name: 'Energy Select Sector SPDR',       feed: '0x8bf649e08e5a86129c57990556c8eec30e296069b524f4639549282bc5c07bb4' },
    { sym: 'XOP',  name: 'SPDR S&P Oil & Gas Exploration',  feed: '0xc706cce81639eed699bf23a427ea8742ac6e7cc775b2a8a8e70cba8a49393e42' },
    { sym: 'ITA',  name: 'iShares Aerospace & Defense ETF',  feed: '0x79f7f0b79a6b7fdc0d7d9e8b6337fd709b8eea9dc6f57b6174c84816cae88bfd' },

    // Mega-cap Tech
    { sym: 'AAPL', name: 'Apple',                           feed: '0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688' },
    { sym: 'NVDA', name: 'NVIDIA',                          feed: '0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593' },
    { sym: 'TSLA', name: 'Tesla',                           feed: '0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1' },
    { sym: 'DELL', name: 'Dell Technologies',               feed: '0xa2950270a22ce39a22cb3488ba91e60474cd93c6d01da2ecc5a97c1dd40f4995' },
    { sym: 'SMCI', name: 'Super Micro Computer',            feed: '0x8f34132a42f8bb7a47568d77a910f97174a30719e16904e9f2915d5b2c6c2d52' },
    { sym: 'ANET', name: 'Arista Networks',                 feed: '0x31cc7558642dc348a3e2894146a998031438de8ccc56b7af2171bcd5e5d83eda' },
    { sym: 'VRT',  name: 'Vertiv Holdings',                 feed: '0x84dad6b760396a7904d04a3d83039a3fc18f10819fd97d023ac5535997d70108' },
    { sym: 'SNDK', name: 'Sandisk',                         feed: '0xc86a1f20cd7d5d07932baea30bcd8e479b775c4f51f82526bf1de6dc79fa3f76' },

    // Semiconductors
    { sym: 'KLAC', name: 'KLA Corporation',                 feed: '0x9c27675f282bfe54b5d0a7b187b29b09184d32d4462de7e3060629c7b8895aad' },
    { sym: 'LRCX', name: 'Lam Research',                    feed: '0x01a67883f58bd0f0e9cf8f52f21d7cf78c144d7e7ae32ce9256420834b33fb75' },
    { sym: 'AMAT', name: 'Applied Materials',               feed: '0xb9bc74cc1243b706efacf664ed206d08ab1dda79e8b87752c7c44b3bdf1b9e08' },
    { sym: 'TER',  name: 'Teradyne',                        feed: '0x58ab181e7512766728d2cc3581839bbb913e6cd24457ba422cbe2a33df64416e' },

    // Energy & Infrastructure
    { sym: 'CEG',  name: 'Constellation Energy',            feed: '0xa541bc5c4b69961442e45e9198c7cce151ff9c2a1003f620c6d4a9785c77a4d9' },
    { sym: 'GEV',  name: 'GE Vernova',                      feed: '0x57e28b0f0ab18923f5c987629c0c714b9b46c87e729ed95ed6e23e466e8d1e0c' },
    { sym: 'SMR',  name: 'NuScale Power',                   feed: '0x69155365daba71df19c2c0416467b64581052cfa75f44b77f352a92698b81639' },
    { sym: 'ETN',  name: 'Eaton Corporation',               feed: '0xb1cf984febc32fbd98f0c5d31fed29d050d56a272406bae9de64dd94ba7e5e1e' },
    { sym: 'PWR',  name: 'Quanta Services',                 feed: '0xa189b9eee6d023e3b79a726804aeb748d54e52cf6ebcebe0f7d5c8dae4988357' },
    { sym: 'APLD', name: 'Applied Digital',                 feed: '0x7fc1e64946aff450748e8f60644d052ae787e5708dc48c6c73c546ee94218cc3' },

    // Commodities & Precious Metals
    { sym: 'SLV',  name: 'iShares Silver Trust',            feed: '0x6fc08c9963d266069cbd9780d98383dabf2668322a5bef0b9491e11d67e5d7e7' },
    { sym: 'PPLT', name: 'abrdn Physical Platinum',         feed: '0x782410278b6c8aa2d437812281526012808404aa14c243f73fb9939eeb88d430' },
    { sym: 'PALL', name: 'abrdn Physical Palladium',        feed: '0xfeeb371f721e75853604c47104967f0ab3fa92b988837013f5004f749a8a0599' },

    // Crypto-adjacent
    { sym: 'STRK', name: 'Strategy (MicroStrategy)',        feed: '0xcdea273301806de445b481e91a8dbe292ba23fcff8f7dec2053311555a0656c3' },
    { sym: 'BTGO', name: 'BitGo',                           feed: '0x6540ed0004047d446b252bc49bff9e23e667c5c7d0437ad0db8e120e7b19c311' },
];

function feedToUint256(feedHex: string): bigint {
    return BigInt(feedHex);
}

async function main() {
    // ── Validate env ──
    const mnemonic = process.env.DEPLOYER_MNEMONIC;
    if (!mnemonic) {
        console.error('ERROR: Set DEPLOYER_MNEMONIC environment variable');
        process.exit(1);
    }

    const factoryAddressStr = process.env.FACTORY_ADDRESS;
    if (!factoryAddressStr) {
        console.error('ERROR: Set FACTORY_ADDRESS environment variable');
        process.exit(1);
    }

    const usdcAddressStr = process.env.USDC_ADDRESS;
    if (!usdcAddressStr) {
        console.error('ERROR: Set USDC_ADDRESS environment variable');
        process.exit(1);
    }

    const endpoint = process.env.TON_ENDPOINT || 'https://testnet.toncenter.com/api/v2/jsonRPC';

    console.log('═══════════════════════════════════════════════════');
    console.log('  xLever — Deploy All 33 Vaults via Factory');
    console.log('═══════════════════════════════════════════════════');
    console.log(`Factory:  ${factoryAddressStr}`);
    console.log(`USDC:     ${usdcAddressStr}`);
    console.log(`Endpoint: ${endpoint}`);
    console.log(`Assets:   ${ASSETS.length}`);
    console.log('');

    // ── Derive deployer keys ──
    const mnemonicWords = mnemonic.split(' ');
    const keyPair = await mnemonicToPrivateKey(mnemonicWords);

    // ── Connect ──
    const client = new TonClient({ endpoint });
    const factoryAddress = Address.parse(factoryAddressStr);
    const usdcAddress = Address.parse(usdcAddressStr);

    // ── Deploy each vault ──
    // In production, each CreateVault message is sent as a wallet transfer.
    // The factory deploys the child vault contract deterministically.

    console.log('Vault deployment plan:');
    console.log('─────────────────────────────────────────────────');

    for (let i = 0; i < ASSETS.length; i++) {
        const asset = ASSETS[i];
        const feedId = feedToUint256(asset.feed);

        console.log(`  [${String(i + 1).padStart(2, '0')}/${ASSETS.length}] ${asset.sym.padEnd(5)} — ${asset.name}`);
        console.log(`         Feed: ${asset.feed.slice(0, 18)}...`);

        // NOTE: In production, this sends a real transaction:
        //
        //   const createVaultBody = beginCell()
        //       .storeUint(0x3001, 32)                    // CreateVault opcode
        //       .storeStringTail(asset.sym)
        //       .storeUint(feedId, 256)
        //       .storeAddress(usdcAddress)
        //       .storeUint(i, 64)                         // query_id
        //       .endCell();
        //
        //   await wallet.sendTransfer({
        //       secretKey: keyPair.secretKey,
        //       sendMode: SendMode.PAY_GAS_SEPARATELY,
        //       messages: [internal({
        //           to: factoryAddress,
        //           value: toNano('0.15'),
        //           body: createVaultBody,
        //       })],
        //   });
        //
        //   // Wait for confirmation
        //   await sleep(15000);
    }

    console.log('─────────────────────────────────────────────────');
    console.log(`\nAll ${ASSETS.length} vaults queued for deployment.`);
    console.log('\nTo execute:');
    console.log('  1. Build contracts:  npx @tact-lang/compiler');
    console.log('  2. Deploy factory:   npx ts-node scripts/deployFactory.ts');
    console.log('  3. Set FACTORY_ADDRESS env var to the deployed factory');
    console.log('  4. Uncomment the transaction sending code above');
    console.log('  5. Re-run this script');
}

main().catch(console.error);
