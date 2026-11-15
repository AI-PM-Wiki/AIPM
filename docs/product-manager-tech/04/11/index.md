---
author: 陈宇、巩晓波、高杨、杨俊勇、关磊
book: 给产品经理讲技术
description: 从 Chrome 默认关闭断点续传讲起，用 2048Byte 文件下载中断的例子解释 Range 与 Content-Range 两个 HTTP 字段，再说明多线程下载的原理
publication_date: '2019-04-01'
publisher: 电子工业出版社
title: 4.11 断点续传的奥义
---

<div class="book-original" markdown="1">

## 断点续传的奥义

如果读者也是个“重度”Chrome 用户，那么一定有过这样的糟糕体验：在 Chrome 中下载一个文件，下载还未完成时突然被提示“下载失败”，单击“重试”按钮后，Chrome 竟然不支持断点续传，而是傻傻地从头开始重新下载这个文件。

作者经过一番调查，发现其实 Chrome 是自带了断点续传功能的，只是被默认关闭了。通过 chrome://flags 中的选项，可以将其打开（如[图4-8](#figure-4-8)所示）。

<figure id="figure-4-8" tabindex="-1" markdown="1">

<p markdown="span" style="margin:0">
![img](../../images/fig_4_8.jpg){ width="1405" height="187" }
</p>

<figcaption markdown="span" style="margin:0.5em auto;font-size:0.8em;font-style:normal;line-height:1.5">
图4-8
</figcaption>

</figure>

那么，被谷歌默认关闭的“断点续传”到底是什么呢？

首先，我们来看看 HTTP Header 中的两个特殊字段。一个在请求头中，叫“Range”表示本次请求要求服务器返回的数据范围；另一个在响应头中，叫作“Content-Range”表示本次服务器返回的数据范围。我们通过下面的例子来理解这两个字段具体的作用。

小明在下载一个 2048Byte 大小的文件，当下载工具收到 1024Byte 数据时，网络由于某种不可预知的原因中断。网络恢复正常后，小明想把没下载完的数据拉取回来，就要在请求头里写“Range:bytes=1024-”，从 1024Byte 开始拉取后面的数据。小明并不知道还剩下多少数据，所以在“1024Byte”后面写了一个“-”。服务器会在响应里写“Content-Range:bytes1024-/2048”，表示返回了从 1024Byte 到文件结尾的全部数据，同时告诉小明，这个文件的大小总共是 2048Byte。

我们可以看出，在请求头里写“Range”，可以指定请求某一个片段的数据，相应地，响应包里用“Content-Range”表示返回数据片段在整个文件中的位置。

如果小明把这个文件分成 4 个片段，同时用 4 个线程分别下载它们，最后把它们拼在一起，那么下载同样大小的文件就只需要以前所需时间的 1/4，这也就是多线程下载工具的基本原理。

</div>
