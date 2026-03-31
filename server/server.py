#!/usr/bin/env python3
"""
Simple HTTP server with CORS support and Yahoo Finance API proxy
"""
import http.server
import socketserver
import urllib.request
import urllib.parse
import json
from pathlib import Path

PORT = 8000

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # CORS headers are handled by Nginx, don't add them here
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        # Proxy endpoint for Yahoo Finance API
        if self.path.startswith('/api/yahoo/'):
            self.proxy_yahoo_finance()
        else:
            # Serve static files
            super().do_GET()

    def proxy_yahoo_finance(self):
        try:
            # Parse the request path
            # Expected format: /api/yahoo/QQQ?period1=X&period2=Y&interval=1d
            path_parts = self.path.split('?')
            symbol_path = path_parts[0].replace('/api/yahoo/', '')
            query_string = path_parts[1] if len(path_parts) > 1 else ''
            
            # Build Yahoo Finance URL
            yahoo_url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol_path}?{query_string}'
            
            print(f'Proxying request to: {yahoo_url}')
            
            # Fetch data from Yahoo Finance
            req = urllib.request.Request(yahoo_url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            
            with urllib.request.urlopen(req, timeout=10) as response:
                data = response.read()
                
                # Send response
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)
                
                print(f'✓ Successfully proxied data for {symbol_path}')
                
        except urllib.error.HTTPError as e:
            print(f'✗ HTTP Error: {e.code} - {e.reason}')
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            error_data = json.dumps({'error': f'HTTP {e.code}: {e.reason}'}).encode()
            self.wfile.write(error_data)
            
        except urllib.error.URLError as e:
            print(f'✗ URL Error: {e.reason}')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            error_data = json.dumps({'error': str(e.reason)}).encode()
            self.wfile.write(error_data)
            
        except Exception as e:
            print(f'✗ Error: {str(e)}')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            error_data = json.dumps({'error': str(e)}).encode()
            self.wfile.write(error_data)

    def log_message(self, format, *args):
        # Custom logging format
        if hasattr(self, 'path') and not self.path.startswith('/api/'):
            return  # Don't log static file requests
        print(f'[{self.log_date_time_string()}] {format % args}')


if __name__ == '__main__':
    Handler = CORSRequestHandler
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f'╔═══════════════════════════════════════════════════════╗')
        print(f'║  Leverage Backtester Server                          ║')
        print(f'╠═══════════════════════════════════════════════════════╣')
        print(f'║  Server running at: http://localhost:{PORT}            ║')
        print(f'║  API Proxy endpoint: /api/yahoo/<symbol>             ║')
        print(f'║  Press Ctrl+C to stop                                ║')
        print(f'╚═══════════════════════════════════════════════════════╝')
        print()
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n\n✓ Server stopped')
