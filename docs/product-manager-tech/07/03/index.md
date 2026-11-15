---
author: 陈宇、巩晓波、高杨、杨俊勇、关磊
book: 给产品经理讲技术
description: 说明 React Native 应用的热更新与跨终端原理：JavaScript 解释执行、React 引擎翻译虚拟 DOM、桥接层生成原生控件，并分析它与原生应用的性能差距
publication_date: '2019-04-01'
publisher: 电子工业出版社
title: 7.3 一个 React Native 的应用是什么样的
---

<div class="book-original" markdown="1">

## 一个 React Native 的应用是什么样的

读者已经对 React Native 有了基本的认识，但心里可能还有很多疑问。例如，React Native 是如何做到热更新的？React Native 是如何利用一套代码实现 Android 和 iOS 两者兼得的？React Native 的性能是否和原生的应用一样？接下来作者将对这些问题一一作答。

我们先来复习 React Native 的原理：React Native 允许开发者使用 JavaScript 作为开发语言，像写网页一样，用 JSX 语法布局页面，React 引擎会把 JSX 语法翻译成终端的布局，并依赖终端的能力显示页面。

从原理中我们可以得到如下几个信息。

（1）开发者是用 JavaScript 开发应用的。我们知道，JavaScript 是一种解释性语言，它不需要像 C 语言及 Java 一样预先编译和打包。通常，当浏览器运行时，从网络上下载一段 JavaScript 代码，就能当场执行它。这就是解释性语言的好处，非常轻量级，可以随时随地运行和生效。

如果我们的 APP 有更新，就可以把最新的代码和之前线上代码做一个对比，找出根据新需求开发的代码，然后将它们打成一个补丁包，通过推送系统推送给终端。因为终端可以随时执行 JavaScript 代码，所以当它拉到补丁时，新需求可以直接在手机里生效。

（2）React 引擎能够把同样的 JavaScript 代码翻译成 Android 和 iOS 两个不同平台的代码，这得益于 ReactJS 的强大。首先，Android 和 iOS 要想支持 JavaScript 语言的运行，就要有一个 JavaScript 的解释器。浏览器就是一个天然的 JavaScript 解释器，不过在普通的 Android APP 里，我们要用谷歌的 V8 引擎来代替，而在 iOS APP 里，系统默认提供了一个 JavaScriptCore 充当解释器。

我们写的 JavaScript 代码，经过 ReactJS 框架翻译，会生成一棵虚拟 DOM 树，这棵树就是最后我们这个 APP 页面的布局信息。之后，这棵虚拟 DOM 树会经由一个叫 JavaScript-Native 的桥接层传递到终端世界。例如，在 Android 终端上，这棵虚拟 DOM 树将被翻译成 Android 上视图组件 View：如果 DOM 树上有一段文字，就会对应地生成一个 TextView 来显示 DOM 树上的文字。

（3）经过此番折腾，React Native 的效率还能媲美原生的 APP 吗？我们分情况分析。因为 React Native 引擎的启动耗时，所以首屏速度可能会稍微慢一点儿。另外，React Native 会多出一些 JS to Native 的通信成本。除此之外，翻译后 UI 布局因为用的是纯原生的实现方式，动画、滑动都会跟原生一样顺滑。

但 React 有一个硬伤，就是 List（列表）性能较差。Facebook 花了很大力气优化 List 的性能，但结果还是不尽如人意。可喜的是，一些第三方的项目通过自己接管 React Native 的 List 排版，实现了条目最大限度的复用，也能够媲美原生 List。

从原理上讲，React Native 是一个庞大的工程，其代码囊括 C++、JavaScript 和 Objective-C，整体架构从 Web 渲染到内核通道再到终端绘制，非常复杂。架构的复杂会导致掌控难度增加，例如，如果出了一些奇奇怪怪的 Bug，可能需要精通前端和终端的程序员才能解决。读者可以在选择 React Native 的时候做一个权衡。

</div>
