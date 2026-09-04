---
description: 密码、身份与架构对应识别与保护：威胁与攻击面、身份认证与访问控制、密码学与密钥管理、安全架构与零信任，读完能在功能设计前列出资产、身份和信任边界。
---

## 密码、身份与架构

先回答谁会攻击、凭什么证明身份、系统默认信任谁。对应 NIST CSF 中 Identify 与 Protect 的核心控制，也是等保里访问控制和安全通信的产品化入口。

```mermaid
flowchart LR
    asset[盘点资产] --> threat[威胁模型]
    threat --> iam[身份与权限]
    iam --> crypto[密钥与通道]
    crypto --> zt[零信任默认]
```

-   [威胁与攻击面](threats-and-attack-surface.md)：STRIDE、ATT&CK 与攻击面清单
-   [身份认证与访问控制](identity-and-access.md)：认证、授权、特权与身份治理
-   [密码学与密钥管理](cryptography-and-keys.md)：密钥生成、存储、轮换与吊销
-   [安全架构与零信任](architecture-and-zero-trust.md)：纵深防御与持续验证

## 相关阅读

-   [网络安全](../index.md)
-   [身份认证与权限](../../../tech/identity-access.md)
