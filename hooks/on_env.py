import re

def _nav_math():
    raw_re = r"\\\((.+?)\\\)"
    target = r'<span class="arithmatex">\(\1\)</span>'
    r = re.compile(raw_re)
    def nav_math(s):
        return r.sub(target, s).replace(" <span", "&nbsp;<span").replace("</span> ", "</span>&nbsp;")
    return nav_math

def on_env(env, config, files, **kwargs):
    env.filters["nav_math"] = _nav_math()
    return env

def on_config(config, **kwargs):
    # mkdocs 内置 search 插件会把经典主题的搜索 UI(search/main.js)注入每页,
    # 本仓库用 Material 模板渲染搜索,该脚本是死代码且依赖经典主题的 base_url 全局变量,
    # 每页加载都会抛 ReferenceError。hook 在插件 on_config 之后执行,这里摘掉它。
    try:
        config["extra_javascript"].remove("search/main.js")
    except ValueError:
        pass
    return config
