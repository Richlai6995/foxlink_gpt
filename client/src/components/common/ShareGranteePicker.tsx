/**
 * ShareGranteePicker — 共用分享對象選擇器
 *
 * 統一 7 種 grantee_type 的 combobox UI、模糊搜尋、顯示格式。
 * 見 docs/factory-share-layer-plan.md §3.2
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import i18n from '../../i18n'
import api from '../../lib/api'
import UserPicker from './UserPicker'
import type { GranteeType, GranteeSelection, GranteeLovOption, OrgLovResponse } from '../../types'
import { formatGranteeLabel, filterAndRank, splitForHighlight, hasCode } from './granteeFormat'

const DEFAULT_TYPES: GranteeType[] = ['user', 'role', 'factory', 'department', 'cost_center', 'division', 'org_group']

interface ShareTypeOption {
  value: string
  label: string
}

interface Props {
  value: GranteeSelection | null
  onChange: (v: GranteeSelection | null) => void
  shareType: string
  onShareTypeChange: (t: string) => void
  shareTypeOptions: ShareTypeOption[]
  onAdd: () => void | Promise<void>
  adding?: boolean
  disabled?: boolean
  /** 隱藏某些 type (e.g. bot 場景可能不要 org_group) */
  excludeTypes?: GranteeType[]
  /** LOV 端點 — 預設 /dashboard/orgs，某些模組用 /kb/orgs */
  orgsUrl?: '/dashboard/orgs' | '/kb/orgs'
}

interface Role {
  id: number
  name: string
}

export default function ShareGranteePicker({
  value,
  onChange,
  shareType,
  onShareTypeChange,
  shareTypeOptions,
  onAdd,
  adding = false,
  disabled = false,
  excludeTypes = [],
  orgsUrl = '/dashboard/orgs',
}: Props) {
  const { t } = useTranslation()
  const [granteeType, setGranteeType] = useState<GranteeType>('user')
  const [orgs, setOrgs] = useState<OrgLovResponse | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [search, setSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [userDisplay, setUserDisplay] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  const availableTypes = DEFAULT_TYPES.filter(tp => !excludeTypes.includes(tp))

  // Load orgs + roles once，依當前 lang
  useEffect(() => {
    const lang = i18n.language || 'zh-TW'
    api.get(`${orgsUrl}?lang=${encodeURIComponent(lang)}`).then(r => setOrgs(r.data)).catch(() => {})
    api.get('/roles').then(r => setRoles(r.data || [])).catch(() => {})
  }, [orgsUrl])

  // 切換 grantee type 清空選擇 + 搜尋
  useEffect(() => {
    onChange(null)
    setSearch('')
    setUserDisplay('')
    setShowDropdown(false)
  }, [granteeType])

  // Outside click 收起 dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 取當前 type 的候選清單
  const candidates: GranteeLovOption[] = useMemo(() => {
    if (!orgs && granteeType !== 'role') return []
    switch (granteeType) {
      case 'role':
        return roles.map(r => ({ code: String(r.id), name: r.name }))
      case 'factory':
        return orgs?.factories || []
      case 'department':
        return orgs?.depts || []
      case 'cost_center':
        return orgs?.profit_centers || []
      case 'division':
        return orgs?.org_sections || []
      case 'org_group':
        return orgs?.org_groups || []
      default:
        return []
    }
  }, [granteeType, orgs, roles])

  const filtered = useMemo(() => filterAndRank(granteeType, candidates, search, 50), [granteeType, candidates, search])

  const canAdd = !!value && !disabled && !adding

  const selectOption = (opt: GranteeLovOption) => {
    // role: id=role.id(數字字串)；其他: id=code or name
    let id: string
    if (granteeType === 'role') {
      id = opt.code || ''
    } else if (granteeType === 'org_group') {
      id = opt.name  // org_group 用 name 當 key
    } else {
      id = opt.code || ''
    }
    const label = granteeType === 'role'
      ? opt.name
      : formatGranteeLabel(granteeType, opt.code, opt.name)
    onChange({ type: granteeType, id, label })
    setSearch(label)
    setShowDropdown(false)
  }

  const clearSelection = () => {
    onChange(null)
    setSearch('')
    setShowDropdown(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        {/* Grantee type */}
        <select
          value={granteeType}
          onChange={e => setGranteeType(e.target.value as GranteeType)}
          disabled={disabled}
          className="border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white"
        >
          {availableTypes.map(tp => (
            <option key={tp} value={tp}>{t(`grantee.type.${tp}`)}</option>
          ))}
        </select>

        {/* Share type */}
        <select
          value={shareType}
          onChange={e => onShareTypeChange(e.target.value)}
          disabled={disabled}
          className="border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white"
        >
          {shareTypeOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <button
          onClick={onAdd}
          disabled={!canAdd}
          className="ml-auto px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40"
        >
          {adding ? '...' : t('common.add', '新增')}
        </button>
      </div>

      {/* Picker — user 用 UserPicker，其他用 Combobox */}
      {granteeType === 'user' ? (
        <UserPicker
          value={value?.id || ''}
          display={userDisplay}
          onChange={(id, disp) => {
            setUserDisplay(disp)
            if (id) onChange({ type: 'user', id, label: disp })
            else onChange(null)
          }}
          className="w-full"
        />
      ) : (
        <div className="relative" ref={dropdownRef}>
          <div className="relative">
            <input
              type="text"
              value={value?.label || search}
              onChange={e => {
                onChange(null)
                setSearch(e.target.value)
                setShowDropdown(true)
              }}
              onFocus={() => setShowDropdown(true)}
              placeholder={t('grantee.searchPlaceholder', '輸入代碼或名稱搜尋...')}
              disabled={disabled}
              className="w-full border border-slate-200 rounded pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:border-blue-400"
            />
            {(value || search) && !disabled && (
              <button
                onClick={clearSelection}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                type="button"
                tabIndex={-1}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Dropdown */}
          {showDropdown && !value && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded shadow-lg z-20 max-h-60 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-400">
                  {t('grantee.noMatch', '無符合項目')}
                </div>
              ) : (
                filtered.map((opt, idx) => (
                  <button
                    key={`${opt.code || ''}::${opt.name}::${idx}`}
                    onClick={() => selectOption(opt)}
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
                  >
                    {hasCode(granteeType) && (
                      <span className="font-mono text-xs text-slate-500 min-w-[60px] flex-shrink-0">
                        {renderHighlighted(opt.code || '', search)}
                      </span>
                    )}
                    <span className="text-slate-800 truncate">
                      {renderHighlighted(opt.name, search)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function renderHighlighted(text: string, query: string) {
  const [before, match, after] = splitForHighlight(text, query)
  if (!match) return text
  return (
    <>
      {before}
      <span className="bg-yellow-200">{match}</span>
      {after}
    </>
  )
}
