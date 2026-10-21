---
description: 注意力与 KV Cache 前沿：从 MHA、MQA、GQA 到 MLA、CSA/HCA，比较表达能力、缓存压缩和解码带宽，纠正 MOA/GOA 等误写，并接到推理通识页
---

## 注意力与 KV Cache 前沿论文

本页只讨论注意力头组织和 KV 表示的论文演进，不重复 [模型推理与部署](llm-inference.md) 中的 KV Cache 基础公式、服务链路和压测方法。

## 注意力头组织与 KV 表示

### 1. MHA：标准多头注意力

[Attention Is All You Need](https://arxiv.org/abs/1706.03762v7) 同时是原始位置编码（详见 [架构组件与训练稳定性](llm-frontier-architecture.md)）和 **MHA（Multi-Head Attention，多头注意力）** 的来源。MHA 使用多个独立的 Query、Key、Value 头：

```text
head_i = Attention(X W_Q_i, X W_K_i, X W_V_i)
MHA(X) = Concat(head_1, ..., head_H) W_O
```

多个头允许模型在不同子空间中建立不同关系。代价是每个 Query 头通常都有对应的 K/V 头，因此解码时 KV Cache 随头数、序列长度和每头维度一起增长。

MHA 仍然是表达能力与实现成熟度的基准。MQA、GQA 和 MLA 的核心问题不是「能否替代注意力」，而是能否在减少 K/V 存储和带宽后保留足够的注意力多样性。

### 2. MQA：多查询注意力

[Fast Transformer Decoding: One Write-Head is All You Need](https://arxiv.org/abs/1911.02150) 提出 **MQA（Multi-Query Attention，多查询注意力）**。常见误写是 MOA；若讨论 Mixture-of-Agents，应另查 [Mixture-of-Agents](https://arxiv.org/abs/2406.04692)。

MQA 保留多个 Query 头，但所有 Query 头共享一组 Key 和 Value：

```text
Q = [Q_1, ..., Q_H]
K = K_shared
V = V_shared
```

在增量解码中，KV Cache 的头数从 `H` 降为 `1`，显著减少显存读写和带宽压力。它尤其适合解码受内存带宽限制的场景。

代价是不同 Query 头无法读取完全独立的 K/V 子空间，注意力表达能力受到约束。论文报告的典型结论是速度收益明显、质量损失相对有限，但实际损失取决于模型规模、训练方式和任务分布。MQA 更像是把预算从表达多样性转给推理吞吐。

### 3. GQA：分组查询注意力

[GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints](https://arxiv.org/abs/2305.13245) 提出 **GQA（Grouped-Query Attention，分组查询注意力）**。常见误写是 GOA。

GQA 把 Query 头分成若干组，每组共享一组 K/V。设 Query 头数为 `H_q`，KV 头数为 `H_kv`：

```text
1 ≤ H_kv ≤ H_q
```

- `H_kv = H_q`：退化为 MHA；
- `H_kv = 1`：退化为 MQA；
- 中间取值：在质量、缓存和带宽之间折中。

论文还研究如何从已有 MHA checkpoint 进行少量 uptraining，将模型转换为 GQA 或 MQA。相比从头预训练，迁移成本更低，适合已有模型的推理优化。

### 4. MLA：把 KV 压缩到潜在空间

[DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model](https://arxiv.org/abs/2405.04434) 介绍 **MLA（Multi-head Latent Attention，多头潜在注意力）**，它是 DeepSeek-V2 的核心注意力组件。

MLA 不只是减少 KV 头数，而是把历史 K/V 信息压缩为低维潜在向量，在需要计算注意力时再通过投影恢复所需表示。解码阶段主要缓存压缩后的 latent，而不是完整的每头 K/V：

```text
历史隐藏状态 → latent KV compression → KV Cache
当前 Query + latent → 注意力计算
```

这种设计的收益是显著减少 KV Cache，使长上下文和高并发服务更可行。它的代价是投影、压缩和恢复的结构更复杂，对训练与推理 kernel 有更高要求；压缩维度、位置编码的处理和低秩分解方式都会影响质量。

MLA 与 GQA 的差异可以这样区分：GQA 共享一部分 K/V 头，MLA 则改变了缓存的信息参数化。前者是头数分组，后者是潜在空间压缩。

### 5. CSA / HCA：DeepSeek-V4 的压缩注意力

[DeepSeek-V4: Towards Highly Efficient Million-Token Context Intelligence](https://arxiv.org/abs/2606.19348) 介绍 **CSA（Compressed Sparse Attention，压缩稀疏注意力）** 与 **HCA（Heavily Compressed Attention，重度压缩注意力）**。以正式 arXiv 页面为准。

CSA 先把历史 token 压缩为较少的表示，再用 Lightning Indexer 对压缩后的候选位置打分，保留 top-k 压缩 KV 进入核心注意力。HCA 则使用更强的、不重叠的大块压缩，对压缩后的 KV 执行注意力，不采用 CSA 式的 top-k 稀疏筛选。

二者的分工是：CSA 同时使用压缩和稀疏选择，HCA 主要依靠更激进的压缩。论文在特定模型、硬件和 1M 上下文设置下报告了相对 DeepSeek-V3.2 的 FLOPs 与 KV Cache 降低，具体数字不能脱离实验口径泛化。

对于新的长上下文架构，至少要核对：

- 压缩对象是 token、块还是 latent；
- 选择器是否需要额外全量扫描；
- 位置编码如何与压缩表示结合；
- 训练和推理的稀疏模式是否一致；
- 压缩错误是否存在全局或局部恢复路径。

### 6. 注意力变体的横向比较

| 方案 | Q 头 | KV 头或缓存 | 主要收益 | 主要代价 |
| --- | --- | --- | --- | --- |
| MHA | 多 | 每个 Q 头独立 | 表达能力与生态成熟 | KV Cache 大、带宽压力高 |
| MQA | 多 | 一组共享 | 缓存最小、解码快 | 头间 K/V 多样性下降 |
| GQA | 多 | 多组共享 | 质量与缓存的折中 | 需要选择 KV 组数、迁移训练 |
| MLA | 多 | 压缩 latent | 大幅减少缓存，适合长上下文 | 投影与 kernel 复杂 |
| CSA / HCA | 多 | 压缩 KV + 选择或全量压缩块 | 面向百万 token 上下文降低计算和缓存 | 压缩误差、索引成本与实现复杂 |

不可外推：某一模型卡上的 KV 节省，不能写成「所有 GQA/MLA 部署都同样省」。验收时分开报：质量（相对 MHA 基线）、解码带宽、并发下的 KV 显存、压缩/选择错误时有没有恢复路径。CSA 与 HCA 的数字只在 DeepSeek-V4 论文口径内有效。本页是论文导读，机制落到服务工程见 [模型推理与部署](llm-inference.md)。

## 来源说明

本文为注意力专题独立页，引用日期：2026-09-04。MQA 机制见 [Fast Transformer Decoding](https://arxiv.org/abs/1911.02150)，勿与 Mixture-of-Agents 混淆；GQA 见 [2305.13245](https://arxiv.org/abs/2305.13245)；MLA 见 [DeepSeek-V2](https://arxiv.org/abs/2405.04434)。CSA/HCA 使用 [DeepSeek-V4](https://arxiv.org/abs/2606.19348)。服务工程见 [模型推理与部署](llm-inference.md)。
