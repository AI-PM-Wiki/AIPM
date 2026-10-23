---
description: 混合专家模型前沿：稀疏门控、Switch、DeepSeekMoE，分析路由、负载均衡和分布式通信，强调总参数不等于单次激活算力。选型看激活算力与路由失败，不看总参数广告。
---

## 混合专家模型前沿论文

本页从论文和系统研究角度讨论 MoE。基础部署概念见 [模型推理与部署](llm-inference.md)，模型生态与实际模型信息见 [开源与闭源模型生态](model-ecosystem.md)。

## MoE：用稀疏路由扩大参数容量

### 1. 稀疏门控 MoE

[Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer](https://arxiv.org/abs/1701.06538) 提出稀疏门控混合专家层。一个 MoE 层包含多个独立的专家网络，路由器为每个输入选择少数专家：

```text
router(x) = TopK(softmax(W_r x))
MoE(x) = Σ_{i ∈ selected(x)} g_i(x) E_i(x)
```

如果专家总数为 `N`，每个 token 只激活 `K` 个专家，模型总参数可以随 `N` 增加，而单 token 的主要 FFN 计算量近似由 `K` 决定。MoE 因此把「模型总容量」和「单 token 计算量」部分解耦。

MoE 的核心难题不是路由公式本身，而是分布式系统：

- token 需要发送到拥有目标专家的设备；
- 热门专家可能超载，导致 token 丢弃或 padding 浪费；
- 专家之间负载不均衡，部分 GPU 空转；
- 路由器训练不稳定时，专家可能缺乏专业化。

### 2. Switch Transformer：Top-1 路由

[Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity](https://arxiv.org/abs/2101.03961) 使用更简单的 **Top-1 路由**：每个 token 只发送给一个专家。这样减少了专家组合和跨设备通信，也简化了容量管理。

Top-1 路由的系统收益很直接：每个 token 只需要一次专家计算和一次主要分发。但它把质量和负载均衡压力集中到路由器：

- 路由器过早偏好少数专家，会造成拥塞；
- 容量因子过低会丢弃 token 或使用替代路径；
- 容量因子过高会引入 padding，削弱稀疏收益；
- 通信拓扑和专家并行方式会决定真实吞吐。

因此，MoE 评估必须同时报告激活参数量、总参数量、路由负载、token 丢弃率、通信时间和质量，而不能只写「总参数 1T」。

### 3. DeepSeekMoE：细粒度专家与共享专家

[DeepSeekMoE: Towards Ultimate Expert Specialization in Mixture-of-Experts Language Models](https://arxiv.org/abs/2401.06066) 从专家专业化角度改进 MoE。

它包含两个关键设计：

1. **细粒度专家**：把原本较大的专家拆成更多小专家，同时调整每个 token 激活的专家数量，让路由器有更细的组合粒度；
2. **共享专家**：保留少量共享专家处理不同输入都需要的共通知识，减少每个路由专家重复学习基础能力。

这相当于把专家层拆成「共享基础能力 + 输入相关的专业能力」。它可能提高参数利用率，但专家数量、路由通信、负载均衡损失和并行布局也更复杂。DeepSeek-V2 将 DeepSeekMoE 与 MLA 组合，展示了容量稀疏和 KV 压缩可以同时用于同一个模型。

### 4. MoE 的产品判断

MoE 适合高并发、需要较大模型容量但希望控制每 token 计算的服务。然而总参数仍然影响：

- 权重存储与加载时间；
- 多机多卡部署规模；
- 专家路由通信；
- 故障恢复与版本管理；
- 冷启动和低并发场景下的资源利用率。

「激活参数少」只回答了部分 FLOPs 问题，没有回答模型权重是否都要常驻、请求是否会跨设备、尾延迟是否被最慢专家拖长。

Mixtral 8x7B 是产品里最常见的对照：总参数约 47B、每 token 激活约 13B，见 [模型推理与部署](llm-inference.md)。本页只覆盖瓶颈地图里的代表论文，不穷尽 Expert Choice、DeepSeek-V3 路由变体。

| 验收项 | 不能只看 | 要报 |
| --- | --- | --- |
| 能力 | 总参数 1T | 激活参数、路由负载、token 丢弃率 |
| 成本 | 单 token FLOPs | 显存、跨设备通信、尾延迟 |
| 部署 | 「稀疏所以便宜」 | 低并发利用率、冷启动、故障恢复 |


## 来源说明

本文为 MoE 专题独立页，引用日期：2026-09-04。部署概念见 [模型推理与部署](llm-inference.md)。论文与实验结论以原始来源为准。[Outrageously Large Neural Networks](https://arxiv.org/abs/1701.06538)、[Switch Transformers](https://arxiv.org/abs/2101.03961)、[DeepSeekMoE](https://arxiv.org/abs/2401.06066)。
