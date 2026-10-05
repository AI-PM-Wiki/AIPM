---
description: 线性注意力与状态空间前沿：Lightning Attention、Mamba、DeltaNet、KDA 与 Mamba-3，比较有限状态的表达力、效率和失败模式
---

## 线性注意力与状态空间前沿论文

本页讨论 Transformer 之外的长序列建模研究。总入口见 [大模型前沿论文](llm-frontier-papers.md)。它与 [模型推理与部署](llm-inference.md) 的关系是：有限状态、线性递推和混合层可能改变 KV Cache 与流式解码的成本结构。

## 线性注意力与状态空间：用有限状态处理长序列

### 1. Lightning Attention：把因果注意力改写成线性累积

[Lightning Attention-2: A Free Lunch for Handling Unlimited Sequence Lengths in Large Language Models](https://arxiv.org/abs/2401.04658) 探索因果线性注意力的高效实现。通过核技巧，注意力可以把历史信息维护为累积状态，避免显式构造完整的 `L×L` 注意力矩阵。

Lightning Attention-2 使用分块策略：块内保留更接近传统注意力的计算，块间使用线性累积，以兼顾局部表达和长序列效率。其重点不只在渐进复杂度，也在 Triton kernel、tiling 和内存访问上。

线性注意力的核心约束是：历史不能再以完整 token-token 矩阵保存，必须压缩成固定维度状态。因此它的瓶颈从「注意力矩阵太大」转变为「有限状态是否足以表达任务所需记忆」。

### 2. Mamba：输入依赖的选择性状态空间

[Mamba: Linear-Time Sequence Modeling with Selective State Spaces](https://arxiv.org/abs/2312.00752) 将状态空间模型用于大规模序列建模。一般状态空间模型可以抽象为：

```text
state_t = A state_(t-1) + B input_t
output_t = C state_t
```

Mamba 的关键变化是让部分状态空间参数依赖当前输入。模型因此能够根据 token 内容动态决定：

- 哪些信息写入状态；
- 哪些历史信息继续保留；
- 哪些状态应该被遗忘或更新。

这种 **selective state space** 使有限状态不再是固定滤波器，而成为内容相关的记忆机制。Mamba 通过硬件感知的选择性扫描实现线性长度扩展，避免直接 materialize 长度平方的注意力矩阵。

Mamba 的优势适合长序列吞吐和流式处理，边界在于：有限状态可能难以精确保存任意远端 token，精确复制、全局检索和多实体关系任务可能仍受益于注意力或混合结构。

### 3. Mamba-2：建立 SSM 与注意力的对偶关系

[Transformers are SSMs: Generalized Models and Efficient Algorithms Through Structured State Space Duality](https://arxiv.org/abs/2405.21060) 提出结构化状态空间对偶（SSD）视角，展示某些结构化状态空间计算与注意力矩阵之间的联系，并据此改进 Mamba 的核心层。

Mamba-2 的重要意义不是简单地把 Mamba 做得更大，而是把两类序列模型放进同一组矩阵结构中分析：

- 注意力提供显式 token-token 交互；
- SSM 通过递推状态处理序列；
- 结构化半可分矩阵连接了两种计算表达。

论文报告其核心层在保持序列建模能力的同时获得更高速度。对架构设计者而言，这条路线提供了新的硬件映射方式；对产品经理而言，仍要回到长序列质量、流式延迟和部署生态，而不是只比较模型名称。

### 4. DeltaNet：用 Delta Rule 改写状态

[Parallelizing Linear Transformers with the Delta Rule over Sequence Length](https://arxiv.org/abs/2406.06484) 提出 **DeltaNet**。它不用「把新 token 累加进状态」的普通线性注意力，而是按 Delta Rule 对已有状态做定向改写：当前输入决定改哪一块记忆、改成什么。

这让有限状态更接近「可更新的联想记忆」，而不是只能衰减的滑动平均。地图上的 DeltaNet 指这篇；下一节的 Gated DeltaNet 是在它上面加门控。

失败模式：改写过度会忘掉仍需要的历史；改写不足则状态被新 token 淹没。验收时分开测：精确检索、长程依赖、流式吞吐，不要只看平均 perplexity。

### 5. Gated DeltaNet：门控与 Delta Rule

[Gated Delta Networks: Improving Mamba2 with Delta Rule](https://arxiv.org/abs/2412.06464) 将门控机制与 Delta Rule 结合。Delta Rule 不只是把新 token 加入状态，而是根据当前输入计算对已有状态的定向修正；门控则决定状态保留、衰减或清除的程度。

可以用以下抽象理解它的更新：

```text
candidate = state_(t-1) + targeted_delta(input_t)
state_t = gate_t ⊙ candidate
```

实际论文的状态更新和并行算法更具体。这里的关键是把「记住什么」和「如何修改已记忆内容」拆成两个可学习的控制问题。论文在上下文检索、长度外推和长上下文理解上报告了相对 Mamba-2、DeltaNet 的改进，并讨论了与滑动窗口注意力或 Mamba-2 组合的混合架构。

### 6. KDA：Kimi Delta Attention

[Kimi Linear: An Expressive, Efficient Attention Architecture](https://arxiv.org/abs/2510.26692) 介绍以 **KDA（Kimi Delta Attention）** 为核心的线性注意力路线，并将 KDA 与 MLA 组合成混合架构 Kimi Linear。

KDA 延续 Delta Rule 的递归状态更新，同时引入更细粒度的门控，使线性状态能够按内容更新。Kimi Linear 用不同层承担不同任务：线性注意力层负责高效维护长程状态，MLA 层保留更强的精确内容交互。

这种混合结构的设计逻辑是：

- 全部使用完整注意力，KV Cache 与长上下文计算昂贵；
- 全部使用有限状态，精确检索和复杂 token 关系可能受限；
- 按层混合，让不同机制承担不同的记忆职责。

论文报告在长上下文解码中减少 KV Cache 并提升吞吐。实际复现时需要区分 KDA 的理论递归复杂度、混合层比例和专用 kernel 带来的真实收益。

### 7. Mamba-3：更有表达力的状态空间递推

[Mamba-3: Improved Sequence Modeling using State Space Principles](https://arxiv.org/abs/2603.15569) 继续从状态空间原则改进线性序列模型。论文引入更有表达力的递推、复数状态更新和 MIMO（多输入多输出）结构，目标是在不增加解码延迟的情况下提升状态表达能力。

Mamba-3 仍然依靠有限维状态和递推式更新，不会把长历史完整保存在 KV Cache 中。相对于 Mamba-2，主要变化集中在：

- 通过复数状态表达更丰富的动态；
- 用 MIMO 结构提高一次状态更新承载的信息量；
- 调整离散化与架构配方，以改善困惑度和下游任务。

Mamba-3 属于较新的研究结果，性能数字和硬件适配仍应以论文版本、代码和复现实验为准。它说明 SSM 路线的研究重点已经从「能否线性处理序列」转向「如何在固定状态预算下恢复更多注意力式表达能力」。

### 8. 线性路线的共同边界

线性注意力、DeltaNet 和 Mamba 都在压缩历史信息。它们更适合：

- 超长日志、音频、传感器流和持续对话；
- 需要稳定流式吞吐、低 KV Cache 的服务；
- 局部状态和时间动态比任意远端精确复制更重要的任务。

它们需要重点验证：

- 长距离精确复制；
- 多实体、多跳关系；
- 随机访问任意历史片段；
- 训练长度变化后的泛化；
- 线性理论复杂度是否转化为硬件上的实际速度。


## 来源说明

本文为序列模型专题独立页，引用日期：2026-09-04。总入口见 [大模型前沿论文](llm-frontier-papers.md)。论文与实验结论以原始来源为准。[Lightning Attention-2](https://arxiv.org/abs/2401.04658)、[Mamba](https://arxiv.org/abs/2312.00752)、[Mamba-2](https://arxiv.org/abs/2405.21060)、[DeltaNet](https://arxiv.org/abs/2406.06484)、[Gated DeltaNet](https://arxiv.org/abs/2412.06464)、[Kimi Linear](https://arxiv.org/abs/2510.26692)、[Mamba-3](https://arxiv.org/abs/2603.15569)。2025—2026 条目均属于较新的 arXiv 研究，应结合版本日期阅读。
