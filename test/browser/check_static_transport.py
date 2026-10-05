"""Concurrent HTTP resource loading through the actual static server."""
import concurrent.futures
import http.client
import threading
import unittest

from harness import ROOT, StaticSite


class StaticTransportCase(unittest.TestCase):
    def test_parallel_resources_complete_before_shutdown(self):
        site = StaticSite(ROOT / "site")
        self.addCleanup(site.close)
        barrier = threading.Barrier(32)

        def load_resource(index):
            connection = http.client.HTTPConnection("127.0.0.1", site.port, timeout=10)
            try:
                barrier.wait(timeout=10)
                connection.request("GET", f"/_static/css/annotation.css?transport={index}")
                response = connection.getresponse()
                body = response.read()
                return response.status, body
            finally:
                connection.close()

        with concurrent.futures.ThreadPoolExecutor(max_workers=32) as executor:
            responses = list(executor.map(load_resource, range(32)))
        expected = (ROOT / "site/_static/css/annotation.css").read_bytes()
        self.assertEqual(responses, [(200, expected)] * 32)
        self.assertTrue(site.thread.is_alive())
        self.assertEqual(len(site.requests), 32)
