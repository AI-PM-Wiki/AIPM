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

import hashlib
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
from urllib.parse import urlsplit

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


class _Sequence:
    """同一个地址,第 n 次请求给第 n 份字节(用完之后一直是最后那份)。

    「这份响应是从缓存里拿的,还是从服务端拿的」没有别的接口可问 —— 字节自己就是
    答案:拿到第 n 份,说明服务端被问过第 n 次;拿到旧的那一份,说明它来自缓存。
    Service Worker 的缓存策略是「接没接管一条请求」,量的就是这个。"""

    def __init__(self, bodies: list[bytes], content_type: str):
        self.bodies = bodies
        self.content_type = content_type


#: 站点响应头按**项目部署约定**给:生产站 aipm.ac 走 GitHub Pages,源站把
#: Cache-Control 钉成这一个(docs/service-worker.js 与 netlify.toml 里都记着同一句;
#: Netlify 预览另有 netlify.toml 那张「先宽后窄」的路径表)。这里不把 HTTP 缓存统一
#: 关掉 —— 关掉之后「换个根目录就换一版构建」这件事在测试里根本不存在,量的就不是
#: 线上那条路。
CACHE_CONTROL = "public, max-age=600"

#: 取源那条请求的标记头,与 docs/_static/js/chart-context.js 和 docs/service-worker.js
#: 里的那一对是同一对(头名在 Headers 里不分大小写,这里写小写)。用例按它认出
#: 「页面上真正发出去的那条取源请求」,而不是只在字节上推断。
SOURCE_FETCH_HEADER = "x-aipm-source-fetch"
SOURCE_FETCH_VALUE = "chart-context"


class _Handler(http.server.SimpleHTTPRequestHandler):
    """静态文件。多几处:按路径覆盖 Content-Type(「类型限制」那条用例要一个名字
    像图、内容不是图的东西)、按路径回 302(「跨源重定向」那条用例)、按路径流式
    写一份读不完的响应(「读取过程限额」那条用例)、按路径每次换一份字节(「放行
    范围」与「带着旧缓存升级」那两条用例)。"""

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

    def send_header(self, keyword, value):
        """`Last-Modified` 不发:它是文件 mtime,而两份构建的 mtime 先后由建站顺序
        决定,与谁新谁旧无关 —— 换根之后新一版的文件完全可能更旧,浏览器按它回来
        一问,服务端就照着回 304,新的那份字节永远换不上。校验符只由内容定(ETag),
        内容变了校验符就变,这正是线上 CDN 的行为。"""
        if keyword.lower() == "last-modified":
            return
        super().send_header(keyword, value)

    def end_headers(self):
        if getattr(self.server, "cors", False):
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", CACHE_CONTROL)
        etag = self._etag()
        if etag is not None:
            self.send_header("ETag", etag)
        super().end_headers()

    def _etag(self) -> str | None:
        """这个地址此刻那一份字节的校验符(路径上没有文件就不发)。"""
        target = Path(self.translate_path(self.path))
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            return None
        return '"' + hashlib.sha1(target.read_bytes()).hexdigest() + '"'

    def log_request(self, code="-", size="-"):
        """每次响应都记一笔(路径 + 状态 + 带回来的校验条件):用例要问的是「这一次
        刷新,服务端有没有被问过、答的是哪一份」。"""
        self.server.requests.append(
            {
                "path": self.path.split("?", 1)[0],
                "query": self.path.split("?", 1)[1] if "?" in self.path else "",
                "status": int(code) if str(code).isdigit() else 0,
                "if_none_match": self.headers.get("If-None-Match"),
                "if_modified_since": self.headers.get("If-Modified-Since"),
                "source_fetch": self.headers.get(SOURCE_FETCH_HEADER),
            }
        )

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
        sequence = self.server.sequences.get(path)
        if sequence is not None:
            self._sequence(path, sequence)
            return
        super().do_GET()

    def _sequence(self, path: str, sequence: "_Sequence") -> None:
        """第 n 次请求给第 n 份字节 —— 「这份响应是从缓存里拿的,还是从服务端拿的」
        靠字节本身分辨。"""
        served = self.server.sequence_hits.get(path, 0)
        self.server.sequence_hits[path] = served + 1
        self._write_all(sequence.bodies[min(served, len(sequence.bodies) - 1)], sequence.content_type)

    def _stream(self, path: str, stream: _Stream) -> None:
        if self.headers.get("Sec-Fetch-Mode") == "no-cors":
            self._write_all(stream.loader, stream.content_type)
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", stream.content_type)
        self.send_header("Content-Length", str(len(stream.body)))
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
        if self.headers.get("Sec-Fetch-Mode") == "no-cors":
            self._write_all(truncated.loader, "image/png")
            return
        body = truncated.body
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body[: len(body) // 2])
        self.wfile.flush()
        self.close_connection = True

    def _write_all(self, body: bytes, content_type: str) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True

    def log_message(self, *args):  # 用例自己会报关键信息,不必刷访问日志
        pass


class StaticSite:
    """一个静态文件服务。

    `serve(root)` 换根,端口不动 —— 对浏览器来说还是同一个 origin,Service Worker、
    Cache Storage、localStorage 全都留着。这正是「老用户升级」与「换了个新端口再看
    一眼」的区别所在;HTTP 缓存也照线上那份约定活着(见 CACHE_CONTROL),换根之后
    新一版能不能拿到,由服务和浏览器自己按线上那套规则决定。

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
        self.sequences: dict[str, _Sequence] = {}
        self.sequence_hits: dict[str, int] = {}
        self.stream_written: dict[str, int] = {}
        self.stream_aborted: dict[str, bool] = {}
        self.requests: list[dict] = []
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.httpd.root = self.root
        self.httpd.content_types = self.content_types
        self.httpd.cors = self.cors
        self.httpd.redirects = self.redirects
        self.httpd.streams = self.streams
        self.httpd.truncated = self.truncated
        self.httpd.sequences = self.sequences
        self.httpd.sequence_hits = self.sequence_hits
        self.httpd.stream_written = self.stream_written
        self.httpd.stream_aborted = self.stream_aborted
        self.httpd.requests = self.requests
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

    def sequence(self, relpath: str, bodies: list[bytes], content_type: str) -> str:
        """一份「每问一次换一份字节」的资源,返回它的站内路径(见 `_Sequence`)。"""
        path = "/" + relpath
        self.sequences[path] = _Sequence(bodies, content_type)
        return path

    def reset_sequence(self, path: str) -> None:
        """把「问到第几次」归零。同一个类里的几条用例共用这一台服务,计数器会跟着
        串到后一条用例上 —— 每条用例自己开头归零。"""
        self.sequence_hits[path] = 0

    def sequence_count(self, path: str) -> int:
        """这个地址被服务端问到过几次 —— 没被问过就是没被问过,缓存接管了它。"""
        return self.sequence_hits.get(path, 0)

    def requests_for(self, path: str) -> list[dict]:
        """服务端收到的、路径等于 path 的那些请求(带状态与校验条件)。"""
        return [r for r in self.requests if r["path"] == path]

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


#: 被挡下来的记录的理由,只有这两种。两者认的都是**错误的出处**:一条错误的出处是
#: 「抛出它的那个脚本」,一条资源失败记录的出处是「浏览器自己报的那个地址」。消息里
#: 出现了别人的网址不算数 —— 本站脚本抛出的错误里照样可以有别人的网址。
REASON_FOREIGN_SCRIPT = "third-party-script-error"
REASON_FOREIGN_RESOURCE = "third-party-resource-failed"

#: 浏览器自己报「资源没加载成」的那句话的形状(Chromium 的 console.error)。
#: 页面代码弄不出它、也删不掉它 —— 网络层没成,浏览器就报一条。
LOAD_FAILURE_PREFIX = "Failed to load resource: "

#: 主题的脚本加载器取不到脚本时抛的那句话的**全部**内容(见 mkdocs-material 的
#: browser/script/index.ts)。认的是这个形状:`Invalid script: <那个地址>`。
INVALID_SCRIPT_RE = re.compile(r"^Invalid script: (\S+)$")

#: 堆栈里的一帧:`at fn (http://host/path:1:2)` 或 `at http://host/path:1:2`。
_STACK_FRAME_RE = re.compile(r"(https?://[^\s()]+?):\d+:\d+")

#: 没写端口时按协议补上的那个端口。
_DEFAULT_PORTS = {"http": 80, "https": 443}


def origin_of(url: str | None) -> tuple[str, str, int] | None:
    """一个地址的出处:(协议, 主机, 端口)。严格按这三样比,不做字符串前缀比较 ——
    `http://127.0.0.1:1234.example.com/` 与 `http://127.0.0.1:1234` 是两台机器。

    解析不出来的(空串、相对地址、`blob:`、端口不是数字)返回 None:取不到出处也
    就说不出「它在别人那里」,调用方按「出处无法确认」处理。"""
    if not url:
        return None
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    if not parts.scheme or not parts.hostname:
        return None
    if port is None:
        port = _DEFAULT_PORTS.get(parts.scheme.lower())
        if port is None:
            return None
    return (parts.scheme.lower(), parts.hostname.lower(), port)


#: 这条通路之外、页面还会碰到的几处服务,不是被测的东西:
#:   - 批注后端(127.0.0.1:8788):这个底座里没有起它,页面一加载就去取批注,
#:     拿到的是连接被拒(见 docs/_static/js/annotation-store.js 的地址);
#:   - GitHub 的版本接口:主题的 bundle 自己会去问最新发布,匿名请求会回 403;
#:   - giscus:评论区,这个仓库没有配 discussion,回 404。
#: 它们的失败记录每次运行都在,条数还随页面加载次数变,用例没法逐条声明。这张单子
#: 把它们点出来 —— 不是默默放过去:断言里照样逐条核对理由与出处,出处不在这张单子
#: 上的记录必须由用例自己声明。
AMBIENT_ORIGINS = tuple(
    origin
    for origin in (
        origin_of("http://127.0.0.1:8788"),
        origin_of("https://api.github.com"),
        origin_of("https://giscus.app"),
    )
    if origin is not None
)


def assert_no_page_errors(
    case: unittest.TestCase,
    browser: "Browser",
    expected_load_failures: tuple[str, ...] = (),
    expected_ignored: tuple[tuple[str, str], ...] = (),
) -> None:
    """这条通路自己这一侧没有异常 —— 连同**被挡下来的那些记录**一起断言。

    挡下来的记录逐项核:理由只有两种;指出的那个地址确实在别人那里(按 origin 比);
    而且那个地址在**这条记录自己身上**找得到 —— 过滤器不能凭空造一个地址出来。
    `expected_ignored` 是这条用例知道会被挡下的那些(地址, 理由),与实际挡下的
    (底座外面那两处服务的记录除外,见 AMBIENT_ORIGINS)逐条对齐,多了少了都报出来:
    挡错一次,一条真实失败就被藏起来了。

    `expected_load_failures` 是**这条用例自己弄坏的那些地址**(「正文读到一半断掉」
    那份素材就是这样):资源没加载成时浏览器自己会报一条 console.error,页面代码
    既弄不出它、也删不掉它。声明的与实际报出来的必须一致 —— 声明了却没报出来,
    同样算这条用例站不住。"""
    errors, ignored, load_failures = browser.classify()

    case.assertEqual(
        tuple(expected_ignored),
        tuple(
            (entry["origin"], entry["reason"])
            for entry in ignored
            if not browser.is_ambient(entry["origin"])
        ),
        f"挡下来的记录与预期对不上;实际挡下的是 {ignored}",
    )
    for entry in ignored:
        case.assertIn(
            entry["reason"],
            (REASON_FOREIGN_SCRIPT, REASON_FOREIGN_RESOURCE),
            f"挡下来的记录理由不认识:{entry}",
        )
        case.assertTrue(
            browser.is_foreign(entry["origin"]),
            f"挡下来的记录指不出一个第三方地址:{entry}",
        )
        case.assertIn(
            entry["origin"],
            entry["line"],
            f"挡下来的记录里找不到它指的那个地址:{entry}",
        )

    broken = set(expected_load_failures)
    reported = {entry["url"] for entry in load_failures}
    case.assertEqual(
        sorted(broken),
        sorted(reported),
        f"用例自己弄坏的地址与实际报出来的对不上;浏览器实际报的是 {load_failures}",
    )
    tolerated = [entry["line"] for entry in load_failures if entry["url"] in broken]
    case.assertEqual(
        errors,
        tolerated,
        f"页面上有异常:{errors};用例自己弄坏的只有 {sorted(broken)},"
        f"它们能留下的是 {tolerated};被挡下的记录:{ignored}",
    )


class Browser:
    """一个 Chromium 与它的一个页面,顺带收页面上的报错。

    收到的异常分两类,分的时候只看**出处**:

    - 出处是本站或问答后端的,或者**根本解析不出出处**的 → 这一侧的真实失败;
      后者按失败计入 —— 「拿不准是不是别人的」不是放行的理由。
    - 出处确实在别人那里的 → 挡下,每条带得住事的地址与理由:
      - **第三方脚本抛出的错误**:堆栈第一帧(抛出它的那个脚本)不在本站与问答
        后端上;
      - **第三方资源加载失败**:浏览器自己报的那条,它报的地址是第三方的。

    主题那个 CDN 取不到 mermaid 时抛的 `Invalid script: <CDN 地址>` 是唯一一条
    「出处在我们、说的是别人」的错误 —— 它抛在我们自己的 bundle 里。这一条不靠
    消息里的那个地址放行,靠**证据**:浏览器自己得报过那个地址的资源没加载成,
    两条对得上才挡下;对不上就是我们的错误,照旧计入失败。"""

    def __init__(self, playwright, base: str, service_workers: str = "allow"):
        self.browser = playwright.chromium.launch()
        self.context = self.browser.new_context(service_workers=service_workers)
        self.page = self.context.new_page()
        self.base = base
        self.ours = {o for o in (origin_of(base), origin_of(AGENT_ORIGIN)) if o is not None}
        self.page_errors: list[dict] = []
        self.console_errors: list[dict] = []
        self.failed_requests: dict[str, str] = {}
        self.page.on("pageerror", self._on_pageerror)
        self.page.on("console", self._on_console)
        self.page.on("requestfailed", self._on_requestfailed)
        self.chat_bodies: list[dict] = []
        self.marked_requests: list[dict] = []
        self.page.on("request", self._on_request)

    def is_ours(self, url: str | None) -> bool:
        """这个地址是不是这条通路自己的:本站,或问答后端。"""
        origin = origin_of(url)
        return origin is not None and origin in self.ours

    def is_foreign(self, url: str | None) -> bool:
        """这个地址确实在别人那里。解析不出出处的一律不算 —— 那种情况计入失败。"""
        origin = origin_of(url)
        return origin is not None and origin not in self.ours

    def is_ambient(self, url: str | None) -> bool:
        """这个地址属于底座外面还会被碰到的那些服务(见 AMBIENT_ORIGINS)。"""
        origin = origin_of(url)
        return origin is not None and origin in AMBIENT_ORIGINS

    def _ignore(self, line: str, origin: str, reason: str) -> dict:
        return {"line": line, "origin": origin, "reason": reason}

    @staticmethod
    def _throw_origin(err) -> str:
        """抛出这条错误的脚本的地址:堆栈里的第一帧。

        只从第二行起找 —— 第一行是消息本身,而消息里可以出现任何网址(一条本站
        脚本抛出的错误里写着一个别人的地址,不能因此就算别人的)。堆栈里没有帧
        (非 Error 的值、被浏览器抹掉细节的跨域脚本)就返回空串,由调用方按「出处
        无法确认」计入失败。"""
        for line in (getattr(err, "stack", "") or "").splitlines()[1:]:
            found = _STACK_FRAME_RE.search(line)
            if found is not None:
                return found.group(1)
        return ""

    def _load_failed(self, url: str) -> bool:
        """浏览器自己报过这个地址没加载成:网络层失败,或者它自己打的那条
        console.error。两条都是浏览器给的,页面代码造不出来。"""
        if url in self.failed_requests:
            return True
        return any(
            entry["url"] == url and entry["text"].startswith(LOAD_FAILURE_PREFIX)
            for entry in self.console_errors
        )

    def _on_pageerror(self, err):
        stack = getattr(err, "stack", "") or ""
        named = INVALID_SCRIPT_RE.match(str(err))
        self.page_errors.append(
            {
                "line": f"pageerror: {err}\n{stack}" if stack else f"pageerror: {err}",
                "throw_origin": self._throw_origin(err),
                "named_url": named.group(1) if named is not None else "",
            }
        )

    def _on_requestfailed(self, request):
        self.failed_requests[request.url] = str(request.failure or "")

    def _on_console(self, msg):
        if msg.type != "error":
            return
        url = (msg.location or {}).get("url") or ""
        self.console_errors.append(
            {"line": f"console.error: {msg.text} [{url}]", "url": url, "text": msg.text}
        )

    def classify(self) -> tuple[list[str], list[dict], list[dict]]:
        """把收到的异常分成三份:这一侧的真实失败、挡下来的记录、浏览器自己报的
        「资源没加载成」。每次调用都从原始记录重算,判据只依赖记录本身。"""
        errors: list[str] = []
        ignored: list[dict] = []
        load_failures: list[dict] = []
        for entry in self.page_errors:
            if self.is_foreign(entry["throw_origin"]):
                ignored.append(
                    self._ignore(entry["line"], entry["throw_origin"], REASON_FOREIGN_SCRIPT)
                )
                continue
            if (
                self.is_foreign(entry["named_url"])
                and self._load_failed(entry["named_url"])
            ):
                ignored.append(
                    self._ignore(entry["line"], entry["named_url"], REASON_FOREIGN_SCRIPT)
                )
                continue
            errors.append(entry["line"])
        for entry in self.console_errors:
            if self.is_foreign(entry["url"]):
                ignored.append(
                    self._ignore(entry["line"], entry["url"], REASON_FOREIGN_RESOURCE)
                )
                continue
            if entry["text"].startswith(LOAD_FAILURE_PREFIX):
                load_failures.append(entry)
            errors.append(entry["line"])
        return errors, ignored, load_failures

    def _on_request(self, request):
        if request.method == "POST" and request.url.endswith("/api/chat"):
            payload = request.post_data
            if payload:
                self.chat_bodies.append(json.loads(payload))
            return
        marker = request.headers.get(SOURCE_FETCH_HEADER)
        if marker:
            self.marked_requests.append({"url": request.url, "value": marker})

    def goto(self, path: str):
        self.page.goto(self.base + path, wait_until="load")
        return self.page

    def close(self) -> None:
        self.context.close()
        self.browser.close()


def _path_env() -> str:
    return os.environ.get("PATH", "/usr/bin:/bin:/usr/local/bin")
