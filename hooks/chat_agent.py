"""AI-PM 文档问答 Agent 前端注入(构建期本地插件)。

从 mkdocs.yml 的 extra.chat_agent 读取开关与缓存击穿版本号,把聊天 widget 的
CSS/JS 追加进 extra_css / extra_javascript(带 ?v= 版本号),随 MkDocs 构建/
serve 注入每页。

纯构建期注入:不 import 任何运行时(Agent SDK 等)、不读环境变量密钥;
缺配置或 enabled 非真时整段跳过(默认不注入)。extra_javascript 条目可能是
纯字符串或 ExtraScriptValue(此处 YAML 写的就是纯字符串),统一按 path 去重。
"""

JS_PATH = "_static/js/chat-widget.js"
CSS_PATH = "_static/css/chat-widget.css"


def on_config(config, **kwargs):
    opts = (config.get("extra") or {}).get("chat_agent") or {}
    if not opts.get("enabled"):
        # 缺配置或未显式开启时默认不注入(曾默认 True,缺配置会注入旧 widget)
        return config
    version = opts.get("version") or 1

    js = f"{JS_PATH}?v={version}"
    if not any(_path_of(e) == JS_PATH for e in config["extra_javascript"]):
        config["extra_javascript"].append(js)

    css = f"{CSS_PATH}?v={version}"
    if not any(_path_of(e) == CSS_PATH for e in config["extra_css"]):
        config["extra_css"].append(css)

    return config


def _path_of(entry):
    """条目可能是纯字符串或 ExtraScriptValue,统一取路径(去掉 ?v= 参数)。"""
    return str(entry).split("?", 1)[0]
