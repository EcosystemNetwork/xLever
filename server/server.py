#!/usr/bin/env python3
"""
xLever Backend Server
- Static file serving for the frontend
- Yahoo Finance proxy (for research/backtest mode)
- Live protocol endpoints: pool state, positions, fees, oracle status
  sourced from on-chain contract reads via web3
"""
import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import os
import threading
import time
from pathlib import Path

from web3 import Web3

PORT = 8000

# ═══════════════════════════════════════════════════════════════
# CHAIN CONFIG — Ink Sepolia (primary deployment)
# ═══════════════════════════════════════════════════════════════

RPC_URL = os.environ.get('RPC_URL', 'https://rpc-gel-sepolia.inkonchain.com')
w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={'timeout': 10}))

# Vault addresses (deployed Full Vault with Junior Tranche)
VAULT_ADDRESSES = {
    'wQQQx': '0xd76378af8494eafa6251d13dcbcaa4f39e70b90b',
    'wSPYx': '0x6bbb5fe4f82b14bd29fd8d7b9cc1f45a6e19c3dd',
}

# Pyth Hermes API for oracle prices
PYTH_HERMES_URL = 'https://hermes.pyth.network'
PYTH_FEEDS = {
    'QQQ': '0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d',
    'SPY': '0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5',
}

# ═══════════════════════════════════════════════════════════════
# VAULT ABI (read-only functions for live state)
# ═══════════════════════════════════════════════════════════════

VAULT_ABI = json.loads('''[
  {
    "name": "getPoolState",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{
      "name": "",
      "type": "tuple",
      "components": [
        {"name": "totalSeniorDeposits", "type": "uint256"},
        {"name": "totalJuniorDeposits", "type": "uint256"},
        {"name": "insuranceFund", "type": "uint256"},
        {"name": "netExposure", "type": "int256"},
        {"name": "grossLongExposure", "type": "uint256"},
        {"name": "grossShortExposure", "type": "uint256"},
        {"name": "lastRebalanceTime", "type": "uint256"},
        {"name": "currentMaxLeverageBps", "type": "uint256"},
        {"name": "fundingRateBps", "type": "int256"},
        {"name": "protocolState", "type": "uint8"}
      ]
    }]
  },
  {
    "name": "getPosition",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{"name": "user", "type": "address"}],
    "outputs": [{
      "name": "",
      "type": "tuple",
      "components": [
        {"name": "depositAmount", "type": "uint128"},
        {"name": "leverageBps", "type": "int32"},
        {"name": "entryTWAP", "type": "uint128"},
        {"name": "lastFeeTimestamp", "type": "uint64"},
        {"name": "settledFees", "type": "uint128"},
        {"name": "leverageLockExpiry", "type": "uint32"},
        {"name": "isActive", "type": "bool"}
      ]
    }]
  },
  {
    "name": "getPositionValue",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{"name": "user", "type": "address"}],
    "outputs": [
      {"name": "value", "type": "uint256"},
      {"name": "pnl", "type": "int256"}
    ]
  },
  {
    "name": "getCurrentTWAP",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {"name": "twap", "type": "uint256"},
      {"name": "spreadBps", "type": "uint256"}
    ]
  },
  {
    "name": "getMaxLeverage",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{"name": "maxLeverageBps", "type": "uint256"}]
  },
  {
    "name": "getFundingRate",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{"name": "", "type": "int256"}]
  },
  {
    "name": "getCarryRate",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{"name": "", "type": "int256"}]
  },
  {
    "name": "getJuniorValue",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {"name": "totalValue", "type": "uint256"},
      {"name": "sharePrice", "type": "uint256"}
    ]
  },
  {
    "name": "getOracleState",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{
      "name": "",
      "type": "tuple",
      "components": [
        {"name": "executionPrice", "type": "uint256"},
        {"name": "displayPrice", "type": "uint256"},
        {"name": "riskPrice", "type": "uint256"},
        {"name": "divergenceBps", "type": "uint256"},
        {"name": "spreadBps", "type": "uint256"},
        {"name": "isFresh", "type": "bool"},
        {"name": "isCircuitBroken", "type": "bool"},
        {"name": "lastUpdateTime", "type": "uint256"},
        {"name": "updateCount", "type": "uint256"}
      ]
    }]
  }
]''')


def get_vault_contract(symbol):
    """Get a web3 contract instance for the given vault symbol."""
    addr = VAULT_ADDRESSES.get(symbol)
    if not addr:
        return None
    return w3.eth.contract(address=Web3.to_checksum_address(addr), abi=VAULT_ABI)


# ═══════════════════════════════════════════════════════════════
# LIVE STATE CACHE — polled in background to avoid blocking requests
# ═══════════════════════════════════════════════════════════════

_live_cache = {}
_cache_lock = threading.Lock()
CACHE_TTL = 15  # seconds


def _read_pool_state(symbol):
    """Read pool state from on-chain vault contract."""
    contract = get_vault_contract(symbol)
    if not contract:
        return None
    try:
        ps = contract.functions.getPoolState().call()
        return {
            'totalSeniorDeposits': str(ps[0]),
            'totalJuniorDeposits': str(ps[1]),
            'insuranceFund': str(ps[2]),
            'netExposure': str(ps[3]),
            'grossLongExposure': str(ps[4]),
            'grossShortExposure': str(ps[5]),
            'lastRebalanceTime': ps[6],
            'currentMaxLeverageBps': ps[7],
            'fundingRateBps': str(ps[8]),
            'protocolState': ps[9],
        }
    except Exception as e:
        print(f'[pool_state] {symbol} read failed: {e}')
        return None


def _read_oracle_state(symbol):
    """Read oracle state from on-chain vault contract."""
    contract = get_vault_contract(symbol)
    if not contract:
        return None
    try:
        os_data = contract.functions.getOracleState().call()
        return {
            'executionPrice': str(os_data[0]),
            'displayPrice': str(os_data[1]),
            'riskPrice': str(os_data[2]),
            'divergenceBps': os_data[3],
            'spreadBps': os_data[4],
            'isFresh': os_data[5],
            'isCircuitBroken': os_data[6],
            'lastUpdateTime': os_data[7],
            'updateCount': os_data[8],
        }
    except Exception as e:
        print(f'[oracle_state] {symbol} read failed: {e}')
        return None


def _read_junior_value(symbol):
    """Read junior tranche value from on-chain vault contract."""
    contract = get_vault_contract(symbol)
    if not contract:
        return None
    try:
        jv = contract.functions.getJuniorValue().call()
        return {
            'totalValue': str(jv[0]),
            'sharePrice': str(jv[1]),
        }
    except Exception as e:
        print(f'[junior_value] {symbol} read failed: {e}')
        return None


def _read_fee_state(symbol):
    """Read fee-related state from on-chain vault contract."""
    contract = get_vault_contract(symbol)
    if not contract:
        return None
    result = {}
    try:
        fr = contract.functions.getFundingRate().call()
        result['fundingRateBps'] = str(fr)
    except Exception:
        result['fundingRateBps'] = None
    try:
        cr = contract.functions.getCarryRate().call()
        result['carryRateBps'] = str(cr)
    except Exception:
        result['carryRateBps'] = None
    try:
        ml = contract.functions.getMaxLeverage().call()
        result['maxLeverageBps'] = ml
    except Exception:
        result['maxLeverageBps'] = None
    try:
        twap = contract.functions.getCurrentTWAP().call()
        result['twap'] = str(twap[0])
        result['twapSpreadBps'] = twap[1]
    except Exception:
        result['twap'] = None
        result['twapSpreadBps'] = None
    return result


def _fetch_pyth_price(symbol):
    """Fetch latest price from Pyth Hermes API."""
    feed_id = PYTH_FEEDS.get(symbol)
    if not feed_id:
        return None
    try:
        url = f'{PYTH_HERMES_URL}/v2/updates/price/latest?ids[]={feed_id}'
        req = urllib.request.Request(url)
        req.add_header('Accept', 'application/json')
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            if data.get('parsed') and len(data['parsed']) > 0:
                p = data['parsed'][0]['price']
                price = int(p['price']) * (10 ** int(p['expo']))
                return {
                    'price': price,
                    'conf': int(p['conf']) * (10 ** int(p['expo'])),
                    'publishTime': p.get('publish_time'),
                }
    except Exception as e:
        print(f'[pyth] {symbol} fetch failed: {e}')
    return None


def _refresh_cache():
    """Background thread: poll all live state every CACHE_TTL seconds."""
    while True:
        new_cache = {'_timestamp': time.time()}
        for symbol in VAULT_ADDRESSES:
            ticker = symbol.replace('w', '').replace('x', '')  # wQQQx -> QQQ
            new_cache[f'pool_{ticker}'] = _read_pool_state(symbol)
            new_cache[f'oracle_{ticker}'] = _read_oracle_state(symbol)
            new_cache[f'junior_{ticker}'] = _read_junior_value(symbol)
            new_cache[f'fees_{ticker}'] = _read_fee_state(symbol)
            new_cache[f'pyth_{ticker}'] = _fetch_pyth_price(ticker)
        with _cache_lock:
            _live_cache.update(new_cache)
        print(f'[cache] refreshed at {time.strftime("%H:%M:%S")}')
        time.sleep(CACHE_TTL)


def get_cached(key):
    with _cache_lock:
        return _live_cache.get(key)


# ═══════════════════════════════════════════════════════════════
# HTTP HANDLER
# ═══════════════════════════════════════════════════════════════

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    ALLOWED_ORIGINS = {
        'http://localhost:8080', 'http://localhost:5173',
        'http://localhost:3000', 'https://xlever.markets',
    }

    def end_headers(self):
        origin = self.headers.get('Origin', '')
        if origin in self.ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
        else:
            self.send_header('Access-Control-Allow-Origin', 'http://localhost:5173')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        origin = self.headers.get('Origin', '')
        if origin in self.ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
        else:
            self.send_header('Access-Control-Allow-Origin', 'http://localhost:5173')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/yahoo/'):
            self.proxy_yahoo_finance()
        elif self.path.startswith('/api/live/pool/'):
            self.handle_pool_state()
        elif self.path.startswith('/api/live/oracle/'):
            self.handle_oracle_state()
        elif self.path.startswith('/api/live/junior/'):
            self.handle_junior_value()
        elif self.path.startswith('/api/live/fees/'):
            self.handle_fee_state()
        elif self.path.startswith('/api/live/position/'):
            self.handle_position()
        elif self.path == '/api/live/summary':
            self.handle_summary()
        elif self.path.startswith('/api/live/pyth/'):
            self.handle_pyth_price()
        else:
            super().do_GET()

    # ── JSON helpers ──

    def _json_response(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def _extract_symbol(self, prefix):
        """Extract symbol from path like /api/live/pool/QQQ -> QQQ"""
        path = self.path.split('?')[0]
        return path.replace(prefix, '').strip('/')

    # ── Live protocol endpoints ──

    def handle_pool_state(self):
        symbol = self._extract_symbol('/api/live/pool/')
        data = get_cached(f'pool_{symbol}')
        if data is None:
            self._json_response({'error': f'No pool data for {symbol}', 'source': 'cache_miss'}, 404)
        else:
            self._json_response({'symbol': symbol, 'source': 'contract', **data})

    def handle_oracle_state(self):
        symbol = self._extract_symbol('/api/live/oracle/')
        data = get_cached(f'oracle_{symbol}')
        if data is None:
            self._json_response({'error': f'No oracle data for {symbol}', 'source': 'cache_miss'}, 404)
        else:
            self._json_response({'symbol': symbol, 'source': 'contract', **data})

    def handle_junior_value(self):
        symbol = self._extract_symbol('/api/live/junior/')
        data = get_cached(f'junior_{symbol}')
        if data is None:
            self._json_response({'error': f'No junior data for {symbol}', 'source': 'cache_miss'}, 404)
        else:
            self._json_response({'symbol': symbol, 'source': 'contract', **data})

    def handle_fee_state(self):
        symbol = self._extract_symbol('/api/live/fees/')
        data = get_cached(f'fees_{symbol}')
        if data is None:
            self._json_response({'error': f'No fee data for {symbol}', 'source': 'cache_miss'}, 404)
        else:
            self._json_response({'symbol': symbol, 'source': 'contract', **data})

    def handle_pyth_price(self):
        symbol = self._extract_symbol('/api/live/pyth/')
        data = get_cached(f'pyth_{symbol}')
        if data is None:
            self._json_response({'error': f'No pyth data for {symbol}', 'source': 'cache_miss'}, 404)
        else:
            self._json_response({'symbol': symbol, 'source': 'pyth_hermes', **data})

    def handle_position(self):
        """Read a user's position from on-chain. /api/live/position/QQQ?user=0x..."""
        symbol = self._extract_symbol('/api/live/position/')
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        user = params.get('user', [None])[0]
        if not user:
            self._json_response({'error': 'Missing ?user=0x... parameter'}, 400)
            return

        vault_key = f'w{symbol}x'
        contract = get_vault_contract(vault_key)
        if not contract:
            self._json_response({'error': f'Unknown vault: {symbol}'}, 404)
            return

        try:
            addr = Web3.to_checksum_address(user)
            pos = contract.functions.getPosition(addr).call()
            val = contract.functions.getPositionValue(addr).call()
            self._json_response({
                'symbol': symbol,
                'source': 'contract',
                'user': user,
                'depositAmount': str(pos[0]),
                'leverageBps': pos[1],
                'entryTWAP': str(pos[2]),
                'lastFeeTimestamp': pos[3],
                'settledFees': str(pos[4]),
                'leverageLockExpiry': pos[5],
                'isActive': pos[6],
                'currentValue': str(val[0]),
                'pnl': str(val[1]),
            })
        except Exception as e:
            self._json_response({'error': str(e)}, 500)

    def handle_summary(self):
        """Aggregate live state for all vaults — used by frontend live mode."""
        vaults = {}
        for symbol in ['QQQ', 'SPY']:
            pool = get_cached(f'pool_{symbol}')
            oracle = get_cached(f'oracle_{symbol}')
            junior = get_cached(f'junior_{symbol}')
            fees = get_cached(f'fees_{symbol}')
            pyth = get_cached(f'pyth_{symbol}')
            vaults[symbol] = {
                'pool': pool,
                'oracle': oracle,
                'junior': junior,
                'fees': fees,
                'pyth': pyth,
            }
        ts = get_cached('_timestamp')
        self._json_response({
            'source': 'contract+pyth',
            'cacheAge': round(time.time() - ts, 1) if ts else None,
            'rpc': RPC_URL,
            'vaults': vaults,
        })

    # ── Yahoo Finance proxy (research/backtest mode) ──

    def proxy_yahoo_finance(self):
        try:
            path_parts = self.path.split('?')
            symbol_path = path_parts[0].replace('/api/yahoo/', '')
            query_string = path_parts[1] if len(path_parts) > 1 else ''
            yahoo_url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol_path}?{query_string}'
            print(f'Proxying request to: {yahoo_url}')
            req = urllib.request.Request(yahoo_url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            with urllib.request.urlopen(req, timeout=10) as response:
                data = response.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)
                print(f'Successfully proxied data for {symbol_path}')
        except urllib.error.HTTPError as e:
            print(f'HTTP Error: {e.code} - {e.reason}')
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'HTTP {e.code}: {e.reason}'}).encode())
        except urllib.error.URLError as e:
            print(f'URL Error: {e.reason}')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e.reason)}).encode())
        except Exception as e:
            print(f'Error: {str(e)}')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def log_message(self, format, *args):
        if hasattr(self, 'path') and not self.path.startswith('/api/'):
            return
        print(f'[{self.log_date_time_string()}] {format % args}')


if __name__ == '__main__':
    # Start background cache refresh thread
    cache_thread = threading.Thread(target=_refresh_cache, daemon=True)
    cache_thread.start()

    Handler = CORSRequestHandler
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f'╔═══════════════════════════════════════════════════════╗')
        print(f'║  xLever Protocol Server                               ║')
        print(f'╠═══════════════════════════════════════════════════════╣')
        print(f'║  Server running at: http://localhost:{PORT}            ║')
        print(f'║  RPC: {RPC_URL[:45]:<45} ║')
        print(f'║                                                       ║')
        print(f'║  Live endpoints:                                      ║')
        print(f'║    GET /api/live/summary          (all vaults)        ║')
        print(f'║    GET /api/live/pool/<SYM>       (pool state)        ║')
        print(f'║    GET /api/live/oracle/<SYM>     (oracle state)      ║')
        print(f'║    GET /api/live/junior/<SYM>     (junior tranche)    ║')
        print(f'║    GET /api/live/fees/<SYM>       (fee state)         ║')
        print(f'║    GET /api/live/position/<SYM>?user=0x...            ║')
        print(f'║    GET /api/live/pyth/<SYM>       (oracle price)      ║')
        print(f'║                                                       ║')
        print(f'║  Research endpoints:                                  ║')
        print(f'║    GET /api/yahoo/<symbol>        (Yahoo proxy)       ║')
        print(f'║                                                       ║')
        print(f'║  Cache refresh: every {CACHE_TTL}s                         ║')
        print(f'║  Press Ctrl+C to stop                                 ║')
        print(f'╚═══════════════════════════════════════════════════════╝')
        print()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n\nServer stopped')
