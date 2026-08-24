#!/usr/bin/env python3
"""
QuickGrade launcher.

    python serve.py            -> http://localhost:8080   (desktop / laptop webcam)
    python serve.py --https    -> https://<your-lan-ip>:8443  (phone camera)

Why two modes: browsers only allow camera access from a "secure context".
localhost counts as secure, so plain HTTP is fine on this computer. A phone
reaching this computer over Wi-Fi does NOT count, so it needs HTTPS - which is
what --https sets up, using a self-signed certificate generated on first run.
"""
import argparse
import http.server
import os
import socket
import socketserver
import ssl
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
CERT = os.path.join(ROOT, ".cert.pem")
KEY = os.path.join(ROOT, ".key.pem")


def lan_ip():
    """Best-effort local address other devices on the Wi-Fi can reach."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))       # no packets are sent; just picks the route
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def make_cert(host):
    """Generate a self-signed certificate valid for localhost and this LAN IP."""
    from datetime import datetime, timedelta, timezone
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)])
    alt = [x509.DNSName("localhost"), x509.IPAddress(__import__("ipaddress").ip_address("127.0.0.1"))]
    try:
        alt.append(x509.IPAddress(__import__("ipaddress").ip_address(host)))
    except ValueError:
        alt.append(x509.DNSName(host))
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName(alt), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    with open(KEY, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM,
                                  serialization.PrivateFormat.TraditionalOpenSSL,
                                  serialization.NoEncryption()))
    with open(CERT, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # Always serve the freshest files; teachers reload after edits.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def bind(port, tries=12):
    """Windows reserves scattered port ranges; walk forward until one is free."""
    last = None
    for p in range(port, port + tries):
        try:
            return Server(("0.0.0.0", p), Handler), p
        except OSError as e:
            last = e
    raise SystemExit("Could not bind a port starting at %d: %s" % (port, last))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--https", action="store_true", help="serve HTTPS so a phone can use its camera")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    port = args.port or (8443 if args.https else 8080)
    httpd, port = bind(port)
    ip = lan_ip()

    if args.https:
        if not (os.path.exists(CERT) and os.path.exists(KEY)):
            print("Generating a self-signed certificate for %s ..." % ip, flush=True)
            try:
                make_cert(ip)
            except ImportError:
                raise SystemExit(
                    "HTTPS needs the 'cryptography' package:  pip install cryptography")
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        url = "https://%s:%d/" % (ip, port)
        print("\n  QuickGrade is running.\n", flush=True)
        print("  On this computer :  https://localhost:%d/" % port, flush=True)
        print("  On your phone    :  %s" % url, flush=True)
        print("\n  Your phone will warn that the certificate is not trusted - that is expected", flush=True)
        print("  for a server running on your own computer. Tap Advanced, then Proceed.", flush=True)
        print("  Both devices must be on the same Wi-Fi network.\n", flush=True)
    else:
        url = "http://localhost:%d/" % port
        print("\n  QuickGrade is running at %s" % url, flush=True)
        print("  The camera works here because browsers trust localhost.", flush=True)
        print("  For a phone camera, stop this and run:  python serve.py --https\n", flush=True)

    print("  Press Ctrl+C to stop.\n", flush=True)
    if not args.no_browser and not args.https:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("stopped", flush=True)


if __name__ == "__main__":
    main()
