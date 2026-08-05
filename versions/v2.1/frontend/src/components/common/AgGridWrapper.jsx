import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'

export default function AgGridWrapper({ columnDefs, rowData }) {
  return <div className="ag-theme-alpine" style={{ height: 600, width: '100%' }}>
    <AgGridReact
      columnDefs={columnDefs}
      rowData={rowData}
      pagination
      paginationPageSize={20}
      rowSelection="single"
      enableCellTextSelection={true}
      ensureDomOrder={true}
    />
  </div>
}
