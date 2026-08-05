export default function Modal({ open, title, children, onClose }) {
  if (!open) return null
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div style={{ background:'#fff', padding:16, borderRadius:8, minWidth:360 }}>
        <div style={{ fontWeight:700, marginBottom:8 }}>{title}</div>
        {children}
        <div style={{ marginTop:12, textAlign:'right' }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
