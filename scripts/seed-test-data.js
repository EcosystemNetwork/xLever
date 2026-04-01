/**
 * xLever Test Data Seeder
 * ────────────────────────
 * Sends real transactions on Ink Sepolia to populate vaults with
 * senior deposits, junior LP deposits, and withdrawals.
 *
 * Handles Pyth oracle initialization (5+ price updates required)
 * before deposits can succeed.
 *
 * Usage: node scripts/seed-test-data.js
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'fs'

// Load .env manually
const envContent = readFileSync(new URL('../.env', import.meta.url), 'utf-8')
for (const line of envContent.split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
}

// ── Chain ──

const inkSepolia = {
  id: 763373,
  name: 'Ink Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc-gel-sepolia.inkonchain.com'] } },
}

// ── Addresses ──

const USDC = '0x6b57475467cd854d36Be7FB614caDa5207838943'
const PYTH_ADAPTER = '0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f'

// Vault address → Pyth feed ID mapping
// Focus on QQQ first (already has 6/75 oracle updates) then others if ETH allows
const VAULT_FEEDS = {
  QQQ:  { vault: '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6', feed: '0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d' },
  SPY:  { vault: '0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228', feed: '0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5' },
}

// ── ABIs ──

const ERC20_ABI = [
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
]

const VAULT_ABI = [
  { type: 'function', name: 'deposit', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'leverageBps', type: 'int32' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'payable' },
  { type: 'function', name: 'withdraw', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'minReceived', type: 'uint256' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'payable' },
  { type: 'function', name: 'depositJunior', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'withdrawJunior', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: 'amount', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'updateOracle', inputs: [{ name: 'priceUpdateData', type: 'bytes[]' }], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'getPosition', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'tuple', components: [
    { name: 'depositAmount', type: 'uint128' }, { name: 'leverageBps', type: 'int32' },
    { name: 'entryTWAP', type: 'uint128' }, { name: 'lastFeeTimestamp', type: 'uint64' },
    { name: 'settledFees', type: 'uint128' }, { name: 'leverageLockExpiry', type: 'uint32' },
    { name: 'isActive', type: 'bool' },
  ] }], stateMutability: 'view' },
  { type: 'function', name: 'getPoolState', inputs: [], outputs: [{ name: '', type: 'tuple', components: [
    { name: 'totalSeniorDeposits', type: 'uint128' }, { name: 'totalJuniorDeposits', type: 'uint128' },
    { name: 'insuranceFund', type: 'uint128' }, { name: 'netExposure', type: 'int256' },
    { name: 'grossLongExposure', type: 'uint128' }, { name: 'grossShortExposure', type: 'uint128' },
    { name: 'lastRebalanceTime', type: 'uint64' }, { name: 'currentMaxLeverageBps', type: 'uint32' },
    { name: 'fundingRateBps', type: 'int64' }, { name: 'protocolState', type: 'uint8' },
  ] }], stateMutability: 'view' },
]

const PYTH_ADAPTER_ABI = [
  { type: 'function', name: 'getUpdateFee', inputs: [{ name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'fee', type: 'uint256' }], stateMutability: 'view' },
]

// ── Pyth Hermes ──

const HERMES_BASE = 'https://hermes.pyth.network'

async function fetchPythUpdate(feedId) {
  const params = new URLSearchParams()
  params.append('ids[]', feedId.replace(/^0x/, ''))
  params.set('encoding', 'hex')
  const resp = await fetch(`${HERMES_BASE}/v2/updates/price/latest?${params}`)
  if (!resp.ok) throw new Error(`Hermes error: ${resp.status}`)
  const data = await resp.json()
  return data.binary.data.map(hex => '0x' + hex)
}

async function getPythFee(publicClient, updateData) {
  try {
    const fee = await publicClient.readContract({
      address: PYTH_ADAPTER, abi: PYTH_ADAPTER_ABI,
      functionName: 'getUpdateFee', args: [updateData],
    })
    return fee + (fee / 10n) // 10% buffer
  } catch {
    return parseUnits('0.001', 18) // safe default
  }
}

// ── Helpers ──

function log(msg) { console.log(`  ${msg}`) }
function header(msg) { console.log(`\n${'─'.repeat(50)}\n${msg}\n${'─'.repeat(50)}`) }

async function initializeOracle(walletClient, publicClient, vault, feedId, label) {
  // TWAP buffer has 75 slots — need to fill all of them so TWAP ≈ spot price
  // (otherwise divergence = huge because empty slots = 0)
  const BUFFER_SIZE = 75
  log(`Initializing oracle for ${label} (${BUFFER_SIZE} updates to fill TWAP buffer)...`)

  let successCount = 0
  for (let i = 0; i < BUFFER_SIZE; i++) {
    try {
      const updateData = await fetchPythUpdate(feedId)
      const fee = await getPythFee(publicClient, updateData)
      const hash = await walletClient.writeContract({
        address: vault, abi: VAULT_ABI, functionName: 'updateOracle',
        args: [updateData], value: fee, chain: inkSepolia,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      successCount++
      if (successCount % 10 === 0 || i === BUFFER_SIZE - 1) {
        log(`  Oracle updates: ${successCount}/${BUFFER_SIZE}`)
      }
    } catch (e) {
      log(`  Oracle update ${i + 1} ✗: ${e.shortMessage || e.message}`)
      // If "Not authorized", this vault's oracle doesn't accept our address — bail
      if (e.message?.includes('Not authorized') || e.shortMessage?.includes('Not authorized')) {
        log(`  Skipping ${label} — not authorized as oracle updater`)
        return false
      }
    }
  }
  log(`  Oracle initialized: ${successCount}/${BUFFER_SIZE} updates`)
  return successCount >= 5
}

async function seniorDeposit(walletClient, publicClient, vault, feedId, amount, leverageBps, label) {
  try {
    // Approve
    const approveHash = await walletClient.writeContract({
      address: USDC, abi: ERC20_ABI, functionName: 'approve',
      args: [vault, amount], chain: inkSepolia,
    })
    await publicClient.waitForTransactionReceipt({ hash: approveHash })

    // Fetch fresh Pyth data
    const updateData = await fetchPythUpdate(feedId)
    const fee = await getPythFee(publicClient, updateData)

    // Deposit
    const hash = await walletClient.writeContract({
      address: vault, abi: VAULT_ABI, functionName: 'deposit',
      args: [amount, leverageBps, updateData], value: fee, chain: inkSepolia,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    log(`✓ ${label}: ${formatUnits(amount, 6)} USDC @ ${leverageBps / 10000}x (tx: ${hash.slice(0, 10)}...)`)
    return receipt
  } catch (e) {
    log(`✗ ${label}: ${e.shortMessage || e.message}`)
    return null
  }
}

async function juniorDeposit(walletClient, publicClient, vault, amount, label) {
  try {
    const approveHash = await walletClient.writeContract({
      address: USDC, abi: ERC20_ABI, functionName: 'approve',
      args: [vault, amount], chain: inkSepolia,
    })
    await publicClient.waitForTransactionReceipt({ hash: approveHash })

    const hash = await walletClient.writeContract({
      address: vault, abi: VAULT_ABI, functionName: 'depositJunior',
      args: [amount], chain: inkSepolia,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    log(`✓ ${label} junior: ${formatUnits(amount, 6)} USDC (tx: ${hash.slice(0, 10)}...)`)
    return receipt
  } catch (e) {
    log(`✗ ${label} junior: ${e.shortMessage || e.message}`)
    return null
  }
}

async function doWithdraw(walletClient, publicClient, vault, feedId, amount, label) {
  try {
    const updateData = await fetchPythUpdate(feedId)
    const fee = await getPythFee(publicClient, updateData)

    const hash = await walletClient.writeContract({
      address: vault, abi: VAULT_ABI, functionName: 'withdraw',
      args: [amount, 0n, updateData], value: fee, chain: inkSepolia,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    log(`✓ ${label} withdraw: ${formatUnits(amount, 6)} USDC (tx: ${hash.slice(0, 10)}...)`)
    return receipt
  } catch (e) {
    log(`✗ ${label} withdraw: ${e.shortMessage || e.message}`)
    return null
  }
}

// ── Main ──

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  xLever Test Data Seeder — Ink Sepolia')
  console.log('═══════════════════════════════════════════════════')

  if (!process.env.PRIVATE_KEY) {
    console.error('ERROR: PRIVATE_KEY not set in .env')
    process.exit(1)
  }

  const account = privateKeyToAccount(process.env.PRIVATE_KEY)
  const publicClient = createPublicClient({ chain: inkSepolia, transport: http() })
  const walletClient = createWalletClient({ account, chain: inkSepolia, transport: http() })

  const ethBalance = await publicClient.getBalance({ address: account.address })
  const usdcBalance = await publicClient.readContract({
    address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  })

  log(`Address: ${account.address}`)
  log(`ETH: ${formatUnits(ethBalance, 18)}`)
  log(`USDC: ${formatUnits(usdcBalance, 6)}`)

  if (ethBalance === 0n) {
    console.error('No ETH for gas — exiting')
    process.exit(1)
  }

  const usdcAvailable = Number(formatUnits(usdcBalance, 6))
  log(`Available USDC: ${usdcAvailable}`)

  let success = 0, failed = 0
  const track = (r) => r ? success++ : failed++

  // ─── Step 1: Initialize oracles for all vaults ───
  header('Step 1: Initialize Oracles (5+ updates each)')

  for (const [sym, { vault, feed }] of Object.entries(VAULT_FEEDS)) {
    await initializeOracle(walletClient, publicClient, vault, feed, sym)
  }

  // ─── Step 2: Junior LP deposits first (needed as buffer for senior) ───
  header('Step 2: Junior LP Deposits')

  // Use ~40% of USDC for junior deposits across 2-3 vaults
  const juniorAmountPer = Math.floor(usdcAvailable * 0.12) // ~12% each
  if (juniorAmountPer >= 1) {
    for (const [sym, { vault }] of Object.entries(VAULT_FEEDS)) {
      track(await juniorDeposit(walletClient, publicClient, vault, parseUnits(String(juniorAmountPer), 6), sym))
    }
  }

  // ─── Step 3: Senior deposits with various leverages ───
  header('Step 3: Senior Deposits')

  // Re-check USDC after junior deposits
  const usdcAfterJunior = await publicClient.readContract({
    address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  })
  const remainingUsdc = Number(formatUnits(usdcAfterJunior, 6))
  log(`Remaining USDC: ${remainingUsdc}`)

  const seniorTxs = [
    { sym: 'QQQ',  lev: 20000,  label: 'QQQ 2x long',   pct: 0.35 },
    { sym: 'QQQ',  lev: -15000, label: 'QQQ 1.5x short', pct: 0.15 },
    { sym: 'SPY',  lev: 30000,  label: 'SPY 3x long',   pct: 0.30 },
    { sym: 'SPY',  lev: -20000, label: 'SPY 2x short',  pct: 0.15 },
  ]

  for (const tx of seniorTxs) {
    const amt = Math.floor(remainingUsdc * tx.pct)
    if (amt < 1) { log(`Skipping ${tx.label} — insufficient USDC`); continue }
    const { vault, feed } = VAULT_FEEDS[tx.sym]
    track(await seniorDeposit(walletClient, publicClient, vault, feed, parseUnits(String(amt), 6), tx.lev, tx.label))
  }

  // ─── Step 4: Partial withdrawal ───
  header('Step 4: Partial Withdrawal')

  const { vault: qqqVault, feed: qqqFeed } = VAULT_FEEDS.QQQ
  track(await doWithdraw(walletClient, publicClient, qqqVault, qqqFeed, parseUnits('1', 6), 'QQQ'))

  // ─── Step 5: Final state ───
  header('Final Pool States')

  for (const [sym, { vault }] of Object.entries(VAULT_FEEDS)) {
    try {
      const pool = await publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: 'getPoolState' })
      log(`${sym}: Senior=${formatUnits(pool.totalSeniorDeposits, 6)} Junior=${formatUnits(pool.totalJuniorDeposits, 6)} MaxLev=${Number(pool.currentMaxLeverageBps) / 10000}x`)
    } catch {
      log(`${sym}: could not read pool state`)
    }
  }

  console.log('\n═══════════════════════════════════════════════════')
  console.log(`  Done! ${success} succeeded, ${failed} failed`)
  console.log('═══════════════════════════════════════════════════')
}

main().catch(e => { console.error(e); process.exit(1) })
