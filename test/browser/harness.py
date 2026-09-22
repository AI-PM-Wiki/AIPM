"""AI-PM 浏览器用例的公共底座(2026-09-23)。

这些用例跑真实浏览器,文件名不以 `test_` 开头,所以不在 `uv run python3 -m unittest`
的默认发现范围内 —— 默认门禁要保持零浏览器依赖。显式跑:

    uv run python3 test/browser/run.py

底座做三件事:

- **建站**:`mkdocs build` 出一份真的 `site/`(hooks 注入的 `?v=` 都在里面,与线上
  同一条构建路径)。要比对旧版本时,用 `git archive` 取那个提交的源码树另建一份。
- **服务**:一个静态文件服务,根目录可以中途换掉 —— **换根不换端口**,浏览器那边
  始终是同一个 origin。缓存升级那条用例靠的就是这一点。
- **链路**:一个假模型 API(把收到的请求体抄下来)加一个真的 agent-server
  (`SEARCH_INDEX_URL` 指向本地站点自己的索引,`ANTHROPIC_BASE_URL` 指向假 API)。
  于是「在界面上点一下」到「模型收到什么」是同一次运行里的一条完整通路,不需要
  联网,也不需要真的 ANTHROPIC_API_KEY。
"""
from __future__ import annotations

import http.server
import json
import os
import shutil
import socket
import subprocess
import threading
import urllib.request
from http import HTTPStatus
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "meta" / "browser"
AGENT_SERVER = ROOT / "agent-server"

#: 聊天 widget 在 localhost 上写死的后端地址(见 docs/_static/js/chat-widget.js)
AGENT_PORT = 8787


def run(cmd: list[str], cwd: Path = ROOT, **kwargs) -> subprocess.CompletedProcess:
    """跑一条命令,非零退出就地抛出 —— 建站失败要立刻看见。"""
    return subprocess.run(cmd, cwd=str(cwd), check=True, **kwargs)


def build_site(out: Path, ref: str | None = None) -> Path:
    """建一份站到 out。

    ref 为空时建当前工作区;给了 ref(提交号或分支)就先把那个提交的源码树取出来
    另建一份 —— 缓存升级那条用例要先造出「用户升级前已经缓存过的那一版」。
    """
    config = ROOT / "mkdocs.yml"
    if ref is not None:
        src = WORK / f"src-{ref[:8]}"
        shutil.rmtree(src, ignore_errors=True)
        src.mkdir(parents=True)
        archive = run(["git", "archive", ref], capture_output=True)
        subprocess.run(["tar", "-x", "-C", str(src)], input=archive.stdout, check=True)
        # 主题是子模块,全量 clone 在每个工作区各一份:旧源码树里链过去即可
        # (git archive 会留下一个空的子模块目录,先让位)
        shutil.rmtree(src / "mkdocs-material", ignore_errors=True)
        (src / "mkdocs-material").symlink_to(ROOT / "mkdocs-material")
        config = src / "mkdocs.yml"

    shutil.rmtree(out, ignore_errors=True)
    run(["uv", "run", "mkdocs", "build", "-q", "-f", str(config), "-d", str(out)])
    if not (out / "index.html").is_file():
        raise RuntimeError(f"建站没有产出 index.html:{out}")
    return out


class _Handler(http.server.SimpleHTTPRequestHandler):
    """静态文件。多一处:按路径覆盖 Content-Type —— 「类型限制」那条用例要一个
    名字像图、内容不是图的东西。"""

    def __init__(self, request, client_address, server):
        super().__init__(request, client_address, server, directory=str(server.root))

    def guess_type(self, path):
        override = getattr(self.server, "content_types", {})
        bare = self.path.split("?", 1)[0]
        if bare in override:
            return override[bare]
        return super().guess_type(path)

    def log_message(self, *args):  # 用例自己会报关键信息,不必刷访问日志
        pass


class StaticSite:
    """一个静态文件服务。

    `serve(root)` 换根,端口不动 —— 对浏览器来说还是同一个 origin,缓存、Service
    Worker、localStorage 全都留着。这正是「老用户升级」与「换了个新端口再看一眼」
    的区别所在。"""

    def __init__(self, root: Path, content_types: dict[str, str] | None = None):
        self.root = Path(root)
        self.content_types = content_types or {}
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.httpd.root = self.root
        self.httpd.content_types = self.content_types
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def serve(self, root: Path) -> None:
        """换根。同一个监听套接字,同一个端口。"""
        self.root = Path(root)
        self.httpd.root = self.root

    def write(self, relpath: str, data: bytes, content_type: str | None = None) -> str:
        """往当前根目录里放一份用例素材,返回它的站内路径。"""
        target = self.root / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        if content_type is not None:
            self.content_types["/" + relpath] = content_type
        return "/" + relpath

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


#: 假模型 API 用来结束一轮的 SSE 脚本:一句话就收,agent 不必再要下一轮。
_SSE_REPLY = "\n".join(
    [
        "event: message_start",
        'data: {"type":"message_start","message":{"id":"msg_stub","type":"message",'
        '"role":"assistant","model":"stub","content":[],"stop_reason":null,'
        '"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
        "",
        "event: content_block_start",
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        "",
        "event: content_block_delta",
        'data: {"type":"content_block_delta","index":0,'
        '"delta":{"type":"text_delta","text":"收到。"}}',
        "",
        "event: content_block_stop",
        'data: {"type":"content_block_stop","index":0}',
        "",
        "event: message_delta",
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},'
        '"usage":{"output_tokens":2}}',
        "",
        "event: message_stop",
        'data: {"type":"message_stop"}',
        "",
        "",
    ]
)


class StubModel:
    """假的模型 API。把收到的每个请求体抄进 `requests`,用它自己那段 SSE 结束这一轮。

    agent-server 那边只要把 ANTHROPIC_BASE_URL 指过来,这一轮就打不到真的那一侧,
    而「模型收到了什么」是这里抄下来的原件。"""

    def __init__(self):
        self.requests: list[dict] = []
        self._httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _StubHandler)
        self._httpd.owner = self
        self.port = self._httpd.server_address[1]
        threading.Thread(target=self._httpd.serve_forever, daemon=True).start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def messages(self) -> list[dict]:
        """真正发到模型那一侧(/v1/messages)的请求体,按先后。"""
        return [r for r in self.requests if r["path"].endswith("/messages")]

    def close(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()


class _StubHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length).decode("utf-8", "replace")
        path = self.path.split("?", 1)[0]
        try:
            body = json.loads(raw)
        except ValueError:
            body = {"_unparsed": raw[:200]}
        self.server.owner.requests.append({"path": path, "body": body})
        if path.endswith("/count_tokens"):
            self._json({"input_tokens": 1})
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        payload = _SSE_REPLY.encode("utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self._json({})

    def _json(self, obj):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class AgentServer:
    """真的 agent-server,进程内跑在聊天 widget 写死的那个端口上。

    索引用**本地站点自己那份**(mkdocs 建出来的 search/search_index.json),
    模型地址指向假 API —— 整条链路因此不联网。"""

    def __init__(self, site: StaticSite, model: StubModel):
        self.proc = subprocess.Popen(
            ["npx", "tsx", "src/server.ts"],
            cwd=str(AGENT_SERVER),
            env={
                "PATH": _path_env(),
                "HOME": str(Path.home()),
                "PORT": str(AGENT_PORT),
                "HOST": "127.0.0.1",
                "ANTHROPIC_API_KEY": "browser-check",
                "ANTHROPIC_BASE_URL": model.base,
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                "SEARCH_INDEX_URL": f"{site.base}/search/search_index.json",
                "ALLOWED_ORIGINS": f"{site.base},http://localhost:{site.port}",
                "SITE_BASE": site.base,
                "MODEL": "claude-opus-5",
                "MAX_TURNS": "2",
                "MAX_BUDGET_USD": "0.1",
                "DAILY_BUDGET_USD": "0",
                "SCRATCH_DIR": str(WORK / "scratch"),
                "INDEX_REFRESH_MS": "1800000",
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        self._wait_ready()

    def _wait_ready(self) -> None:
        for _ in range(600):
            if self.proc.poll() is not None:
                raise RuntimeError(f"agent-server 起不来:\n{self.proc.stdout.read()}")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{AGENT_PORT}/healthz", timeout=1) as res:
                    if res.status == 200:
                        return
            except OSError:
                pass
            threading.Event().wait(0.1)
        raise RuntimeError("agent-server 60 秒内没有就绪")

    def close(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=10)


class Browser:
    """一个 Chromium 与它的一个页面,顺带收页面上的报错。

    `errors` 收**这条通路自己这一侧**的异常:未捕获异常、被拒的 Promise,以及
    来自站点 origin 或问答后端 origin 的 console.error —— 一条通路里「悄悄抛了个
    TypeError 但界面看起来没事」正是要靠它现形。

    别的 origin 上的加载失败不进 `errors`:批注后端(8788)、统计脚本这些不在这条
    通路里,它们连不上是用例环境的事,不是被测代码的事。`other_origin_errors`
    留下它们,要排查时看得到。"""

    def __init__(self, playwright, base: str):
        self.browser = playwright.chromium.launch()
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.base = base
        self.errors: list[str] = []
        self.other_origin_errors: list[str] = []
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        self.page.on("console", self._on_console)
        self.chat_bodies: list[dict] = []
        self.page.on("request", self._on_request)

    def _on_console(self, msg):
        if msg.type != "error":
            return
        url = (msg.location or {}).get("url") or ""
        line = f"console.error: {msg.text} [{url}]"
        if url and not url.startswith(self.base) and not url.startswith(f"http://127.0.0.1:{AGENT_PORT}"):
            self.other_origin_errors.append(line)
            return
        self.errors.append(line)

    def _on_request(self, request):
        if request.method == "POST" and request.url.endswith("/api/chat"):
            payload = request.post_data
            if payload:
                self.chat_bodies.append(json.loads(payload))

    def goto(self, path: str):
        self.page.goto(self.base + path, wait_until="load")
        return self.page

    def close(self) -> None:
        self.context.close()
        self.browser.close()


def _path_env() -> str:
    return os.environ.get("PATH", "/usr/bin:/bin:/usr/local/bin")
