---
description: 确定性趋势与随机趋势、趋势平稳/随机游走/带漂移随机游走模型、单位根与 I(d) 单整、DF/ADF 单位根检验与 ARIMA 建模
---

## 趋势、单位根与 ARIMA

## 带趋势的时间序列

非平稳序列中，含趋势的一类最为常见。趋势分两类：**确定性趋势（deterministic trend）** 是时间 $t$ 的确定函数，如 $\delta t$；**随机趋势（stochastic trend）** 由随机冲击的累加形成，如 $\sum u_i$。

四个模型刻画不同趋势结构。**模型 1：趋势平稳（trend-stationary, TS）** $y_t=y_0+\delta t+X_t$，$X_t$ 为零均值平稳 ARMA(p,q)。只有均值随时间线性变化，去掉趋势后平稳。**模型 2：随机游走（random walk, RW）** $\Delta y_t=\varepsilon_t$，每个冲击对条件均值产生永久性改变，方差 $t\sigma^2$ 随时间发散，无均值回复。**模型 3：带漂移随机游走（random walk with drift, RWD）** $\Delta y_t=\delta+\varepsilon_t$，含确定性趋势 $\delta t$ 与随机趋势 $\sum\varepsilon_i$ 两部分。**模型 4（一般化）** $\Delta y_t=\delta+u_t$，$u_t$ 为零均值平稳 ARMA(p,q)，即 **ARIMA(p,1,q)** 过程。

三类趋势数据对应不同处理。确定性趋势（趋势平稳）经济金融数据中少见；随机趋势的典型例子为失业率、利率、汇率；两者兼有的典型例子为对数 GDP、对数价格指数。宏观序列的实例：美元/日元汇率与月度失业率呈随机游走，log GDP 与资产对数价格呈带漂移随机游走，利率序列可无漂移。

**处理规则**：只有确定性趋势去趋势（对常数与 $t$ 回归取残差），绝不差分——对 TS 序列差分得 $\Delta y_t=\delta+\varepsilon_t-\varepsilon_{t-1}$，产生非可逆 MA(1)，即过度差分。只要含随机趋势差分一次，绝不去趋势——随机趋势 $\sum u_i$ 不是 $t$ 的函数，去趋势去不掉；差分可同时消去随机趋势与线性确定性趋势。

## 单位根与单整

**单位根过程（unit root process）**：AR 特征多项式含根恰为 1 的非平稳过程。ARIMA(p,1,q) 的特征多项式 $\phi(L)(1-L)$ 共 $p+1$ 个根，其中 1 个根为 1。

**单整（integration）**：$y_t\sim I(d)$ 表示经过 $d$ 次差分后平稳，差分次数等于单位根个数。经济金融数据中 I(1) 最常见；I(0) 序列多为变换后的数据（GDP 增长率、股票收益率）；I(2) 极少。**ARIMA(p,d,q)** 是差分 $d$ 次后为 ARMA(p,q) 的过程，$d=2$ 时二次差分 $\Delta^2y_t=(1-L)^2y_t=y_t-2y_{t-1}+y_{t-2}$。

中国 GDP 实证：GDP 由资本、劳动与技术驱动呈指数增长，取对数后近似线性上升，符合带漂移随机游走的直觉。对 log GDP 差分得到增长率，其相关图 AC(1)=0.680、Q(1)=19.93，显著自相关，故在模型 4 框架下对增长率建 ARMA(p,q)，而非简单带漂移随机游走。

## 伪回归与协整

对回归 $y_t=a_0+a_1z_t+e_t$ 分四种情形。两者均 I(0) 时经典回归理论适用。两者均 I(1) 且残差仍 I(1) 时为**伪回归（spurious regression）**：结果看似显著实则无真实关系，OLS 不一致。两者均 I(1) 且残差 I(0) 时为**协整（cointegration）**：两个 I(1) 变量的线性组合平稳，回归有意义。单整阶数不同时回归没有意义。做水平值回归之前必须弄清每个变量的单整阶数，这正是单位根检验的动机。

蒙特卡洛模拟显示非标准分布：两条相互独立的随机游走直接回归得到 $R^2=0.4069$、斜率 $t=26.16$ 的显著结果，但残差高度自相关（DW 约 0.027）且非平稳。单位根与协整情形下 OLS 估计量与 t、F 统计量的极限分布非标准，常规 t 表、F 表失效，必须用专用临界值。

## DF 检验

**Dickey-Fuller 检验**以 $y_t=\rho y_{t-1}+\varepsilon_t$ 为起点，参数重定义 $\tilde\rho=\rho-1$，检验 $H_0:\rho=1$ 对 $H_1:\rho<1$，即 $\tilde\rho=0$ 对 $\tilde\rho<0$。三种设定：
- **Case I（无截距）**：$\Delta y_t=\tilde\rho y_{t-1}+\varepsilon_t$，适用于回归残差等均值近似为零的序列；
- **Case II（含截距）**：$\Delta y_t=\alpha+\tilde\rho y_{t-1}+\varepsilon_t$，适用于失业率、利率、汇率等无趋势序列；
- **Case III（含截距与趋势）**：$\Delta y_t=\alpha+\beta t+\tilde\rho y_{t-1}+\varepsilon_t$，适用于 GDP、对数价格指数等带趋势序列。

三种情形均可对联合假设（Case II 为 $\alpha=0$ 且 $\rho=1$，Case III 为 $\beta=0$ 且 $\rho=1$）做 OLS F 检验，但极限分布非标准。DF 统计量在原假设下的分布非正态、随情形不同而不同，临界值由蒙特卡洛模拟算出（EViews 报告 MacKinnon 临界值与单侧 p 值）。备择为 $\tilde\rho<0$，拒绝域在分布左侧，t 统计量足够负才拒绝。

## ADF 检验与单整阶数判定

**ADF（增广 Dickey-Fuller）检验**：DF 假设 $\Delta y_t$ 为 i.i.d.，真实过程 $u_t$ 存在自相关时检验失效。ADF 在回归中加入 $\Delta y_t$ 的高阶滞后项控制序列相关：
$$\Delta y_t=\tilde\rho y_{t-1}+\eta_1\Delta y_{t-1}+\cdots+\eta_{p-1}\Delta y_{t-p+1}+\varepsilon_t$$
单位根等价于自回归系数之和 $\phi_1+\cdots+\phi_p=1$。$p=3$ 时重参数化为 $\Delta y_t=\tilde\rho y_{t-1}+a_1\Delta y_{t-1}+a_2\Delta y_{t-2}+\varepsilon_t$。ADF 检验 $\rho=1$ 的 t 统计量与对应情形下 DF 的 t 统计量渐近分布相同，DF 的临界值直接套用。滞后阶数 $p$ 用信息准则（AIC/BIC）或 t、F 检验选择，也可用 General-to-Specific 方法从大到小删滞后。

爆炸情形（$\rho>1$）经济金融中基本不予考虑：模拟显示 $\rho=1.05$、$T=1000$ 时序列涨到约 $3.5\times10^{21}$，现实数据不会呈现这种路径；金融泡沫可能在短期内表现爆炸性。其他单位根检验方法包括 PP 检验、DF-GLS、HEGY 季节单位根检验与面板单位根检验。

**单整阶数判定流程**：对水平 $y_t$ 做检验，拒绝则 $y_t\sim I(0)$，结束；不拒绝则对 $\Delta y_t$ 重复检验，拒绝则恰为 I(1)；仍不拒绝继续对更高阶差分检验，直到拒绝为止。每一步重新选择设定与滞后阶。

**Case 选择**依据数据特征：有持续上升趋势的序列（GDP、对数价格指数）选 Case III，无趋势序列（失业率、利率、汇率）选 Case II。finished 序列（成品价格指数）选 Case III、AIC 选滞后 5 阶，ADF t≈-2.13、p≈0.52，不拒绝原假设，存在单位根；对一阶差分改用 Case II，拒绝，确认恰为 I(1)。国债利率 TBILL 无持续上升趋势，原序列检验选 Case II，p 值较大不拒绝，存在单位根。
