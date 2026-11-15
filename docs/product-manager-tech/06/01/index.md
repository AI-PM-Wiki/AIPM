---
author: 陈宇、巩晓波、高杨、杨俊勇、关磊
book: 给产品经理讲技术
description: 面向对象程序设计的五个基本概念：对事物进行抽象，进而封装为类，由类生成实例或对象，这几个名词是程序员技术讨论会上出现频率最高的，文中以化妆包与女孩的例子演示
publication_date: '2019-04-01'
publisher: 电子工业出版社
title: 6.1 抽象、封装、类、实例和对象
---

<div class="book-original" markdown="1">

## 抽象、封装、类、实例和对象

面向对象的程序设计是当前世界上最流行的程序设计思想和方法，而抽象、封装、类、实例和对象都是构成面向对象程序设计的基本概念。如果读者有幸旁听程序员们的技术讨论会，会发现这几个名词是会上出现频率最高的。

这几个词可以用一句话串联为：对事物进行“抽象”，从而封装为“类”，由“类”可以生成“实例”或“对象”。

抽象是面向对象思维方式最基础的逻辑和思维，是封装的前提，是对一系列拥有共同属性或行为的描述。喝水、喝酒、喝西北风，可以抽象出“喝”；抽烟、抽风、抽鸦片，可以抽象出“抽”；点菜、点名、点播，可以抽象出“点”。抽象对应的是具体，抽象之后具体消失，共性出现。这些共性被用来封装为类。类可以定义实例，实例也称为对象。

我们以化妆包为例封装一个类，眉笔、睫毛膏放在夹层里，红石榴水、“小黑瓶”放在另一个格子里，面膜平铺在底部；同时化妆包具备打开和关闭两项功能。我们定义的这个化妆包的类既包含数据（眉笔、睫毛膏等），也包含行为（打开、关闭）。封装了“类”，就可以定义对象了；有了“化妆包”这个对象，再用“女孩”这个抽象类型定义一个对象“小红”，就可以开始面向对象编程之旅了。

下面作者简单地写一段代码，做一个需求：小红打开化妆包，拿出红石榴水，运用“脱、拉、摇、移、拽、拍、打”7 种手法进行脸部护理。

```java
// 创建“化妆包”类
public class MakeUpBag
{
    // 开包，关包
    public void open();
    public void close();

    // 化妆包里面有各种化妆品
    private String mHongShiLiuShui;
    private String mXiaoHeiPing;
    private String mMeiBi;
    private String mMianMo;
}

// 创建“女孩”类
public class SweetGirl
{
    // 从 bag 这个化妆包里拿红石榴水这种化妆品
    public String get(MakeUpBag bag);

    // 化妆的 7 种手法
    public void tuo(String huazhuangPin);
    public void la(String huazhuangPin);
    public void yao(String huazhuangPin);
    public void yi(String huazhuangPin);
    public void zhuai(String huazhuangPin);
    public void pai(String huazhuangPin);
    public void da(String huazhuangPin);

    public static void main(String[] args)
    {
        // 创建一个叫小红女孩对象
        SweetGirl xiaohong = new SweetGirl();

        // 创建一个对象“化妆包”，也可以称之为实例
        MakeUpBag bag = new MakeUpBag();

        // 打开化妆包
        bag.open();

        // 得到红石榴水
        String hongshiliu = xiaohong.get(bag);

        // 开始“按摩”皮肤
        xiaohong.tuo(hongshiliu);
        xiaohong.la(hongshiliu);
        xiaohong.yao(hongshiliu);
        xiaohong.yi(hongshiliu);
        xiaohong.zhuai(hongshiliu);
        xiaohong.pai(hongshiliu);
        xiaohong.da(hongshiliu);
    }
}
```

这段 Java 代码不能运行。作者只是写了大概的伪代码表述整个面向对象的过程，以便读者有一个感性认知。

</div>
