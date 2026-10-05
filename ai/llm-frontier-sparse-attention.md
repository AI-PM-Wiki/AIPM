---
description: 稀疏与局部注意力前沿：结构化稀疏、滑动窗口、DSA 与局部—全局交错，分析长上下文计算量能否变成真实吞吐。并对照 CSA、NSA、BigBird 减少的对象各不相同。
---

## 稀疏与局部注意力前沿论文

本页聚焦注意力连接模式和长上下文研究，不重复 [Transformer 架构](transformer.md) 的标准注意力推导，也不重复 [模型推理与部署](llm-inference.md) 的服务工程基础。

## 稀疏与局部注意力：不让每个 token 看完整个序列

### 1. Sparse Transformer：稀疏化注意力矩阵

[Generating Long Sequences with Sparse Transformers](https://arxiv.org/abs/1904.10509) 针对标准注意力的 `O(L²)` 复杂度，提出结构化稀疏注意力。它不让每个位置连接所有位置，而是将注意力模式分解为局部或跨步的稀疏连接，使信息可以通过多层传播到远端。

论文报告将复杂度从 `O(L²)` 降到约 `O(L√L)`，从而支持更长的音频、图像和字节序列。稀疏模式的设计必须同时满足两点：

- **局部性**：保留邻近 token 的高频交互；
- **可达性**：让远端 token 经过有限层数仍有信息通路。

稀疏不是免费加速。固定模式容易漏掉任务相关的远端依赖，动态稀疏需要额外的选择器或索引开销，稀疏矩阵还可能无法充分利用通用矩阵乘法硬件。实际收益取决于 kernel 是否把理论稀疏转成真实吞吐。

### 2. SWA：滑动窗口注意力（以 Longformer 为代表）

[Longformer: The Long-Document Transformer](https://arxiv.org/abs/2004.05150) 使用滑动窗口注意力，并结合面向任务的全局注意力。每个 token 主要读取固定窗口内的邻居，窗口外的信息通过层间传播或被标记为全局 token 的位置进入。后续 Mistral、Gemma 等实现的 SWA 窗口大小、全局层比例不同，不能把 Longformer 的数字直接当成「SWA 的收益」。

滑动窗口的优点是复杂度随长度近似线性增长，适合长文档、日志、代码和局部依赖明显的序列。它的风险是远端信息不能在一层内直接交互；如果关键事实分隔很远，模型需要多层传播、全局 token 或额外检索机制。

### 3. DSA：动态选择稀疏的注意力

[DeepSeek-V3.2: Pushing the Frontier of Open Large Language Models](https://arxiv.org/abs/2512.02556) 将 **DSA（DeepSeek Sparse Attention）** 用于降低长上下文注意力计算。Lightning Indexer 对当前 Query 和历史 token 打分，为每个查询保留 token 级 top-k 历史位置，再在这些候选上执行核心注意力。DSA 不是块级选择。

公开摘要能够确认 DSA 面向稀疏注意力、长上下文效率和推理能力，但选择器的完整机制、稀疏率、硬件实现与长度边界应以论文正文和代码为准。阅读 DSA 时要重点看：

1. 选择器是否在每一步引入额外全量扫描；
2. 选择错误时是否存在可恢复的全局路径；
3. 稀疏率变化是否影响不同任务，而不是只看平均分；
4. 训练时的稀疏模式和推理时是否一致。

### 4. Gemma 2 中的局部—全局交错

[Gemma 2: Improving Open Language Models at a Practical Size](https://arxiv.org/abs/2408.00118) 在 Transformer 中交错使用局部注意力和全局注意力，并结合 GQA 等设计。局部层控制计算成本，全局层定期重建远端信息通路。

这是一种系统级折中：不要求每一层都支付完整 `O(L²)` 的代价，也不把所有远端依赖交给固定窗口。层间比例、窗口大小和全局层位置会改变质量与吞吐，不能脱离具体模型配置讨论「Gemma 2 使用了 SWA」的收益。

### 5. 局部、稀疏和压缩不是同一个问题

| 路线 | 减少的对象 | 信息如何保留 | 主要失败模式 |
| --- | --- | --- | --- |
| SWA | 每次可见的位置数 | 邻近窗口 + 周期性全局层 | 漏掉远端关键事实 |
| Sparse Transformer | 注意力矩阵连接数 | 预定义结构化通路 | 稀疏模式不匹配任务 |
| DSA | 动态选择的计算位置 | 选择器决定候选集合 | 选择器漏召回重要 token |
| MLA | KV Cache 存储量 | latent 压缩后恢复；机制见 [注意力与 KV Cache](llm-frontier-attention.md) | 压缩损失或投影开销 |

验收时分开报：理论复杂度、kernel 是否吃到稀疏、远端事实召回、与稠密注意力基线的质量差。`O(L)` 或 `O(L√L)` 不等于线上吞吐。本页只覆盖瓶颈地图里的代表论文。

### 6. 和 CSA、NSA、BigBird 怎么对照

减少的对象不同，不要把「稀疏注意力」当成一种技术：

| 方案 | 减少什么 | 和本页哪条同类 | 不要混成 |
| --- | --- | --- | --- |
| BigBird | 固定模式的连接数（全局 token + 窗口 + 随机） | Sparse Transformer / Longformer | 动态 top-k 选择 |
| NSA（Native Sparse Attention） | 动态选择的计算位置，常见为块级或分层 | 与 DSA 同类问题、选择粒度不同 | CSA 的 KV 压缩 |
| CSA / HCA | KV 表示与计算（压缩稀疏 / 重度压缩） | 见 [注意力与 KV Cache](llm-frontier-attention.md) | DSA 的 token 级 top-k |

验收先问：减少的是连接数、可见窗口、动态候选，还是 KV 存储？再对照上表。


## 来源说明

本文为稀疏注意力专题独立页，引用日期：2026-09-04。论文与实验结论以原始来源为准。[Sparse Transformer](https://arxiv.org/abs/1904.10509)、[Longformer](https://arxiv.org/abs/2004.05150)、[Gemma 2](https://arxiv.org/abs/2408.00118)、[DeepSeek-V3.2](https://arxiv.org/abs/2512.02556)。DSA 的 Lightning Indexer 是 token 级 top-k 选择，不能简化为块级选择。MLA 见 [注意力与 KV Cache](llm-frontier-attention.md)。
