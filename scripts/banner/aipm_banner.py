#!/usr/bin/env python3
"""AIPM banner generator — Specimen Alphabet.

设计哲学见同目录 philosophy.md。四个字母(A/I/P/M)作为剖面窗口,
内部以密集术语织物填充;墨蓝底 + 纸白词条 + 琥珀强调 + 发丝网格 + 四角图注。

用法: python3 scripts/banner/aipm_banner.py
输出: scripts/banner/output/aipm-banner-1600.png (2:1 母版)
      scripts/banner/output/aipm-banner-1280.png (GitHub social preview)
      docs/social-card.png (1200x630 社交分享图,og:image / social card)
"""

import os
import random
import sys
from dataclasses import dataclass
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ---------------------------------------------------------------- constants
BASE_W, BASE_H = 1600, 800        # 母版基准尺寸
SCALE = 2                   # 超采样倍数(渲染 2 倍画布后降采样,文字更锐)

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
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(OUT_DIR)))
SOCIAL_PATH = os.path.join(REPO_ROOT, "docs", "social-card.png")


# ------------------------------------------------------- layout (per target)
@dataclass(frozen=True)
class Layout:
    """目标尺寸下、经比例换算的画布与排版参数(均为 2x 画布坐标)。"""
    w: int
    h: int
    cw: int                # 画布宽(2x)
    ch: int                # 画布高(2x)
    gap: int               # 字母间距
    margin: int            # 左右边距
    row_h: int             # 词条行高
    term_size: int         # 常规词条字号
    hero_size: int         # 强调词条字号
    label_size: int        # 图注字号
    grid_step: int         # 发丝网格步长
    line_off: int          # 上下通栏细线距边
    corner_off: int        # 裁切标记距边
    label_top: int         # 顶部图注 Y
    label_bottom_off: int  # 底部图注距底(CH - 该值)
    letter_vshift: int     # 字母组垂直微调


# 母版(1600x800)排版基准,其余目标尺寸按宽度比例换算(见 make_layout)
_BASE_LAYOUT = dict(
    gap=64, margin=260, row_h=34, term_size=26, hero_size=48,
    label_size=22, grid_step=160, line_off=96, corner_off=88,
    label_top=112, label_bottom_off=168, letter_vshift=-16,
)


def make_layout(target_w, target_h):
    """按宽度比例从母版基准换算排版参数;母版本身 s=1 时逐项与原值一致。"""
    s = target_w / BASE_W
    cw, ch = target_w * SCALE, target_h * SCALE
    return Layout(
        w=target_w, h=target_h, cw=cw, ch=ch,
        gap=round(_BASE_LAYOUT["gap"] * s),
        margin=round(_BASE_LAYOUT["margin"] * s),
        row_h=round(_BASE_LAYOUT["row_h"] * s),
        term_size=round(_BASE_LAYOUT["term_size"] * s),
        hero_size=round(_BASE_LAYOUT["hero_size"] * s),
        label_size=round(_BASE_LAYOUT["label_size"] * s),
        grid_step=round(_BASE_LAYOUT["grid_step"] * s),
        line_off=round(_BASE_LAYOUT["line_off"] * s),
        corner_off=round(_BASE_LAYOUT["corner_off"] * s),
        label_top=round(_BASE_LAYOUT["label_top"] * s),
        label_bottom_off=round(_BASE_LAYOUT["label_bottom_off"] * s),
        letter_vshift=round(_BASE_LAYOUT["letter_vshift"] * s),
    )


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
def build_letter_masks(layout):
    """把四个字母逐个渲染成掩膜,得到 bbox 与字形轮廓。"""
    masks, boxes = {}, {}
    for ch in "AIPM":
        mask = Image.new("L", (layout.cw, layout.ch), 0)
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


def place_letters(layout):
    """返回每字母的『已摆放』掩膜(字形位于最终画布坐标,可直接 getbbox 使用)。"""
    f = fit_letter_font(layout.cw - 2 * layout.margin, layout.gap)
    global F_LETTERS_FONT
    F_LETTERS_FONT = f
    masks, boxes = build_letter_masks(layout)
    widths = [boxes[c][2] - boxes[c][0] for c in "AIPM"]
    span = sum(widths) + layout.gap * 3
    x = (layout.cw - span) // 2
    placed = {}
    for ch, w in zip("AIPM", widths):
        box = boxes[ch]
        # 垂直方向:按掩膜视觉中心对齐
        y = (layout.ch - (box[3] - box[1])) // 2 + layout.letter_vshift
        placed_mask = Image.new("L", (layout.cw, layout.ch), 0)
        placed_mask.paste(masks[ch], (x - box[0], y - box[1]))
        placed[ch] = placed_mask
        x += w + layout.gap
    return placed


# ------------------------------------------------------------------ painting
def paint_term_field(bg, placed, layout):
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
        canvas = Image.new("RGBA", (layout.cw, layout.ch), (0, 0, 0, 0))
        d = ImageDraw.Draw(canvas)

        f_paper = cjk_font(layout.term_size)
        f_hero = cjk_font(layout.hero_size, bold=True)
        fm_paper = font(F_MONO, layout.term_size)
        fm_hero = font(F_MONO_HERO, layout.hero_size)
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
                    d.text((x, y + (layout.row_h * 2 - layout.hero_size) // 2), term,
                           font=fnt, fill=AMBER)
                y += layout.row_h * 2
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
            y += layout.row_h
            row += 1

        # 用字母掩膜裁切词条画布(掩膜自带抗锯齿灰度)
        canvas.putalpha(mask)
        bg.alpha_composite(canvas, (0, 0))
        # 字母轮廓:掩膜边缘提取,1px 琥珀描边
        ring = Image.new("RGBA", (layout.cw, layout.ch), (0, 0, 0, 0))
        edge_map = mask.filter(ImageFilter.FIND_EDGES)
        ring.paste(Image.new("RGBA", (layout.cw, layout.ch), (*AMBER, 255)), (0, 0),
                   Image.eval(edge_map, lambda p: 255 if p > 128 else 0))
        bg.alpha_composite(ring, (0, 0))
    return bg


def paint_background(bg, layout):
    d = ImageDraw.Draw(bg)
    d.rectangle((0, 0, layout.cw, layout.ch), fill=INK)
    # 发丝网格
    g = Image.new("RGBA", (layout.cw, layout.ch), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    for x in range(0, layout.cw + 1, layout.grid_step):
        gd.line((x, 0, x, layout.ch), fill=(255, 255, 255, GRID_A))
    for y in range(0, layout.ch + 1, layout.grid_step):
        gd.line((0, y, layout.cw, y), fill=(255, 255, 255, GRID_A))
    bg.alpha_composite(g)
    # 上下通栏细线
    for y in (layout.line_off, layout.ch - layout.line_off):
        d.line((layout.margin, y, layout.cw - layout.margin, y), fill=(255, 255, 255, 46))
    # 四角裁切标记(琥珀)
    t = 3
    L, R, T2, B = layout.margin - 8, layout.cw - layout.margin + 8, layout.corner_off, layout.ch - layout.corner_off
    mark = [(L, T2, L + 96, T2), (L, T2, L, T2 + 96), (R - 96, T2, R, T2),
            (R, T2, R, T2 + 96), (L, B, L + 96, B), (L, B - 96, L, B),
            (R - 96, B, R, B), (R, B - 96, R, B)]
    for x0, y0, x1, y1 in mark:
        d.line((x0, y0, x1, y1), fill=(*AMBER, TICK_A), width=t)
    return bg


def paint_labels(bg, layout):
    d = ImageDraw.Draw(bg)
    fm = font(F_MONO, layout.label_size)
    fcjk = cjk_font(layout.label_size)
    gray = (140, 148, 160, 230)
    L, R = layout.margin - 8, layout.cw - layout.margin + 8
    d.text((L, layout.label_top), "AI-PM · KNOWLEDGE WIKI", font=fm, fill=gray)
    t = "LEXICON — 200+ TERMS"
    d.text((R - fm.getlength(t), layout.label_top), t, font=fm, fill=gray)
    t = "FIG.01 · TERMINAL ALPHABET — CUTAWAY NO.4"
    d.text((L, layout.ch - layout.label_bottom_off), t, font=fm, fill=gray)
    t = "N 30.26 / E 120.09 · HANGZHOU"
    d.text((R - fm.getlength(t), layout.ch - layout.label_bottom_off), t, font=fm, fill=gray)
    # 底部中央中文落款
    t = "AI 产品经理知识库 · 方法论 / 能力 / 工具 / 案例"
    d.text(((layout.cw - fcjk.getlength(t)) / 2, layout.ch - layout.label_bottom_off), t, font=fcjk,
           fill=(112, 122, 136, 220))


# ---------------------------------------------------------------------- main
def render(target_w, target_h):
    """按目标尺寸渲染一张成品(RGB,PIL Image)。"""
    layout = make_layout(target_w, target_h)
    bg = Image.new("RGBA", (layout.cw, layout.ch), (*INK, 255))
    paint_background(bg, layout)
    placed = place_letters(layout)
    paint_term_field(bg, placed, layout)
    paint_labels(bg, layout)
    return bg.convert("RGB")


def main():
    ensure_fonts()
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(SOCIAL_PATH), exist_ok=True)

    master = render(BASE_W, BASE_H)
    p1600 = os.path.join(OUT_DIR, "aipm-banner-1600.png")
    master.resize((BASE_W, BASE_H), Image.LANCZOS).save(p1600)
    p1280 = os.path.join(OUT_DIR, "aipm-banner-1280.png")
    master.resize((1280, 640), Image.LANCZOS).save(p1280)

    social = render(1200, 630).resize((1200, 630), Image.LANCZOS)
    social.save(SOCIAL_PATH)
    print("ok:", p1600, p1280)
    print("social:", SOCIAL_PATH, f"{social.width}x{social.height}")


if __name__ == "__main__":
    main()
