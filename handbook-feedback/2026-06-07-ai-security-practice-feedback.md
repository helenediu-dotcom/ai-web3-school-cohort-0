# Handbook Feedback — AI Security 章节实践反馈

**日期**：2026-06-07
**来源**：Safe Agent Wallet 项目实战

---

## 1. AI Security 概念与实际代码之间的 gap

Handbook 的理论框架很清晰（Prompt Injection / Tool Misuse / Permission Isolation），但从概念到代码有距离。建议每个概念配一个最小可运行代码示例：

- Prompt Injection → 一个故意注入的 prompt + Guard 拦截的 demo
- Tool Misuse → 一个超出权限的交易请求 + Policy 引擎拒绝的 demo
- Permission Isolation → 一个 Session Key 创建 → 使用 → 过期 → 被拒绝的完整生命周期 demo

当前 Handbook 偏概念解释，缺少「把这个概念翻译成 50 行代码」的桥接。

---

## 2. Guard 层不应调用 LLM

这是项目实战中最重要的发现。如果让 LLM 同时充当「交易发起者」和「安全检查者」，攻击者可以通过 Prompt Injection 同时攻击两层。

建议 Handbook 明确强调：**安全检查层应该是确定性规则引擎，不依赖 LLM 判断**。

---

## 3. Simulation 结果不应让 Agent 用自然语言总结

项目最初设计让 Agent 读取 Simulation 结果后给用户一句话摘要（「这笔交易很安全」），后来改为结构化渲染。原因：LLM 可能把 HIGH 风险描述为「基本安全」。

建议 Handbook 增加一节：**什么时候不该用 LLM**——当输出直接影响用户的资金安全决策时，结构化数据 > 自然语言总结。

---

## 4. 权限维度的优先级排序

七维约束中，时间窗口（validFrom/validUntil）是第一道防线——大部分「忘了关权限」的问题可以通过短有效期缓解。

建议 Handbook 给出一个权限维度的优先级建议：时间 > 金额 > 合约 > 函数 > 频率，帮助读者从最重要到次要逐层配置。

---

## 5. 建议增加的内容

- **Session Key 生命周期管理**：创建 → 使用 → 过期/撤销 → 轮换
- **Multi-Agent 权限场景**：多个 Agent 各自持有不同 Session Key 时如何管理
- **安全事件的审计追踪**：Agent 的所有操作记录应该上链还是 off-chain？
