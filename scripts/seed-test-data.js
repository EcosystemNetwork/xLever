/**
 * xLever Test Data Seeder — Phase 2 (Deposits)
 * ──────────────────────────────────────────────
 * QQQ oracle is already initialized (130+ updates pushed).
 * Now do the actual deposits/withdrawals to create on-chain activity.
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
const QQQ_VAULT = '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6'
const SPY_VAULT = '0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228'
const QQQ_FEED = '0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d'

// ── ABIs ──

const ERC20_ABI = [
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
]

const VAULT_ABI = [
  { type: 'function', name: 'deposit', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'leverageBps', type: 'int32' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'payable' },
  { type: 'function', name: 'withdraw', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'minReceived', type: 'uint256' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'payable' },
  { type: 'function', name: 'depositJunior', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable' },
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

const ORACLE_ABI = [
  { type: 'function', name: 'getTWAP', inputs: [], outputs: [{ name: 'twap', type: 'uint128' }], stateMutability: 'view' },
  { type: 'function', name: 'getSpotPrice', inputs: [], outputs: [{ name: 'spot', type: 'uint128' }], stateMutability: 'view' },
  { type: 'function', name: 'getDivergence', inputs: [], outputs: [{ name: 'divergenceBps', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'hasSufficientUpdates', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'isStale', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
]

// ── Pyth Hermes ──

async function fetchPythUpdate(feedId) {
  const params = new URLSearchParams()
  params.append('ids[]', feedId.replace(/^0x/, ''))
  params.set('encoding', 'hex')
  const resp = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?${params}`)
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
    return fee + (fee / 10n)
  } catch {
    return parseUnits('0.001', 18)
  }
}

// ── Helpers ──

function log(msg) { console.log(`  ${msg}`) }
function header(msg) { console.log(`\n${'─'.repeat(50)}\n${msg}\n${'─'.repeat(50)}`) }

const delay = (ms) => new Promise(r => setTimeout(r, ms))

// ── Main ──

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  xLever Test Data Seeder — Phase 2')
  console.log('═══════════════════════════════════════════════════')

  const account = privateKeyToAccount(process.env.PRIVATE_KEY)
  const publicClient = createPublicClient({ chain: inkSepolia, transport: http() })
  const walletClient = createWalletClient({ account, chain: inkSepolia, transport: http() })

  // Check balances
  const ethBalance = await publicClient.getBalance({ address: account.address })
  await delay(500)
  const usdcBalance = await publicClient.readContract({
    address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  })

  log(`Address: ${account.address}`)
  log(`ETH: ${formatUnits(ethBalance, 18)}`)
  log(`USDC: ${formatUnits(usdcBalance, 6)}`)

  // ─── Check QQQ oracle state ───
  header('Oracle Status')
  await delay(500)

  const oracleAddr = '0x661B44636a24697480346C82C0aA8B899cADD0AA' // from earlier query
  try {
    const twap = await publicClient.readContract({ address: oracleAddr, abi: ORACLE_ABI, functionName: 'getTWAP' })
    await delay(300)
    const spot = await publicClient.readContract({ address: oracleAddr, abi: ORACLE_ABI, functionName: 'getSpotPrice' })
    await delay(300)
    const div = await publicClient.readContract({ address: oracleAddr, abi: ORACLE_ABI, functionName: 'getDivergence' })
    log(`QQQ Oracle — TWAP: ${twap} Spot: ${spot} Divergence: ${div} bps`)

    if (div > 300n) {
      log(`Divergence too high (${div} > 300 bps). Need more oracle updates.`)
      log('Pushing additional oracle updates to fill TWAP buffer...')

      // Fill remaining buffer slots
      const needed = div > 1000n ? 75 : 20
      for (let i = 0; i < needed; i++) {
        try {
          const updateData = await fetchPythUpdate(QQQ_FEED)
          await delay(300)
          const fee = await getPythFee(publicClient, updateData)
          await delay(300)
          const hash = await walletClient.writeContract({
            address: QQQ_VAULT, abi: VAULT_ABI, functionName: 'updateOracle',
            args: [updateData], value: fee, chain: inkSepolia,
          })
          await publicClient.waitForTransactionReceipt({ hash })
          if ((i + 1) % 10 === 0) log(`  Oracle updates: ${i + 1}/${needed}`)
          await delay(500) // Rate limit protection
        } catch (e) {
          log(`  Update ${i + 1} failed: ${e.shortMessage || e.message}`)
          await delay(2000)
        }
      }

      // Re-check divergence
      await delay(1000)
      const newDiv = await publicClient.readContract({ address: oracleAddr, abi: ORACLE_ABI, functionName: 'getDivergence' })
      log(`New divergence: ${newDiv} bps`)
      if (newDiv > 300n) {
        log('Still too high — deposits will fail. Try running again later.')
        process.exit(1)
      }
    }
  } catch (e) {
    log(`Oracle check failed: ${e.shortMessage || e.message}`)
    log('Continuing anyway — deposits will reveal if oracle is ready')
  }

  // ─── QQQ Pool State ───
  header('Current Pool State')
  await delay(500)
  try {
    const pool = await publicClient.readContract({ address: QQQ_VAULT, abi: VAULT_ABI, functionName: 'getPoolState' })
    log(`QQQ — Senior: ${formatUnits(pool.totalSeniorDeposits, 6)} Junior: ${formatUnits(pool.totalJuniorDeposits, 6)} MaxLev: ${Number(pool.currentMaxLeverageBps) / 10000}x`)
  } catch (e) {
    log(`Pool state error: ${e.shortMessage || e.message}`)
  }

  let success = 0, failed = 0
  const track = (r) => r ? success++ : failed++

  const usdcAvail = Number(formatUnits(usdcBalance, 6))

  // ─── Junior LP deposit (if not already done) ───
  header('Junior LP Deposit')
  await delay(1000)

  const juniorAmt = Math.floor(usdcAvail * 0.20)
  if (juniorAmt >= 1) {
    try {
      const amt = parseUnits(String(juniorAmt), 6)
      const approveHash = await walletClient.writeContract({
        address: USDC, abi: ERC20_ABI, functionName: 'approve',
        args: [QQQ_VAULT, amt], chain: inkSepolia,
      })
      await publicClient.waitForTransactionReceipt({ hash: approveHash })
      await delay(500)

      const hash = await walletClient.writeContract({
        address: QQQ_VAULT, abi: VAULT_ABI, functionName: 'depositJunior',
        args: [amt], chain: inkSepolia,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      log(`✓ QQQ junior: ${juniorAmt} USDC (tx: ${hash.slice(0, 10)}...)`)
      track(receipt)
    } catch (e) {
      log(`✗ QQQ junior: ${e.shortMessage || e.message}`)
      track(null)
    }
  }

  // ─── Senior Deposit: QQQ 2x long ───
  header('Senior Deposit: QQQ 2x Long')
  await delay(1000)

  // Recheck USDC
  const usdcNow = await publicClient.readContract({
    address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  })
  const usdcRemaining = Number(formatUnits(usdcNow, 6))
  log(`USDC remaining: ${usdcRemaining}`)

  const depositAmt = Math.floor(usdcRemaining * 0.5)
  if (depositAmt >= 1) {
    try {
      const amt = parseUnits(String(depositAmt), 6)

      // Approve
      const approveHash = await walletClient.writeContract({
        address: USDC, abi: ERC20_ABI, functionName: 'approve',
        args: [QQQ_VAULT, amt], chain: inkSepolia,
      })
      await publicClient.waitForTransactionReceipt({ hash: approveHash })
      await delay(500)

      // Fetch fresh Pyth data
      const updateData = await fetchPythUpdate(QQQ_FEED)
      await delay(300)
      const fee = await getPythFee(publicClient, updateData)

      // Deposit with 2x long
      const hash = await walletClient.writeContract({
        address: QQQ_VAULT, abi: VAULT_ABI, functionName: 'deposit',
        args: [amt, 20000, updateData], value: fee, chain: inkSepolia,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      log(`✓ QQQ 2x long: ${depositAmt} USDC (tx: ${hash.slice(0, 10)}...)`)
      track(receipt)
    } catch (e) {
      log(`✗ QQQ 2x long: ${e.shortMessage || e.message}`)
      track(null)
    }
  }

  // ─── Check position ───
  header('Position Check')
  await delay(1000)
  try {
    const pos = await publicClient.readContract({
      address: QQQ_VAULT, abi: VAULT_ABI, functionName: 'getPosition', args: [account.address],
    })
    log(`Position: deposit=${formatUnits(pos.depositAmount, 6)} leverage=${Number(pos.leverageBps) / 10000}x active=${pos.isActive}`)
  } catch (e) {
    log(`Position error: ${e.shortMessage || e.message}`)
  }

  // ─── Final pool state ───
  header('Final Pool State')
  await delay(500)
  try {
    const pool = await publicClient.readContract({ address: QQQ_VAULT, abi: VAULT_ABI, functionName: 'getPoolState' })
    log(`QQQ — Senior: ${formatUnits(pool.totalSeniorDeposits, 6)} Junior: ${formatUnits(pool.totalJuniorDeposits, 6)}`)
    log(`  Net Exposure: ${formatUnits(pool.netExposure, 6)} Gross Long: ${formatUnits(pool.grossLongExposure, 6)}`)
    log(`  Max Leverage: ${Number(pool.currentMaxLeverageBps) / 10000}x State: ${['Active', 'Stressed', 'Paused', 'Emergency'][pool.protocolState]}`)
  } catch (e) {
    log(`Pool state error: ${e.shortMessage || e.message}`)
  }

  console.log('\n═══════════════════════════════════════════════════')
  console.log(`  Done! ${success} succeeded, ${failed} failed`)
  console.log('═══════════════════════════════════════════════════')
}

main().catch(e => { console.error(e.message || e); process.exit(1) })
