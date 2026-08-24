import json
import os
import sys

CHAR_MAP = json.load(open("scripts/char-map.json"))
changed_files = os.environ.get("CHANGED_FILES", "")
successed_list, skipped_list, failed_list = [], [], {}


def str_2_unicode(s):
    return s.encode("unicode-escape").decode()


def summary(message):
    if os.environ.get("GITHUB_ACTIONS") == "true":
        # 直接向 $GITHUB_STEP_SUMMARY 文件追加。文件名来自 PR,含引号/$
        # 等特殊字符时经 shell 展开有命令注入风险,故绝不经过 shell。
        summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary_path:
            with open(summary_path, "a") as f:
                f.write(message + "\n")
    print(message)


def error(filename, line, col, message):
    if os.environ.get("GITHUB_ACTIONS") == "true":
        # ::error 工作流命令由 runner 从 stdout 解析,直接 print 即可,
        # 不拼 shell(文件名来自 PR,可能含引号/特殊字符)。
        print(f"::error file={filename},line={line},col={col}::Check Characters: {message}")
    print(f"Check Characters: {filename} {line}:{col} {message}")


def check(filename):
    if os.path.exists(f"{filename}.skipchars"):
        skipped_list.append(filename)
        return
    failed = False
    check = open(filename)
    data = check.read()
    for key, value in CHAR_MAP.items():
        if data.find(key) != -1:
            failed = True
            if filename in failed_list.keys():
                failed_list[filename].append(key)
            else:
                failed_list[filename] = [key]
    if not failed:
        successed_list.append(filename)


def annotate(filename, char):
    suggest = f"{char}({str_2_unicode(char)}) -> {CHAR_MAP[char]}({str_2_unicode(CHAR_MAP[char])})"
    summary(f"  - {suggest}")
    with open(filename, "r") as file:
        lines = file.readlines()
    for line_num, line in enumerate(lines, start=1):
        col_num = line.find(char) + 1
        while col_num > 0:
            error(filename, line_num, col_num, suggest)
            col_num = line.find(char, col_num) + 1


if changed_files != "":
    for filename in changed_files.replace("\n", " ").split():
        check(filename)
else:
    for root, _, files in os.walk("docs"):
        for filename in files:
            if filename.endswith(".md") or filename.endswith(".tex"):
                check(os.path.join(root, filename))
summary("## :checkered_flag: 字符检查结果")
if successed_list:
    summary("### :white_check_mark: 成功")
    for filename in successed_list:
        summary(f"- {filename}")
if skipped_list:
    summary("### 跳过")
    for filename in skipped_list:
        summary(f"- {filename}")
if failed_list:
    summary("### :x: 失败")
    for filename, failed_chars in failed_list.items():
        summary(f"- {filename}")
        for failed_char in failed_chars:
            annotate(filename, failed_char)
    sys.exit(1)
