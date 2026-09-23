---
description: 安全运营对应检测与响应：漏洞管理、检测与响应、安全运营中心和威胁情报，读完能用修复窗口、误报率、MTTD 和情报落地程度验收安全产品。
---

## 安全运营

安全运营把控制从配置变成持续处理事件。价值出现在平均检测时间、修复时间和漏报，而不是功能清单。对应 NIST CSF 的 Detect、Respond、Recover。

```mermaid
flowchart LR
    intel[情报] --> detect[检测]
    vuln[漏洞] --> detect
    detect --> triage[分诊]
    triage --> respond[遏制与恢复]
    respond --> learn[复盘入库]
```

-   [漏洞管理](vulnerability-management.md)：发现、分级、修复与例外
-   [检测与响应](detection-and-response.md)：告警、研判、遏制与取证
-   [安全运营中心](soc.md)：班次、分层和工单质量
-   [威胁情报](threat-intelligence.md)：IOC、TTP 与检测规则闭环

## 相关阅读

-   [网络安全](../index.md)
-   [密码、身份与架构](../foundations/index.md)
