#!/usr/bin/env python3
"""跑 test/browser/ 下的浏览器用例。

    uv run python3 test/browser/run.py            # 全部
    uv run python3 test/browser/run.py chart      # 只跑名字里带 chart 的

浏览器用例刻意不进 `uv run python3 -m unittest` 的默认发现范围(那里的门禁是零浏览器
依赖的),所以要显式跑这一条。缺 Chromium 时先 `uv run playwright install chromium`。
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def main() -> int:
    pattern = "check_*.py"
    if len(sys.argv) > 1:
        pattern = f"check_*{sys.argv[1]}*.py"
    suite = unittest.TestLoader().discover(str(HERE), pattern=pattern, top_level_dir=str(HERE))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
