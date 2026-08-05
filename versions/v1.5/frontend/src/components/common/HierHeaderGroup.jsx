import React, { useMemo, useState } from 'react'

export default function HierHeaderGroup(props) {
  const { columnGroup, api } = props
  const level = useMemo(() => {
    let l = 1
    let p = columnGroup.getParent()
    while (p) {
      l += 1
      p = p.getParent()
    }
    return l
  }, [columnGroup])

  const [expanded, setExpanded] = useState(true)

  const collectLeafIds = group => {
    const children = group.getLeafColumns()
    return children.map(c => c.getColId())
  }


  const toggle = () => {
    const ids = collectLeafIds(columnGroup)
    api.setColumnsVisible(ids, !expanded)
    setExpanded(!expanded)
  }

  const label = useMemo(() => {
    const def = columnGroup.getColGroupDef ? columnGroup.getColGroupDef() : null
    return (def && def.headerName) || columnGroup.getColId?.() || columnGroup.getColId || ''
  }, [columnGroup])
  const upper = String(label || '').toUpperCase()
  const kind = (upper.includes('POTONGAN') ? 'kind-deduction'
    : (upper.includes('PENDAPATAN') || upper.includes('TUNJANGAN') || upper.includes('PREMI')) ? 'kind-income'
      : 'kind-neutral')

  const indent = (level - 1) * 8
  return (
    <div className={`hdr-group hdr-level-${level} ${kind}`} style={{
      paddingLeft: indent,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      whiteSpace: 'normal',
      lineHeight: '1.2',
      textAlign: 'center',
      overflow: 'hidden'
    }}>
      <span className="hdr-label" style={{ width: '100%' }}>{label}</span>
    </div>
  )
}
