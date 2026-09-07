---
description: 架构组件前沿：位置编码、RoPE 扩展族、归一化、激活与残差，分析训练稳定性和长度外推，不把标称窗口当成有效窗口。连接改动要看稳定性和 kernel，不只看公式。
---

## 架构组件与训练稳定性前沿论文

本页从论文视角整理 Transformer Block 内部组件的演进。基础结构见 [Transformer 架构](transformer.md)；训练工程见 [深度学习工程实践](deep-learning-practice.md)。

## 位置编码：模型如何表示顺序

### 1. PE：从无序集合恢复序列

[Attention Is All You Need](https://arxiv.org/abs/1706.03762v7) 提出 Transformer 时使用正弦与余弦位置编码。它把位置向量加入 token embedding，使自注意力不仅看到内容相似度，也能利用位置信号。

对位置 `pos` 和维度 `i`，原始方案使用不同频率的正弦、余弦函数。低频维度提供较粗的位置信息，高频维度提供较细的变化。它不增加需要训练的位置参数，也可以生成训练长度之外的位置向量，但这不等于模型必然具备可靠的长上下文外推能力。

位置编码要解决两个不同问题：

1. **顺序识别**：区分「用户删除订单」和「订单删除用户」这类 token 顺序不同的输入；
2. **距离建模**：让模型知道两个 token 相隔多远，以及这种距离如何影响注意力。

原始 PE 属于加性绝对位置编码。后续方案通常把位置信息直接作用于 `Q/K`，或者让注意力结构本身带有位置偏置，以便更自然地表达相对距离。

### 2. RoPE：把位置变成 Q/K 的旋转

[RoFormer: Enhanced Transformer with Rotary Position Embedding](https://arxiv.org/abs/2104.09864) 提出 **RoPE（Rotary Position Embedding，旋转位置编码）**。它不把位置向量直接加到隐藏状态，而是对每个位置的 `Q` 和 `K` 做与位置相关的二维旋转。

把向量拆成若干二维子空间后，每个位置使用不同角度旋转。两个位置的旋转结果做点积时，角度差会进入匹配结果，因此注意力分数自然包含相对位置信息。可以把它理解为：绝对位置通过旋转进入向量，`QKᵀ` 的结果主要暴露位置之间的相对相位。

RoPE 成为 LLaMA、Qwen、DeepSeek 等 decoder-only 模型的常见选择，原因包括：

- 不需要为每个最大位置保存独立 embedding；
- 对相对距离有较直接的表达；
- 与自回归注意力和 KV Cache 兼容；
- 方便通过频率缩放、插值或继续训练扩展上下文。

RoPE 的边界也很明确：训练长度之外的旋转角度会进入模型没有充分学习的区域，长上下文扩展不能只把最大位置数改大。外推质量还取决于频率处理、继续训练数据、注意力分布和下游任务。

### 3. NoPE：没有显式位置编码不等于没有顺序

[The Impact of Positional Encoding on Length Generalization in Transformers](https://arxiv.org/abs/2305.19466) 系统比较了绝对位置编码、T5 相对位置编码、ALiBi、RoPE 和 **NoPE（No Positional Encoding）**。

NoPE 不向输入显式加入位置向量，也不在 `Q/K` 上施加显式旋转。对自回归 decoder 来说，因果 mask、token 的处理顺序和每一步可见的前缀仍然提供了结构性顺序信号。因此 NoPE 不是把序列变成完全无序的集合，而是把位置信息从显式参数化转移到计算过程。

该论文在长度泛化任务中观察到 NoPE 具有竞争力，部分实验中优于多种显式位置方案。读者应把这个结果理解为研究结论，而不是通用工程规则：

- NoPE 是否有效取决于任务是否需要精确绝对位置；
- 训练目标、scratchpad 格式和长度分布会影响结果；
- 在多模态 patch、双向 Encoder 或非自回归任务中，位置来源与 decoder 不同；
- 没有显式位置参数也不代表模型自动获得无限长度外推。

### 4. YaRN：RoPE 的上下文窗口扩展

[YaRN: Efficient Context Window Extension of Large Language Models](https://arxiv.org/abs/2309.00071) 面向 RoPE 模型的上下文扩展。它不是简单修改配置中的最大长度，而是对 RoPE 的频率进行分段处理，再配合低成本的继续训练，让模型适应新的位置分布。

YaRN 的核心思路可以拆成三步：

1. **识别不同频率分量**：低频和高频位置分量对长度外推的敏感性不同；
2. **分段缩放与温度调整**：对不同维度采用不同程度的插值或缩放，避免所有频率被同样压缩；
3. **短继续训练**：让模型在扩展后的长度分布上重新校准注意力和位置关系。

论文报告其所需训练 token 和训练步数明显少于部分早期扩展方法。工程上仍应验证：原始长度附近的能力是否退化、长文档检索是否稳定、位置分布变化是否影响代码和结构化输出，以及扩展后的 KV Cache 是否超出服务显存预算。

RoPE 扩展还有邻近路线，产品对照见 [大模型基础](llm-basics.md) 长上下文表：

| 方法 | 做法 | 主要边界 |
| --- | --- | --- |
| PI | 把位置整体压缩回训练范围 | 局部位置分辨率下降 |
| NTK-aware | 按频率差异化缩放 | 大倍率下仍可能不稳定 |
| YaRN | 分段插值 + 注意力尺度修正 | 超参数复杂，仍需继续训练 |
| LongRoPE | 搜索各维度非均匀缩放因子 | 搜索校准成本高 |

### 5. 位置编码方法如何选

| 方法 | 位置进入哪里 | 优点 | 主要边界 |
| --- | --- | --- | --- |
| 原始 PE | 加到 embedding | 简单、固定、无需训练位置参数 | 长度外推不保证；绝对位置表达较强 |
| RoPE | 旋转 Q/K | 相对距离自然、生态成熟、适配 decoder | 超出训练长度后需扩展策略 |
| NoPE | 依赖因果计算结构 | 参数更少，部分任务长度泛化好 | 任务依赖强，不能假设无位置也无损 |
| YaRN | 扩展 RoPE 频率 | 低成本扩展上下文窗口 | 仍需要继续训练和长上下文验收 |

产品评估不应只看模型卡中的「支持 128K」或「支持 1M」。需要分别测试：模型是否能读到远端事实、能否保持局部顺序、长输入下输出是否变短或重复、实际吞吐是否因 KV Cache 下降，以及不同位置的事实召回率是否均匀。


## 归一化与训练稳定性

### 1. LayerNorm：按样本、按特征归一化

[Layer Normalization](https://arxiv.org/abs/1607.06450) 提出 LayerNorm。对一个样本的隐藏向量 `h ∈ R^d`，先计算特征维度上的均值和方差，再使用可学习的缩放和偏置：

```text
μ = mean(h)
σ² = mean((h - μ)²)
LayerNorm(h) = γ ⊙ (h - μ) / √(σ² + ε) + β
```

与 BatchNorm 按 batch 统计不同，LayerNorm 对每个样本独立计算，训练和推理使用相同规则。因此它适合序列长度变化、小 batch 和自回归解码。它的作用不是提升模型的知识容量，而是控制隐藏状态尺度，让后续线性层、注意力和梯度处于更容易优化的数值范围。

LayerNorm 的工程代价包括均值、方差和逐元素仿射变换。现代实现通常通过融合 kernel 降低内存读写，但归一化仍处于每层主干路径上。

### 2. RMSNorm：移除均值中心化

[Root Mean Square Layer Normalization](https://arxiv.org/abs/1910.07467) 提出 **RMSNorm**。它认为 LayerNorm 的均值中心化并非始终必要，因此只保留 RMS 缩放：

```text
RMS(h) = √(mean(h²) + ε)
RMSNorm(h) = γ ⊙ h / RMS(h)
```

相对于 LayerNorm，RMSNorm：

- 少一次均值计算和减法；
- 不使用可学习偏置 `β`；
- 保留尺度不变性与一定的隐式学习率适应；
- 在性能接近时减少归一化开销。

RMSNorm 已成为许多现代 decoder-only 模型的常见组件，但「更快」取决于硬件 kernel、序列长度和实现方式，不能只依据公式推断端到端收益。

### 3. QK-Norm：限制注意力 logits 的尺度

[Query-Key Normalization for Transformers](https://arxiv.org/abs/2010.04245) 提出 **QKNorm**。该论文归一化的是 **Query 和 Key**，不是 Value，也没有提出通用的 KV-Norm。

传统注意力通过除以 `√d_k` 控制 `QKᵀ` 的尺度。QKNorm 则分别对每个头的 `Q` 和 `K` 做 L2 归一化，再使用可学习温度或尺度恢复区分度。这样做的直接目标是防止 attention logits 过早变得极端，减少 Softmax 饱和与梯度变小。

QK-Norm 适合放在以下问题的排查清单中：

- attention logits 在训练早期快速增大；
- Softmax 权重几乎变成 one-hot；
- 混合精度下出现数值溢出；
- 长上下文或深层模型训练不稳定。

它不是万能稳定器。数据异常、学习率过大、残差尺度失控和错误 mask 同样会导致 NaN 或 loss spike。

### 4. Pre-Norm 与 Post-Norm：LayerNorm 放在哪里

[On Layer Normalization in the Transformer Architecture](https://arxiv.org/abs/2002.04745) 用均值场分析研究 LayerNorm 在 Transformer Block 中的位置。

**Post-Norm** 把归一化放在残差相加之后，形式接近：

```text
x_next = LayerNorm(x + F(x))
```

**Pre-Norm** 把归一化放进子层之前：

```text
x_next = x + F(LayerNorm(x))
```

Pre-Norm 的关键优势是残差路径更接近恒等映射。梯度可以沿 `x` 直接向前传播，初始化时更容易保持稳定，通常对 warm-up 不那么敏感。Post-Norm 的表示约束位置不同，可能取得有竞争力的最终效果，但训练初期的梯度尺度更难控制。

| 结构 | 直接优点 | 常见代价或风险 |
| --- | --- | --- |
| Post-Norm | 输出表示每层经过归一化，经典结构清晰 | 深层初始化更敏感，常需要 warm-up |
| Pre-Norm | 残差提供稳定梯度通路，深层训练更容易 | 最终表示尺度与层间累积需要额外设计 |

现代架构经常把 Pre-Norm 与 RMSNorm、残差缩放、初始化策略组合使用。讨论某个模型的「用了 LayerNorm」仍然不够，必须继续问归一化的种类、位置、参数共享和残差尺度。


## 激活函数：逐位置的非线性门控

Transformer 的 FFN 对每个 token 独立做非线性变换。激活函数决定这个逐位置加工站如何保留、抑制和重组特征。

### 1. GELU：平滑的概率式门控

[Gaussian Error Linear Units (GELUs)](https://arxiv.org/abs/1606.08415) 提出 **GELU**：

```text
GELU(x) = x Φ(x)
```

其中 `Φ(x)` 是标准高斯分布的累积分布函数。与 ReLU 的硬阈值不同，GELU 根据输入值大小进行连续加权：负值通常被抑制，正值大多被保留，过渡区域保持平滑。

平滑激活有利于梯度传播和优化，但激活函数本身不会单独创造大模型能力。它的效果应放在 FFN 中间维度、参数规模、归一化和训练配方中一起评估。

### 2. SiLU：输入自门控

[Sigmoid-Weighted Linear Units for Neural Network Function Approximation in Reinforcement Learning](https://arxiv.org/abs/1702.03118) 研究 **SiLU**：

```text
SiLU(x) = x sigmoid(x)
```

它使用输入自身经过 sigmoid 后的结果作为门控系数。SiLU 不在零点产生硬切断，负值仍可能保留小幅信息，正值随着输入增大逐渐接近线性通路。

### 3. Swish：自门控激活函数的来源

[Searching for Activation Functions](https://arxiv.org/abs/1710.05941v1) 研究并提出后来称为 **Swish** 的自门控激活函数。该论文的正式标题不是 “Swish: a Self-Gated Activation Function”。Swish 写作：

```text
Swish(x) = x sigmoid(βx)
```

当 `β = 1` 时，Swish 与 SiLU 的数学形式相同。两篇论文的研究背景和命名不同，工程讨论中常把 `SiLU` 与 `Swish-1` 视为同一激活。

| 激活 | 公式 | 结构特征 |
| --- | --- | --- |
| ReLU | `max(0, x)` | 硬门控，简单高效 |
| GELU | `x Φ(x)` | 高斯累积分布的平滑门控 |
| SiLU | `x sigmoid(x)` | 输入自门控 |
| Swish | `x sigmoid(βx)` | 带可调 β 的自门控族 |

现代 LLM 常将 GELU 或其门控变体用于 FFN。产品经理不需要依据激活函数名称判断模型强弱，更应关注它与 FFN 宽度、训练稳定性和推理 kernel 的组合。


## 残差连接：从固定相加到动态层间信息流

### 1. RC：Residual Connection 的标准形式

[Deep Residual Learning for Image Recognition](https://arxiv.org/abs/1512.03385) 奠定了深层网络中常用的残差连接。下文按 **Residual Connection / ResNet** 处理：

```text
x_next = x + F(x)
```

网络不必直接学习完整映射 `H(x)`，而是学习相对于输入的残差 `F(x)`。恒等捷径为梯度提供直接通路，使更深网络更容易优化。

Transformer 继承了这个思想：注意力和 FFN 都在残差分支上工作。标准残差的局限是连接通常是固定的、单位权重的逐层累加。深度增大后，所有历史变换可能以相似方式累积，隐藏状态尺度和层间信息竞争需要额外控制。

### 2. HC：Hyper-Connections

[Hyper-Connections](https://arxiv.org/abs/2409.19606) 提出 **HC**，把固定残差连接推广为更灵活的层间连接。它允许网络学习不同深度表示之间的连接强度和信息流路径，而不是始终执行固定的 `x + F(x)`。

HC 的设计问题可以概括为：

- 哪些层的表示应当继续向后传递；
- 当前层应当读取多少旧表示；
- 梯度应当沿哪些路径传播；
- 如何避免残差变体造成梯度消失或表示坍缩。

HC 增加了连接结构的自由度，因此可能改善大模型训练和下游表现，但也带来额外参数、内存访问和并行实现问题。阅读 HC 论文时要区分理论连接矩阵、实际参数化和经过 kernel 优化后的成本。

### 3. mHC：把 Hyper-Connections 约束到流形

[mHC: Manifold-Constrained Hyper-Connections](https://arxiv.org/abs/2512.24880) 在 HC 基础上施加流形约束，目标是恢复标准残差连接的恒等映射性质，同时保留动态连接的表达能力。

这个方向的关键思想是：自由度并非越多越好。连接矩阵如果任意增长，层间信号可能爆炸、衰减或失去可解释的尺度；把它限制在合适的流形上，可以让动态连接仍然满足稳定性约束。

mHC 还讨论了面向大规模训练的内存访问和基础设施优化。它代表一种常见的现代架构趋势：先提出更强的数学结构，再为该结构设计专用 kernel 和并行实现，否则理论收益很难落地。

### 4. AttnRes：对历史层表示做注意力汇聚

[Attention Residuals](https://arxiv.org/abs/2603.15031) 提出 **AttnRes（Attention Residuals）**，用每层可学习的伪查询对先前层表示做 softmax 汇聚，替代固定的逐层残差累积：

```text
x_l = Σ_{i < l} α_{l,i} h_i
α_l = softmax(score(q_l, h_i))
```

其中 `q_l` 是第 `l` 层的可学习伪查询，**不依赖尚未算出的当前层表示 `h_l`**。直观上，当前层不再被迫以固定方式接收所有历史层输出，而是学习哪些深度的表示更有用。这样可以缓解深层网络中信号累积和单层贡献被稀释的问题。公式为教学示意，层间汇聚与 Block AttnRes 的实现以论文为准。

完整 AttnRes 需要访问大量历史层表示，可能增加显存和跨设备通信。论文进一步提出 Block AttnRes，把多层分成块，在块级表示之间做注意力，以降低成本。块级近似减少了细粒度选择能力，但更容易匹配大规模训练系统。

### 5. 残差现代化的连续谱

| 方案 | 层间信息流 | 主要收益 | 主要风险 |
| --- | --- | --- | --- |
| RC | 固定恒等捷径 + 当前残差 | 稳定、简单、硬件友好 | 深层累积缺少选择性 |
| HC | 可学习的动态连接 | 更灵活的梯度与表示路径 | 参数、通信和稳定性更复杂 |
| mHC | 受流形约束的动态连接 | 在自由度与稳定性间折中 | 约束设计与 kernel 依赖 |
| AttnRes | 对历史层表示做注意力汇聚 | 按输入选择深度信息 | 历史表示访问成本高 |

这些方法改变的是网络内部的信息流，并不直接等同于更长上下文或更多知识。它们首先要通过训练稳定性、深度扩展和相同算力预算下的有效 loss 来证明价值。

## 失败模式、不可外推与验收

| 不能外推 | 要分开验收 |
| --- | --- |
| 「支持 128K / 1M」 | 远端事实召回、局部顺序、长输入是否变短或重复、KV 导致的吞吐下降 |
| 「用了 RoPE / YaRN」 | 是否继续训练、有效窗口是否均匀、与基线同预算的质量差 |
| 「Pre-Norm / RMSNorm 更稳」 | 具体模型、精度、学习率和 kernel；公式更快不等于端到端更快 |
| Hyper-Connections / AttnRes 论文数字 | 额外参数、显存、跨设备通信；没有专用 kernel 时理论收益落不了地 |

本页是 [大模型前沿论文](llm-frontier-papers.md) 的导读专题，只覆盖瓶颈地图里的代表论文。

## 来源说明

本文为架构组件专题独立页，引用日期：2026-09-04。位置编码基础亦见 [Transformer 架构](transformer.md) 与 [AI 经典论文](classic-papers.md) 第 15 条。论文与实验结论以原始来源为准。[Attention Is All You Need](https://arxiv.org/abs/1706.03762v7)、[RoFormer](https://arxiv.org/abs/2104.09864)、[LayerNorm](https://arxiv.org/abs/1607.06450)、[RMSNorm](https://arxiv.org/abs/1910.07467)、[Hyper-Connections](https://arxiv.org/abs/2409.19606)。
