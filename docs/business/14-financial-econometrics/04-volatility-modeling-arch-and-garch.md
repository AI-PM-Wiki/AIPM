---
description: 波动率聚集与条件异方差、GARCH(1,1) 模型设定与平稳性条件、ARCH 效应检验（Ljung-Box 与 Engle LM 检验）、QMLE 估计、模型诊断与波动率预测
---

## 波动率建模：ARCH 与 GARCH

## 波动率聚集与条件异方差

金融资产回报率序列的一个显著特征：大波动后紧跟大波动、小波动后紧跟小波动，即**波动率聚集（volatility clustering）**。标普 500 日回报有的时段变化幅度小、有的时段变化剧烈。条件同方差假设下残差方差为常数，无法刻画这一特征，需要**条件异方差**模型——条件方差随时间变化。

**ARCH（自回归条件异方差）**：对残差平方 $\varepsilon_t^2$ 拟合 AR 模型。**GARCH（广义 ARCH）**：对 $\varepsilon_t^2$ 拟合 ARMA 模型。GARCH 比纯 ARCH 精简，抓时间序列相关性所需阶数小。**GARCH(1,1) 方差方程**：
$$\sigma_t^2=\alpha_0+\alpha_1\varepsilon_{t-1}^2+\beta_1\sigma_{t-1}^2$$
$\alpha_0>0$、$\alpha_1,\beta_1\ge 0$ 保证方差为正；$\alpha_1+\beta_1<1$ 为弱平稳条件；无条件方差 $\alpha_0/(1-\alpha_1-\beta_1)$。$\alpha_1+\beta_1$ 衡量波动率冲击的持续性，接近 1 时冲击衰减很慢。

对 $\sigma_t^2$ 建模可利用三类信息：$\varepsilon_{t-i}^2$ 的滞后观察值、$\sigma_{t-i}^2$ 的滞后值、其他有助于估计 $\sigma_t^2$ 的变量信息。ARCH 只用第一类，GARCH 用第一类与第二类。

条件异方差不影响无条件矩。均值只由均值方程决定，ACF/PACF 只看均值方程的滞后结构，方差计算中把 $\mathrm{Var}(\varepsilon_t)$ 换成无条件方差即可。波动率建模的意义在于区间预测与风险测度：条件方差的动态变化直接决定预测置信区间的宽度。

**GARCH 族扩展**：GARCH 无法刻画杠杆效应（负冲击推高未来波动、正冲击影响较小）。EGARCH 与 GJR/Threshold GARCH 引入冲击符号，用于不对称反应。此外还有 GARCH-M、IGARCH、GARCH-MIDAS 等。

## ARCH 效应检验

建模第一步先检验数据是否存在 ARCH 效应。存在条件异方差时 $\varepsilon_t^2$ 在时间维度上相关，故对均值方程残差平方做序列相关性检验。检验前必须先把均值方程建模充分（残差为白噪声）。

四个检验不可混淆：对残差 $\hat\varepsilon_t$ 做序列相关性检验判断均值方程是否充分；对残差平方 $\hat\varepsilon_t^2$ 做 Q 检验判断是否存在 ARCH 效应；估计完成后对标准化残差 $\hat v_t$ 做 Q 检验判断均值方程充分性；对 $\hat v_t^2$ 做 Q 检验判断波动率方程充分性。

**方法一：Ljung-Box 检验**。对 $\{\hat\varepsilon_t^2\}$ 算样本 ACF/PACF 并做 Q 检验。$H_0$：无 ARCH 效应，$\rho_1=\cdots=\rho_m=0$。IBM 日收益残差平方 Q(12)=726.34，p 值接近 0，拒绝原假设，存在显著 ARCH 效应。

**方法二：Engle LM 检验**。构造辅助回归
$$\hat\varepsilon_t^2=\alpha_0+\alpha_1\hat\varepsilon_{t-1}^2+\cdots+\alpha_q\hat\varepsilon_{t-q}^2+\text{error}$$
$H_0:\alpha_1=\cdots=\alpha_q=0$。统计量 $\text{LM}_{ARCH}=T\cdot R^2_{AUX}$，原假设下渐近 $\chi^2(q)$。IBM 数据取 $q=6$ 得 LM=385.48，p 值接近 0，拒绝原假设。该检验对 GARCH 备择也有功效。滞后期 $q$ 按残差平方的样本 PACF 确定。

## QMLE 估计

ARCH/GARCH 模型不是线性形式，不能用 OLS，用**极大似然**。以 AR(1)-GARCH(1,1) 为例：
$$y_t=\phi_0+\phi_1y_{t-1}+\varepsilon_t,\quad \varepsilon_t=\sigma_tv_t,\quad v_t\sim i.i.d.\ N(0,1)$$
$\sigma_t^2$ 由递推式给出。条件对数似然为
$$L=-\frac{T-1}{2}\log(2\pi)-\frac12\sum_{t=2}^{T}\log(\sigma_t^2)-\frac12\sum_{t=2}^{T}\frac{(y_t-\phi_0-\phi_1y_{t-1})^2}{\sigma_t^2}$$
$\sigma_t^2$ 不可直接观测，由 $\varepsilon_{t-1}=y_{t-1}-\phi_0-\phi_1y_{t-2}$ 递推，初值可取样本无条件方差。均值方程与波动率方程参数联合估计。IBM 均值方程取 MA(2)，残差 Q(10)=3.66、p=0.887，均值模型充分；其后进入波动率建模。

**QMLE（拟极大似然）**：实际操作中 $v_t$ 通常非正态。均值方程与波动率方程设定正确时，即使 $v_t$ 非正态，极大化正态似然得到的估计量在大样本下仍一致，只是不有效。截面数据的 OLS 就是 QMLE 的特例。$v_t$ 分布重要的场合是预测置信区间与 VaR 等风险测度：估计完成后用标准化残差做非参数密度估计，再计算分位数。

## 模型诊断

**标准化残差** $\hat v_t=\hat\varepsilon_t/\hat\sigma_t$。均值方程充分时 $\{\hat v_t\}$ 为白噪声；波动率方程充分时 $\{\hat v_t^2\}$ 无序列相关。分别对 $\{\hat v_t\}$ 与 $\{\hat v_t^2\}$ 做 Ljung-Box 检验。

误差分布诊断看偏度、峰度与 Jarque-Bera 检验。峰度显著大于 3 说明厚尾，改用 Student's t 分布，自由度作为附加参数估计。IBM 案例正态假设下标准化残差峰度 7.98，改用 t 分布后自由度约 5.8，AIC 由 -5.542 降至 -5.628。

定阶原则：尝试 GARCH(2,1)、GARCH(1,2) 等高阶，出现负 ARCH 系数（违反正性约束）或不显著的高阶系数则回到 GARCH(1,1)。IBM 案例 GARCH(2,1) 出现负的 $\varepsilon_{t-2}^2$ 系数，GARCH(1,2) 的滞后方差系数不显著，均被舍弃，最终选 GARCH(1,1)-t。EViews 估计时不自动施加正性约束，负系数靠人工检查剔除。

## 波动率预测

**一步方差预测** $\sigma_{t+1}^2$ 在 $t$ 时刻已知，属于信息集 $\mathcal{F}_t$——GARCH 类模型的共同性质。**多步预测**按递推 $E_t(\sigma_{t+j}^2)=\alpha_0+(\alpha_1+\beta_1)E_t(\sigma_{t+j-1}^2)$ 迭代，收敛到无条件方差。**区间预测**为 $\hat y_{t+1}\pm 1.96\hat\sigma_{t+1}$，误差为标准化 t 分布时临界值按自由度取分位数，自由度作为参数估出。

$y_{T+j}$ 的条件方差等于其预测误差的条件方差。一步预测误差为 $\varepsilon_{T+1}$，方差 $\sigma_{T+1}^2$；两步预测误差为 $c_1\varepsilon_{T+1}+c_2\varepsilon_{T+2}$，系数由均值方程决定。由迭代期望法则与条件均值 0 可得条件协方差为零，两步预测误差方差 $c_1^2\sigma_{T+1}^2+c_2^2\sigma_{T+2}^2$。

与条件同方差的对比：同方差假定下两步预测误差方差为 $(c_1^2+c_2^2)\sigma^2$，把方差当常数；异方差模型随信息集更新，每一步都用条件方差预测值。
