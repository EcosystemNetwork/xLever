/**
 * xLever Deploy & Seed Script
 * ───────────────────────────
 * 1. Deploy new TestERC20 (USDC) with secureMode=false so anyone can mint
 * 2. Mint 100,000 USDC to deployer
 * 3. Deploy TWAPOracles for SPY vault with deployer as updater
 * 4. Initialize oracles via initializeBuffer (fills all 75 slots in 1 tx)
 * 5. Seed deposits across vaults
 *
 * Usage: node scripts/deploy-and-seed.js
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, encodeDeployData, encodeAbiParameters } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'fs'

// Load .env
const envContent = readFileSync(new URL('../.env', import.meta.url), 'utf-8')
for (const line of envContent.split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
}

// Load compiled artifacts
const twapArtifact = JSON.parse(readFileSync(new URL('../contracts/out/TWAPOracle.sol/TWAPOracle.json', import.meta.url), 'utf-8'))
const erc20Artifact = JSON.parse(readFileSync(new URL('../contracts/out/TestERC20.sol/TestERC20.json', import.meta.url), 'utf-8'))

const inkSepolia = {
  id: 763373,
  name: 'Ink Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc-gel-sepolia.inkonchain.com'] } },
}

const account = privateKeyToAccount(process.env.PRIVATE_KEY)
const publicClient = createPublicClient({ chain: inkSepolia, transport: http() })
const walletClient = createWalletClient({ account, chain: inkSepolia, transport: http() })

const delay = ms => new Promise(r => setTimeout(r, ms))
const log = msg => console.log(`  ${msg}`)
const header = msg => console.log(`\n${'─'.repeat(50)}\n${msg}\n${'─'.repeat(50)}`)

// Existing vault addresses
const SPY_VAULT = '0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228'
const QQQ_VAULT = '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6'
const QQQ_FEED = '0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d'
const SPY_FEED = '0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5'
const PYTH_ADAPTER = '0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f'

// ABIs
const ERC20_ABI = [
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'mint', inputs: [{ name: 'who', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
]

const VAULT_ABI = [
  { type: 'function', name: 'deposit', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'leverageBps', type: 'int32' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'payable' },
  { type: 'function', name: 'withdraw', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'minReceived', type: 'uint256' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'payable' },
  { type: 'function', name: 'depositJunior', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'updateOracle', inputs: [{ name: 'priceUpdateData', type: 'bytes[]' }], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'getPoolState', inputs: [], outputs: [{ name: '', type: 'tuple', components: [
    { name: 'totalSeniorDeposits', type: 'uint128' }, { name: 'totalJuniorDeposits', type: 'uint128' },
    { name: 'insuranceFund', type: 'uint128' }, { name: 'netExposure', type: 'int256' },
    { name: 'grossLongExposure', type: 'uint128' }, { name: 'grossShortExposure', type: 'uint128' },
    { name: 'lastRebalanceTime', type: 'uint64' }, { name: 'currentMaxLeverageBps', type: 'uint32' },
    { name: 'fundingRateBps', type: 'int64' }, { name: 'protocolState', type: 'uint8' },
  ] }], stateMutability: 'view' },
]

const TWAP_ABI = [
  { type: 'function', name: 'initializeBuffer', inputs: [{ name: 'startPrice', type: 'uint128' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'updatePrice', inputs: [{ name: 'spotPrice', type: 'uint128' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getTWAP', inputs: [], outputs: [{ name: 'twap', type: 'uint128' }], stateMutability: 'view' },
  { type: 'function', name: 'getDivergence', inputs: [], outputs: [{ name: 'divergenceBps', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'updater', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'vault', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
]

const PYTH_ABI = [
  { type: 'function', name: 'getUpdateFee', inputs: [{ name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'fee', type: 'uint256' }], stateMutability: 'view' },
]

async function fetchPythUpdate(feedId) {
  const params = new URLSearchParams()
  params.append('ids[]', feedId.replace(/^0x/, ''))
  params.set('encoding', 'hex')
  const resp = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?${params}`)
  const data = await resp.json()
  return {
    updateData: data.binary.data.map(hex => '0x' + hex),
    price: data.parsed?.[0]?.price?.price ? Number(data.parsed[0].price.price) * Math.pow(10, data.parsed[0].price.expo) : 0,
  }
}

async function getPythFee(updateData) {
  try {
    const fee = await publicClient.readContract({ address: PYTH_ADAPTER, abi: PYTH_ABI, functionName: 'getUpdateFee', args: [updateData] })
    return fee + (fee / 10n)
  } catch { return parseUnits('0.001', 18) }
}

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  xLever Deploy & Seed')
  console.log('═══════════════════════════════════════════════════')

  const ethBal = await publicClient.getBalance({ address: account.address })
  log(`Deployer: ${account.address}`)
  log(`ETH: ${formatUnits(ethBal, 18)}`)

  // ─── Step 1: Deploy new USDC with secureMode=false ───
  header('Step 1: Deploy mintable USDC')

  // Constructor: (string name_, string symbol_, uint8 decimals_, bool secureMode_)
  const usdcHash = await walletClient.deployContract({
    abi: erc20Artifact.abi,
    bytecode: erc20Artifact.bytecode.object,
    args: ['USD Coin', 'USDC', 6, false],  // secureMode = false!
    chain: inkSepolia,
  })
  const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcHash })
  const newUSDC = usdcReceipt.contractAddress
  log(`New USDC deployed: ${newUSDC}`)
  log(`Tx: ${usdcHash}`)

  await delay(1000)

  // ─── Step 2: Mint 100,000 USDC ───
  header('Step 2: Mint USDC')

  const mintAmount = parseUnits('100000', 6)
  const mintHash = await walletClient.writeContract({
    address: newUSDC, abi: ERC20_ABI, functionName: 'mint',
    args: [account.address, mintAmount], chain: inkSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: mintHash })

  const bal = await publicClient.readContract({ address: newUSDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })
  log(`Minted: ${formatUnits(bal, 6)} USDC`)

  await delay(1000)

  // ─── Step 3: Deploy TWAPOracle for SPY vault ───
  header('Step 3: Deploy TWAPOracle for SPY')

  const spyOracleHash = await walletClient.deployContract({
    abi: twapArtifact.abi,
    bytecode: twapArtifact.bytecode.object,
    args: [account.address, SPY_VAULT],  // updater = deployer, vault = SPY vault
    chain: inkSepolia,
  })
  const spyOracleReceipt = await publicClient.waitForTransactionReceipt({ hash: spyOracleHash })
  const spyOracleAddr = spyOracleReceipt.contractAddress
  log(`SPY TWAPOracle deployed: ${spyOracleAddr}`)

  await delay(1000)

  // ─── Step 4: Initialize oracle buffer with current price ───
  header('Step 4: Initialize Oracle Buffers')

  // Fetch current SPY price from Pyth
  const { price: spyPrice } = await fetchPythUpdate(SPY_FEED)
  const spyPriceInt = BigInt(Math.round(spyPrice * 1e8)) // 8 decimal format
  log(`SPY price from Pyth: $${spyPrice} → ${spyPriceInt} (8 dec)`)

  if (spyPriceInt > 0n) {
    const initHash = await walletClient.writeContract({
      address: spyOracleAddr, abi: TWAP_ABI, functionName: 'initializeBuffer',
      args: [spyPriceInt], chain: inkSepolia,
    })
    await publicClient.waitForTransactionReceipt({ hash: initHash })
    log('SPY oracle buffer initialized (75 slots filled)')

    // Verify
    await delay(500)
    const twap = await publicClient.readContract({ address: spyOracleAddr, abi: TWAP_ABI, functionName: 'getTWAP' })
    const div = await publicClient.readContract({ address: spyOracleAddr, abi: TWAP_ABI, functionName: 'getDivergence' })
    log(`SPY TWAP: ${twap}, Divergence: ${div} bps`)
  }

  // Also check QQQ oracle status
  await delay(500)
  const qqqOracleAddr = '0x661B44636a24697480346C82C0aA8B899cADD0AA'
  try {
    const qqqTwap = await publicClient.readContract({ address: qqqOracleAddr, abi: TWAP_ABI, functionName: 'getTWAP' })
    const qqqDiv = await publicClient.readContract({ address: qqqOracleAddr, abi: TWAP_ABI, functionName: 'getDivergence' })
    log(`QQQ TWAP: ${qqqTwap}, Divergence: ${qqqDiv} bps`)
  } catch (e) {
    log(`QQQ oracle check failed: ${e.shortMessage || e.message}`)
  }

  // ─── Step 5: Seed deposits on QQQ vault (uses old USDC) ───
  header('Step 5: Seed QQQ Vault Deposits')

  const OLD_USDC = '0x6b57475467cd854d36Be7FB614caDa5207838943'
  const oldBal = await publicClient.readContract({ address: OLD_USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })
  log(`Old USDC balance: ${formatUnits(oldBal, 6)}`)

  // Use remaining old USDC for QQQ deposits
  if (oldBal > 0n) {
    // Junior deposit with whatever we have
    try {
      const approveH = await walletClient.writeContract({
        address: OLD_USDC, abi: ERC20_ABI, functionName: 'approve',
        args: [QQQ_VAULT, oldBal], chain: inkSepolia,
      })
      await publicClient.waitForTransactionReceipt({ hash: approveH })
      await delay(500)

      const jrH = await walletClient.writeContract({
        address: QQQ_VAULT, abi: VAULT_ABI, functionName: 'depositJunior',
        args: [oldBal], chain: inkSepolia,
      })
      await publicClient.waitForTransactionReceipt({ hash: jrH })
      log(`QQQ junior deposit: ${formatUnits(oldBal, 6)} USDC`)
    } catch (e) {
      log(`QQQ junior deposit failed: ${e.shortMessage || e.message}`)
    }
  }

  // Senior deposit with fresh Pyth data
  await delay(1000)
  try {
    const { updateData } = await fetchPythUpdate(QQQ_FEED)
    await delay(300)
    const fee = await getPythFee(updateData)

    // Use new USDC for a senior deposit (need to approve QQQ vault)
    const amt = parseUnits('100', 6)
    const aH = await walletClient.writeContract({
      address: newUSDC, abi: ERC20_ABI, functionName: 'approve',
      args: [QQQ_VAULT, amt], chain: inkSepolia,
    })
    await publicClient.waitForTransactionReceipt({ hash: aH })
    await delay(500)

    const dH = await walletClient.writeContract({
      address: QQQ_VAULT, abi: VAULT_ABI, functionName: 'deposit',
      args: [amt, 20000, updateData], value: fee, chain: inkSepolia,
    })
    await publicClient.waitForTransactionReceipt({ hash: dH })
    log('QQQ senior deposit: 100 USDC @ 2x long')
  } catch (e) {
    log(`QQQ senior deposit failed: ${e.shortMessage || e.message}`)
    log('(Note: QQQ vault uses old USDC address — new USDC wont work unless vault is reconfigured)')
  }

  // ─── Final state ───
  header('Final State')

  try {
    const pool = await publicClient.readContract({ address: QQQ_VAULT, abi: VAULT_ABI, functionName: 'getPoolState' })
    log(`QQQ — Senior: ${formatUnits(pool.totalSeniorDeposits, 6)} Junior: ${formatUnits(pool.totalJuniorDeposits, 6)}`)
    log(`  Insurance: ${formatUnits(pool.insuranceFund, 6)} Net Exposure: ${formatUnits(pool.netExposure, 6)}`)
  } catch (e) { log(`QQQ pool error: ${e.shortMessage || e.message}`) }

  await delay(500)
  try {
    const pool = await publicClient.readContract({ address: SPY_VAULT, abi: VAULT_ABI, functionName: 'getPoolState' })
    log(`SPY — Senior: ${formatUnits(pool.totalSeniorDeposits, 6)} Junior: ${formatUnits(pool.totalJuniorDeposits, 6)}`)
  } catch (e) { log(`SPY pool error: ${e.shortMessage || e.message}`) }

  log(`\nNew USDC address: ${newUSDC}`)
  log(`SPY TWAPOracle address: ${spyOracleAddr}`)

  console.log('\n═══════════════════════════════════════════════════')
  console.log('  Deploy & Seed Complete')
  console.log('═══════════════════════════════════════════════════')
}

main().catch(e => { console.error(e.message || e); process.exit(1) })
