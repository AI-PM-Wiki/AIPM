"""check-characters.py 的纯函数核心(可独立单测)。

字符检查逻辑与 I/O(文件读写、CI 汇报输出)分离:本模块只含无副作用函数,
scripts/check-characters.py 负责扫描与汇报,test/ 下的单测直接测本模块。
"""


def str_2_unicode(s):
    """把字符串转成 unicode 转义形式(如 '，' -> '\\uff0c')。"""
    return s.encode("unicode-escape").decode()


def find_bad_chars(data, char_map):
    """返回 data 中命中的 char_map 键列表(按 char_map 键序)。"""
    return [key for key in char_map if key in data]
