---
description: Tokenizer-free 模型：字节级、字符级、MegaByte 与 Byte Latent Transformer，分析多语言公平性、序列变长和部署成本
---

## Tokenizer-free 模型

大语言模型通常先用 BPE、WordPiece 或 Unigram 将文本切成 token，再进行序列建模。Tokenizer-free 模型直接处理字节或字符，试图减少固定词表对多语言、代码、拼写和新词的限制。

本页讨论 tokenizer 的研究边界，不重复 [大模型基础](llm-basics.md) 中的 token 入门和 [模型推理与部署](llm-inference.md) 的通用成本估算。

## Tokenizer 的收益与代价

Tokenizer 通过把常见字符串压缩成较少 token，降低序列长度和 Transformer 的注意力成本。但固定词表也会带来：

- 不同语言的压缩率不均；
- 中文、日文、泰文和低资源语言的 token 成本差异；
- 代码、数学表达式和新词被切成过多片段；
- 词表更新后模型输入接口不兼容；
- 拼写扰动和字符级变化被切分规则放大。

因此，tokenizer 是模型架构和产品计费的一部分，不只是预处理脚本。

## Byte-level 与 Character-level

[CANINE: Pre-training an Efficient Tokenization-Free Encoder for Language Understanding](https://arxiv.org/abs/2103.06874) 研究不依赖传统 subword tokenizer 的字符级 Encoder。它通过局部压缩和下采样控制字符序列过长的问题。

[ByT5: Towards a Token-Free Future with Pre-trained Byte-to-Byte Models](https://arxiv.org/abs/2105.13626) 直接在 UTF-8 字节序列上训练 Encoder-Decoder 模型。字节级输入具有词表小、未知词处理统一和跨语言接口一致的特点，但序列长度更长，训练和推理需要更高的计算预算。

### 字节与字符的差异

| 粒度 | 优势 | 代价 |
| --- | --- | --- |
| 字符 | 对可读文字更直观，序列比字节短 | Unicode、多语言和编码处理更复杂 |
| UTF-8 字节 | 输入接口统一，不需要未知词 | 序列可能显著变长 |
| Subword token | 压缩效率高，生态成熟 | 词表偏差、切分边界和更新成本 |

## Charformer 与动态压缩

[Charformer: Fast Character Transformers via Gradient-based Subword Tokenization](https://arxiv.org/abs/2106.12672) 在字符输入上学习可训练的 subword 组合。它保留字符级输入的灵活性，又尝试通过梯度学习压缩常见片段。

这种路线说明“tokenizer-free”不一定意味着每个字符都完整进入主干 Transformer。压缩可以从离线规则迁移为模型内部可学习的动态操作。

## MegaByte 与 Byte Latent Transformer

[MegaByte: Predicting Million-byte Sequences with Multiscale Transformers](https://arxiv.org/abs/2305.07185) 采用多尺度结构，让局部模型处理字节细节，让更高层模型处理 patch 级表示。它将长字节序列分解为局部和全局两个尺度。

[Byte Latent Transformer: Patches Scale Better Than Tokens](https://arxiv.org/abs/2412.09871) 进一步探索根据字节内容动态形成 patch，使高信息密度区域获得更细粒度表示，重复或低信息区域获得更强压缩。动态 patch 的关键是压缩率和语义边界是否稳定，而不是单纯减少 token 数。

## 多语言、代码和数学

Tokenizer-free 模型的潜在收益主要集中在输入分布变化明显的场景：

- 新词、专有名词和拼写变体；
- 低资源语言和混合语言；
- 代码中的标识符、路径和符号；
- 数学公式、表格和结构化文本；
- 对抗性字符扰动和 Unicode 变体。

评测必须使用原始字符串级任务，并报告字节长度、字符长度和模型内部序列长度。只比较 token 数，会掩盖字节级模型在更长序列上的真实计算代价。

## 生产成本

Tokenizer-free 模型需要重点测量：

1. 平均与 P99 序列长度；
2. 训练和推理的 tokens/bytes per second；
3. 注意力和激活显存；
4. 输入预处理和输出解码时间；
5. 多语言输入的成本公平性；
6. 长输入下的吞吐和尾延迟；
7. 字节级模型与现有 tokenizer 生态的兼容成本。

如果字节级序列长度增加 4 倍，而模型只通过减少词表参数节省很少显存，端到端收益可能为负。多尺度压缩和动态 patch 是把鲁棒性转化为可部署效率的关键。

## Tokenizer-free 是否适合生产

| 场景 | 初步判断 |
| --- | --- |
| 统一多语言输入 | 值得评估，重点看成本公平性 |
| 代码和数学 | 值得评估，重点看符号与长序列能力 |
| 实时聊天 | 谨慎，优先测量序列长度与吞吐 |
| 长文档 RAG | 谨慎，检索块和上下文预算都需重算 |
| 既有模型微调 | 迁移成本高，词表和 checkpoint 不兼容 |
| 边缘设备 | 需要专用压缩和 kernel，不能只看参数量 |

## 给 AI 产品经理的结论

Tokenizer-free 解决的是输入表示的灵活性和公平性，不会自动解决语言理解、长上下文和推理问题。它的产品价值取决于输入是否经常出现新词、代码、符号、多语言或字符扰动；最终仍要用字节成本、延迟、质量和生态迁移成本共同决策。

## 来源说明

本文为原创整理，引用日期：2026-09-04。主要来源包括 [CANINE](https://arxiv.org/abs/2103.06874)、[ByT5](https://arxiv.org/abs/2105.13626)、[Charformer](https://arxiv.org/abs/2106.12672)、[MegaByte](https://arxiv.org/abs/2305.07185) 与 [Byte Latent Transformer](https://arxiv.org/abs/2412.09871)。