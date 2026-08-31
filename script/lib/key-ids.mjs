/**
 * key-ids.mjs —— 3_key_ids.json 四键契约（titleId/descriptionIds/
 * paragraphIds/dumpIds）的共享解析与校验。
 *
 * 步骤 3 产出的 key_ids 被步骤 4/6（及后续步骤 8）各自读取，校验规则
 * 单一事实源在此：形状拦截（类型/正整数）、paragraphIds 嵌套展开
 * （数组 = 子段落流，展开为扁平块清单 blockIds——页面函数只收扁平
 * 清单，展开逻辑不分叉）、四键互不相交（同一元素进两个键是自相矛盾
 * 的输入）。全部在开浏览器**之前**执行——坏输入不浪费一次启动。
 *
 * 用法:
 *   const parsed = parseKeyIds(keyIds);
 *   if (parsed.error) return emitError(parsed.error);
 *   const { titleId, descriptionIds, blockIds, dumpIds } = parsed;
 *
 * 返回 {error: string}（含「请重跑步骤 3」指路）或
 * {titleId, descriptionIds, blockIds, dumpIds}（titleId 归一为
 * number|null，缺省键归一为空数组）。
 */
export function parseKeyIds(keyIds) {
  const titleId = keyIds.titleId === undefined ? null : keyIds.titleId;
  const descriptionIds = Array.isArray(keyIds.descriptionIds) ? keyIds.descriptionIds : [];
  const dumpIds = Array.isArray(keyIds.dumpIds) ? keyIds.dumpIds : [];
  if (titleId !== null && !(Number.isInteger(titleId) && titleId > 0)) {
    return { error: 'titleId 应为正整数或 null，请重跑步骤 3' };
  }
  if (!Array.isArray(keyIds.paragraphIds) || keyIds.paragraphIds.length === 0) {
    return { error: 'paragraphIds 为空（步骤 3 要求至少标一个段落块），请重跑步骤 3' };
  }
  const blockIds = [];
  const invalidMembers = [];
  (function walk(node) {
    for (const item of node) {
      if (Array.isArray(item)) walk(item);
      else if (Number.isInteger(item) && item > 0) blockIds.push(item);
      else invalidMembers.push(item);
    }
  })(keyIds.paragraphIds);
  if (invalidMembers.length > 0) {
    return {
      error: `paragraphIds 含非法成员: ${invalidMembers.map((m) => JSON.stringify(m)).join(', ')}（段落块 ID 应为正整数，数组为子段落流），请重跑步骤 3`,
    };
  }

  // 四键互不相交——同一元素进两个键（或段落块重复列举）是自相矛盾的输入
  const seen = new Map();
  const dup = [];
  const collect = (id, label) => {
    if (seen.has(id)) dup.push(`id ${id} 同时在 ${seen.get(id)} 与 ${label}`);
    else seen.set(id, label);
  };
  if (titleId !== null) collect(titleId, 'titleId');
  for (const id of descriptionIds) collect(id, 'descriptionIds');
  for (const id of blockIds) collect(id, 'paragraphIds');
  for (const id of dumpIds) collect(id, 'dumpIds');
  if (dup.length > 0) {
    return { error: `四键标记重叠: ${dup.join('; ')}（同一元素不得进两个键），请重跑步骤 3` };
  }
  return { titleId, descriptionIds, blockIds, dumpIds };
}
