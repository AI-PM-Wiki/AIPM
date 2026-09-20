"""AI-PM 批注系统前端注入(构建期本地插件)。

从 mkdocs.yml 的 extra.annotation 读取开关与缓存击穿版本号,把批注面板的
CSS/JS 追加进 extra_css / extra_javascript(带 ?v= 版本号),随 MkDocs 构建/
serve 注入每页。

为什么走 hook 而不是直接写在 mkdocs.yml 的清单里:与 hooks/chat_agent.py 同款,
好处是「一处开关 + 一处版本号」——关掉 extra.annotation.enabled 就整组资源都不
注入,改资源只改 version,不必在 YAML 里逐条改 ?v=。两个面板的注入方式也因此
一致,日后加第三个面板不用重新决定风格。

依赖顺序:三个 JS 必须按 store → auth → panel 的顺序执行(后一个在 IIFE 里直接
读前一个挂在 window 上的命名空间)。共享件 panel-shared.js 不在这里注入 ——
它同时被 AI 助手面板依赖,写在 mkdocs.yml 的 extra_javascript 里,靠静态条目
天然排在两个 hook 追加的资源之前。

纯构建期注入:不 import 任何运行时、不读环境变量密钥;缺配置或 enabled 非真时
整段跳过(默认不注入)。extra_javascript 条目可能是纯字符串或 ExtraScriptValue,
统一按 path 去重。
"""

JS_PATHS = [
    "_static/js/annotation-store.js",
    "_static/js/annotation-auth.js",
    "_static/js/annotation.js",
]
CSS_PATHS = ["_static/css/annotation.css"]


def on_config(config, **kwargs):
    opts = (config.get("extra") or {}).get("annotation") or {}
    if not opts.get("enabled"):
        # 缺配置或未显式开启时默认不注入
        return config
    version = opts.get("version") or 1

    for path in JS_PATHS:
        entry = f"{path}?v={version}"
        if not any(_path_of(e) == path for e in config["extra_javascript"]):
            config["extra_javascript"].append(entry)

    for path in CSS_PATHS:
        entry = f"{path}?v={version}"
        if not any(_path_of(e) == path for e in config["extra_css"]):
            config["extra_css"].append(entry)

    return config


def _path_of(entry):
    """条目可能是纯字符串或 ExtraScriptValue,统一取路径(去掉 ?v= 参数)。"""
    return str(entry).split("?", 1)[0]
