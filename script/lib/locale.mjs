// script/lib/locale.mjs —— 导出物语言标记：viewer UI 语言。
// 源仓库开发态恒 'en'；copy-skill.mjs 导出时按目标语言改写（zh 导出物 = 'zh'）——
// 这是两份导出物 script/ 中唯一内容被改写的文件（文件名两侧一致，清单契约不受影响）。
// 消费方：lib/viewer-i18n.mjs 的 resolveViewerLang（优先级 U2M_LANG 环境变量 > 本标记 > 'en'）。
export const SKILL_LOCALE = 'en';
