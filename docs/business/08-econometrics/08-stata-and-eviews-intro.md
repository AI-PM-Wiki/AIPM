---
description: Stata 的界面窗口、三类文件与常用命令，以 auto.dta 为例的建模流程，EViews 的方程估计与检验操作
---

## Stata 与 EViews 操作入门

## Stata 界面四大窗口

Stata 17.0 界面有四个主要窗口：结果窗口（中央最大，显示命令执行结果）、命令窗口（下方输入区，输入命令但不保存）、历史窗口（左侧，列出已执行命令、可点击复用）、变量窗口（右侧，列变量名与标签）。另有属性窗口显示所选变量的名称、类型、格式、值标签，以及变量数、观测数与内存等数据信息。

## 三类文件与三种运行方式

**三类文件**：数据文件 `*.dta` 存变量与观测；程序文件 `*.do` 存命令代码，可批量运行、重复使用；结果文件 `*.log` 记录全部运行结果，可发给合作者。

**三种运行方式**：菜单操作执行后结果窗口能显示命令行与结果，但命令不保存；命令行操作在命令窗口直接输入，一次只能写一行，关闭后丢失；程序操作用 do-file 编辑器编写 `.do` 文件执行批量命令。推荐 do 文件方式：命令保存、批量运行、可复用，日志结果可存档。

## 文件管理与数据导入导出

**清内存与设置**：`clear all` 清除内存；`set more off` 让结果连续显示、不翻页暂停；`capture log close` 若日志已开先关闭。

**目录与日志**：`cd "路径"` 进入文件夹；`log using 文件名, text replace` 开始记录日志，`log close` 关闭日志。

**数据调用与导入导出**：`use auto.dta, clear` 调用 dta 数据；`import excel using auto.xls, firstrow clear` 从 Excel 导入，`firstrow` 表示第一行是变量名；`export excel using temp.xls, first(variable) replace` 导出 Excel。手工造数可用 `generate var1=.`、`set obs 2`、`replace var3=6 in 3` 等命令逐步构建。

## 数据浏览与变量操作

**浏览与编辑**：`browse` 只读查看；`edit` 打开数据编辑器，缺失值用点 `.` 表示；`list in 1/10` 列出前 10 条，`list make price mpg in 1/10` 列出指定变量；`drop if rep78==.` 删除满足条件的观测，缺失值判断用 `==.`；`save temp.dta, replace` 保存。

**改名与加标签**：`rename foreign import` 只改变量名、数据不变；`label var rep78 "repair record 1978"` 给变量加标签说明含义。

**排序**：`sort price` 升序；`gsort -price` 降序（变量前加负号），数据量大时用来看最大值、最小值。

**生成新变量**：`gen lprice=log(price)` 对价格取对数，价格、GDP 等经济变量建模时常取对数；`gen rep78new=rep78+1` 先平移再加一（rep78 有 0 值无法取对数）；`gen check=(rep78>=4)` 生成 0/1 虚拟变量，条件成立为 1。

## 运算、数据检查、画图与描述统计

**运算符号**：算术 `+ - * /` 与次方 `^`（`disp 2^3` 输出 8）；关系运算 `== != > < >= <=`，比较相等用双等号 `==`、单个 `=` 用于赋值；逻辑运算 `&`（和）、`|`（或）、`~`（非）。例：`list rep78 price if rep78>0 & price>10000` 列出"修理记录为正且价格高于 1 万"的观测。

**数据检查**：`describe`（简写 `d`）显示变量类型；`tabulate`（简写 `tab`）做频数表；`summarize`（简写 `sum`）给出 Obs/Mean/Std.Dev./Min/Max，写论文时先汇报描述统计；`count` 计数。auto 数据中 price 均值 6165.257、标准差 2949.496、最小 3291、最大 15906；rep78 只有 69 个观测，其余为缺失值，summarize 对缺失值不计数。

**画图**：`histogram rep78, normal` 画直方图并叠加正态曲线；`graph twoway scatter price mpg` 画散点图，price 与 mpg 呈负相关趋势。

**帮助**：`help import` 查看命令帮助，`findit xtbalance` 查找并安装用户自编的插件命令。注释：`*` 整行注释，`//` 行尾注释，`/* */` 整块注释。

## 回归与检验命令

**相关与回归**：`correlate`（简写 `cor`）给出相关系数，`cor price mpg` 得 -0.459；`regress`（简写 `reg`）做回归，格式为 `reg 被解释变量 解释变量`，如 `reg price mpg`。结果表给出系数、标准误、t 值、P 值、R² 等。

**假设检验与模型选择**：`test educ exper` 做 F 联合检验，`test jc=univ` 检验系数相等；`estat hettest` 做 BP 异方差检验，`estat imtest, white` 做 White 检验；`estat ovtest` 做 Ramsey RESET 检验；`estat bgodfrey, lags(3)` 做序列相关 LM 检验。

**内生性与工具变量**：`ivregress 2sls lwage (educ = motheduc fatheduc) exper expersq`，内生变量与工具变量用括号括起来，外生变量自己作为自己的工具变量；`estat endogenous` 做内生性检验，`estat overid` 做过度识别约束检验。

**稳健标准误**：`reg y x1 x2, robust` 报告异方差稳健标准误；`newey y x, lag(3)` 报告序列相关稳健标准误。

**时间序列**：先用 `tsset 时间变量` 声明时间序列结构；`corrgram y, lags(10)` 输出自相关、偏自相关与 Q 统计量；`wntestq y, lag(10)` 做白噪声 Ljung-Box 检验；`dfuller y, lags(p) reg` 做 ADF 单位根检验（含截距），`noconstant` 为无截距无趋势、`trend` 为截距加趋势。

## 以 auto.dta 为例的建模流程

1978 年汽车数据 auto.dta 有 74 个观测、12 个变量，含 make（车型）、price（价格）、mpg（每加仑英里数）、rep78（1978 年修理记录）、foreign（0=国产，1=进口）等。完整建模流程：

```stata
clear all
set more off
use auto.dta, clear

* 描述统计与数据检查
su price mpg
tab rep78
corr price mpg
graph twoway scatter price mpg

* 变量变换
gen lprice=log(price)

* 回归建模
reg price mpg
reg lprice mpg
```

`reg price mpg` 的结果：mpg 系数 -238.8943（标准误 53.07669、$t=-4.50$、$P>|t|=0.000$）、常数项 11253.06，$R^2=0.2196$、调整 $R^2=0.2087$。mpg 每提高 1，价格平均下降约 239 美元，mpg 解释价格变动的约 22%。对价格取对数后回归可以降低异方差。

## EViews 常用操作

**方程估计**：打开工作文件后，菜单 Quick → Estimate Equation，或命令窗口输入 `ls wage c education` 做最小二乘估计，`c` 表示常数项；方法选 Least Squares。

**异方差检验与稳健标准误**：在 OLS 结果上 View → Residual Diagnostics → Heteroskedasticity Tests，可选 Breusch-Pagan-Godfrey 或 White 检验；方程设定中加选项 `(covariance=white)` 报告稳健标准误，协方差方法选择 Huber-White。

**工具变量估计**：菜单 Quick → Estimate Equation，method 选 TSLS，specification 填 `lwage c educ exper expersq`，instrument list 填 `exper expersq motheduc fatheduc`；命令形式为 `TSLS LWAGE C EDUC EXPER EXPERSQ @ EXPER EXPERSQ MOTHEDUC FATHEDUC`，`@` 之后为工具变量列，不可省略。

**序列相关与单位根**：回归方程窗口 View → Residual Diagnostics → Serial Correlation LM Test 做序列相关检验；Quick → Series Statistics → Unit Root Test，Test type 选 ADF，Test for unit root in 选 Level / 1st difference / 2nd difference，Include in test equation 选 Intercept / Trend and intercept / None，滞后阶数可自动（SIC）或自定。
