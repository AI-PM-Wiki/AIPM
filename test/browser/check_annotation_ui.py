"""批注栏目、GitHub 登录 ID 大小写及历史记录，使用浏览器和隔离批注服务。"""

import json
import subprocess
import unittest

from annotation_service import RealAnnotationApi
from harness import ROOT, WORK, StaticSite, configured_port


class AnnotationUiCase(unittest.TestCase):
    def test_columns_usernames_and_profile_refresh(self):
        runtime = WORK / "annotation-ui"
        runtime.mkdir(parents=True, exist_ok=True)
        site = StaticSite(ROOT / "site")
        self.addCleanup(site.close)
        api = RealAnnotationApi(ROOT, runtime, site, configured_port("AIPM_TEST_UI_PORT"))
        self.addCleanup(api.close)
        api.restart("bRowser-Check")
        site.set_local_api({"annotation": api.base, "agent": api.base})
        config = runtime / "config.json"
        config.write_text(json.dumps({"site": site.base, "api": api.base, "directory": str(runtime)}),
                          encoding="utf-8")
        script = ROOT / "test/browser/check_annotation_ui_ego.mjs"
        for phase in ("empty", "content", "renamed", "recased"):
            if phase == "renamed":
                api.restart("Browser-Renamed")
            if phase == "recased":
                api.restart("bROWSER-rENAMED")
            subprocess.run(["ego-browser", "nodejs", "-e",
                            f"const m = await import({json.dumps(script.as_uri())}); "
                            f"await m.checkAnnotationUi({json.dumps(str(config))}, {json.dumps(phase)});"],
                           cwd=ROOT, check=True, timeout=240)
        result = json.loads((runtime / "results.json").read_text(encoding="utf-8"))
        self.assertTrue(result["passed"])
        self.assertTrue(result["casePreserved"])
        self.assertEqual(result["emptyViews"], 12)
        self.assertEqual(len(api.stored), 2)
        for annotation in api.stored:
            self.assertEqual(annotation["author"]["login"], "bROWSER-rENAMED")
            self.assertEqual(annotation["replies"][0]["author"]["login"], "bROWSER-rENAMED")
