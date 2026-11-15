---
author: 陈宇、巩晓波、高杨、杨俊勇、关磊
book: 给产品经理讲技术
description: SQL 注入是 Web 开发中最常见的安全问题，本文用一个登录系统演示拼接 SQL 语句如何被恶意输入改变执行逻辑，并说明校验与过滤的防范原则
publication_date: '2019-04-01'
publisher: 电子工业出版社
title: 5.3 Web 安全之 SQL 语句
---

<div class="book-original" markdown="1">

## Web 安全之 SQL 语句

不少优秀的产品经理都会写一些简单的 SQL 语句进行数据查询的操作，但是会写 SQL 语句不代表能写好 SQL 语句。SQL 语句写得不好，就会引发 SQL 注入攻击。SQL 注入攻击是 Web 开发中最常见的一种安全问题，恶意攻击者可以利用它获取数据库中的敏感信息、篡改数据，甚至可以获得系统的控制权限。产生 SQL 注入漏洞的原因也很简单：开发者没有对用户提交的内容进行审核，导致恶意 SQL 语句被执行。

我们来看一个简单的例子。假设有一个登录系统，用户在登录时提交了用户名和密码，如果通过用户名和密码能从后台数据库中找到某个用户，就算登录成功。根据这个例子可以写出这样的伪代码：

```text
username = req.POST['username']
password = req.POST['password']

sql = "SELECT * FROM user_table WHERE username='" + username + "' AND
password='" + password + "'"
```

可以看出，这个 SQL 语句会将查询语句和用户提交的数据拼接起来。如果提交的用户名是 guoguo，密码是 passwd123，这个 SQL 语句就是：

```sql
SELECT * FROM user_table WHERE username='guoguo' AND
password='passwd123'
```

看上去很正常，可是，如果提交的用户名填的是 guoguo'--，密码是 123，在后台得到 SQL 语句就变成了：

```sql
SELECT * FROM user_table WHERE username='guoguo'--' AND
password='123'
```

这里就有点蹊跷了。我们先看前面那个 SQL 语句：账号和密码两个条件必须匹配上，才会返回用户 guoguo 的信息，否则查询不到任何结果。再来看第二个 SQL 语句。要知道，“--”在 SQL 语句中是注释符号，它后面的语句都将被视为无效，那么这个 SQL 真正有效的部分是：

```sql
SELECT * FROM user_table WHERE username='guoguo'
```

它的含义是“找出用户名是 guoguo 的用户”。这样黑客完全不需要知道密码，就能拿到 guoguo 的用户信息，继而登录账户。这也是互联网发展早期大家口口相传的“万能密码”。

这种通过在提交的数据里加入 SQL 代码巧妙地改变后台 SQL 执行逻辑的攻击方式，就是 SQL 注入攻击。

如何防范 SQL 注入攻击呢？其实也很简单，在这个例子中，我们将用户输入的用户名和密码进行校验，只允许字母和数字出现，那么“guoguo'--”中的“--”会被视为非法输入而拒绝执行 SQL，这个攻击就起不到任何作用了。

当然，只允许使用字母和数字这个规则过于粗暴，会误伤一些真正有效的输入。我们在实践中使用的是更复杂、也更精细的过滤规则。只需要记住一个原则：永远不要相信外界输入的数据，对任何外界输入的数据都要做合法性的校验。

可以扫描出 SQL 注入的工具很多，产品上线前，我们可以多用安全工具“扫一扫”自己的服务，防患于未然。

</div>
