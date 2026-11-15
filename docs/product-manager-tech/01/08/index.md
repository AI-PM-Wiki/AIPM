---
author: 陈宇、巩晓波、高杨、杨俊勇、关磊
book: 给产品经理讲技术
description: 讲解 JS DDoS 的攻击原理：劫持流行的 JavaScript 类库并插入恶意代码，让每个访问者的浏览器持续向目标网站发请求，并给出校验散列值与改用 HTTPS 两种防御办法
publication_date: '2019-04-01'
publisher: 电子工业出版社
title: 1.8 JS DDoS 攻击的原理与防御
---

<div class="book-original" markdown="1">

## JS DDoS 攻击的原理与防御

分布式拒绝服务攻击（Distributed Denial of Service，DDoS）是一种对网站发起大量连接，导致正常用户无法访问网站的攻击手段。利用流量劫持变相进行 DDoS，就是 JS DDoS。

很多网站都会用 JavaScript 执行一些页面的逻辑代码，它可以在网页加载完成后再根据情况增加一些图片元素，通过进行异步加载提升网页加载速度。很多程序员都喜欢用网上流行的各种 JavaScript 库，它们提供了一些公共方法，可以提升开发效率，比如一个很流行的 JavaScript 库 jQuery，在很多网页源码里都能看到类似下文所示的代码。

```javascript
function imgflood() {
    var TARGET = 'victim-website.com'
    var URI = '/index.php?'
    var pic = new Image()
    var rand = Math.floor(Math.random() * 1000)
    pic.src = 'http://' + TARGET + URI + rand + '=val'
}
setInterval(imgflood, 10)
```

一个类库越流行，就越容易被做“黑产”的人盯上：既然大家都这么喜欢用 jQuery，就劫持开发者使用的 jQuery，然后在其中插入一段恶意的 DDoS 代码，当页面加载被劫持的 jQuery 类库后，就会触发恶意 DDoS 代码的执行。然后，每个访问这个页面的用户都可能成为攻击者的傀儡机，替他们攻击特定的网站。

下面这段代码展示了攻击的雏形。

```html
<script src="https://code.jquery.com/jquery-1.10.2.min.js" integrity="sha256-C6CB9UYIS9UJeqinPHWTHVqh/E1uhG5Tw+YqFOmYg" crossorigin="anonymous">
```

这个攻击每秒在页面上创建 10 个图片控件，每个图片控件的源图都指向 victim-website.com，加上浏览器会自动拉取图片资源，所以每个用户每秒都会对这个网站请求 10 次，如果同时有 100 个人访问这个页面，那么每秒就有 1000 个无效的请求在访问 victim-website.com，这是很大的资源浪费，而真正想访问这个网站的用户有可能因为服务器过载而无法打开页面。

当然，要防御它是有办法的。开发者在引用一个第三方库时，在页面里写上它的散列值，如果第三方库被劫持，计算出的散列值与开发者写在页面里的不匹配，浏览器便不会执行它。还有另一种方案，就是使用 HTTPS 链接，这样可以解决大部分劫持问题。

网络世界是不安全的，需要时刻注意做好保护措施。

</div>
