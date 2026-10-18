"""浏览器用例的素材:真图、超限的图、名字像图但内容不是图的东西,以及一份载荷 SVG。

图是**按 PNG 规范写出来的**(zlib 压缩 + CRC 分块),不是从哪儿拷来的 —— 用例要拿
字节本身做比对,得先有一份自己算得出来的字节。
"""
from __future__ import annotations

import random
import struct
import zlib


def _chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def png(width: int, height: int, seed: int) -> bytes:
    """写一张 8 位真彩 PNG。seed 决定像素,同一 seed 每次得到同一份字节。

    像素用伪随机数:随机内容的 deflate 几乎压不动,尺寸因此可控 —— 「体积限制」
    那条用例要一张真的超过 512 KiB 的图。
    """
    rng = random.Random(seed)
    raw = bytearray()
    for _ in range(height):
        raw.append(0)  # 每行的过滤器:无
        raw += bytes(rng.getrandbits(8) for _ in range(width * 3))
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )


#: 一份带外链与事件属性的 SVG —— 浏览器解析它时会去取那张不存在的图,从而触发
#: onerror。它经 innerHTML 进页面时是**活的**,经取源那条路时必须是死的。
PAYLOAD_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">
  <title>载荷图</title>
  <image href="/definitely-missing.png" width="10" height="10" onerror="window.__aipmPwned = true"/>
  <text x="0" y="20">图里的文字</text>
</svg>
""".encode("utf-8")

#: 一张规规矩矩的 SVG:取源读得到 title 与 text。
PLAIN_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">
  <title>流程示意</title>
  <text x="0" y="20">入库侧</text>
  <text x="0" y="30">查询处理</text>
</svg>
""".encode("utf-8")

#: 名字像图、内容是一段 HTML。两种用法:
#:   - 配 text/html:content-type 那一道前置筛子就该拦下;
#:   - 配 image/png:筛子放行,由**字节开头**那一道认出来不是图。
NOT_AN_IMAGE = "<!doctype html><html><body><p>这不是一张图。</p></body></html>\n".encode("utf-8")


def oversized(body_head: bytes, total: int) -> bytes:
    """一份「读不完」的响应:开头是真东西,后面是填充,总量远超任何合理的读取上限。

    开头按各自的格式起:位图是 PNG 的签名,那样它是一张真的会被当成图处理的响应,
    而不是「一眼就看得出不是图」的东西 —— 用例要验的正是「读的过程有没有上限」,
    所以它必须先过类型那一关。"""
    return body_head + b"\x00" * (total - len(body_head))
