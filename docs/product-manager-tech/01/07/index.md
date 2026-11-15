---
author: 陈宇、巩晓波、高杨、杨俊勇、关磊
book: 给产品经理讲技术
description: 汇总 Chrome 浏览器里的七项实用功能：Console 招聘留言、断网后的小恐龙游戏、Android 版的主题色标题栏、地址栏指定站内搜索、地址栏直接计算与执行 JavaScript、把网页另存为 PDF
publication_date: '2019-04-01'
publisher: 电子工业出版社
title: 1.7 Chrome 里的冷知识
---

<div class="book-original" markdown="1">

## Chrome 里的冷知识

**DevTools**：如果读者在浏览某些网站时按“F12”键启动开发者工具，会在 Console 这个 Tab 下收到网站开发者的留言，不过这些留言大多是一些招聘信息，因为这样做针对性很强，这些信息几乎只有开发工程师才能看到。

**恐龙小游戏**：当没有网络时，浏览器也就没有什么作用了，用户会很无聊，于是 Chrome 免费送了一款小游戏，给用户消磨时间。触发方法：先断开网络，然后在 Chrome 里随便打开一个网址，读者会看到如[图1-3](#figure-1-3)所示的小恐龙，再按“空格”键，游戏就开始了。如果是在手机版浏览器上，就直接单击小恐龙开始游戏。

<figure id="figure-1-3" tabindex="-1" markdown="1">

<p markdown="span" style="margin:0">
![img](../../images/fig_1_3.jpg){ width="920" height="207" }
</p>

<figcaption markdown="span" style="margin:0.5em auto;font-size:0.8em;font-style:normal;line-height:1.5">
图1-3
</figcaption>

</figure>

**变色的标题栏**：在 Android 版的 Chrome 浏览器里访问某些网站时，读者会发现标题栏和状态栏的颜色变成了该网站的主题色。这其实是 Chrome 的一个特性，只要开发者在网页的 header 里设置了 theme-color 的属性，Android 版的 Chrome 就会选择当前网页的 theme-color 表示的颜色作为标题栏和状态栏的背景色。

**指定搜索引擎**：如果读者想在淘宝搜索某件商品，或者想在知乎搜索某个问题，可以在 Chrome 的地址栏里直接输入淘宝或者知乎的域名，然后按“Tab”键，Chrome 的地址栏就显示“用 xx 搜索”，我们紧接着输入想搜索的内容，按回车键，结果就如[图1-4](#figure-1-4)所示。

<figure id="figure-1-4" tabindex="-1" markdown="1">

<p markdown="span" style="margin:0">
![img](../../images/fig_1_4.jpg){ width="1134" height="244" }
</p>

<figcaption markdown="span" style="margin:0.5em auto;font-size:0.8em;font-style:normal;line-height:1.5">
图1-4
</figcaption>

</figure>

**计算器**：临时要做一些简单的计算，又不想打开计算机里的计算器程序，则可以直接在 Chrome 的地址栏里进行计算。例如，在地址栏输入“1+1=”，地址栏下方就会显示计算结果。

**执行 JavaScript 语句**：同样在地址栏里，使用“javascript:xxx”就能执行相应的 JavaScript 语句，读者可以尝试在地址栏里输入如下代码：

```javascript
javascript:alert("hello guoguo");
```

注意要手动输入，若采用复制/粘贴的方式，Chrome 会默认清理“javascript:”这个前缀，输入后就会看到一个显示“hello guoguo”的对话框。

**将网页存为 PDF 文件**：有时我们需要将一个页面保存下来，除了用 Evernote 等工具，还可以在 Chrome 里直接将该网页存成 PDF，只需按“Ctrl+P”组合键唤起“打印网页”对话框，然后在目标打印机的选项中选择“另存为 PDF”选项。

</div>
