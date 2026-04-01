#!/usr/bin/env python3
# Shebang allows running this file directly (./server.py) without explicitly calling python3
"""
Simple HTTP server with CORS support and Yahoo Finance API proxy
"""
# http.server provides a lightweight dev server — no need for FastAPI/Flask for the backtester
import http.server
# socketserver gives us TCPServer to bind to a port and handle connections
import socketserver
# urllib.request is used to make outbound HTTP calls to Yahoo Finance (stdlib, no deps needed)
import urllib.request
# urllib.parse would be needed if we manually encoded query params (kept for future use)
import urllib.parse
# json is used to serialize error responses back to the client
import json
# Path is imported for potential static file resolution (stdlib convenience)
from pathlib import Path

# Port 8000 chosen to avoid conflicts with common dev servers (3000, 5173, 8080)
PORT = 8000


# Subclass SimpleHTTPRequestHandler so we get static file serving for free,
# while adding CORS headers and a Yahoo Finance proxy route
class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    # Override end_headers to inject CORS headers into every response —
    # the browser blocks cross-origin requests from the frontend without these
    # Allowed origins for CORS — restrict to known local dev servers
    ALLOWED_ORIGINS = {'http://localhost:8080', 'http://localhost:5173', 'http://localhost:3000', 'https://xlever.markets'}

    def end_headers(self):
        # Only allow requests from known frontend dev server origins
        origin = self.headers.get('Origin', '')
        if origin in self.ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
        else:
            # Default to primary dev server if no matching origin
            self.send_header('Access-Control-Allow-Origin', 'http://localhost:5173')
        # Whitelist the HTTP methods the frontend needs for fetching price data
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        # Allow Content-Type header so the frontend can send JSON requests
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Disable caching so the backtester always gets fresh price data during dev
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        # Call the parent to actually write the headers and blank line to the socket
        super().end_headers()

    # Handle CORS preflight requests — browsers send OPTIONS before cross-origin GETs
    def do_OPTIONS(self):
        # 200 tells the browser the preflight passed
        self.send_response(200)
        # Repeat CORS headers here because preflight responses need them independently
        origin = self.headers.get('Origin', '')
        if origin in self.ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
        else:
            self.send_header('Access-Control-Allow-Origin', 'http://localhost:5173')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Finalize headers (also injects our CORS additions via end_headers override)
        self.end_headers()

    # Override GET to intercept /api/yahoo/ requests before they hit the static file handler
    def do_GET(self):
        # Route Yahoo Finance requests to the proxy — the frontend can't call Yahoo
        # directly due to CORS restrictions on Yahoo's servers
        if self.path.startswith('/api/yahoo/'):
            self.proxy_yahoo_finance()
        else:
            # Everything else (HTML, JS, CSS) is served as static files for the backtester UI
            super().do_GET()

    # Proxy method that fetches price data from Yahoo Finance on behalf of the browser
    def proxy_yahoo_finance(self):
        try:
            # Split path from query string so we can extract the ticker symbol separately
            # Expected format: /api/yahoo/QQQ?period1=X&period2=Y&interval=1d
            path_parts = self.path.split('?')
            # Strip the /api/yahoo/ prefix to isolate the ticker symbol (e.g., "QQQ")
            symbol_path = path_parts[0].replace('/api/yahoo/', '')
            # Preserve any query params (period, interval) to forward to Yahoo
            query_string = path_parts[1] if len(path_parts) > 1 else ''

            # Reconstruct the real Yahoo Finance API URL with the extracted symbol and params
            yahoo_url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol_path}?{query_string}'

            # Log for debugging — useful when the backtester returns unexpected data
            print(f'Proxying request to: {yahoo_url}')

            # Build a proper Request object so we can add headers
            req = urllib.request.Request(yahoo_url)
            # Spoof a browser User-Agent because Yahoo blocks requests from scripts/bots
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')

            # 10-second timeout prevents the server from hanging if Yahoo is slow/down
            with urllib.request.urlopen(req, timeout=10) as response:
                # Read the entire JSON response body from Yahoo
                data = response.read()

                # Forward Yahoo's response back to the browser with proper headers
                self.send_response(200)
                # Tell the browser this is JSON so it can parse it correctly
                self.send_header('Content-Type', 'application/json')
                # end_headers also adds our CORS headers via the override above
                self.end_headers()
                # Write the raw Yahoo JSON bytes directly — no need to decode/re-encode
                self.wfile.write(data)

                # Confirmation log so we know the proxy succeeded
                print(f'Successfully proxied data for {symbol_path}')

        # Handle HTTP-level errors (4xx/5xx) from Yahoo — forward the status code to the client
        except urllib.error.HTTPError as e:
            print(f'HTTP Error: {e.code} - {e.reason}')
            # Mirror Yahoo's error code so the frontend can distinguish 404 vs 429 etc.
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            # Wrap the error in JSON so the frontend error handler can parse it uniformly
            error_data = json.dumps({'error': f'HTTP {e.code}: {e.reason}'}).encode()
            self.wfile.write(error_data)

        # Handle network-level errors (DNS failure, connection refused, timeout)
        except urllib.error.URLError as e:
            print(f'URL Error: {e.reason}')
            # 500 because this is a server-side connectivity issue, not a client mistake
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            error_data = json.dumps({'error': str(e.reason)}).encode()
            self.wfile.write(error_data)

        # Catch-all for unexpected errors so the server never crashes on a single request
        except Exception as e:
            print(f'Error: {str(e)}')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            error_data = json.dumps({'error': str(e)}).encode()
            self.wfile.write(error_data)

    # Override log_message to reduce noise — static file requests clutter the terminal
    def log_message(self, format, *args):
        # Only log API proxy requests since those are the ones we care about debugging
        if hasattr(self, 'path') and not self.path.startswith('/api/'):
            return  # Suppress static file request logs to keep output clean
        # Include timestamp for correlating proxy requests with Yahoo Finance timing
        print(f'[{self.log_date_time_string()}] {format % args}')


# Guard ensures the server only starts when run directly, not when imported
if __name__ == '__main__':
    # Alias for readability when passing to TCPServer
    Handler = CORSRequestHandler

    # TCPServer binds to all interfaces ("") on PORT and routes requests to our handler
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        # ASCII art banner so the developer knows the server started and where to connect
        print(f'╔═══════════════════════════════════════════════════════╗')
        print(f'║  Leverage Backtester Server                          ║')
        print(f'╠═══════════════════════════════════════════════════════╣')
        print(f'║  Server running at: http://localhost:{PORT}            ║')
        print(f'║  API Proxy endpoint: /api/yahoo/<symbol>             ║')
        print(f'║  Press Ctrl+C to stop                                ║')
        print(f'╚═══════════════════════════════════════════════════════╝')
        # Blank line after banner for visual separation from request logs
        print()

        try:
            # Block forever, handling one request at a time (fine for local dev)
            httpd.serve_forever()
        except KeyboardInterrupt:
            # Graceful message on Ctrl+C so the developer knows shutdown was intentional
            print('\n\nServer stopped')
