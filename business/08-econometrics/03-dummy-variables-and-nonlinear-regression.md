---
description: 含交叉项模型的偏效应、可线性化的非线性回归、柯布-道格拉斯生产函数估计与规模报酬检验、虚拟变量的加法乘法混合引入与陷阱
---

## 虚拟变量与非线性回归

## 交叉项与偏效应

含交叉项的模型 $Y=\beta_0+\beta_1X_1+\beta_2X_2+\beta_3X_1X_2+u$ 中，$X_1$ 对 Y 的偏效应

$$\frac{\partial Y}{\partial X_1}=\beta_1+\beta_3X_2$$

取决于 $X_2$ 的取值，同理 $\dfrac{\partial Y}{\partial X_2}=\beta_2+\beta_3X_1$。$X_2$ 在模型中有无交叉项，直接决定了 $\beta_1$ 能否被独立解释。解释 $X_1$ 的边际影响时不能只看 $\beta_1$：只看 $\beta_1$ 等于假定 $X_2=0$，当 $X_2$ 实际不为零时解释失真。

出席率与期末成绩案例：期末成绩 $=2.05-0.0067\,\text{出席率}-1.63\,\text{上学期GPA}-0.128\,\text{入学成绩}+0.296\,\text{GPA}^2+0.0045\,\text{入学成绩}^2+0.0056\,(\text{GPA}\times\text{出席率})$。出席率的偏效应 $\dfrac{\partial\,\text{期末成绩}}{\partial\,\text{出席率}}=-0.0067+0.0056\,\text{GPA}$，-0.0067 只是 GPA=0 时的效应；上学期 GPA 越高，增加 1 个单位出席率对期末成绩的贡献越大。

## 可线性化的非线性回归

**倒数模型**：$1/Q=a+b(1/P)+u$，令 $y=1/Q$、$x=1/P$ 化为线性，常用来刻画需求-价格这类双曲关系。

**多项式模型**：拉弗曲线 $s=a+br+cr^2$（$c<0$），税率 r 与税收 s 呈开口向下的抛物线，令 $x=r$、$z=r^2$ 直接线性回归。

**幂函数模型**：柯布-道格拉斯生产函数 $Q=AK^\alpha L^\beta e^\epsilon$，两边取对数得 $\ln Q=\ln A+\alpha\ln K+\beta\ln L+u$，变成多元线性模型，α、β 即产出弹性，可据此检验规模报酬（$\alpha+\beta=1$）。

**CES 生产函数** $Q=A(\delta_1K^{-\rho}+\delta_2L^{-\rho})^{-1/\rho}e^\epsilon$（$\delta_1+\delta_2=1$）在 $\rho=0$ 处作泰勒展开可近似为线性形式。非线性函数常经取对数、变量替换或级数展开线性化，再做 OLS。

## 柯布-道格拉斯生产函数估计与规模报酬检验

2010 年中国制造业 39 个行业的总产出与要素投入数据：模型 $\ln Y=\beta_0+\beta_1\ln K+\beta_2\ln L+u$。软件操作：EViews 用命令 `LS LOG(Y) C LOG(K) LOG(L)`，Stata 先 `import excel` 导入数据、`gen lnY=log(Y)` 取对数，再 `reg lnY lnK lnL`。回归结果

$$\ln\hat Y=1.8+0.68\ln K+0.29\ln L$$

资本产出弹性 0.68，资本增加 1% 产出约增加 0.68%；劳动产出弹性 0.29，劳动增加 1% 产出增加 0.29%；两个斜率系数均在 1% 水平显著，$R^2=0.9408$。

0.68+0.29=0.97，需检验 $\beta_1+\beta_2=1$ 即规模报酬不变。施加约束后模型人均化为 $\ln(Y/L)=\beta_0+\beta_1\ln(K/L)+u$，受约束模型 $\mathrm{SSR}_R=4.4694$，无约束模型 $\mathrm{SSR}_{UR}=4.4006$，F 检验

$$F=\frac{(\mathrm{SSR}_R-\mathrm{SSR}_{UR})/q}{\mathrm{SSR}_{UR}/(n-k-1)}=\frac{(4.47-4.40)/1}{4.40/36}=0.67$$

$F_{0.05}(1,36)=4.11$，$0.67<4.11$，不能拒绝原假设，不能拒绝生产函数具有规模报酬不变性质。

## 虚拟变量的概念与设置规则

**虚拟变量（dummy variable）**：把定性信息（性别、婚否、地区）通过二值变量刻入模型，如 $D=\{1,\text{本科及以上};0,\text{高中及以下}\}$。

**基准组与 g-1 规则**：含截距的回归中，有 g 个分组只需 g-1 个虚拟变量；虚拟变量的系数度量该组与基准组均值的差距；基准组不设虚拟变量，选择可任意、可更换，更换基准组只改变其他虚拟变量的系数含义，模型拟合不变。

## 三种引入方式

**加法方式**度量截距变化：$wage=\beta_0+\beta_1educ+\delta_0female+u$，$E(w|female=1)-E(w|female=0)=\delta_0$，即同等教育水平下女性与男性平均工资之差。加法方式下两组回归线斜率相同、截距相差 $\delta_0$，平均工资差距与教育水平无关。WAGE1 数据 526 个观测的估计 $\hat{wage}=0.62-2.27female+0.51educ$，教育及其他条件不变时女性比男性平均小时工资低 2.27 美元。

**乘法方式**度量斜率变化：$wage=\beta_0+\beta_1educ+\delta_1female\cdot educ+u$，差距 $=\delta_1\cdot educ$，女性与男性工资差距随教育水平变化而变化。WAGE1 数据的乘法形式估计 $\hat{wage}=-0.29-0.18female\cdot educ+0.58educ$，$\partial wage/\partial female=-0.18educ$，性别差距随教育水平变化（$t=-8.14$）。

**混合方式**截距、斜率都变：$wage=\beta_0+\beta_1educ+\delta_0female+\delta_1female\cdot educ+u$，差距 $=\delta_0+\delta_1educ$，$\delta_0$ 只是 educ=0 时的差距，并不等于一般意义上的工资差距。WAGE1 数据的混合形式中 female（-1.20，$t=-0.90$）与 female·educ（-0.09，$t=-0.83$）均不显著，说明单看截距和斜率没有显著差异。

## 虚拟变量陷阱

**虚拟变量陷阱（dummy variable trap）**：同时定义 female、male 两个虚拟变量，因 $female+male=1$ 与常数列完全共线，违反基本假设、无法分离估计。处理办法是去掉一个虚拟变量，或去掉常数项做无截距回归（此时参数解释发生变化）。陷阱演示：`gen male=1-female` 后回归，Stata 自动删除一个变量并标注 omitted，EViews 报近奇异矩阵错误；无截距回归 `reg wage female male educ, noconstant` 仍给出估计，但女性系数变为 -1.65（$t=-2.53$）等，参数解释与含截距模型不同。完全共线的另一种来源是模型设定错误：工资对 education 与 education2（等于 $2\times education$）回归时两变量完全线性相关，Stata 同样自动去掉一个。

## 多分组与基准组更换

多分组情形设置 g-1 个虚拟变量。婚否乘性别四组（已婚男、单身男、已婚女、单身女）以单身男性为基准组，定义 marrmale、marrfem、singfem 三个虚拟变量，模型 $wage=\beta_0+\beta_1marrmale+\beta_2marrfem+\beta_3singfem+\beta_4educ+\beta_5exper+\beta_6exper^2+\beta_7tenure+\beta_8tenure^2+u$，参数分别衡量已婚男、已婚女、单身女与单身男性的平均工资差距；已婚男性与已婚女性之差等于 $\beta_1-\beta_2$。检验该差是否显著的方法：把基准组换成已婚女性，重新定义虚拟变量后再回归，新模型中已婚男性虚拟变量的系数直接就是该差距，用 t 检验即可。

## 模型选择：Translog 与 C-D

**超越对数生产函数（Translog）**：$\ln Y=\beta_0+\beta_1\ln L+\beta_2\ln K+\beta_3(\ln^2 L)/2+\beta_4(\ln^2 K)/2+\beta_5\ln L\ln K+u$，是含平方项与交叉对数项的灵活函数形式。C-D 是其受约束形式，检验 $H_0:\beta_3=\beta_4=\beta_5=0$。32 个观测的估计：受约束（C-D）$\mathrm{SSR}_R=1.32609$，无约束（Translog）$\mathrm{SSR}_{UR}=1.25888$，$F=\dfrac{(1.33-1.25)/3}{1.25/26}=0.555<F_{0.05}(3,26)=2.31$，不拒绝原假设，选取 C-D 生产函数模型。
