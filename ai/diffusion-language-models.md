---
description: Diffusion Language Model：离散扩散、SEDD、Masked Diffusion 与 LLaDA，比较并行生成、infilling 和自回归在延迟与生态上的取舍
---

## Diffusion Language Model

自回归语言模型按从左到右的顺序预测下一个 token。Diffusion Language Model 则从噪声、掩码或不完整序列开始，经过多轮去噪逐步恢复文本。它把生成过程从单向追加改为全序列迭代更新。

图像扩散基础见 [图像生成](image-generation.md)。本页只讨论离散文本扩散、并行生成、infilling 和语言模型部署边界。

## 从连续扩散到离散文本

扩散模型原本常作用于连续图像像素或潜空间。文本 token 是离散变量，不能直接套用连续高斯噪声，因此需要定义离散破坏过程：

```text
干净 token 序列 → 掩码 / 替换 / 离散噪声 → 部分损坏序列
部分损坏序列 → 迭代去噪 → 完整 token 序列
```

[D3PM: Structured Denoising Diffusion Models in Discrete State-Spaces](https://arxiv.org/abs/2107.03006) 系统研究离散状态空间中的扩散过程。噪声转移矩阵可以把 token 替换成其他 token、特殊 mask 或均匀分布，再训练模型学习逆向恢复。

离散扩散的设计变量包括：

- 噪声如何破坏 token；
- 每个位置的噪声强度；
- 去噪步数和时间调度；
- 是否使用 mask 作为吸收状态；
- 训练和推理是否共享同一破坏过程。

## Diffusion-LM：连续潜空间中的文本生成

[Diffusion-LM Improves Controllable Text Generation](https://arxiv.org/abs/2205.14217) 研究先把离散 token 映射到连续 embedding，再在连续空间中执行扩散生成，最后解码回词表。

连续空间便于使用成熟的扩散训练和梯度控制，也有利于属性引导和文本编辑。但 embedding 空间中的几何距离不一定等于语言意义距离，去噪结果还需要可靠地映射回合法 token。

## Masked Diffusion 与 SEDD

[Simple and Effective Masked Diffusion Language Models](https://arxiv.org/abs/2406.07524) 代表使用 mask 破坏和恢复文本的路线。模型在每一步选择部分位置进行预测，逐渐减少被遮蔽的 token。

[Discrete Diffusion Modeling by Estimating the Ratios of the Data Distribution](https://arxiv.org/abs/2310.16834)（SEDD）研究 score entropy 等扩散语言模型目标，探索如何在离散空间中获得更有效的训练信号。

Masked Diffusion 的一个自然优势是 infilling：模型可以同时修改多个位置，而不是只能追加文本。它也可能支持更灵活的编辑和约束，但每轮去噪都需要重新计算模型，步数过多时会增加延迟。

## LLaDA：大规模扩散语言模型

[Large Language Diffusion Models](https://arxiv.org/abs/2502.09992) 研究大规模 masked diffusion language model。其路线试图证明，扩散式语言模型在规模化训练后可以获得接近自回归模型的语言建模和指令能力。

阅读 LLaDA 等新论文时要重点核对：

- 训练 token 规模和模型参数是否与自回归基线可比；
- 生成步数是否固定，是否使用加速采样；
- 文本续写、infilling、编辑和推理任务是否分别评估；
- 每轮更新全部 token 还是部分 token；
- 并行度收益是否抵消了重复前向的成本。

## 与自回归模型的比较

| 维度 | 自回归 LM | Diffusion LM |
| --- | --- | --- |
| 生成方向 | 从左到右 | 全序列迭代去噪 |
| 训练目标 | 下一个 token | 逆扩散或去噪目标 |
| 生成长度 | 自然自回归 | 需要规划或固定长度机制 |
| Infilling | 需要特殊设计 | 天然适合部分位置重写 |
| 推理并行 | 位置级串行 | 单轮可更新多个位置 |
| 总计算 | 步数少、每步依赖前缀 | 多轮前向，步数可能较多 |
| 生态 | tokenizer、缓存和服务成熟 | 调度、缓存和评测仍在发展 |

“可并行生成”不等于端到端一定更快。需要比较每轮并行度、去噪步数、模型大小、硬件利用率和输出质量。

## 文本编辑与可控生成

扩散式文本生成适合以下任务：

- 局部重写和 infilling；
- 受长度、格式或关键词约束的生成；
- 同时修改多个互相依赖的位置；
- 交互式草稿编辑。

但可控性仍取决于条件是否进入去噪网络、属性分类器或采样过程。控制信号可能与语义正确性冲突，生成结果也可能出现语法破坏、重复和条件遗漏。

## 部署边界

产品评估至少要测量：

- 生成步数；
- 每步更新 token 的比例；
- 端到端延迟和流式能力；
- 长文本显存和 KV Cache 使用；
- 中途取消和部分结果展示；
- infilling 质量与完整续写质量；
- 与同规模自回归模型的有效输出 token 成本。

扩散语言模型的优势更可能首先出现在编辑、结构化填充和并行生成，而不是所有开放式对话场景。研究结果需要结合实际采样调度和硬件实现判断。

## 给 AI 产品经理的结论

Diffusion LM 提供了自回归之外的语言生成范式。它适合被纳入技术储备，但选型前要明确产品是否真正需要全序列编辑、并行更新或特殊可控性。若产品主要是流式问答和工具调用，自回归生态的成熟度仍然是重要约束。

## 来源说明

本文为原创整理，引用日期：2026-09-04。主要来源包括 [D3PM](https://arxiv.org/abs/2107.03006)、[Diffusion-LM](https://arxiv.org/abs/2205.14217)、[SEDD](https://arxiv.org/abs/2310.16834)、[Masked Diffusion LM](https://arxiv.org/abs/2406.07524) 与 [LLaDA](https://arxiv.org/abs/2502.09992)。