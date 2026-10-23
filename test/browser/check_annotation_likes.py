"""真实浏览器中的点赞与可见范围切换。"""

import json
import subprocess
import unittest

from annotation_service import RealAnnotationApi
from harness import ROOT, WORK, StaticSite, configured_port


class AnnotationLikesCase(unittest.TestCase):
    def test_likes_survive_every_visibility_transition(self):
        runtime = WORK / "annotation-likes"
        runtime.mkdir(parents=True, exist_ok=True)
        site = StaticSite(ROOT / "site")
        self.addCleanup(site.close)
        api = RealAnnotationApi(ROOT, runtime, site, configured_port("AIPM_TEST_LIKES_PORT"))
        self.addCleanup(api.close)
        site.set_local_api({"annotation": api.base, "agent": api.base})
        config = runtime / "config.json"
        config.write_text(json.dumps({"site": site.base, "api": api.base,
                                      "output": str(runtime / "results.json")}), encoding="utf-8")
        script = ROOT / "test/browser/check_annotation_likes_ego.mjs"
        subprocess.run(["ego-browser", "nodejs", "-e",
                        f"const m = await import({json.dumps(script.as_uri())}); "
                        f"await m.checkAnnotationLikes({json.dumps(str(config))});"],
                       cwd=ROOT, check=True, timeout=240)
        result = json.loads((runtime / "results.json").read_text(encoding="utf-8"))
        self.assertEqual(result["transitions"], 12)
        self.assertEqual(len(api.stored), 2)
        for request in api.requests:
            if request["method"] == "POST" and request["path"] == "/api/annotations":
                self.assertNotIn("likeCount", request["body"])
