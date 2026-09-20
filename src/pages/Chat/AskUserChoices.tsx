import { Button, Checkbox, Radio, Select, Space } from 'antd'
import type { AskUserCard } from '../../types/chat'

/**
 * ask_user 卡片里的「选择控件」（全部用 antd 组件）。
 *
 * 选哪种控件，取决于选项数量和选择模式：
 * - 选项少（≤ 8 个）：单选 → Radio.Group（button 样式，点一下立即回答）；
 *                    多选 → Checkbox.Group，勾完点「确定」提交。
 * - 选项多（> 8 个，例如整改人/复查人是整个项目的人员名单）：
 *      一律用带搜索的 Select 下拉，否则一张卡片会被几十个按钮撑爆。
 *      多选时 Select 用 multiple 模式，配 maxTagCount 避免标签换行。
 */
export default function AskUserChoices({
  card,
  picks,
  onChangePicks,
  onPick,
  onConfirm,
}: {
  card: AskUserCard
  /** 多选模式下已勾选的选项（单选不用） */
  picks: string[]
  onChangePicks: (labels: string[]) => void
  /** 单选/下拉直接选中时调用：立即提交答案 */
  onPick: (answer: string | string[]) => void
  /** 多选点「确定」时调用 */
  onConfirm: () => void
}) {
  const options = card.options ?? []
  const isMulti = card.selectionMode === 'multi_select'
  // antd 的选择类组件统一吃 { label, value } 结构，这里把选项转换一下
  const selectOptions = options.map((o) => ({ label: o.label, value: o.label }))

  // 选项很多 → 下拉框（可搜索）
  if (options.length > 8) {
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Select
          style={{ minWidth: 260 }}
          mode={isMulti ? 'multiple' : undefined}
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="请选择"
          options={selectOptions}
          value={isMulti ? picks : undefined}
          onChange={(value) => (isMulti ? onChangePicks(value as string[]) : onPick(String(value)))}
          maxTagCount="responsive"
        />
        {isMulti ? (
          // 确定按钮：右对齐（.ask-actions 控制布局），带对勾图标更明确「提交」语义
          <div className="ask-actions">
            <Button type="primary" disabled={!picks.length} onClick={onConfirm}>
              确定
            </Button>
          </div>
        ) : null}
      </Space>
    )
  }

  // 选项不多 → 多选：复选框组 + 确定
  if (isMulti) {
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Checkbox.Group options={selectOptions} value={picks} onChange={(v) => onChangePicks(v as string[])} />
        <div className="ask-actions">
          <Button type="primary" disabled={!picks.length} onClick={onConfirm}>
            确定
          </Button>
        </div>
      </Space>
    )
  }

  // 选项不多 → 单选：按钮式单选组，选中即提交
  return (
    <Radio.Group
      options={selectOptions}
      optionType="button"
      buttonStyle="solid"
      onChange={(e) => onPick(String(e.target.value))}
    />
  )
}
