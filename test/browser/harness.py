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
import re
import shutil
import socket
import subprocess
import threading
import unittest
import urllib.request
from http import HTTPStatus
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "meta" / "browser"
AGENT_SERVER = ROOT / "agent-server"

#: 聊天 widget 在 localhost 上写死的后端地址(见 docs/_static/js/chat-widget.js)
AGENT_PORT = 8787
AGENT_ORIGIN = f"http://127.0.0.1:{AGENT_PORT}"


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


#: 「读不完的资源」每次往套接字里推多少字节。
STREAM_CHUNK = 64 * 1024


class _Stream:
    """一份「读不完」的响应:交给取源那份远超上限的字节,交给页面自己那次 `<img>`
    加载的是一张正常的图。

    分两次给是为了量得准 —— 浏览器自己那次加载与取源那次请求的是同一个地址,混在
    一起就分不出取源这一步到底读了多少。区分按 `Sec-Fetch-Mode`:取源发的是
    `cors`(页面代码自己发的 fetch),`<img>` 发的是 `no-cors`。

    不按 `Sec-Fetch-Dest` 分,虽然那个头看着更直白:Service Worker 接管之后,
    `<img>` 那次加载是 SW 拿拦截到的请求重新发起的,而**重新发起时 destination
    是空的**(`Sec-Fetch-Dest: empty`)—— 两份内容会发错,而错的那一份(超大的)
    正好让「取源读了多少」量出个假数。`Sec-Fetch-Mode` 在这次重新发起里原样保留。

    两份内容都带 `Cache-Control: no-store`:这条用例要的是「每次都由服务端给字节」,
    落进浏览器的 HTTP 缓存就量不出来了(SW 那份 Cache Storage 不受它影响)。
    """

    def __init__(self, body: bytes, loader: bytes, content_type: str):
        self.body = body
        self.loader = loader
        self.content_type = content_type


class _Truncated:
    """一份「读到一半就断」的响应:`body` 是响应头里 `Content-Length` 声明的那一份,
    实际只写出去一半。取源那边读到的是 `reader.read()` 拒绝 —— 请求成功、头拿到
    了、正文中途失败,与「根本取不到这张图」是两种不同的情形。

    `loader` 与 `_Stream` 同一个用处:页面自己那次 `<img>` 加载拿到的是一张正常的
    图,否则按钮所在的容器量不出尺寸、点不着。"""

    def __init__(self, body: bytes, loader: bytes):
        self.body = body
        self.loader = loader


class _Handler(http.server.SimpleHTTPRequestHandler):
    """静态文件。多三处:按路径覆盖 Content-Type(「类型限制」那条用例要一个名字
    像图、内容不是图的东西)、按路径回 302(「跨源重定向」那条用例)、按路径流式
    写一份读不完的响应(「读取过程限额」那条用例)。"""

    #: 客户端中途取消时,写阻塞在这个上限上就该放手 —— 不让一条用例把整个跑挂住。
    timeout = 20

    def __init__(self, request, client_address, server):
        super().__init__(request, client_address, server, directory=str(server.root))

    def guess_type(self, path):
        override = getattr(self.server, "content_types", {})
        bare = self.path.split("?", 1)[0]
        if bare in override:
            return override[bare]
        return super().guess_type(path)

    def end_headers(self):
        if getattr(self.server, "cors", False):
            self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        target = self.server.redirects.get(path)
        if target is not None:
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", target)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        stream = self.server.streams.get(path)
        if stream is not None:
            self._stream(path, stream)
            return
        truncated = self.server.truncated.get(path)
        if truncated is not None:
            self._truncate(path, truncated)
            return
        super().do_GET()

    def _stream(self, path: str, stream: _Stream) -> None:
        if self.headers.get("Sec-Fetch-Mode") != "no-cors":
            self._write_all(stream.loader, stream.content_type)
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", stream.content_type)
        self.send_header("Content-Length", str(len(stream.body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        written = 0
        try:
            while written < len(stream.body):
                self.wfile.write(stream.body[written : written + STREAM_CHUNK])
                self.wfile.flush()
                written += STREAM_CHUNK
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            # 客户端把这条响应断了 —— 正是「超限就地取消」要留下的证据
            self.server.stream_aborted[path] = True
            self.close_connection = True
        finally:
            self.server.stream_written[path] = written

    def _truncate(self, path: str, truncated: _Truncated) -> None:
        """响应头照发,正文只给一半就断:读的过程中失败的那条路。

        `Content-Length` 说的是整份,实际写出去一半,客户端因此拿到的是
        `ERR_CONTENT_LENGTH_MISMATCH` —— 取源那边 `reader.read()` 会拒绝。
        页面自己那次 `<img>` 加载照旧给 `loader`(见 `_Truncated`)。"""
        if self.headers.get("Sec-Fetch-Mode") != "no-cors":
            self._write_all(truncated.loader, "image/png")
            return
        body = truncated.body
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body[: len(body) // 2])
        self.wfile.flush()
        self.close_connection = True

    def _write_all(self, body: bytes, content_type: str) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True

    def log_message(self, *args):  # 用例自己会报关键信息,不必刷访问日志
        pass


class StaticSite:
    """一个静态文件服务。

    `serve(root)` 换根,端口不动 —— 对浏览器来说还是同一个 origin,缓存、Service
    Worker、localStorage 全都留着。这正是「老用户升级」与「换了个新端口再看一眼」
    的区别所在。

    `cors=True` 的实例给每个响应加 `Access-Control-Allow-Origin: *` —— 「同源地址
    重定向到允许 CORS 的跨域资源」那条用例需要一台**真的会放行**的跨域服务器,否则
    挡住那一步的是 CORS,而不是被测的那道判断。"""

    def __init__(
        self,
        root: Path,
        content_types: dict[str, str] | None = None,
        cors: bool = False,
    ):
        self.root = Path(root)
        self.content_types = content_types or {}
        self.cors = cors
        self.redirects: dict[str, str] = {}
        self.streams: dict[str, _Stream] = {}
        self.truncated: dict[str, bytes] = {}
        self.stream_written: dict[str, int] = {}
        self.stream_aborted: dict[str, bool] = {}
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.httpd.root = self.root
        self.httpd.content_types = self.content_types
        self.httpd.cors = self.cors
        self.httpd.redirects = self.redirects
        self.httpd.streams = self.streams
        self.httpd.truncated = self.truncated
        self.httpd.stream_written = self.stream_written
        self.httpd.stream_aborted = self.stream_aborted
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

    def redirect(self, relpath: str, target: str, content_type: str | None = None) -> str:
        """一个 302 到 target 的站内路径。target 可以是另一个 origin 上的地址。"""
        path = "/" + relpath
        self.redirects[path] = target
        if content_type is not None:
            self.content_types[path] = content_type
        return path

    def stream(self, relpath: str, body: bytes, loader: bytes, content_type: str) -> str:
        """一份「读不完」的资源,返回它的站内路径。

        `loader` 是页面自己那次 `<img>` 加载拿到的内容(一张正常的图):它必须能正常
        显示,否则按钮所在的容器量不出尺寸。"""
        path = "/" + relpath
        self.streams[path] = _Stream(body, loader, content_type)
        return path

    def truncate(self, relpath: str, body: bytes, loader: bytes) -> str:
        """一份「读到一半就断」的资源,返回它的站内路径。

        `body` 是响应头里 `Content-Length` 声明的那一份,实际只写出去一半;`loader`
        是页面自己那次 `<img>` 加载拿到的正常图(见 `_Truncated`)。"""
        path = "/" + relpath
        self.truncated[path] = _Truncated(body, loader)
        return path

    def bytes_read_by_fetch(self, path: str) -> int:
        """取源那一步从这份响应里实际读走的字节数。"""
        return self.stream_written.get(path, 0)

    def was_cancelled(self, path: str) -> bool:
        """这条响应写到一半被客户端断掉了没有。"""
        return self.stream_aborted.get(path, False)

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


#: 上游拒绝图像输入时的那句话。文案照 Anthropic 的真实措辞写(400 + invalid_request_error),
#: 用例要验的是「这句话没有原样走到用户眼前」,所以它必须是一句认得出来的、带上游细节的话。
IMAGE_REJECTION_BODY = json.dumps(
    {
        "type": "error",
        "error": {
            "type": "invalid_request_error",
            "message": (
                "messages.0.content.1.image.source.base64: This model does not support "
                "image inputs. Request id req_01STUBIMAGE"
            ),
        },
    }
).encode("utf-8")


class StubModel:
    """假的模型 API。把收到的每个请求体抄进 `requests`,用它自己那段 SSE 结束这一轮。

    agent-server 那边只要把 ANTHROPIC_BASE_URL 指过来,这一轮就打不到真的那一侧,
    而「模型收到了什么」是这里抄下来的原件。

    `reject_images` 打开时,带图像块的请求一律收到 400(见 IMAGE_REJECTION_BODY)——
    「模型不收图」这条路径要能被执行到,才谈得上验证界面给出的反馈。"""

    def __init__(self, reject_images: bool = False):
        self.requests: list[dict] = []
        self.reject_images = reject_images
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

    @staticmethod
    def _carries_an_image(body: dict) -> bool:
        for message in body.get("messages", []):
            content = message.get("content")
            if isinstance(content, list) and any(b.get("type") == "image" for b in content):
                return True
        return False

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
        if self.server.owner.reject_images and self._carries_an_image(body):
            self._json_raw(IMAGE_REJECTION_BODY, HTTPStatus.BAD_REQUEST)
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
        self._json_raw(json.dumps(obj).encode("utf-8"), HTTPStatus.OK)

    def _json_raw(self, payload: bytes, status: HTTPStatus):
        self.send_response(status)
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


#: 被挡下来的记录的理由,只有这两种。两者认的都是**错误的出处**,不是「消息里
#: 出现了网址」:一条本站脚本抛出的错误里照样可以有别人的网址,那种错误必须留在
#: `errors` 里 —— 靠消息文本放行,一条真实失败就能靠这句话本身溜过去。
REASON_FOREIGN_SCRIPT = "third-party-script-error"
REASON_FOREIGN_RESOURCE = "third-party-resource-failed"

#: 主题的脚本加载器取不到脚本时抛的那句话的**全部**内容(见 mkdocs-material 的
#: browser/script/index.ts)。认的是这个形状:`Invalid script: <那个地址>`。
INVALID_SCRIPT_RE = re.compile(r"^Invalid script: (\S+)$")

#: 堆栈里的一帧:`at fn (http://host/path:1:2)` 或 `at http://host/path:1:2`。
_STACK_FRAME_RE = re.compile(r"(https?://[^\s()]+?):\d+:\d+")


def assert_no_page_errors(case: unittest.TestCase, browser: "Browser") -> None:
    """这条通路自己这一侧没有异常 —— 连同**被挡下来的那些记录**一起断言。

    挡下来的每一条都必须指得出一个不属于本站与问答后端的地址,理由只有两种(见
    Browser 的归类)。过滤挡错一次,一条真实失败就被藏起来了,所以这件事由断言
    兜住:挡下来的记录要逐条站得住,站不住就地报出来。"""
    for entry in browser.ignored:
        case.assertIn(
            entry["reason"],
            (REASON_FOREIGN_SCRIPT, REASON_FOREIGN_RESOURCE),
            f"挡下来的记录理由不认识:{entry}",
        )
        case.assertTrue(
            browser.is_foreign(entry["origin"]),
            f"挡下来的记录指不出一个第三方地址:{entry}",
        )
    case.assertEqual(
        browser.errors,
        [],
        f"页面上有异常:{browser.errors};被挡下的记录:{browser.ignored}",
    )


class Browser:
    """一个 Chromium 与它的一个页面,顺带收页面上的报错。

    `errors` 收**这条通路自己这一侧**的异常:未捕获异常、被拒的 Promise,以及
    来自站点 origin 或问答后端 origin 的 console.error —— 一条通路里「悄悄抛了个
    TypeError 但界面看起来没事」正是要靠它现形。

    别的 origin 上的失败不进 `errors`,进 `ignored`,每条带得住事的地址与理由:

    - **第三方脚本抛出的错误**:堆栈第一帧(抛错的那个脚本)不在本站与问答后端上;
    - **第三方资源加载失败**:浏览器的 console.error,它自己报的地址是第三方的。

    两处的依据都是**出处**,不是消息文本。主题那个 CDN 取不到 mermaid 时抛的
    `Invalid script: <CDN 地址>` 是唯一一条出处在我们、指向别人的错误:认的是这
    句话的完整形状,地址落在别人那里才挡下,落在这里就是「我们自己的脚本没加载成」,
    照旧进 `errors`。`assert_no_page_errors` 逐条再审一遍这些记录。"""

    def __init__(self, playwright, base: str, service_workers: str = "allow"):
        self.browser = playwright.chromium.launch()
        self.context = self.browser.new_context(service_workers=service_workers)
        self.page = self.context.new_page()
        self.base = base
        self.errors: list[str] = []
        self.ignored: list[dict] = []
        self.page.on("pageerror", self._on_pageerror)
        self.page.on("console", self._on_console)
        self.chat_bodies: list[dict] = []
        self.page.on("request", self._on_request)

    def is_foreign(self, url: str | None) -> bool:
        """这个地址在不在这条通路之外。"""
        return bool(url) and not self._ours(url)

    def _ours(self, url: str) -> bool:
        """这个地址是不是这条通路自己的:本站,或问答后端。"""
        return url.startswith(self.base) or url.startswith(AGENT_ORIGIN)

    def _ignore(self, line: str, origin: str, reason: str) -> None:
        self.ignored.append({"line": line, "origin": origin, "reason": reason})

    @staticmethod
    def _stack_origin(err) -> str:
        """这条错误是从哪个脚本抛出来的:堆栈第一帧的地址(取不到就是空串)。"""
        found = _STACK_FRAME_RE.search(getattr(err, "stack", "") or "")
        return found.group(1) if found is not None else ""

    def _on_pageerror(self, err):
        line = f"pageerror: {err}"
        named = INVALID_SCRIPT_RE.match(str(err))
        if named is not None:
            # 主题的脚本加载器报告某个地址上的脚本没取到。它抛在我们自己的 bundle
            # 里,指的却是那个地址 —— 地址是别人的就挡下,是自己的就是真实失败。
            src = named.group(1)
            if self._ours(src):
                self.errors.append(line)
            else:
                self._ignore(line, src, REASON_FOREIGN_SCRIPT)
            return
        origin = self._stack_origin(err)
        if origin and not self._ours(origin):
            self._ignore(line, origin, REASON_FOREIGN_SCRIPT)
            return
        self.errors.append(line)

    def _on_console(self, msg):
        if msg.type != "error":
            return
        url = (msg.location or {}).get("url") or ""
        line = f"console.error: {msg.text} [{url}]"
        if self.is_foreign(url):
            self._ignore(line, url, REASON_FOREIGN_RESOURCE)
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
