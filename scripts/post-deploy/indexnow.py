#!/usr/bin/env python3
# IndexNow Active Submission
# Reads every <loc> URL from the mkdocs sitemap and submits them to IndexNow,
# so search engines (Google/Bing) pick up new/changed pages faster.
#
# Usage:
#   python3 scripts/post-deploy/indexnow.py --key "$INDEXNOW_KEY"
#   python3 scripts/post-deploy/indexnow.py --key KEY --sitemap site/sitemap.xml --host aipm.ac
#
# --key may also come from the INDEXNOW_KEY environment variable.
# --host defaults to the netloc of the first sitemap URL.
#
# Exit codes:
#   0 = success
#   1 = network / HTTP failure while talking to IndexNow
#   2 = usage or data error (missing key/sitemap/host, or empty urlList)

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"
TIMEOUT_SECONDS = 30


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Submit all sitemap URLs to IndexNow."
    )
    parser.add_argument(
        "--key",
        default=os.environ.get("INDEXNOW_KEY", ""),
        help="IndexNow key (default: $INDEXNOW_KEY)",
    )
    parser.add_argument(
        "--sitemap",
        default="site/sitemap.xml",
        help="Path to sitemap.xml (default: site/sitemap.xml)",
    )
    parser.add_argument(
        "--host",
        default=None,
        help="Site host, e.g. aipm.ac (default: inferred from sitemap URLs)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be submitted without sending the request",
    )
    return parser.parse_args(argv)


def read_urls(sitemap_path):
    if not os.path.exists(sitemap_path):
        print("ERROR: sitemap not found: %s" % sitemap_path, file=sys.stderr)
        return None
    tree = ET.parse(sitemap_path)
    urls = []
    # Match <loc> regardless of the sitemap XML namespace.
    for elem in tree.getroot().iter():
        local = elem.tag.rsplit("}", 1)[-1]
        if local == "loc" and elem.text and elem.text.strip():
            urls.append(elem.text.strip())
    return urls


def infer_host(urls):
    for url in urls:
        netloc = urlparse(url).netloc
        if netloc:
            return netloc
    return None


def build_payload(urls, host, key):
    return {
        "host": host,
        "key": key,
        "keyLocation": "https://%s/%s.txt" % (host, key),
        "urlList": urls,
    }


def submit(payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        INDEXNOW_ENDPOINT,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        return resp.status


def main(argv=None):
    args = parse_args(argv)

    if not args.key:
        print(
            "ERROR: missing IndexNow key (use --key or set INDEXNOW_KEY)",
            file=sys.stderr,
        )
        return 2

    urls = read_urls(args.sitemap)
    if urls is None:
        return 2
    if not urls:
        print(
            "ERROR: no <loc> URLs found in %s" % args.sitemap,
            file=sys.stderr,
        )
        return 2

    host = args.host or infer_host(urls)
    if not host:
        print(
            "ERROR: could not infer host from sitemap URLs (use --host)",
            file=sys.stderr,
        )
        return 2

    payload = build_payload(urls, host, args.key)

    if args.dry_run:
        print(
            "DRY-RUN: would submit %d URLs from %s to %s (host=%s, keyLocation=%s)"
            % (len(urls), args.sitemap, INDEXNOW_ENDPOINT, host, payload["keyLocation"])
        )
        return 0

    print(
        "Submitting %d URLs from %s to IndexNow (host=%s)..."
        % (len(urls), args.sitemap, host)
    )
    try:
        status = submit(payload)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        print(
            "ERROR: IndexNow returned HTTP %d: %s" % (e.code, e.reason),
            file=sys.stderr,
        )
        if body:
            print(body, file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(
            "ERROR: request to IndexNow failed: %s" % e.reason,
            file=sys.stderr,
        )
        return 1

    print("OK: submitted %d URLs (HTTP %d)" % (len(urls), status))
    return 0


if __name__ == "__main__":
    sys.exit(main())
