#!/usr/bin/env python3
"""AIPM banner generator — Specimen Alphabet.

设计哲学见同目录 philosophy.md。四个字母(A/I/P/M)作为剖面窗口,
内部以密集术语织物填充;墨蓝底 + 纸白词条 + 琥珀强调 + 发丝网格 + 四角图注。

用法: python3 scripts/banner/aipm_banner.py
输出: scripts/banner/output/aipm-banner-1600.png (2:1 母版)
      scripts/banner/output/aipm-banner-1280.png (GitHub social preview)
"""

import os
import random
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ---------------------------------------------------------------- constants
W, H = 1600, 800            # 母版尺寸
SCALE = 2                   # 超采样倍数(渲染 3200x1600 后降采样,文字更锐)
CW, CH = W * SCALE, H * SCALE

INK = (11, 14, 19)          # 墨蓝黑底
PAPER = (232, 228, 218)     # 纸白词条
AMBER = (217, 154, 43)      # 琥珀强调
GRAY = (126, 136, 150)      # 灰调(次要词条 / 图注)
GRID_A = 10                 # 发丝网格 alpha
TICK_A = 210                # 裁切标记 alpha

# canvas-fonts 目录:默认取 agent-skills 缓存路径,可用环境变量 AIPM_FONTS_DIR 覆盖
DEFAULT_FONTS_DIR = os.path.expanduser(
    "~/.claude/plugins/cache/anthropic-agent-skills/"
    "example-skills/3b3fad96af16/skills/canvas-design/canvas-fonts"
)
FONTS_DIR = os.environ.get("AIPM_FONTS_DIR") or DEFAULT_FONTS_DIR
SYSTEM_DIR = "/System/Library/Fonts"

F_LETTERS = os.path.join(FONTS_DIR, "BigShoulders-Bold.ttf")
F_MONO = os.path.join(FONTS_DIR, "IBMPlexMono-Regular.ttf")
F_MONO_HERO = os.path.join(FONTS_DIR, "IBMPlexMono-Bold.ttf")
REQUIRED_FONTS = (F_LETTERS, F_MONO, F_MONO_HERO)   # 缺失即报错退出,见 ensure_fonts()
F_CJK = os.path.join(SYSTEM_DIR, "Hiragino Sans GB.ttc")   # index 0=W3 1=W6
F_CJK_BOLD = os.path.join(SYSTEM_DIR, "Hiragino Sans GB.ttc")

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")

# ---------------------------------------------------------------- term banks
# 词条全部取自 docs/intro/glossary.md 与站点主题,按字母分主题
TERMS = {
    "A": dict(
        bank=["LLM", "Token", "RAG", "Agent", "Prompt", "多模态", "幻觉", "涌现", "对齐",
              "微调", "RLHF", "CoT", "思维链", "Function Calling", "知识库", "向量检索",
              "Embedding", "评测", "蒸馏", "温度", "采样", "工具调用", "智能体", "记忆",
              "MCP", "Copilot", "上下文窗口", "上下文工程", "Rerank", "重排序", "人机协同",
              "Agentic", "工作流", "缓存", "路由", "量化", "LoRA", "PEFT", "ReAct", "思维树"],
        hero=["LLM", "RAG", "AGENT", "PROMPT"],
    ),
    "I": dict(
        # I 字母窄(164px @2x),只收短词条,长词条放不下会被跳过、行会空
        bank=["PRD", "MRD", "BRD", "MVP", "PMF", "KANO", "MOT", "痛点", "痒点",
              "场景", "埋点", "迭代", "原型", "走查", "触点", "需求池", "用户画像",
              "竞品分析", "线框图", "组件化", "信息架构", "双钻模型", "峰终定律",
              "需求评审", "体验地图", "用户访谈", "灰度发布", "用户故事", "尼尔森",
              "A/B 测试"],
        hero=["PRD", "MVP", "PMF"],
    ),
    "P": dict(
        bank=["抓手", "闭环", "颗粒度", "赋能", "拉通", "沉淀", "复盘", "对标", "护城河",
              "破圈", "冷启动", "中台", "矩阵", "操盘", "顶层设计", "底层逻辑", "心智",
              "链路", "声量", "势能", "点线面", "组合拳", "第二曲线", "基本盘", "降维打击",
              "OKR", "KPI", "北极星", "漏斗", "归因", "复用打法", "赛马", "外溢", "倒逼",
              "SOP", "DDL", "排期", "站会", "干系人", "灰度"],
        hero=["闭环", "抓手", "北极星"],
    ),
    "M": dict(
        bank=["LTV", "CAC", "GMV", "ROI", "NPS", "DAU", "MAU", "留存", "裂变", "私域",
              "公域", "飞轮", "网络效应", "PLG", "人货场", "千人千面", "复购率", "客单价",
              "品效合一", "全域营销", "下沉市场", "TAM", "SAM", "SOM", "GTM", "DTC",
              "C2M", "会员体系", "RFM", "AARRR", "探索与利用", "流量池", "种草", "拉新",
              "促活", "转化", "召回", "漏斗"],
        hero=["LTV", "ROI", "裂变"],
    ),
}

GAP = 64                    # 字母间距(2x)
MARGIN = 260                # 左右边距(2x)
ROW_H = 34                  # 词条行高(2x)
TERM_SIZE = 26              # 常规词条字号(2x)
HERO_SIZE = 48              # 强调词条字号(2x)
LABEL_SIZE = 22             # 图注字号(2x)

SEEDS = {"A": 7, "I": 19, "P": 23, "M": 37}   # 固定随机种子,可复现


# ------------------------------------------------------------------ helpers
def ensure_fonts():
    """校验字体目录与所需字体文件存在;缺失则清晰报错退出,不隐式失败。

    默认目录不可用时,把含上述 ttf 的目录用环境变量指给脚本:
      AIPM_FONTS_DIR=/path/to/canvas-fonts python3 scripts/banner/aipm_banner.py
    """
    problems = []
    if not os.path.isdir(FONTS_DIR):
        problems.append(f"字体目录不存在: {FONTS_DIR}")
    else:
        for path in REQUIRED_FONTS:
            if not os.path.isfile(path):
                problems.append(f"字体文件缺失: {path}")
    if problems:
        print("[aipm_banner] 字体不可用,无法生成横幅:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print(
            f"尝试过的字体目录: {FONTS_DIR}\n"
            f"(默认: {DEFAULT_FONTS_DIR})\n"
            "如字体在其他位置,请以环境变量指定后重试:\n"
            "  AIPM_FONTS_DIR=/path/to/canvas-fonts python3 scripts/banner/aipm_banner.py",
            file=sys.stderr,
        )
        sys.exit(1)


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


def cjk_font(size, bold=False):
    return font(F_CJK, size, index=1 if bold else 0)


def term_style(rng):
    """决定词条着色:纸白为主、琥珀次之、灰调点缀。"""
    r = rng.random()
    if r < 0.5:
        return "paper"
    if r < 0.78:
        return "amber"
    return "gray"


# -------------------------------------------------------------------- masks
def build_letter_masks():
    """把四个字母逐个渲染成掩膜,得到 bbox 与字形轮廓。"""
    masks, boxes = {}, {}
    for ch in "AIPM":
        mask = Image.new("L", (CW, CH), 0)
        d = ImageDraw.Draw(mask)
        d.text((0, 0), ch, font=F_LETTERS_FONT, fill=255)
        boxes[ch] = mask.getbbox()
        masks[ch] = mask
    return masks, boxes


def fit_letter_font(target_span, gap):
    """二分法求字号,使 AIPM 总宽(含间距)不超过可用宽度。"""
    lo, hi = 400, 2400
    while lo < hi:
        mid = (lo + hi + 1) // 2
        f = font(F_LETTERS, mid)
        widths = [f.getbbox(c)[2] - f.getbbox(c)[0] for c in "AIPM"]
        span = sum(widths) + gap * 3
        if span <= target_span:
            lo = mid
        else:
            hi = mid - 1
    return font(F_LETTERS, lo)


def place_letters():
    """返回每字母的『已摆放』掩膜(字形位于最终画布坐标,可直接 getbbox 使用)。"""
    f = fit_letter_font(CW - 2 * MARGIN, GAP)
    global F_LETTERS_FONT
    F_LETTERS_FONT = f
    masks, boxes = build_letter_masks()
    widths = [boxes[c][2] - boxes[c][0] for c in "AIPM"]
    span = sum(widths) + GAP * 3
    x = (CW - span) // 2
    placed = {}
    for ch, w in zip("AIPM", widths):
        box = boxes[ch]
        # 垂直方向:按掩膜视觉中心对齐
        y = (CH - (box[3] - box[1])) // 2 - 16
        placed_mask = Image.new("L", (CW, CH), 0)
        placed_mask.paste(masks[ch], (x - box[0], y - box[1]))
        placed[ch] = placed_mask
        x += w + GAP
    return placed


# ------------------------------------------------------------------ painting
def paint_term_field(bg, placed):
    """逐字母在掩膜内画词条织物,用字母掩膜裁切后合成到背景。"""
    for ch in "AIPM":
        mask = placed[ch]
        bbox = mask.getbbox()
        left, top, right, bottom = bbox
        rng = random.Random(SEEDS[ch])
        bank = TERMS[ch]["bank"]
        hero_bank = TERMS[ch]["hero"]
        order = list(bank)
        rng.shuffle(order)
        idx = 0
        canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        d = ImageDraw.Draw(canvas)

        f_paper = cjk_font(TERM_SIZE)
        f_hero = cjk_font(HERO_SIZE, bold=True)
        fm_paper = font(F_MONO, TERM_SIZE)
        fm_hero = font(F_MONO_HERO, HERO_SIZE)
        x, y = left + 6, top + 6

        row = 0
        while y < bottom - 4:
            x = left + 6
            if row % 5 == 0 and hero_bank:
                # 每 5 行一个 hero 词条:占双行带并垂直居中,不与相邻行重叠
                term = hero_bank[row // 5 % len(hero_bank)]
                fnt = fm_hero if term.isascii() else f_hero
                w = fnt.getbbox(term)[2] - fnt.getbbox(term)[0]
                if x + w < right - 6:
                    d.text((x, y + (ROW_H * 2 - HERO_SIZE) // 2), term,
                           font=fnt, fill=AMBER)
                y += ROW_H * 2
                row += 2
                continue
            while x < right - 16:
                term = order[idx % len(order)]
                idx += 1
                latin = term.isascii()
                fnt = fm_paper if latin else f_paper
                style = term_style(rng)
                fill = AMBER if style == "amber" else (GRAY if style == "gray" else PAPER)
                w = fnt.getbbox(term)[2] - fnt.getbbox(term)[0]
                if x + w > right - 10:
                    break
                d.text((x, y), term, font=fnt, fill=fill)
                x += w + 16
            y += ROW_H
            row += 1

        # 用字母掩膜裁切词条画布(掩膜自带抗锯齿灰度)
        canvas.putalpha(mask)
        bg.alpha_composite(canvas, (0, 0))
        # 字母轮廓:掩膜边缘提取,1px 琥珀描边
        ring = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        edge_map = mask.filter(ImageFilter.FIND_EDGES)
        ring.paste(Image.new("RGBA", (CW, CH), (*AMBER, 255)), (0, 0),
                   Image.eval(edge_map, lambda p: 255 if p > 128 else 0))
        bg.alpha_composite(ring, (0, 0))
    return bg


def paint_background(bg):
    d = ImageDraw.Draw(bg)
    d.rectangle((0, 0, CW, CH), fill=INK)
    # 发丝网格
    g = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    for x in range(0, CW + 1, 160):
        gd.line((x, 0, x, CH), fill=(255, 255, 255, GRID_A))
    for y in range(0, CH + 1, 160):
        gd.line((0, y, CW, y), fill=(255, 255, 255, GRID_A))
    bg.alpha_composite(g)
    # 上下通栏细线
    for y in (96, CH - 96):
        d.line((MARGIN, y, CW - MARGIN, y), fill=(255, 255, 255, 46))
    # 四角裁切标记(琥珀)
    t = 3
    L, R, T2, B = MARGIN - 8, CW - MARGIN + 8, 88, CH - 88
    mark = [(L, T2, L + 96, T2), (L, T2, L, T2 + 96), (R - 96, T2, R, T2),
            (R, T2, R, T2 + 96), (L, B, L + 96, B), (L, B - 96, L, B),
            (R - 96, B, R, B), (R, B - 96, R, B)]
    for x0, y0, x1, y1 in mark:
        d.line((x0, y0, x1, y1), fill=(*AMBER, TICK_A), width=t)
    return bg


def paint_labels(bg):
    d = ImageDraw.Draw(bg)
    fm = font(F_MONO, LABEL_SIZE)
    fcjk = cjk_font(LABEL_SIZE)
    gray = (140, 148, 160, 230)
    L, R = MARGIN - 8, CW - MARGIN + 8
    d.text((L, 112), "AI-PM · KNOWLEDGE WIKI", font=fm, fill=gray)
    t = "LEXICON — 200+ TERMS"
    d.text((R - fm.getlength(t), 112), t, font=fm, fill=gray)
    t = "FIG.01 · TERMINAL ALPHABET — CUTAWAY NO.4"
    d.text((L, CH - 168), t, font=fm, fill=gray)
    t = "N 30.26 / E 120.09 · HANGZHOU"
    d.text((R - fm.getlength(t), CH - 168), t, font=fm, fill=gray)
    # 底部中央中文落款
    t = "AI 产品经理知识库 · 方法论 / 能力 / 工具 / 案例"
    d.text(((CW - fcjk.getlength(t)) / 2, CH - 168), t, font=fcjk,
           fill=(112, 122, 136, 220))


# ---------------------------------------------------------------------- main
def main():
    ensure_fonts()
    os.makedirs(OUT_DIR, exist_ok=True)
    bg = Image.new("RGBA", (CW, CH), (*INK, 255))
    paint_background(bg)
    placed = place_letters()
    paint_term_field(bg, placed)
    paint_labels(bg)
    img = bg.convert("RGB")

    p1600 = os.path.join(OUT_DIR, "aipm-banner-1600.png")
    img.resize((W, H), Image.LANCZOS).save(p1600)
    p1280 = os.path.join(OUT_DIR, "aipm-banner-1280.png")
    img.resize((1280, 640), Image.LANCZOS).save(p1280)
    print("ok:", p1600, p1280)


if __name__ == "__main__":
    main()
