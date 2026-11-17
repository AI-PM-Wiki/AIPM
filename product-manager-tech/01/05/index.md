---
author: 陈宇、巩晓波、高杨、杨俊勇、关磊
book: 给产品经理讲技术
description: 介绍 HTML 表单的作用与写法：以用户登录界面为例，逐条解释 form、action、method、input、type 各标签属性的含义，说明表单是用户与服务器之间传递数据的那层界面
publication_date: '2019-04-01'
publisher: 电子工业出版社
title: 1.5 网页基础知识：表单
---

<div class="book-original" markdown="1">

## 网页基础知识：表单

表单在很早 HTML 版本中就已经存在，它是用户输入和网页之间数据交互的一个界面，在 HTML 中用 `<form>` 标签标记。

HTML 规范已经升级到 5.0 版本，H5 是它的简称。以前的 HTML 其实应该称为 HTML4 或者 HTML4.01，“5”并不代表一种新技术，仅仅是一个版本号。

以常见的用户登录界面为例，用户访问页面前必须经过一个登录界面，这就是一个表单。表单留了一个需要输入数据的区域，这些数据将被上传到后台服务器，或者用来校验用户名和密码。表单为用户和网页的数据交互提供了一个友好的界面。

我们再来看看 HTML 表单代码是如何书写的，代码如下所示：

```html
<html lang="en">
<form name="input" action="http://www.***.com/index.html" method="GET">
<input type="text" name="user"/>
<input type="submit" value="Submit"/>
</form>
</html>
```

`form`：标识了这是一个表单。

`action`：标识了所有的数据内容将向引号内的地址提交。

`method`：标识为提交到网站的方法（一般为 GET 或 POST）。

`input`：标识为一个输入框。

`type`：标识为文本输入（user 是其参数名字）。

`input` 的 `type` 为 `submit`：标识一个按钮的类型为“提交”类型。

如果在上面的代码描述页面的输入框中输入“果果”，这两个字将会以 GET 方法提交到 http://www.xxx.com/index.html，至于服务器取到这些值后如何操作是另一个问题，这涉及服务器端程序，也是前端与后端划分的标准之一。

此外，表单中还可以承载很多类型的元素，例如 RadioBox 和 CheckBox，用来丰富用户输入类型和减少交互成本。

总结：表单是用户和服务器数据交互的用户界面，一切向服务器提交的数据都是由其中的几个简单的标签组成的。

</div>
