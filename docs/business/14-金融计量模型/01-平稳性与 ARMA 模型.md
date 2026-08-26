---
description: 时间序列大数定律与弱平稳三条件、MA/AR/ARMA 模型的平稳性条件、ACF 与 Yule-Walker 方程、PACF 的定义与性质
---

## 平稳性与 ARMA 模型

## 从大数定律到平稳性

**大数定律（law of large numbers）**：样本均值以概率收敛到总体均值。用样本均值估计 GDP 增速的总体均值，需要时间序列版大数定律成立。

截面数据的 i.i.d. 大数定律要求同分布、独立与矩条件。时间序列不能照搬这三条：独立性要求过强，序列若真独立，时间序列分析失去意义；同分布不够，$G_t$ 与 $G_{t+1}$ 的相关性本身必须稳定。时间序列版大数定律需要三个条件：**平稳性**、**弱相关性**与**矩条件**。

**随机过程视角**：站在历史时点看，未来时间序列的路径完全不确定，每个 $y_t$ 是随机变量，整条路径有无穷多种可能。时间序列在每个时点只能观测到一个值，$y_3$ 的随机样本不可得。平稳性把其他时点的观测当作来自同一分布的样本，从时间维度取均值，替代截面数据的重复抽样。

**弱相关性（weak dependence）**：相隔较远的观测之间相关性快速衰减，序列遍历取值空间。数学上的可操作条件为**绝对可加**：$\sum_k|\gamma_k|<\infty$，蕴含 $\gamma_k\to 0$。$\gamma_k=1/k$ 时 $\gamma_k\to 0$ 但 $\sum 1/k$ 发散，不满足；$\gamma_k=1/k^2$ 满足。AR(1) 的 $\gamma_k=\phi_1^k\gamma_0$ 等比衰减，必满足。

正反对例。$X_t=X_{t-1}$（$X_0\sim N(0,1)$）满足同分布且相关性稳定，但整条序列恒等于首次抽样值，样本均值不以概率收敛到总体均值。$X_t\sim i.i.d.\ N(0,1)$ 的高斯白噪声满足平稳性与弱相关性，样本均值以概率收敛到 0。相关性过强导致弱相关性失效，大数定律不适用。

满足平稳性、弱相关性与矩条件后，大数定律与中心极限定理可用，估计量有渐近分布，可做假设检验。

## 弱平稳的定义

**弱平稳（weak stationarity，协方差平稳）** 的三个条件：
1. 均值不随时间变化：$E(y_t)=\mu$；
2. 方差不随时间变化：$\mathrm{Var}(y_t)=\gamma_0$；
3. 自协方差只依赖时间间隔 $k$：$\mathrm{Cov}(y_t,y_{t-k})=\gamma_k$。

条件 3 是时间序列特有的要求。$\gamma_{-k}=\gamma_k$，平稳序列只需计算 $k\ge 0$ 的自协方差。弱平稳只约束一、二阶矩；严格平稳约束整个联合分布，本课程以弱平稳为主。

**自协方差（autocovariance）**：$\gamma_k=\mathrm{Cov}(y_t,y_{t-k})$。**自相关函数（autocorrelation function, ACF）**：$\rho_k=\gamma_k/\gamma_0$，即相关系数 $\mathrm{Corr}(y_t,y_{t-k})$。$\rho_0=1$，$\rho_{-k}=\rho_k$。

**去均值化（demeaning）**：定义 $y_t^*=y_t-\mu$，均值为 0，方差、协方差、ACF 与 $y_t$ 完全相同。研究 ACF 时假设截距为 0 不失一般性。

三个判别例子。白噪声满足三个条件，弱平稳。确定性趋势序列 $y_t=\alpha+\beta t$ 的均值随时间变化，非平稳。随机游走 $y_t=y_{t-1}+\varepsilon_t$ 展开为 $y_t=y_0+\varepsilon_t+\cdots+\varepsilon_1$，方差 $\mathrm{Var}(y_t)=t\sigma^2$ 随时间线性累积，非平稳。平稳序列的外观：绕固定均值线上下波动，波动幅度大致一致。

## ARMA 模型的平稳性条件

**MA(q) 无条件平稳**。MA(2) $y_t=\mu+\varepsilon_t+\beta_1\varepsilon_{t-1}+\beta_2\varepsilon_{t-2}$ 的方差 $\gamma_0=\sigma^2(1+\beta_1^2+\beta_2^2)$，一阶自协方差 $\gamma_1=(\beta_1+\beta_1\beta_2)\sigma^2$，二阶 $\gamma_2=\beta_2\sigma^2$，$k>2$ 时为 0。均值、方差、协方差均与时间起点无关，参数无需限制。MA(q) 的 ACF 在 $q$ 阶后截断为 0，记忆只有 $q$ 期。

**AR(1) 的平稳条件：$|\phi_1|<1$ 且时间充分大**。迭代解 $y_t=\phi_1^t y_0+\phi_0\sum_{j=0}^{t-1}\phi_1^j+\sum_{j=0}^{t-1}\phi_1^j\varepsilon_{t-j}$ 中，初值项 $\phi_1^t y_0\to 0$，均值与方差收敛到有限常数：均值 $\to\phi_0/(1-\phi_1)$，方差 $\to\sigma^2/(1-\phi_1^2)$。$|\phi_1|>1$ 为爆炸情形，$\phi_1=\pm1$ 为随机游走或震荡发散，均非平稳。

**AR(p) 与 ARMA(p,q)：根在单位圆外**。AR 多项式 $1-\phi_1z-\cdots-\phi_pz^p=0$ 所有根的模大于 1 时平稳。高次方程常有复数根，看模 $|a+bi|=\sqrt{a^2+b^2}$。ARMA 的平稳性完全由 AR 部分决定，与 MA 部分无关。

快速判据：$\sum_i|\phi_i|<1$ 为平稳的充分条件；$\sum_i\phi_i<1$ 为必要条件，连必要条件都不满足必非平稳。该判据用于快速排除，不满足充分条件不构成非平稳的证据。

实操中模拟 AR 模型时生成 1500 个数据丢弃前 500 个，消除初值影响。

## ACF 与 Yule-Walker 方程

**Yule-Walker 方程**：对动态方程两边关于 $y_t$、$y_{t-1}$、$y_{t-k}$ 求协方差得到的方程组。AR(1) 得 $\gamma_0=\phi_1\gamma_1+\sigma^2$ 与 $\gamma_k=\phi_1\gamma_{k-1}$（$k\ge 1$）。除以 $\gamma_0$ 得递推式 $\rho_k=\phi_1\rho_{k-1}$，由 $\rho_0=1$ 解得 $\rho_k=\phi_1^k$。反向由 $\gamma_1=\rho_1\gamma_0$ 代入 $\gamma_0$ 式，得 $\gamma_0=\sigma^2/(1-\phi_1^2)$。

$|\phi_1|<1$ 时 $\rho_k$ 以指数速度收敛到 0，平稳 AR 序列自动满足弱相关性。

AR(2) 的 Yule-Walker 方程：$\gamma_0=\phi_1\gamma_1+\phi_2\gamma_2+\sigma^2$，$\gamma_1=\phi_1\gamma_0+\phi_2\gamma_1$，$\gamma_k=\phi_1\gamma_{k-1}+\phi_2\gamma_{k-2}$（$k\ge 2$）。初值 $\rho_1=\phi_1/(1-\phi_2)$，递推式 $\rho_k=\phi_1\rho_{k-1}+\phi_2\rho_{k-2}$。

ARMA(1,1) $y_t=\phi_1y_{t-1}+\theta_1\varepsilon_{t-1}+\varepsilon_t$ 的 ACF：$k\ge 2$ 时递推式 $\rho_k=\phi_1\rho_{k-1}$ 与 AR(1) 相同，仅起点 $\rho_1$ 不同。AR 部分相同的 AR(1) 与 ARMA(1,1) 衰减形态相近，ACF 难以区分二者。

## PACF：偏自相关函数

**偏自相关（partial autocorrelation）**：回归式
$$y_t=\phi_{k0}+\phi_{k1}y_{t-1}+\phi_{k2}y_{t-2}+\cdots+\phi_{kk}y_{t-k}+e_{kt}$$
的系数 $\phi_{kk}$，衡量控制 $y_{t-1},\ldots,y_{t-k+1}$ 后 $y_{t-k}$ 对 $y_t$ 的净影响。全体 $\{\phi_{11},\phi_{22},\ldots\}$ 构成**偏自相关函数（partial autocorrelation function, PACF）**。

残差 $e_{kt}$ 与等式右边全部解释变量不相关，$E(e_{kt})=0$，但不一定是白噪声。$e_{kt}$ 与模型的 $\varepsilon_t$ 不是一回事。

由 ACF 求 PACF：对回归式分别关于 $y_{t-1}$、$y_{t-2}$ 求协方差，残差项置零，得方程组。$k=2$ 时解为 $\phi_{22}=(\rho_2-\rho_1^2)/(1-\rho_1^2)$。$k$ 阶情形写成 $A\phi=b$，$A$ 与 $b$ 的元素全部是已知的 ACF，解为 $\phi=A^{-1}b$。该关系对一切平稳 ARMA 模型恒成立。

理论 ACF 与 PACF 性质：MA(q) 的 ACF 在 $q$ 阶后截断，PACF 不截断而指数收敛到 0；AR(p) 的 ACF 拖尾，PACF 在 $p$ 阶后截断；ARMA(p,q) 的 PACF 由 MA 部分决定、ACF 由 AR 部分决定。ACF 摘 MA 模型，PACF 摘 AR 模型，两者结合选模。
