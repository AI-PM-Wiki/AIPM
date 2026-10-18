#!/usr/bin/env python3
"""跑 test/browser/ 下的浏览器用例。

    uv run python3 test/browser/run.py            # 全部
    uv run python3 test/browser/run.py chart      # 只跑名字里带 chart 的

浏览器用例刻意不进 `uv run python3 -m unittest` 的默认发现范围(那里的门禁是零浏览器
依赖的),所以要显式跑这一条。缺 Chromium 时先 `uv run playwright install chromium`。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


MODEL_CONFIG = ("AIPM_REAL_MODEL_API_KEY", "AIPM_REAL_MODEL_BASE_URL", "AIPM_REAL_MODEL_NAME")
OAUTH_CONFIG = ("AIPM_REAL_GITHUB_CLIENT_ID", "AIPM_REAL_GITHUB_CLIENT_SECRET", "AIPM_REAL_GITHUB_ID")
MODEL_MODULES = {
    "check_agent_annotation", "check_agent_confirmation", "check_agent_confirmation_real", "check_chart_flow",
}
MODEL_DRAFT_METHODS = {
    "test_unsent_proposal_with_request_id_remains_editable_after_login_failure",
    "test_unknown_proposal_login_failure_retains_original_request",
    "test_unknown_proposal_retry_login_failure_keeps_text_selection",
}


def cases(suite):
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            yield from cases(test)
        else:
            yield test


def requirements(test):
    module = type(test).__module__
    if module == "check_annotation_cache_consent":
        return "oauth", OAUTH_CONFIG
    if module in MODEL_MODULES or (module == "check_annotation_draft_real" and
                                  test._testMethodName in MODEL_DRAFT_METHODS):
        names = MODEL_CONFIG
        if test._testMethodName == "test_rejected_image_gets_actionable_feedback":
            names += ("AIPM_REAL_TEXT_ONLY_MODEL",)
        return "model", names
    return "independent", ()


class RecordingResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.records = []

    def addSuccess(self, test):
        super().addSuccess(test)
        self.records.append({"test": test.id(), "status": "passed"})

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.records.append({"test": test.id(), "status": "failed", "reason": str(err[1])})

    def addError(self, test, err):
        super().addError(test, err)
        self.records.append({"test": test.id(), "status": "failed", "reason": str(err[1])})

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.records.append({"test": test.id(), "status": "skipped", "reason": reason})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pattern", nargs="?", default="")
    parser.add_argument("--group", choices=("all", "independent", "model", "oauth"), default="all")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    discovered = unittest.TestLoader().discover(
        str(HERE), pattern=f"check_*{args.pattern}*.py", top_level_dir=str(HERE))
    selected = []
    pending = []
    for test in cases(discovered):
        group, names = requirements(test)
        if args.group not in ("all", group):
            continue
        missing = [name for name in names if not os.environ.get(name)]
        if missing:
            pending.append({"test": test.id(), "group": group, "status": "not_run", "missing": missing})
        else:
            selected.append(test)
    result = unittest.TextTestRunner(verbosity=2, resultclass=RecordingResult).run(unittest.TestSuite(selected))
    records = result.records + pending
    for record in pending:
        print(f"NOT RUN {record['test']}: missing {', '.join(record['missing'])}")
    successful = result.wasSuccessful() and not result.skipped and not pending
    report = {"group": args.group, "testsRun": result.testsRun, "successful": successful,
              "counts": {status: sum(record["status"] == status for record in records)
                         for status in ("passed", "failed", "not_run", "skipped")}, "records": records}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("group", "testsRun", "successful", "counts")}))
    return 0 if successful else 1


if __name__ == "__main__":
    sys.exit(main())
