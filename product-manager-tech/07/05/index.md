---
author: 陈宇、巩晓波、高杨、杨俊勇、关磊
book: 给产品经理讲技术
description: 介绍谷歌推出的终端开发框架 Flutter：用 Dart 语言描述界面、由自带渲染引擎直接绘制，兼顾开发时的动态下发与上线后的原生效率，并与 React Native 对比定位
publication_date: '2019-04-01'
publisher: 电子工业出版社
title: 7.5 终端开发新思路：Flutter
---

<div class="book-original" markdown="1">

## 终端开发新思路：Flutter

React Native 之后，就在很多人以为终端开发已经没有什么值得挑战的事情时，谷歌正式发布了 Flutter，它一经推出便受到众多开发者的追捧。不像 React Native 那样站在 ReactJS 肩膀上，Flutter 的诞生显得平淡了很多。它的开发者来自谷歌的 Chrome 团队，没错，就是那些做浏览器的技术人员，他们试图把浏览器的渲染技术用在普通的 APP 上，改着改着，就改出了一个令所有人振奋的框架。

Flutter 是一套新的终端开发解决方案，像 React Native 一样，它采用一种前端语言来开发，但不是 JavaScript，而是 Dart。Dart 是谷歌主推的语言，据说谷歌内部用 Dart 重写了大部分业务，而且把它视为谷歌下一代操作系统 Fuchsia 里的一等公民。Dart 语言写起来既像 Java 又像 JavaScript。如果说 Java 给人的印象是包罗万象、JavaScript 给人的印象是短小精悍，那么 Dart 就是采二者之长的存在。

谷歌之所以用 Dart 而不用 JavaScript 还有一层原因。Dart 语言既可以像 Java 那样预先编译成二进制代码预装在 APK 包里，也可以像 JavaScript 那样动态下发，随时解释执行。有了这个特性，开发者开发时，就用动态下发的方式把代码下发到手机里，做到实时修改实时运行，开发起来又快又顺畅。在 APP 上线时，就将代码打包成二进制，享受最小的代码体积和最高的运行效率。

Flutter 用 Dart 来描述 UI，用终端来渲染界面，看到这里读者可能在想，这不就是另一个 React Native 吗？其实不是的，它和 React Native 的区别在于，React Native 会用终端的原生控件代替前端的界面，然后交给 Android 或者 iOS 渲染；而 Flutter 则省去了原生控件这一步，直接由它自己的渲染引擎把界面“画”在屏幕上。

还记得 Flutter 的开发者 Chrome 团队吗？他们最擅长的事情就是把 HTML 渲染在屏幕上。他们把同样的技术移植到 Flutter 上，保证了 Flutter 最流畅的体验。同时，因为这套渲染逻辑是不依赖具体终端类型的，所以无论 Android 还是 iOS 都适用。

一句话概括，Flutter 是一套用 Dart 语言来写的、兼容 Android 和 iOS 的终端开发框架。拿它来和 React Native 相比，其实是不合适的，因为它并没有提供动态运营的能力，Dart 的动态解释也只是被用在了开发调试阶段。所以，Flutter 更像替代传统终端开发的一个解决方案，真正实现了程序员利用一套代码部署两种终端的梦想。

因为专注于终端渲染，Flutter 的流畅度和渲染效率是大于等于原生终端的，而 React Native，将其优化到极限也不过是等于原生终端的水平。

</div>
