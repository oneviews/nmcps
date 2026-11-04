// layers/system/app/utils/policyDocument.ts
// 策略文档（`document`，上游是 **JSON 字符串** 落 jsonb）的只读预览口径。
//
// 设计基准：NMCPS-DESIGN-005 §7.2（layers/content/collections/cn/architecture/2.domain/system.md）：
// 页面「只做格式化预览 + 复制」，解析失败就回落原文，**不提供编辑器**（写坏即脏数据）。
// 上游缺陷：NMCPS-REC-005 UP-RBAC-04 —— 非法 JSON 会被 PG 直接拒绝（`SQLSTATE 22P02`），
// 因此新建表单也要在前端先 parse 一次，别把注定失败的报文发给上游。

export interface PolicyDocumentPreview {
	/** 可直接渲染的文本：能解析时是两空格缩进的 JSON，否则是原文 */
	text: string
	/** 是否为合法 JSON（`false` 时 `text` 是原文，可能被上游拒绝） */
	valid: boolean
}

/** 文档预览：合法 JSON 缩进美化，非法 JSON 原样返回（不猜、不修） */
export function previewPolicyDocument(raw: string | null | undefined): PolicyDocumentPreview {
	const source = (raw ?? "").trim();
	if (!source)
		return { text: "", valid: false };

	try {
		return { text: JSON.stringify(JSON.parse(source), null, 2), valid: true };
	} catch {
		return { text: source, valid: false };
	}
}
