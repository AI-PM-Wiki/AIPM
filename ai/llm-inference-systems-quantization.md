---
description: 推理系统与量化前沿：FlashAttention、PagedAttention、投机解码、量化和 KV 压缩，核对理论复杂度如何变成线上延迟与成本
---

## 大模型推理系统与量化

模型架构论文通常用 FLOPs 或渐进复杂度描述效率，线上系统还要处理显存带宽、kernel、批处理、通信、调度和尾延迟。本页从论文视角整理这些系统优化，基础链路见 [模型推理与部署](llm-inference.md)。

## 理论算力不等于真实吞吐

一次生成请求的成本至少包括：

- 矩阵乘法和注意力的算术量；
- 读取权重、激活和 KV Cache 的显存带宽；
- kernel 启动、融合和临时张量开销；
- 多卡张量并行、专家并行或流水线通信；
- 请求排队、动态 batch 和显存碎片。

对于长上下文解码，GPU 往往不是算力满载，而是反复读取权重和 KV Cache。因而系统论文的关键问题是：**减少哪一种数据移动，减少后是否破坏质量和调度弹性**。

## IO-aware Attention 与 FlashAttention

[FlashAttention](https://arxiv.org/abs/2205.14135) 将注意力计算重写为 IO-aware 的分块算法，在不显式保存完整注意力矩阵的情况下完成精确 softmax 注意力。它通过 tiling 减少 GPU 高带宽显存与片上 SRAM 之间的数据往返。

[FlashAttention-2](https://arxiv.org/abs/2307.08691) 进一步调整工作分区和并行化，提升 GPU 利用率。二者的共同启示是：

- 相同的数学公式可以有完全不同的内存访问成本；
- “避免物化 `L×L` 矩阵”比只数乘加次数更接近长上下文瓶颈；
- kernel 优化需要和 head dimension、精度、序列长度及硬件型号一起测量。

FlashAttention 并没有把注意力的理论复杂度变成线性；它优化的是精确注意力的实现和 IO。

## PagedAttention 与连续批处理

[PagedAttention](https://arxiv.org/abs/2309.06180) 将 KV Cache 按固定大小的 block 管理，类似虚拟内存分页。请求生成长度不同、暂停或结束时，系统可以复用和回收 cache block，减少预分配造成的碎片和浪费。

推理服务还需要 continuous batching：新请求可以加入正在解码的 batch，已结束的请求及时移出，而不必等待整个静态 batch 完成。调度器需要在以下目标之间取舍：

| 目标 | 可能冲突 |
| --- | --- |
| 最大吞吐 | 可能增加单请求等待时间 |
| 低 TTFT | 预填充请求会争抢 GPU |
| 低 TPOT | 长输入和短输入互相影响 |
| 稳定 P99 | 激进 batching 造成长尾 |
| 显存利用 | cache 复用增加管理复杂度 |

线上比较必须统一输入长度、输出长度、并发、硬件、量化和调度配置；单条请求的速度不能代表服务吞吐。

## Prefill/Decode 分离

Prefill 主要处理输入，计算密度高，适合批量矩阵运算；Decode 每次只生成一个或少量 token，更容易受到内存带宽和 KV Cache 读取限制。把二者放在同一资源池中会造成资源争抢。

前沿系统会考虑：

- Prefill 与 Decode 使用不同 GPU 池；
- 分离后通过网络或高速互联传递 KV Cache；
- 依据输入长度、输出长度和优先级动态迁移请求；
- 对长输入预填充做分块和抢占。

分离不是必然更快。KV 传输、网络拥塞、调度复杂度和故障恢复可能抵消计算收益，必须测量端到端 P50/P95/P99。

## 投机解码与多 token 预测

[Fast Inference from Transformers via Speculative Decoding](https://arxiv.org/abs/2211.17192) 使用小模型先提出多个候选 token，再由大模型一次性验证。若候选大部分被接受，大模型就能减少逐 token 的串行步数，同时保持目标模型分布的正确性。

投机解码的关键变量是：

- 草稿模型与目标模型的能力差距；
- 草稿 token 的长度；
- 目标模型验证 kernel 是否高效；
- 不同任务和温度下的接受率；
- 草稿模型额外占用的显存。

如果接受率低，系统会支付草稿模型和验证的额外开销；高并发场景还要考虑草稿模型是否成为新的瓶颈。

## 权重量化

量化把 FP16/BF16 权重映射为更低位宽的表示，减少显存和带宽。常见路线包括：

| 方法 | 主要思想 | 需要关注 |
| --- | --- | --- |
| GPTQ | 基于近似二阶信息的后训练量化 | 校准数据、层级误差、kernel 支持 |
| AWQ | 保护对激活敏感的权重通道 | 激活统计与硬件实现 |
| SmoothQuant | 迁移激活异常值到权重 | 校准集、平滑系数、精度损失 |
| FP8 | 使用 8 位浮点表示权重或激活 | 动态范围、缩放和硬件支持 |
| INT4/INT8 | 使用整数表示 | 反量化开销和算子融合 |

代表论文：[GPTQ](https://arxiv.org/abs/2210.17323)、[SmoothQuant](https://arxiv.org/abs/2211.10438) 和 [AWQ](https://arxiv.org/abs/2306.00978)。量化后的模型不应只比较困惑度，还要比较长上下文、代码、结构化输出、异常输入和实际硬件吞吐。

## KV Cache 量化与压缩

权重量化不等于 KV Cache 量化。KV Cache 随上下文和并发动态增长，可能成为服务显存的主要占用。KV 量化需要控制注意力 logits、softmax 和远端 token 读取的误差。

[KIVI: A Tuning-Free Asymmetric 2bit Quantization for KV Cache](https://arxiv.org/abs/2402.02750) 研究 KV Cache 的低比特量化，并指出 Key 和 Value 的分布特征不同，需要采用不同的量化策略。产品评测应覆盖：

- 短上下文与百万级长上下文；
- 单请求与高并发；
- 常规生成与检索型任务；
- 首 token 延迟与持续生成速度；
- cache 量化误差累积和跨 batch 复用。

## 统一评测口径

推理系统论文至少应报告以下指标：

| 类别 | 指标 |
| --- | --- |
| 质量 | 任务准确率、困惑度、长上下文召回、量化前后差值 |
| 延迟 | TTFT、TPOT、E2E latency、P50/P95/P99 |
| 吞吐 | tokens/s、requests/s、有效输出 token/s |
| 资源 | 峰值显存、权重占用、KV Cache 占用、功耗 |
| 调度 | 并发、batch size、请求长度分布、抢占次数 |
| 成本 | 每百万 token 成本、GPU 小时、跨卡通信量 |

没有输入输出长度、并发和硬件配置的“快 2 倍”无法用于选型。

## 给 AI 产品经理的结论

推理优化应先定位瓶颈：

1. 显存放不下模型：考虑量化、分片或更小模型；
2. 长上下文 cache 占用高：考虑 GQA、MLA、KV 量化或上下文压缩；
3. Decode 带宽受限：考虑 continuous batching、MQA/GQA、投机解码；
4. Prefill 拖慢首 token：考虑分块预填充、缓存和 Prefill/Decode 分离；
5. P99 不稳定：先看调度和请求长度分布，不要只换 kernel。

## 来源说明

本文为原创整理，引用日期：2026-09-04。基础部署概念参见 [模型推理与部署](llm-inference.md)。主要来源包括 [FlashAttention](https://arxiv.org/abs/2205.14135)、[FlashAttention-2](https://arxiv.org/abs/2307.08691)、[PagedAttention](https://arxiv.org/abs/2309.06180)、[Speculative Decoding](https://arxiv.org/abs/2211.17192)、[GPTQ](https://arxiv.org/abs/2210.17323)、[SmoothQuant](https://arxiv.org/abs/2211.10438)、[AWQ](https://arxiv.org/abs/2306.00978) 与 [KIVI](https://arxiv.org/abs/2402.02750)。