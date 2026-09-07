#!/usr/bin/env python3
"""CLI wrapper: uv run python scripts/check-doc-links.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.doc_links import main

if __name__ == "__main__":
    sys.exit(main())
