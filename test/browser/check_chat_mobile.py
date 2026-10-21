"""Mobile assistant layout and drawer animation on the built site."""

import json
import unittest

from playwright.sync_api import sync_playwright

from harness import ROOT, WORK, StaticSite


class ChatMobileCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (WORK / "chat-mobile").mkdir(parents=True, exist_ok=True)
        cls.site = StaticSite(ROOT / "site")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.site.close()

    def setUp(self):
        self.errors = []
        self.open_panel()

    def open_panel(self, width=390, height=844):
        self.context = self.browser.new_context(viewport={"width": width, "height": height},
                                               is_mobile=True, has_touch=True)
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.goto(self.site.base + "/ai/rag/", wait_until="domcontentloaded")
        self.page.wait_for_function("window.__aipmIntegrityReady && window.__aipmChat")
        self.page.get_by_role("button", name="询问助手", exact=True).tap()
        self.panel = self.page.locator("#aipm-chat")
        self.grip = self.panel.get_by_role("button", name="调整助手面板高度", exact=True)
        self.settled()

    def tearDown(self):
        self.assertEqual(self.errors, [])

    def settled(self):
        self.page.wait_for_function("""() => {
          const panel = document.querySelector('#aipm-chat');
          return !panel.classList.contains('is-snapping') &&
            panel.getAnimations().every(animation => animation.playState !== 'running');
        }""")

    def record_motion(self):
        self.page.evaluate("""() => {
          const panel = document.querySelector('#aipm-chat');
          const messages = panel.querySelector('.aipm-chat__msgs');
          const composer = panel.querySelector('.aipm-chat__composer');
          const record = window.assistantMotion = {
            frames: [], measurements: [], complete: false, finish: false
          };
          const start = performance.now();
          const observer = new MutationObserver(records => {
            for (const mutation of records) {
              if (!(mutation.oldValue || '').split(' ').includes('is-peek-measure')) continue;
              const moving = panel.classList.contains('is-dragging') ||
                panel.getAnimations().some(animation =>
                  animation.transitionProperty === 'height' && animation.playState === 'running');
              if (moving) record.measurements.push({ time: performance.now() - start,
                snap: panel.dataset.snap, classes: panel.className,
                composer: composer.getBoundingClientRect().height,
                animations: panel.getAnimations().map(animation => ({
                  property: animation.transitionProperty, state: animation.playState,
                  time: animation.currentTime, duration: animation.effect.getTiming().duration
                })) });
            }
          });
          observer.observe(panel, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
          function sample(now) {
            record.frames.push({ time: now - start, height: panel.getBoundingClientRect().height,
              snap: panel.dataset.snap, messages: getComputedStyle(messages).display,
              composer: composer.getBoundingClientRect().height });
            if (!record.finish) requestAnimationFrame(sample);
            else { observer.disconnect(); record.complete = true; }
          }
          requestAnimationFrame(sample);
        }""")

    def assert_motion(self, name, direction=None):
        self.settled()
        self.page.evaluate("""() => new Promise(resolve => requestAnimationFrame(() =>
          requestAnimationFrame(() => { window.assistantMotion.finish = true; resolve(); })))""")
        self.page.wait_for_function("window.assistantMotion.complete")
        record = self.page.evaluate("window.assistantMotion")
        (WORK / "chat-mobile" / f"{name}.json").write_text(json.dumps(record, indent=2))
        self.assertEqual(record["measurements"], [], "Live composer measured during drawer motion")
        self.assertGreater(len(record["frames"]), 4)
        self.assertTrue(all(frame["messages"] != "none" for frame in record["frames"]))
        heights = [frame["height"] for frame in record["frames"]]
        if direction is not None:
            self.assertTrue(all((after - before) * direction >= -1
                                for before, after in zip(heights, heights[1:])), heights)

    def test_drawer_motion_preserves_live_layout(self):
        self.grip.tap()
        self.settled()
        self.assertEqual(self.panel.get_attribute("data-snap"), "half")
        self.record_motion()
        self.grip.tap()
        with self.subTest(direction="half-expanded"):
            self.assert_motion("half-expanded", 1)
        self.assertEqual(self.panel.get_attribute("data-snap"), "expanded")
        self.record_motion()
        bounds = self.grip.bounding_box()
        x, y = bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2
        cdp = self.context.new_cdp_session(self.page)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for step in range(1, 9):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y + step * 40}]})
            self.page.evaluate("new Promise(resolve => requestAnimationFrame(resolve))")
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        with self.subTest(direction="expanded-half"):
            self.assert_motion("expanded-half", -1)
        self.assertEqual(self.panel.get_attribute("data-snap"), "half")

    def test_interrupted_motion_across_mobile_sizes(self):
        for width, height in ((320, 844), (430, 932), (667, 375)):
            with self.subTest(width=width, height=height):
                self.context.close()
                self.open_panel(width, height)
                self.grip.tap()
                self.settled()
                self.record_motion()
                bounds = self.grip.bounding_box()
                x, y = bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2
                cdp = self.context.new_cdp_session(self.page)
                cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
                cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
                self.page.wait_for_function("""() => document.querySelector('#aipm-chat').getAnimations()
                  .some(animation => animation.transitionProperty === 'height' && animation.playState === 'running')""")
                bounds = self.grip.bounding_box()
                x, y = bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2
                cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
                for step in range(1, 49):
                    offset = step if step <= 24 else 48 - step
                    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y - offset * 2}]})
                    self.page.evaluate("new Promise(resolve => requestAnimationFrame(resolve))")
                cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
                cdp.detach()
                self.assert_motion(f"interrupted-{width}")
                self.assertIn(self.panel.get_attribute("data-snap"), ("half", "expanded"))
                self.assertEqual(self.panel.locator(".aipm-chat__msgs").inner_text(), "")
                self.assertFalse(self.panel.evaluate("node => node.classList.contains('is-peek-measure')"))
                self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)

    def test_mobile_cover_and_desktop_welcome(self):
        self.grip.tap()
        self.settled()
        self.assertFalse(self.panel.locator(".aipm-chat__empty").is_visible())
        self.assertFalse(self.panel.locator(".aipm-chat__disclaimer").is_visible())
        self.assertEqual(self.panel.locator(".aipm-chat__msgs").inner_text(), "")
        self.assertTrue(self.panel.get_by_role("textbox", name="提问", exact=True).is_visible())
        self.page.set_viewport_size({"width": 1440, "height": 900})
        self.page.wait_for_function("document.documentElement.classList.contains('aipm-chat-mode--dock')")
        self.settled()
        self.assertTrue(self.panel.locator(".aipm-chat__welcome").is_visible())
        self.assertTrue(self.panel.locator(".aipm-chat__disclaimer").is_visible())
        self.assertEqual(self.panel.get_by_role("group", name="推荐问题").get_by_role("button").count(), 3)
