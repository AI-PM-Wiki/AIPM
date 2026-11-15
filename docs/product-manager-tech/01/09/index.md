---
author: 陈宇、巩晓波、高杨、杨俊勇、关磊
book: 给产品经理讲技术
description: 从 Netscape 的 Mozilla/3.0 讲起，梳理 IE、Safari、Chrome、Opera、Edge 的 UA 字符串如何层层叠加 Mozilla、like Gecko 等标识，解释浏览器为争取服务器下发完整页面而相互看齐
publication_date: '2019-04-01'
publisher: 电子工业出版社
title: 1.9 UA 的故事
---

<div class="book-original" markdown="1">

## UA 的故事

“UA”是“User Agent”（用户代理）的简写，一般用来区分不同的浏览器。UA 形如：

`Mozilla/3.0 (Win95; U)`

这是 Netscape（网景）浏览器的标识，Mozilla/3.0 表示 Netscape Navigator 3，Win95 表示宿主平台，U 为加密类型［U（128 位加密）、I（40 位加密）、N（没加密）］。

这是“血统最纯正”的 UA。其他的浏览器（例如 IE、Safari、Chrome 等）都是以它为模板扩展出来的，比如下面这些 UA：

**IE**

`Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; Touch; rv:11.0) like Gecko`

**Safari**

`Mozilla/5.0 (Macintosh; U; PPC Mac OS X; en) AppleWebKit/124 (KHTML, like Gecko) Safari/125.1`

**Chrome**

`Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US) AppleWebKit/525.13 (KHTML, like Gecko) Chrome/0.2.149.29 Safari/525.13`

这些浏览器的标识中都有 Mozilla，读者可能会疑惑，这几个浏览器名气都比 Netscape 大，为什么要这样标记呢？因为那时 Netscape 已经发展了 18 年，而 IE 才发展了 1 年，当然要向 Netscape 看齐了。

Netscape 支持网页框架，就给自己贴上 Mozilla 的标签，表示自己有这个能力。于是服务器给 Netscape 浏览器下发带框架的页面，这些网页在 Netscape 上表现得很好。虽然 IE 也支持框架，可大家都不识别，服务器给它下发的自然都是没框架的页面。于是 IE 摇身一变，也贴个 Mozilla 标签，让大家都给它发带框架的页面。

IE 就这样逐渐占领了 Netscape 的市场。Safari、Chrome 也紧随其后，贴上了 Mozilla 的标签，于是 Mozilla 成了浏览器界的 UA 的标配。

“KHTML, like Gecko”又是什么呢？

Gecko 属于渲染引擎，用于对网页信息进行排版显示。因为 Netscape 不满自己市场被挤占，让 Firefox 搭载了 Gecko，使其拥有更强的能力，网页开发者又开始追捧 Gecko。其他浏览器为了能享受相同的待遇，纷纷声称自己“like Gecko”，这里的 like 是“像”的意思，不是“喜欢”的意思。

KHTML 是 Linux 上的渲染引擎。Gecko 大火，KHTML 只有迎合大趋势才不至于被冷落，但自己本来的标识不能丢，所以表明身份是 KHTML，只是带上了 like Gecko 的标识。

看了上面的故事，再来看看快被大家忘掉的 Opera。它本是一个坚持自己立场的浏览器，可它的 UA 还是从 `Opera/8.0 (Windows NT 5.1; U; en)` 变成 `Mozilla/5.0 (Windows NT 5.1; U; en; rv:1.8.1) Gecko/20061208 Firefox/2.0.0 Opera 9.50`，它的 UA 在诉说怎样的故事，读者可以自行推理。

最后，微软的 Edge 浏览器的 UA 拷贝如下：

`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2486.0 Safari/537.36 Edge/13.10586`

至此，UA 不再是冰冷的标识，而是一个个鲜活的故事。

</div>
