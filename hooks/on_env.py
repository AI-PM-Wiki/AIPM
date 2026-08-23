import json
import os
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

def _chunk_sentences(text):
    """按中文句子边界(。！？!?)切块;无句号的超长块(代码/表格/列表)再按停顿符硬切。"""
    chunks = []
    for s in re.split(r"(?<=[。！？!?])", text):
        s = s.strip()
        if not s:
            continue
        while len(s) > 150:
            # 在 [20, 120] 区间找最后一个停顿符,找不到就硬切 120 字
            cut = max([120] + [
                p for p in (s.rfind(c, 0, 120) for c in "，,、;； ")
                if p >= 20
            ])
            chunks.append(s[: cut + 1].rstrip())
            s = s[cut + 1:].strip()
        if s:
            chunks.append(s)
    return chunks

def on_post_build(config, **kwargs):
    # 内置 search 插件把整页文本抹成一行(无 HTML 标签),Material 搜索 worker
    # 的摘要机制按块级标签切块,于是整页=一块,命中词所在"块"=全文。
    # 这里把 text 按句子切成 <p> 块,恢复「命中句摘要」(最多两句)。
    path = os.path.join(config["site_dir"], "search", "search_index.json")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        index = json.load(f)
    for doc in index.get("docs", []):
        text = doc.get("text")
        if not text or "<p>" in text:
            continue
        chunks = _chunk_sentences(text)
        if len(chunks) > 1:
            doc["text"] = "<p>" + "</p><p>".join(chunks) + "</p>"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False)
